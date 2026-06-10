import { callOpenAIJson, OPENAI_CONFIG, warmUpConnection } from '../utils/openai-client.js';
import { arrayBufferToBase64 } from '../utils/binary.js';
import { mapWithConcurrency, callWithRetry } from '../utils/agent-pool.js';

// Cap on the raw-text COPY persisted with the extraction (storage-quota guard
// only — the full text always reaches the LLM sub-agents via segments, and
// rawTextTruncated flags the stored copy when it was clipped).
const MAX_RAW_TEXT_CHARS = 400000;
// Segment size is bounded by the per-call TIMEOUT, not by context: a reasoning
// model (gpt-5.5) doing an EXHAUSTIVE extraction of a large segment blows the
// ~95s per-call timeout on dense pages — which surfaces to the user as
// "extraction failed". 6000 chars is the proven timeout-safe size. To use
// bigger chunks, point the bulk calls at a faster model via VITE_OPENAI_FAST_MODEL
// (a fast model finishes a big segment well under the timeout) and raise this.
const TEXT_SEGMENT_CHARS = 6000;
const IMAGE_BATCH_SIZE = 2;
// Concurrency is the number of in-flight sub-agent calls. The Responses API is
// HTTP/2, so these multiplex over one warm connection — wall-clock time is the
// number of sequential waves (a 24-segment page is 2 waves at 12, 4 at 6).
// callWithRetry absorbs the occasional 429 this provokes, and the run budget
// still caps total spend.
const TEXT_CONCURRENCY = 12;
const IMAGE_CONCURRENCY = 6;
// Image bytes are fetched ahead of the vision sub-agents (network-bound, zero
// token cost), so VLM slots never idle waiting on a slow CDN.
const IMAGE_PREFETCH_CONCURRENCY = 8;

// Coverage is bounded by a per-run BUDGET, never by a fixed segment/image count.
// The number of LLM/VLM calls scales with the page; dispatch stops only when the
// run would exceed one of these ceilings, and every skip is logged to warnings[].
//   - wallClockMs: hard master — kept under the MV3 service-worker
//     "unresponsive" kill tolerance.
//   - maxTokens: soft ceiling on estimated total subagent token spend (cost).
//   - maxStorageBytes: guards the ~10MB chrome.storage.local quota.
const DEFAULT_BUDGET_WALL_CLOCK_MS = 220000;
const DEFAULT_BUDGET_MAX_TOKENS = 350000;
const DEFAULT_BUDGET_MAX_STORAGE_BYTES = 8_500_000;
const CHARS_PER_TOKEN = 4; // rough chars→tokens estimate for budgeting
const VISION_TOKENS_PER_IMAGE = 1200; // est. cost of one low-detail image (in+out)

// Reasoning models (e.g. gpt-5.5) count reasoning tokens against this budget,
// so it must leave room for the chain of thought plus the JSON output.
// Extraction is EXHAUSTIVE (every fact/claim becomes its own item), so output
// can be large — generous caps avoid truncating real content. The hierarchical
// reducer below handles any overflow at merge time without dropping facts.
const MAX_TEXT_OUTPUT_TOKENS = 9000;
const MAX_IMAGE_OUTPUT_TOKENS = 3500;
const MAX_ORCHESTRATOR_OUTPUT_TOKENS = 16000;
// When candidate facts would overflow one orchestrator call, merge them in
// batches up a tree until the set fits — never silently drop the overflow.
const REDUCE_FACT_BATCH = 40;
// Extraction is structured fact-finding, not open-ended problem solving — low
// reasoning effort keeps the subagents fast and cheap without losing accuracy.
const EXTRACTION_REASONING_EFFORT = 'low';

// ── Budget helpers ────────────────────────────────────────────────────────
// A budget is the SOLE coverage ceiling. canDispatch() is checked before each
// subagent call; recordSpend() reserves the projected cost so concurrent
// workers see it. Wall-clock is a hard stop (MV3 kill risk); tokens are soft.
function buildBudget(overrides = {}) {
  return {
    wallClockMs: boundedTimeout(DEFAULT_BUDGET_WALL_CLOCK_MS),
    maxTokens: DEFAULT_BUDGET_MAX_TOKENS,
    maxStorageBytes: DEFAULT_BUDGET_MAX_STORAGE_BYTES,
    startedAt: Date.now(),
    spentTokens: 0,
    ...overrides,
  };
}

function estimateTokens(chars) {
  return Math.ceil(Math.max(0, Number(chars) || 0) / CHARS_PER_TOKEN);
}

function budgetElapsed(budget) {
  return Date.now() - (budget?.startedAt || Date.now());
}

function canDispatch(budget, projectedTokens) {
  if (!budget) return true;
  if (budgetElapsed(budget) >= budget.wallClockMs) return false;
  if (budget.spentTokens + Math.max(0, projectedTokens || 0) > budget.maxTokens) return false;
  return true;
}

function recordSpend(budget, tokens) {
  if (budget) budget.spentTokens += Math.max(0, Number(tokens) || 0);
}

// Stops sub-agent retries once the run's wall-clock budget is spent (don't
// burn the budget retrying a dead page).
function budgetStop(budget) {
  return () => Boolean(budget) && budgetElapsed(budget) >= budget.wallClockMs;
}

const FACT_KINDS = new Set(['FACT', 'CLAIM', 'QUOTE', 'FIGURE', 'COUNTER', 'VISUAL']);
const FACT_SOURCES = new Set(['text', 'image', 'mixed']);

// Verbose per-call extraction tracing. OFF by default: every call below was
// handing full prompts, raw responses, the whole page text, and every image
// object to console.log on each run — pure overhead and noise in production.
// Flip to true only when actively debugging the pipeline.
const EXTRACTION_DEBUG = false;

function logExtraction(label, details) {
  if (!EXTRACTION_DEBUG) return;
  try {
    console.log(`[Clear Extraction][background] ${label}`, details);
  } catch {}
}

function boundedTimeout(maxMs) {
  const configured = Number(OPENAI_CONFIG.timeoutMs);
  return Number.isFinite(configured) && configured > 0 ? Math.min(configured, maxMs) : maxMs;
}

const TEXT_STAGE_TIMEOUT_MS = boundedTimeout(95000);
const IMAGE_STAGE_TIMEOUT_MS = boundedTimeout(95000);
const ORCHESTRATOR_TIMEOUT_MS = boundedTimeout(120000);

const factSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'kind', 'text', 'evidence', 'confidence', 'source', 'sectionIds', 'imageIds'],
  properties: {
    id: { type: 'string' },
    kind: { type: 'string', enum: Array.from(FACT_KINDS) },
    text: { type: 'string' },
    evidence: { type: 'string' },
    confidence: { type: 'number' },
    source: { type: 'string', enum: Array.from(FACT_SOURCES) },
    sectionIds: { type: 'array', items: { type: 'string' } },
    imageIds: { type: 'array', items: { type: 'string' } },
  },
};

const extractionStageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'topic', 'facts', 'entities', 'keyTerms', 'warnings'],
  properties: {
    title: { type: 'string' },
    topic: { type: 'string' },
    facts: { type: 'array', items: factSchema },
    entities: { type: 'array', items: { type: 'string' } },
    keyTerms: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

const finalExtractionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'topic', 'facts', 'entities', 'keyTerms', 'compactText', 'warnings'],
  properties: {
    title: { type: 'string' },
    topic: { type: 'string' },
    facts: { type: 'array', items: factSchema },
    entities: { type: 'array', items: { type: 'string' } },
    keyTerms: { type: 'array', items: { type: 'string' } },
    compactText: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

// Vision is a CURATOR + CAPTIONER, decoupled from fact extraction. Each image
// gets a keep/drop verdict and a caption; `fact` is an OPTIONAL bonus carried as
// an empty string when absent (OpenAI strict mode requires every key present).
const visionImageVerdictSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['imageId', 'keep', 'reason', 'caption', 'fact'],
  properties: {
    imageId: { type: 'string' },
    keep: { type: 'boolean' },
    reason: { type: 'string' },
    caption: { type: 'string' },
    fact: { type: 'string' },
  },
};

const visionStageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['images'],
  properties: {
    images: { type: 'array', items: visionImageVerdictSchema },
  },
};

// Merge-only schema for the hierarchical fact reducer.
const factMergeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['facts'],
  properties: {
    facts: { type: 'array', items: factSchema },
  },
};

function trimText(text, maxChars = Number.POSITIVE_INFINITY) {
  const value = String(text || '').replace(/\n{3,}/g, '\n\n').trim();
  return value.length > maxChars ? value.slice(0, maxChars) + '\n...(truncated)' : value;
}

function errorMessage(error) {
  return error?.message || String(error || 'unknown error');
}

function plural(count, singular, pluralValue = singular + 's') {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

async function getVisibleText(tabId) {
  try {
    // Target the main frame only. With all_frames enabled the content script
    // runs in every iframe, so without frameId Chrome would broadcast to all
    // frames and a subframe could answer first with partial content.
    const response = await chrome.tabs.sendMessage(tabId, { action: 'extract-visible-page-text' }, { frameId: 0 });
    if (response?.success) return response;
  } catch {}
  return { success: false, text: '', images: [], sections: [], title: '', url: '' };
}

function uniqueStrings(items, maxItems = 60) {
  const seen = new Set();
  const output = [];
  for (const item of items || []) {
    const value = String(item || '').trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= maxItems) break;
  }
  return output;
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function clampConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.75;
  return Math.max(0, Math.min(1, numeric));
}

function normalizeIdList(items) {
  return uniqueStrings((items || []).map((item) => String(item || '').trim()), 12);
}

function normalizeFact(raw, index, fallback = {}) {
  const text = typeof raw === 'string' ? raw : String(raw?.text || raw?.content || '').trim();
  if (!text) return null;
  const rawKind = typeof raw === 'object' ? String(raw.kind || raw.type || '').toUpperCase() : '';
  const rawSource = typeof raw === 'object' ? String(raw.source || '').toLowerCase() : '';
  const rawSectionIds = typeof raw === 'object' && Array.isArray(raw.sectionIds) ? raw.sectionIds : fallback.sectionIds;
  const rawImageIds = typeof raw === 'object' && Array.isArray(raw.imageIds) ? raw.imageIds : fallback.imageIds;
  const imageIds = normalizeIdList(rawImageIds);
  const source = FACT_SOURCES.has(rawSource) ? rawSource : (fallback.source || (imageIds.length ? 'image' : 'text'));
  const rawProvenance = typeof raw === 'object' ? String(raw.provenance || '').toLowerCase() : '';

  return {
    id: String(typeof raw === 'object' && raw.id ? raw.id : `fact-${index + 1}`),
    kind: FACT_KINDS.has(rawKind) ? rawKind : (source === 'image' ? 'VISUAL' : 'CLAIM'),
    text,
    evidence: String(typeof raw === 'object' ? raw.evidence || '' : '').trim(),
    confidence: clampConfidence(typeof raw === 'object' ? raw.confidence : 0.75),
    source,
    sectionIds: normalizeIdList(rawSectionIds),
    imageIds,
    // Provenance is code-assigned (not LLM-generated): extraction is always
    // page-faithful. A future enrichment stage may set 'enrichment'.
    provenance: rawProvenance === 'enrichment' ? 'enrichment' : (fallback.provenance || 'page'),
  };
}

function normalizeFacts(rawFacts, fallback = {}) {
  const seen = new Set();
  const facts = [];
  for (const raw of rawFacts || []) {
    const fact = normalizeFact(raw, facts.length, fallback);
    const key = fact?.text.toLowerCase();
    if (!fact || seen.has(key)) continue;
    seen.add(key);
    facts.push({ ...fact, id: `fact-${facts.length + 1}` });
  }
  return facts;
}

function selectedSectionText(section) {
  const heading = String(section?.heading || '').trim();
  const text = String(section?.text || '').trim();
  return [heading ? `Heading: ${heading}` : '', text].filter(Boolean).join('\n');
}

function splitLongText(text, maxChars) {
  const chunks = [];
  let remaining = String(text || '').trim();
  while (remaining.length > maxChars) {
    let splitAt = remaining.lastIndexOf('\n', maxChars);
    if (splitAt < Math.floor(maxChars * 0.6)) splitAt = remaining.lastIndexOf(' ', maxChars);
    if (splitAt < Math.floor(maxChars * 0.6)) splitAt = maxChars;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function normalizeSections(visible, pageText) {
  const sections = Array.isArray(visible.sections) ? visible.sections : [];
  const normalized = sections
    .map((section, index) => ({
      id: String(section?.id || `section-${index + 1}`),
      index: Number.isFinite(Number(section?.index)) ? Number(section.index) : index,
      heading: String(section?.heading || '').trim(),
      // Full section text, whitespace-normalized only — a section longer than
      // one segment is SPLIT across sub-agents by planTextSegments, never cut.
      text: trimText(section?.text || ''),
      imageIds: normalizeIdList(section?.imageIds || []),
    }))
    .filter((section) => section.heading || section.text);

  if (normalized.length) return normalized;
  return pageText ? [{
    id: 'section-1',
    index: 0,
    heading: '',
    text: pageText,
    imageIds: [],
  }] : [];
}

function plannedTextCharCount(sections, pageText) {
  const sectionChars = sections.reduce((sum, section) => sum + String(section.text || '').length, 0);
  return sectionChars || String(pageText || '').length;
}

// Returns ALL usable candidate images (deduped by URL), ordered by score so the
// vision step evaluates the strongest first — if the budget runs out mid-page,
// the lowest-signal images are the ones left unevaluated. No fixed count cap:
// the run budget decides how many reach the VLM. Render order is restored to
// page order downstream.
function selectWebsiteImages(images = []) {
  const seen = new Set();
  const selected = [];
  for (const image of images) {
    const url = String(image?.url || image?.imageUrl || '').trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const pageIndex = Number(image.index);
    selected.push({
      id: String(image.id || `image-${selected.length + 1}`),
      url,
      alt: String(image.alt || '').trim(),
      caption: String(image.caption || '').trim(),
      heading: String(image.heading || '').trim(),
      nearbyText: String(image.nearbyText || '').trim(),
      sectionIds: normalizeIdList(image.sectionIds || []),
      width: Number(image.width || 0),
      height: Number(image.height || 0),
      renderedWidth: Number(image.renderedWidth || 0),
      renderedHeight: Number(image.renderedHeight || 0),
      index: Number.isFinite(pageIndex) ? pageIndex : selected.length,
      source: String(image.source || '').trim(),
      score: Number(image.score || 0),
    });
  }

  return selected.sort((a, b) => b.score - a.score || a.index - b.index);
}

function filterSectionImageIds(sections, images) {
  const selected = new Set(images.map((image) => image.id));
  return sections.map((section) => ({
    ...section,
    imageIds: (section.imageIds || []).filter((imageId) => selected.has(imageId)),
  }));
}

function imageIdsForSections(images, sectionIds) {
  const wanted = new Set(sectionIds || []);
  return images
    .filter((image) => (image.sectionIds || []).some((sectionId) => wanted.has(sectionId)))
    .map((image) => image.id);
}

function planTextSegments(sections, images, pageText) {
  const segments = [];
  let current = null;

  const pushCurrent = () => {
    if (!current?.text.trim()) return;
    current.imageIds = normalizeIdList([
      ...current.imageIds,
      ...imageIdsForSections(images, current.sectionIds),
    ]);
    segments.push({
      id: `text-segment-${segments.length + 1}`,
      sectionIds: normalizeIdList(current.sectionIds),
      headings: uniqueStrings(current.headings, 12),
      imageIds: current.imageIds,
      text: current.text.trim(),
    });
  };

  for (const section of sections) {
    const sectionText = selectedSectionText(section);
    if (!sectionText) continue;
    const pieces = sectionText.length > TEXT_SEGMENT_CHARS
      ? splitLongText(sectionText, TEXT_SEGMENT_CHARS)
      : [sectionText];
    for (const piece of pieces) {
      const nextText = current?.text ? `${current.text}\n\n${piece}` : piece;
      if (current && nextText.length > TEXT_SEGMENT_CHARS) {
        pushCurrent();
        current = null;
      }
      if (!current) current = { text: '', sectionIds: [], headings: [], imageIds: [] };
      current.text = current.text ? `${current.text}\n\n${piece}` : piece;
      current.sectionIds.push(section.id);
      if (section.heading) current.headings.push(section.heading);
      current.imageIds.push(...imageIdsForSections(images, [section.id]));
    }
  }

  pushCurrent();

  if (!segments.length && pageText) {
    return splitLongText(pageText, TEXT_SEGMENT_CHARS).map((text, index) => ({
      id: `text-segment-${index + 1}`,
      sectionIds: ['section-1'],
      headings: [],
      imageIds: [],
      text,
    }));
  }
  return segments;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function formatImageMetadata(images) {
  if (!images.length) return 'No direct website images in this batch.';
  return images.map((image, index) => [
    `Image input ${index + 1}`,
    `ID: ${image.id}`,
    `URL: ${image.url}`,
    image.source ? `Source: ${image.source}` : '',
    image.sectionIds?.length ? `Section IDs: ${image.sectionIds.join(', ')}` : '',
    image.heading ? `Nearby heading: ${image.heading}` : '',
    image.alt ? `Alt text: ${image.alt}` : '',
    image.caption ? `Caption: ${image.caption}` : '',
    image.nearbyText ? `Nearby text: ${image.nearbyText}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');
}

function buildTextPrompt({ segment, index, total, pageMetadata, visible }) {
  return [
    'Extract ALL the knowledge present in this page-text segment as discrete facts and claims, for a renarration system.',
    'Use only this segment. Do not infer facts from missing segments.',
    'Be EXHAUSTIVE about real content: capture every substantive fact, claim, statement, statistic or figure, quoted line, definition, example, cause/effect, comparison, caveat, and conclusion. Emit each distinct point as its own atomic item — do NOT summarize, compress, or merge separate points. Nothing substantive should be lost.',
    'Do NOT add related or outside information — only what is literally in this segment.',
    'The ONLY things to skip are non-content page chrome: site navigation, breadcrumbs, menus, search bars, login/signup prompts, newsletter signups, cookie/GDPR banners, ads, sponsored content, social-share buttons, related-article or "recommended for you" lists, comment threads, author bios, footer text, legal/copyright notices, "trending now" widgets, and sidebar promos.',
    'If the segment is entirely boilerplate or chrome (nav, footer, ad slot, etc.), return an empty facts array rather than fabricating filler.',
    'Link each fact to the provided section IDs. Only attach an image ID when the surrounding text directly discusses that specific image.',
    'Use FACT for established facts, CLAIM for author/source claims, QUOTE for direct quoted material, FIGURE for numbers/statistics, COUNTER for caveats or opposing points, and VISUAL only when text describes a visual element.',
    '',
    `URL: ${pageMetadata.url || visible.url || ''}`,
    `Title: ${pageMetadata.title || visible.title || ''}`,
    `Text segment: ${index + 1} of ${total}`,
    `Segment ID: ${segment.id}`,
    `Section IDs: ${segment.sectionIds.join(', ') || 'none'}`,
    `Nearby image IDs: ${segment.imageIds.join(', ') || 'none'}`,
    '',
    'Visible page text segment:',
    segment.text,
  ].join('\n');
}

function buildVisionPrompt({ batch, index, total, pageMetadata, visible }) {
  return [
    'You are curating webpage images for a clean reading / static-site rebuild.',
    'For EACH image provided below, return exactly one verdict object keyed by its given image ID.',
    'Decide keep vs drop by STRICT relevance to the page\'s MAIN topic (title + metadata above).',
    'Set keep=true ONLY for images that directly illustrate the subject: figures, charts, diagrams, screenshots, data visualizations, photos of the actual person/place/thing/event, or labeled illustrations.',
    'Set keep=false for advertisements, sponsored content, logos, brand marks, social-share icons, navigation controls, author or profile avatars, decorative patterns, generic stock-photo filler, unrelated illustrations, or anything off-topic.',
    'caption: a brief one-sentence factual description of what the image actually shows. Required for kept images.',
    'reason: a few words on why kept or dropped (e.g. "revenue chart", "ad banner", "author avatar").',
    'fact: OPTIONAL bonus. If the image conveys a concrete fact supporting the topic (e.g. a value read off a chart), put it here; otherwise return an empty string "". Never invent a fact to justify keeping an image.',
    'Return one entry per input image, using the exact provided image IDs. Do not invent images that were not provided.',
    '',
    `URL: ${pageMetadata.url || visible.url || ''}`,
    `Title: ${pageMetadata.title || visible.title || ''}`,
    `Image batch: ${index + 1} of ${total}`,
    '',
    formatImageMetadata(batch),
  ].join('\n');
}

function normalizeVisionVerdicts(rawVerdicts, batchImages) {
  const validIds = new Set((batchImages || []).map((image) => image.id));
  const byId = new Map();
  for (const raw of rawVerdicts || []) {
    const imageId = String(raw?.imageId || '').trim();
    if (!imageId || !validIds.has(imageId) || byId.has(imageId)) continue;
    byId.set(imageId, {
      imageId,
      keep: raw?.keep === true,
      reason: String(raw?.reason || '').trim(),
      caption: String(raw?.caption || '').trim(),
      fact: String(raw?.fact || '').trim(),
    });
  }
  return Array.from(byId.values());
}

function buildOrchestratorPrompt({ facts, meta, sections, images, pageMetadata, visible }) {
  const sectionOutline = sections.slice(0, 40).map((section) => ({
    id: section.id,
    index: section.index,
    heading: section.heading,
    imageIds: section.imageIds,
    textPreview: trimText(section.text, 500),
  }));
  const imageOutline = images.map((image) => ({
    id: image.id,
    sectionIds: image.sectionIds,
    heading: image.heading,
    alt: image.alt,
    caption: image.caption,
    nearbyText: image.nearbyText,
  }));

  return [
    'You are the final extraction orchestrator for a webpage renarration system.',
    'Consolidate the candidate facts (already extracted from page text and images) into the COMPLETE knowledge set for the page.',
    'Your job is CONSOLIDATION, not curation: retain every distinct substantive fact, claim, quote, figure, and detail. Do NOT drop content for being minor or for being a "long list". Only merge genuine duplicates and near-duplicates into the single most complete fact.',
    'When two candidates overlap, merge them into the most complete single fact rather than discarding either. Preserve uncertainty by lowering confidence instead of inventing details.',
    'Drop ONLY page chrome that slipped through: navigation, breadcrumbs, search bars, login/signup prompts, cookie/GDPR banners, ads or sponsored slots, social-share widgets, "recommended for you" / "related" / "trending" lists, comments, footer text, legal/copyright notices, site-section promos.',
    'Stay page-faithful: do not add related or outside information that is not in the candidate facts.',
    'Link kept facts to sectionIds and imageIds when supported by the evidence. Use source "mixed" only when both text and image evidence support the same fact.',
    'Produce compactText as dense plain-text notes covering ALL the facts, suitable for a later renarration prompt — only the facts, no boilerplate. No Markdown tables, no HTML.',
    '',
    `URL: ${pageMetadata.url || visible.url || ''}`,
    `Title: ${pageMetadata.title || visible.title || ''}`,
    meta?.topics?.length ? `Candidate topics: ${meta.topics.join(' | ')}` : '',
    '',
    'Page sections JSON:',
    JSON.stringify(sectionOutline),
    '',
    'Selected image metadata JSON:',
    JSON.stringify(imageOutline),
    '',
    'Candidate facts JSON:',
    JSON.stringify(facts),
  ].filter((line) => line !== '').join('\n');
}

function buildFactMergePrompt({ facts, pageMetadata, visible }) {
  return [
    'Merge and deduplicate this batch of candidate facts from a webpage for the page\'s MAIN TOPIC.',
    'Collapse overlapping facts into the most complete single fact; drop page-chrome facts (nav, ads, cookie banners, related/trending lists, comments, footers).',
    'Stay page-faithful: do not invent or add outside information. Preserve sectionIds and imageIds. Keep the strongest source.',
    '',
    `URL: ${pageMetadata.url || visible.url || ''}`,
    `Title: ${pageMetadata.title || visible.title || ''}`,
    '',
    'Candidate facts JSON:',
    JSON.stringify(facts),
  ].join('\n');
}

function estimateFactsTokens(facts) {
  return estimateTokens(JSON.stringify(facts || []).length);
}

async function mergeFactBatch({ facts, pageMetadata, visible }) {
  const prompt = buildFactMergePrompt({ facts, pageMetadata, visible });
  const result = await callOpenAIJson({
    schema: factMergeSchema,
    schemaName: 'page_fact_merge_batch',
    prompt,
    model: OPENAI_CONFIG.fastModel,
    maxOutputTokens: MAX_ORCHESTRATOR_OUTPUT_TOKENS,
    timeoutMs: ORCHESTRATOR_TIMEOUT_MS,
    reasoningEffort: EXTRACTION_REASONING_EFFORT,
  });
  return normalizeFacts(result.json?.facts || []);
}

// Hierarchical reduce: when the candidate fact set would overflow a single
// orchestrator call's output budget, merge it in batches up a tree until it
// fits — so no distinct fact is silently dropped at the token ceiling. Batch
// failures fall back to the (deduped) input for that batch and are warned.
async function reduceFactsHierarchically({ facts, pageMetadata, visible, warnings, onProgress }) {
  const threshold = Math.floor(MAX_ORCHESTRATOR_OUTPUT_TOKENS * 0.6);
  let current = normalizeFacts(facts);
  let round = 0;
  while (estimateFactsTokens(current) > threshold && current.length > REDUCE_FACT_BATCH && round < 4) {
    round += 1;
    const batches = chunkArray(current, REDUCE_FACT_BATCH);
    onProgress?.(`Reducing ${plural(current.length, 'fact')} in ${plural(batches.length, 'batch', 'batches')}...`);
    const merged = await mapWithConcurrency(batches, TEXT_CONCURRENCY, async (batch, index) => {
      try {
        return await mergeFactBatch({ facts: batch, pageMetadata, visible });
      } catch (error) {
        warnings.push(`Fact-merge batch ${round}.${index + 1} failed: ${errorMessage(error)}`);
        return batch; // keep the un-merged (but deduped) batch rather than lose it
      }
    });
    const next = normalizeFacts(merged.flat());
    if (next.length >= current.length) break; // no further reduction possible
    current = next;
  }
  return current;
}

async function runTextSubagents({ segments, pageMetadata, visible, budget, onProgress }) {
  if (!segments.length) return [];
  onProgress?.(`Extracting text knowledge from ${plural(segments.length, 'segment')}...`);
  return mapWithConcurrency(segments, TEXT_CONCURRENCY, async (segment, index) => {
    const agentId = `text-${index + 1}`;
    // Budget gate: reserve the projected cost before dispatching so concurrent
    // workers see the reservation. Skipped segments are reported, never silent.
    const projected = estimateTokens(String(segment.text || '').length) + MAX_TEXT_OUTPUT_TOKENS;
    if (!canDispatch(budget, projected)) {
      logExtraction(`${agentId} skipped (budget)`, { agentId, sourceType: 'text', sectionIds: segment.sectionIds });
      return { ok: true, skipped: true, agentId, sourceType: 'text' };
    }
    recordSpend(budget, projected);
    const prompt = buildTextPrompt({ segment, index, total: segments.length, pageMetadata, visible });
    logExtraction(`${agentId} request`, {
      agentId,
      sourceType: 'text',
      model: OPENAI_CONFIG.fastModel,
      maxOutputTokens: MAX_TEXT_OUTPUT_TOKENS,
      timeoutMs: TEXT_STAGE_TIMEOUT_MS,
      segment,
      prompt,
    });
    try {
      if (segments.length > 1) onProgress?.(`Extracting text segment ${index + 1}/${segments.length}...`);
      const result = await callWithRetry(() => callOpenAIJson({
        schema: extractionStageSchema,
        schemaName: 'page_text_segment',
        prompt,
        model: OPENAI_CONFIG.fastModel,
        maxOutputTokens: MAX_TEXT_OUTPUT_TOKENS,
        timeoutMs: TEXT_STAGE_TIMEOUT_MS,
        reasoningEffort: EXTRACTION_REASONING_EFFORT,
      }), { retries: 1, shouldStop: budgetStop(budget) });
      logExtraction(`${agentId} response`, {
        agentId,
        sourceType: 'text',
        json: result.json || {},
        response: result.response,
      });
      return {
        ok: true,
        agentId,
        sourceType: 'text',
        fallback: { sectionIds: segment.sectionIds, imageIds: segment.imageIds, source: 'text' },
        json: result.json || {},
      };
    } catch (error) {
      logExtraction(`${agentId} error`, {
        agentId,
        sourceType: 'text',
        error: errorMessage(error),
      });
      return {
        ok: false,
        agentId,
        sourceType: 'text',
        error: errorMessage(error),
      };
    }
  });
}

// OpenAI's servers frequently cannot download a page's image URLs (hotlink
// protection, expiring CDN tokens, bot-blocked fetchers) — that fails the
// whole vision batch with an HTTP 400 "Error while downloading" response. The
// background service worker has <all_urls> host access, so it fetches the
// bytes itself and sends them inline as data URIs instead.
const IMAGE_FETCH_TIMEOUT_MS = 12000;
const MAX_VISION_IMAGE_BYTES = 3_000_000;

async function fetchImageAsDataUrl(url) {
  if (!/^https?:\/\//i.test(String(url || ''))) return '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
    if (!response.ok) return '';
    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType && !contentType.startsWith('image/')) return '';
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength || buffer.byteLength > MAX_VISION_IMAGE_BYTES) return '';
    return `data:${contentType || 'image/jpeg'};base64,${arrayBufferToBase64(buffer)}`;
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

// Starts downloading every candidate image's bytes immediately — in parallel
// with the text sub-agents — and hands back a per-image promise map for the
// vision sub-agents to await. Bandwidth only (no tokens), so it runs ahead of
// the budget gate; a budget-skipped batch simply never awaits its entries.
function prefetchImageDataUrls(images) {
  const promises = new Map();
  if (!images.length) return promises;
  const resolvers = new Map();
  for (const image of images) {
    promises.set(image.id, new Promise((resolve) => resolvers.set(image.id, resolve)));
  }
  const queue = [...images];
  const workers = Array.from({ length: Math.min(IMAGE_PREFETCH_CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const image = queue.shift();
      resolvers.get(image.id)(await fetchImageAsDataUrl(image.url));
    }
  });
  Promise.all(workers).catch(() => {});
  return promises;
}

async function runVisionSubagents({ batches, prefetchedImages, pageMetadata, visible, budget, onProgress }) {
  if (!batches.length) return [];
  onProgress?.(`Curating ${plural(batches.flat().length, 'image')}...`);
  return mapWithConcurrency(batches, IMAGE_CONCURRENCY, async (batch, index) => {
    const agentId = `vision-${index + 1}`;
    const batchImageIds = batch.map((image) => image.id);

    // Budget gate: reserve the projected cost before dispatching. Strongest
    // images batch first (selectWebsiteImages sorts by score), so any
    // budget-skipped images are the lowest-signal ones — and they are reported.
    const projected = batch.length * VISION_TOKENS_PER_IMAGE + MAX_IMAGE_OUTPUT_TOKENS;
    if (!canDispatch(budget, projected)) {
      logExtraction(`${agentId} skipped (budget)`, { agentId, sourceType: 'image', imageIds: batchImageIds });
      return { ok: true, skipped: true, agentId, sourceType: 'image', imageIds: batchImageIds, verdicts: [] };
    }
    recordSpend(budget, projected);

    // Embed each image as a data URI so OpenAI never has to download the URL.
    // The bytes were prefetched at planning time, so this normally resolves
    // instantly instead of holding a VLM slot during the download.
    const images = (await Promise.all(batch.map(async (image) => {
      const dataUrl = await (prefetchedImages?.get(image.id) ?? fetchImageAsDataUrl(image.url));
      return dataUrl ? { ...image, detail: 'low', dataUrl } : null;
    }))).filter(Boolean);

    // A single dead URL would fail the whole request — if none of the batch's
    // images could be fetched, skip the call instead of sending dead URLs.
    if (!images.length) {
      logExtraction(`${agentId} skipped`, {
        agentId,
        sourceType: 'image',
        reason: 'no fetchable images in batch',
        requestedImageCount: batch.length,
      });
      return { ok: true, agentId, sourceType: 'image', imageIds: batchImageIds, verdicts: [], unfetchable: true };
    }

    const prompt = buildVisionPrompt({ batch: images, index, total: batches.length, pageMetadata, visible });
    logExtraction(`${agentId} request`, {
      agentId,
      sourceType: 'image',
      model: OPENAI_CONFIG.visionModel,
      maxOutputTokens: MAX_IMAGE_OUTPUT_TOKENS,
      timeoutMs: IMAGE_STAGE_TIMEOUT_MS,
      imageDetail: 'low',
      requestedImageCount: batch.length,
      embeddedImageCount: images.length,
      prompt,
    });
    try {
      const result = await callWithRetry(() => callOpenAIJson({
        schema: visionStageSchema,
        schemaName: 'page_image_curation',
        prompt,
        images,
        imageDetail: 'low',
        model: OPENAI_CONFIG.visionModel,
        maxOutputTokens: MAX_IMAGE_OUTPUT_TOKENS,
        timeoutMs: IMAGE_STAGE_TIMEOUT_MS,
        reasoningEffort: EXTRACTION_REASONING_EFFORT,
      }), { retries: 1, shouldStop: budgetStop(budget) });
      const verdicts = normalizeVisionVerdicts(result.json?.images || [], images);
      logExtraction(`${agentId} response`, {
        agentId,
        sourceType: 'image',
        verdicts,
        response: result.response,
      });
      return { ok: true, agentId, sourceType: 'image', imageIds: batchImageIds, verdicts };
    } catch (error) {
      logExtraction(`${agentId} error`, {
        agentId,
        sourceType: 'image',
        error: errorMessage(error),
      });
      return { ok: false, agentId, sourceType: 'image', imageIds: batchImageIds, verdicts: [], error: errorMessage(error) };
    }
  });
}

// Converts vision verdicts into (a) a per-image curation map keyed by imageId
// and (b) image-sourced facts from the optional `fact` field. Retention is the
// VLM's keep flag — decoupled from whether a fact was produced.
function collectImageCuration(visionResults) {
  const curation = new Map();
  const facts = [];
  for (const result of visionResults || []) {
    for (const verdict of result.verdicts || []) {
      if (!verdict?.imageId || curation.has(verdict.imageId)) continue;
      curation.set(verdict.imageId, {
        keep: verdict.keep === true,
        reason: verdict.reason || '',
        caption: verdict.caption || '',
      });
      if (verdict.keep === true && verdict.fact) {
        facts.push({
          kind: 'VISUAL',
          text: verdict.fact,
          evidence: verdict.caption || '',
          source: 'image',
          imageIds: [verdict.imageId],
          provenance: 'page',
        });
      }
    }
  }
  return { curation, facts: normalizeFacts(facts) };
}

// Collapses a URL to a stable identity, ignoring the variants that make one
// photo look like many: query strings, responsive size tokens, retina markers,
// and WordPress's -scaled suffix.
function curatedImageDedupeKey(image) {
  const url = String(image?.url || '').trim();
  let path = url.toLowerCase().split(/[?#]/)[0];
  try {
    const parsed = new URL(url);
    path = `${parsed.origin}${parsed.pathname}`.toLowerCase();
  } catch {
    /* keep the query-stripped raw string */
  }
  return path
    .replace(/[-_]\d{2,4}x\d{2,4}(?=(\.[a-z0-9]+)?$)/, '')
    .replace(/@\d+x(?=(\.[a-z0-9]+)?$)/, '')
    .replace(/-scaled(?=(\.[a-z0-9]+)?$)/, '');
}

function altTokenSet(text) {
  return new Set(String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2));
}

function jaccardOverlap(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

// Applies vision verdicts to the candidate images: keeps only the relevant ones
// (keep === true), attaches the VLM caption, dedupes so each photo renders once,
// and logs (never silently drops) both budget-skipped and possible-duplicate
// images. Returns kept images in page (reading) order.
function applyCurationToImages(candidateImages, curation, warnings) {
  let unevaluated = 0;
  const kept = [];
  const seenUrl = new Set();
  const seenAlt = new Set();
  for (const image of candidateImages) {
    const verdict = curation.get(image.id);
    if (!verdict) { unevaluated += 1; continue; } // never reached the VLM (budget / unreachable)
    if (!verdict.keep) continue; // dropped: not relevant to the topic
    const enriched = {
      ...image,
      keep: true,
      keepReason: verdict.reason || '',
      caption: verdict.caption || image.caption || '',
    };
    const urlKey = curatedImageDedupeKey(enriched);
    const altKey = String(enriched.alt || '').trim().toLowerCase();
    if (urlKey && seenUrl.has(urlKey)) continue; // same photo at a size/retina/scaled variant
    if (altKey && seenAlt.has(altKey)) continue; // identical alt text => same picture
    if (urlKey) seenUrl.add(urlKey);
    if (altKey) seenAlt.add(altKey);
    kept.push(enriched);
  }
  if (unevaluated) {
    warnings.push(`${unevaluated} image(s) were not curated (budget reached or unreachable) and were left out.`);
  }
  // Residual-duplicate detection: images that survived URL/alt dedup but whose
  // alt text overlaps heavily are probably the same photo at a different URL.
  // URL+alt heuristics cannot confirm this, so we LOG it as a known limitation
  // rather than silently rendering both.
  const tokenSets = kept.map((image) => altTokenSet(image.alt));
  for (let i = 0; i < kept.length; i += 1) {
    for (let j = i + 1; j < kept.length; j += 1) {
      if (tokenSets[i].size >= 3 && tokenSets[j].size >= 3 && jaccardOverlap(tokenSets[i], tokenSets[j]) >= 0.8) {
        warnings.push(`Possible duplicate images kept (${kept[i].id}, ${kept[j].id}); heuristic dedup cannot confirm (known limitation).`);
      }
    }
  }
  return kept.sort((a, b) => a.index - b.index);
}

function normalizeStageResult(result) {
  const json = result.json || {};
  return {
    ...result,
    json: {
      title: String(json.title || '').trim(),
      topic: String(json.topic || '').trim(),
      facts: normalizeFacts(json.facts || [], result.fallback),
      entities: uniqueStrings(json.entities || [], 60),
      keyTerms: uniqueStrings(json.keyTerms || [], 60),
      warnings: uniqueStrings(json.warnings || [], 20),
    },
  };
}

function compactTextFromKnowledge({ title, topic, facts }) {
  const lines = [
    title ? `Title: ${title}` : '',
    topic ? `Topic: ${topic}` : '',
    facts?.length ? 'Facts and claims:' : '',
    ...(facts || []).map((fact) => {
      const refs = [
        fact.sectionIds?.length ? `sections ${fact.sectionIds.join(', ')}` : '',
        fact.imageIds?.length ? `images ${fact.imageIds.join(', ')}` : '',
      ].filter(Boolean).join('; ');
      return refs ? `${fact.kind}: ${fact.text} (${refs})` : `${fact.kind}: ${fact.text}`;
    }),
  ].filter(Boolean);
  // No char cap: compactText must cover ALL the facts (it is bounded by the
  // fact set, which the run budget already bounds; the storage write below
  // fails loudly, never by silently clipping content).
  return trimText(lines.join('\n'));
}

function localAssembly({ facts, meta = {}, pageMetadata, visible, warnings }) {
  const normFacts = normalizeFacts(facts);
  const title = firstString(...(meta.titles || []), pageMetadata.title, visible.title);
  const topic = firstString(...(meta.topics || []));
  const knowledge = {
    title,
    topic,
    facts: normFacts,
    entities: uniqueStrings(meta.entities || [], 80),
    keyTerms: uniqueStrings(meta.keyTerms || [], 80),
  };
  return {
    ...knowledge,
    compactText: compactTextFromKnowledge(knowledge),
    warnings: uniqueStrings([...warnings, ...(meta.warnings || [])], 40),
  };
}

// Last-resort degraded extraction: when the LLM produced no facts at all (e.g.
// every text call timed out) but the page DID have readable text, turn that
// text into page-faithful facts so renarration still has full content. This is
// what makes a content-bearing page never come back as a hard "extraction
// failed" — only a page with genuinely no text falls through to an error.
function rawTextFallback({ pageText, visible, pageMetadata, warnings }) {
  const facts = normalizeFacts(
    String(pageText || '')
      .split(/\n+/)
      .map((block) => block.replace(/\s+/g, ' ').trim())
      .filter((block) => block.length > 1)
      .map((text) => ({ kind: 'FACT', text, source: 'text', provenance: 'page' })),
  );
  const knowledge = {
    title: firstString(pageMetadata.title, visible.title),
    topic: '',
    facts,
    entities: [],
    keyTerms: [],
  };
  return {
    ...knowledge,
    compactText: compactTextFromKnowledge(knowledge),
    warnings: uniqueStrings(warnings, 60),
  };
}

async function runFinalOrchestrator({ facts, meta = {}, sections, images, pageMetadata, visible, warnings, onProgress }) {
  onProgress?.('Merging text and visual knowledge...');
  // Reduce first so the single merge call below can never overflow its output
  // budget and silently drop facts.
  const reducedFacts = await reduceFactsHierarchically({ facts, pageMetadata, visible, warnings, onProgress });
  const prompt = buildOrchestratorPrompt({ facts: reducedFacts, meta, sections, images, pageMetadata, visible });
  logExtraction('orchestrator request', {
    model: OPENAI_CONFIG.textModel,
    maxOutputTokens: MAX_ORCHESTRATOR_OUTPUT_TOKENS,
    timeoutMs: ORCHESTRATOR_TIMEOUT_MS,
    candidateFactCount: facts.length,
    reducedFactCount: reducedFacts.length,
    sections,
    images,
    prompt,
  });
  const result = await callOpenAIJson({
    schema: finalExtractionSchema,
    schemaName: 'page_extraction_orchestrator',
    prompt,
    model: OPENAI_CONFIG.textModel,
    maxOutputTokens: MAX_ORCHESTRATOR_OUTPUT_TOKENS,
    timeoutMs: ORCHESTRATOR_TIMEOUT_MS,
    reasoningEffort: EXTRACTION_REASONING_EFFORT,
  });
  logExtraction('orchestrator response', {
    json: result.json || {},
    response: result.response,
  });
  const json = result.json || {};
  const outFacts = normalizeFacts(json.facts || []);
  const knowledge = {
    title: firstString(json.title, ...(meta.titles || []), pageMetadata.title, visible.title),
    topic: firstString(json.topic, ...(meta.topics || [])),
    facts: outFacts,
    entities: uniqueStrings([...(json.entities || []), ...(meta.entities || [])], 80),
    keyTerms: uniqueStrings([...(json.keyTerms || []), ...(meta.keyTerms || [])], 80),
  };
  return {
    ...knowledge,
    compactText: trimText(json.compactText || compactTextFromKnowledge(knowledge)),
    warnings: uniqueStrings(json.warnings || [], 40),
  };
}

export async function extractPageKnowledge({ tabId, pageMetadata = {}, onProgress } = {}) {
  if (!tabId) throw new Error('No active tab available for extraction');

  const started = Date.now();
  // Open the TLS connection to the API while the content script is still
  // reading the page, so the first sub-agent call skips the handshake.
  warmUpConnection();
  onProgress?.('Reading page text, sections, and images...');
  const visible = await getVisibleText(tabId);
  logExtraction('visible response from content script', {
    url: visible.url || '',
    title: visible.title || '',
    visibleTextCharCount: String(visible.text || '').length,
    visibleImageCount: Array.isArray(visible.images) ? visible.images.length : 0,
    visibleSectionCount: Array.isArray(visible.sections) ? visible.sections.length : 0,
    text: visible.text || '',
    sections: visible.sections || [],
    images: visible.images || [],
  });
  const budget = buildBudget();
  const pageText = trimText(visible.text || '');
  const rawSections = normalizeSections(visible, pageText);
  const textCharCount = plannedTextCharCount(rawSections, pageText);
  // ALL usable images are candidates (ordered by score); the budget — not a
  // fixed count — decides how many reach the vision step.
  const candidateImages = selectWebsiteImages(visible.images || []);
  const planSections = filterSectionImageIds(rawSections, candidateImages);
  const warnings = [];
  // No fixed segment cap: dispatch all planned segments, gated by the budget.
  const textSegments = planTextSegments(planSections, candidateImages, pageText);
  const imageBatches = chunkArray(candidateImages, IMAGE_BATCH_SIZE);
  logExtraction('planner output', {
    pageTextCharCount: pageText.length,
    plannedTextCharCount: textCharCount,
    rawSectionCount: rawSections.length,
    candidateImageCount: candidateImages.length,
    textSegmentCount: textSegments.length,
    imageBatchCount: imageBatches.length,
    budget,
    rawSections,
    candidateImages,
    textSegments,
    imageBatches,
    warnings,
  });
  onProgress?.(`Master agent planned ${plural(textSegments.length, 'text sub-agent')} and ${plural(imageBatches.length, 'vision sub-agent')}.`);

  // Image bytes start downloading now, in parallel with the text sub-agents,
  // so the vision sub-agents go straight to their VLM calls.
  const prefetchedImages = prefetchImageDataUrls(candidateImages);

  const [textResults, imageResults] = await Promise.all([
    runTextSubagents({ segments: textSegments, pageMetadata, visible, budget, onProgress }),
    runVisionSubagents({ batches: imageBatches, prefetchedImages, pageMetadata, visible, budget, onProgress }),
  ]);

  // Surface budget-skipped work — coverage is bounded, never silently truncated.
  const skippedTextCount = textResults.filter((result) => result.skipped).length;
  if (skippedTextCount) {
    warnings.push(`Budget reached: ${skippedTextCount} of ${textSegments.length} text segment(s) were not extracted.`);
  }
  const skippedImageCount = imageResults
    .filter((result) => result.skipped)
    .reduce((sum, result) => sum + (result.imageIds?.length || 0), 0);
  if (skippedImageCount) {
    warnings.push(`Budget reached: ${skippedImageCount} image(s) were not evaluated by the vision step.`);
  }

  const failedResults = [...textResults, ...imageResults].filter((result) => !result.ok);
  for (const result of failedResults) {
    const label = result.sourceType === 'image' ? 'Image' : 'Text';
    warnings.push(`${label} subagent ${result.agentId} failed: ${result.error}`);
  }

  // Text knowledge: stage results carry title/topic/entities/keyTerms + facts.
  const textStageResults = textResults
    .filter((result) => result.ok && !result.skipped)
    .map(normalizeStageResult);
  const textFacts = textStageResults.flatMap((result) => result.json.facts || []);

  // Image curation: keep/drop verdicts + captions + OPTIONAL facts (decoupled).
  const { curation, facts: imageFacts } = collectImageCuration(imageResults.filter((result) => result.ok));
  const keptImages = applyCurationToImages(candidateImages, curation, warnings);
  const sections = filterSectionImageIds(rawSections, keptImages);

  logExtraction('subagent settled results', {
    textResults,
    imageResults,
    textStageResults,
    curation: Array.from(curation.entries()),
    keptImageCount: keptImages.length,
    failedResults,
    warnings,
  });

  const textFailures = failedResults.filter((result) => result.sourceType === 'text');
  let finalKnowledge;
  let orchestratorError = '';

  if (textFacts.length || imageFacts.length) {
    const candidateFacts = normalizeFacts([...textFacts, ...imageFacts]);
    const meta = {
      titles: textStageResults.map((result) => result.json.title).filter(Boolean),
      topics: uniqueStrings(textStageResults.map((result) => result.json.topic), 6),
      entities: uniqueStrings(textStageResults.flatMap((result) => result.json.entities || []), 80),
      keyTerms: uniqueStrings(textStageResults.flatMap((result) => result.json.keyTerms || []), 80),
      warnings: textStageResults.flatMap((result) => result.json.warnings || []),
    };

    // Fast path: the orchestrator's job is cross-segment consolidation. A single
    // text segment has no cross-segment duplicates to merge, so when its facts
    // already fit the orchestrator's output budget (no hierarchical reduce
    // needed) the second full-page reasoning call adds latency without improving
    // coverage. Assemble locally instead — renarration reads facts directly.
    const orchestratorThreshold = Math.floor(MAX_ORCHESTRATOR_OUTPUT_TOKENS * 0.6);
    const canSkipOrchestrator =
      textStageResults.length <= 1 && estimateFactsTokens(candidateFacts) <= orchestratorThreshold;
    if (canSkipOrchestrator) {
      onProgress?.('Assembling knowledge...');
      finalKnowledge = localAssembly({ facts: candidateFacts, meta, pageMetadata, visible, warnings });
    } else {
      try {
        finalKnowledge = await runFinalOrchestrator({
          facts: candidateFacts,
          meta,
          sections,
          images: keptImages,
          pageMetadata,
          visible,
          warnings,
          onProgress,
        });
      } catch (error) {
        orchestratorError = errorMessage(error);
        warnings.push(`Final orchestrator failed: ${orchestratorError}`);
        logExtraction('orchestrator error; using local assembly', { orchestratorError, warnings });
        finalKnowledge = localAssembly({ facts: candidateFacts, meta, pageMetadata, visible, warnings });
      }
    }

    if (!finalKnowledge.facts?.length) {
      logExtraction('orchestrator returned no facts; using local assembly', { finalKnowledge, warnings });
      finalKnowledge = localAssembly({ facts: candidateFacts, meta, pageMetadata, visible, warnings });
    }
  }

  // Never come back empty when the page itself has content. If structured
  // extraction produced no facts (e.g. every text call timed out), degrade to
  // the page's own text so renarration still has something to work from. Only a
  // page with genuinely no readable text (PDF, chrome://, not loaded) hard-fails.
  if (!finalKnowledge?.facts?.length) {
    if (!pageText) {
      const detail = textFailures.length ? ` (text call error: ${textFailures[0].error})` : '';
      throw new Error(
        `Could not extract this page — it returned no readable text ` +
        `(${rawSections.length} sections, ${candidateImages.length} images)${detail}. ` +
        `Likely a restricted/empty page (PDF, chrome://, or not yet loaded).`
      );
    }
    if (textFailures.length) {
      warnings.push(
        `Structured extraction failed for ${textFailures.length}/${textSegments.length} text segment(s) ` +
        `(e.g. ${textFailures[0].error}); renarrating from the page text directly.`
      );
    } else {
      warnings.push('Structured extraction produced no facts; renarrating from the page text directly.');
    }
    onProgress?.('Using the page text directly...');
    finalKnowledge = rawTextFallback({ pageText, visible, pageMetadata, warnings });
  }

  const extraction = {
    compactText: String(finalKnowledge.compactText || compactTextFromKnowledge(finalKnowledge)).trim(),
    facts: finalKnowledge.facts,
    knowledge: {
      title: finalKnowledge.title,
      topic: finalKnowledge.topic,
      facts: finalKnowledge.facts,
      entities: finalKnowledge.entities,
      keyTerms: finalKnowledge.keyTerms,
    },
    entities: finalKnowledge.entities,
    keyTerms: finalKnowledge.keyTerms,
    rawText: trimText(pageText, MAX_RAW_TEXT_CHARS),
    rawCharCount: pageText.length,
    rawTextTruncated: pageText.length > MAX_RAW_TEXT_CHARS,
    sections,
    images: keptImages,
    imageCount: keptImages.length,
    plannedTextCharCount: textCharCount,
    textSegmentCount: textSegments.length,
    imageBatchCount: imageBatches.length,
    budget: {
      wallClockMs: budget.wallClockMs,
      maxTokens: budget.maxTokens,
      spentTokens: budget.spentTokens,
      elapsedMs: Date.now() - started,
    },
    agentCount: textResults.length + imageResults.length + 1,
    failedAgentCount: failedResults.length + (orchestratorError ? 1 : 0),
    warnings: uniqueStrings([...warnings, ...(finalKnowledge.warnings || [])], 60),
    model: OPENAI_CONFIG.textModel,
    visionModel: imageBatches.length ? OPENAI_CONFIG.visionModel : null,
    at: new Date().toISOString(),
    durationMs: Date.now() - started,
    url: pageMetadata.url || visible.url || '',
    title: finalKnowledge.title || pageMetadata.title || visible.title || '',
  };
  if (orchestratorError) extraction.orchestratorError = orchestratorError;

  logExtraction('final extraction stored', extraction);
  // The extraction is complete here; a storage failure (quota, etc.) must not
  // surface as an opaque uncaught rejection that discards all the work done.
  try {
    await chrome.storage.local.set({ lastExtraction: extraction });
  } catch (e) {
    throw new Error(
      `Extraction succeeded but could not be saved to local storage (it may be too large): ${e?.message || String(e)}`
    );
  }
  return extraction;
}
