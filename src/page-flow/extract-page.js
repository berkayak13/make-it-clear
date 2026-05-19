import { callOpenAIJson, OPENAI_CONFIG } from '../utils/openai-client.js';

const MAX_RAW_TEXT_CHARS = 120000;
const MAX_EXTRACTED_NOTES_CHARS = 30000;
const TEXT_SEGMENT_CHARS = 9000;
const MAX_TEXT_SEGMENTS = 48;
const BASE_DIRECT_IMAGES = 8;
const MAX_DIRECT_IMAGES = 24;
const CHARS_PER_EXTRA_IMAGE = 45000;
const IMAGE_BATCH_SIZE = 2;
const TEXT_CONCURRENCY = 4;
const IMAGE_CONCURRENCY = 2;
const MAX_TEXT_OUTPUT_TOKENS = 1800;
const MAX_IMAGE_OUTPUT_TOKENS = 1200;
const MAX_ORCHESTRATOR_OUTPUT_TOKENS = 3000;

const FACT_KINDS = new Set(['FACT', 'CLAIM', 'QUOTE', 'FIGURE', 'COUNTER', 'VISUAL']);
const FACT_SOURCES = new Set(['text', 'image', 'mixed']);

function logExtraction(label, details) {
  try {
    console.log(`[Clear Extraction][background] ${label}`, details);
  } catch {}
}

function boundedTimeout(maxMs) {
  const configured = Number(OPENAI_CONFIG.timeoutMs);
  return Number.isFinite(configured) && configured > 0 ? Math.min(configured, maxMs) : maxMs;
}

const TEXT_STAGE_TIMEOUT_MS = boundedTimeout(30000);
const IMAGE_STAGE_TIMEOUT_MS = boundedTimeout(20000);
const ORCHESTRATOR_TIMEOUT_MS = boundedTimeout(30000);

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
  required: ['title', 'topic', 'summary', 'facts', 'entities', 'keyTerms', 'warnings'],
  properties: {
    title: { type: 'string' },
    topic: { type: 'string' },
    summary: { type: 'string' },
    facts: { type: 'array', items: factSchema },
    entities: { type: 'array', items: { type: 'string' } },
    keyTerms: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

const finalExtractionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'topic', 'summary', 'facts', 'entities', 'keyTerms', 'compactText', 'warnings'],
  properties: {
    title: { type: 'string' },
    topic: { type: 'string' },
    summary: { type: 'string' },
    facts: { type: 'array', items: factSchema },
    entities: { type: 'array', items: { type: 'string' } },
    keyTerms: { type: 'array', items: { type: 'string' } },
    compactText: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
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
    const response = await chrome.tabs.sendMessage(tabId, { action: 'extract-visible-page-text' });
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

  return {
    id: String(typeof raw === 'object' && raw.id ? raw.id : `fact-${index + 1}`),
    kind: FACT_KINDS.has(rawKind) ? rawKind : (source === 'image' ? 'VISUAL' : 'CLAIM'),
    text,
    evidence: String(typeof raw === 'object' ? raw.evidence || '' : '').trim(),
    confidence: clampConfidence(typeof raw === 'object' ? raw.confidence : 0.75),
    source,
    sectionIds: normalizeIdList(rawSectionIds),
    imageIds,
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
      text: trimText(section?.text || '', TEXT_SEGMENT_CHARS),
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

function plannedImageLimit(textChars) {
  const extraImages = Math.floor(Math.max(0, textChars - TEXT_SEGMENT_CHARS) / CHARS_PER_EXTRA_IMAGE) * 2;
  return Math.min(MAX_DIRECT_IMAGES, BASE_DIRECT_IMAGES + extraImages);
}

function selectWebsiteImages(images = [], limit = BASE_DIRECT_IMAGES) {
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

  return selected
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index);
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

function limitTextSegments(segments, warnings) {
  if (segments.length <= MAX_TEXT_SEGMENTS) return segments;
  warnings.push(`Text content produced ${segments.length} segments; extraction limited to ${MAX_TEXT_SEGMENTS} text subagents.`);
  return segments.slice(0, MAX_TEXT_SEGMENTS);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
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
    'Extract structured page knowledge from this visible DOM text segment for a renarration system.',
    'Use only this segment. Do not infer facts from missing segments.',
    'Focus on main article/page content. Omit navigation, ads, cookie banners, repeated boilerplate, and unrelated sidebar text.',
    'Return atomic facts, claims, quotes, figures, counterpoints, and relationships. Link each item to the provided section IDs and relevant image IDs when text refers to a nearby image.',
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
    'Extract structured visual knowledge from these direct website images for a renarration system.',
    'Use image pixels plus metadata. Ignore decorative, branding, ad, social, and layout-only images.',
    'Return only visual information that affects page meaning: figures, charts, screenshots, labels, people, places, objects, evidence, and caption-image relationships.',
    'Every visual fact must include the relevant imageIds. Include sectionIds when metadata supplies them.',
    '',
    `URL: ${pageMetadata.url || visible.url || ''}`,
    `Title: ${pageMetadata.title || visible.title || ''}`,
    `Image batch: ${index + 1} of ${total}`,
    '',
    formatImageMetadata(batch),
  ].join('\n');
}

function buildOrchestratorPrompt({ stageResults, sections, images, pageMetadata, visible }) {
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
  const candidates = stageResults.map((result) => ({
    sourceAgent: result.agentId,
    sourceType: result.sourceType,
    title: result.json.title,
    topic: result.json.topic,
    summary: result.json.summary,
    facts: result.json.facts,
    entities: result.json.entities,
    keyTerms: result.json.keyTerms,
    warnings: result.json.warnings,
  }));

  return [
    'You are the final extraction orchestrator for a webpage renarration system.',
    'Deduplicate and rank candidate facts from text and vision extraction subagents.',
    'Keep only high-signal, page-relevant facts and claims. Preserve uncertainty by lowering confidence instead of inventing details.',
    'Link facts to sectionIds and imageIds when supported. Use source "mixed" when both text and image evidence support a fact.',
    'Produce compactText as dense plain text notes suitable for a later renarration prompt. Do not use Markdown tables or HTML.',
    '',
    `URL: ${pageMetadata.url || visible.url || ''}`,
    `Title: ${pageMetadata.title || visible.title || ''}`,
    '',
    'Page sections JSON:',
    JSON.stringify(sectionOutline),
    '',
    'Selected image metadata JSON:',
    JSON.stringify(imageOutline),
    '',
    'Subagent outputs JSON:',
    JSON.stringify(candidates),
  ].join('\n');
}

async function runTextSubagents({ segments, pageMetadata, visible, onProgress }) {
  if (!segments.length) return [];
  onProgress?.(`Extracting text knowledge from ${plural(segments.length, 'segment')}...`);
  return mapWithConcurrency(segments, TEXT_CONCURRENCY, async (segment, index) => {
    const agentId = `text-${index + 1}`;
    const prompt = buildTextPrompt({ segment, index, total: segments.length, pageMetadata, visible });
    logExtraction(`${agentId} request`, {
      agentId,
      sourceType: 'text',
      model: OPENAI_CONFIG.textModel,
      maxOutputTokens: MAX_TEXT_OUTPUT_TOKENS,
      timeoutMs: TEXT_STAGE_TIMEOUT_MS,
      segment,
      prompt,
    });
    try {
      if (segments.length > 1) onProgress?.(`Extracting text segment ${index + 1}/${segments.length}...`);
      const result = await callOpenAIJson({
        schema: extractionStageSchema,
        schemaName: 'page_text_segment',
        prompt,
        model: OPENAI_CONFIG.textModel,
        maxOutputTokens: MAX_TEXT_OUTPUT_TOKENS,
        timeoutMs: TEXT_STAGE_TIMEOUT_MS,
      });
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

async function runVisionSubagents({ batches, pageMetadata, visible, onProgress }) {
  if (!batches.length) return [];
  onProgress?.(`Extracting visual knowledge from ${plural(batches.flat().length, 'image')}...`);
  return mapWithConcurrency(batches, IMAGE_CONCURRENCY, async (batch, index) => {
    const agentId = `vision-${index + 1}`;
    const prompt = buildVisionPrompt({ batch, index, total: batches.length, pageMetadata, visible });
    const images = batch.map((image) => ({ ...image, detail: 'low' }));
    logExtraction(`${agentId} request`, {
      agentId,
      sourceType: 'image',
      model: OPENAI_CONFIG.visionModel,
      maxOutputTokens: MAX_IMAGE_OUTPUT_TOKENS,
      timeoutMs: IMAGE_STAGE_TIMEOUT_MS,
      imageDetail: 'low',
      batch,
      images,
      prompt,
    });
    try {
      const result = await callOpenAIJson({
        schema: extractionStageSchema,
        schemaName: 'page_image_batch',
        prompt,
        images,
        imageDetail: 'low',
        model: OPENAI_CONFIG.visionModel,
        maxOutputTokens: MAX_IMAGE_OUTPUT_TOKENS,
        timeoutMs: IMAGE_STAGE_TIMEOUT_MS,
      });
      logExtraction(`${agentId} response`, {
        agentId,
        sourceType: 'image',
        json: result.json || {},
        response: result.response,
      });
      return {
        ok: true,
        agentId,
        sourceType: 'image',
        fallback: {
          sectionIds: normalizeIdList(batch.flatMap((image) => image.sectionIds || [])),
          imageIds: normalizeIdList(batch.map((image) => image.id)),
          source: 'image',
        },
        json: result.json || {},
      };
    } catch (error) {
      logExtraction(`${agentId} error`, {
        agentId,
        sourceType: 'image',
        error: errorMessage(error),
      });
      return {
        ok: false,
        agentId,
        sourceType: 'image',
        error: errorMessage(error),
      };
    }
  });
}

function normalizeStageResult(result) {
  const json = result.json || {};
  return {
    ...result,
    json: {
      title: String(json.title || '').trim(),
      topic: String(json.topic || '').trim(),
      summary: String(json.summary || '').trim(),
      facts: normalizeFacts(json.facts || [], result.fallback),
      entities: uniqueStrings(json.entities || [], 60),
      keyTerms: uniqueStrings(json.keyTerms || [], 60),
      warnings: uniqueStrings(json.warnings || [], 20),
    },
  };
}

function compactTextFromKnowledge({ title, topic, summary, facts }) {
  const lines = [
    title ? `Title: ${title}` : '',
    topic ? `Topic: ${topic}` : '',
    summary ? `Summary: ${summary}` : '',
    facts?.length ? 'Facts and claims:' : '',
    ...(facts || []).map((fact) => {
      const refs = [
        fact.sectionIds?.length ? `sections ${fact.sectionIds.join(', ')}` : '',
        fact.imageIds?.length ? `images ${fact.imageIds.join(', ')}` : '',
      ].filter(Boolean).join('; ');
      return refs ? `${fact.kind}: ${fact.text} (${refs})` : `${fact.kind}: ${fact.text}`;
    }),
  ].filter(Boolean);
  return trimText(lines.join('\n'), MAX_EXTRACTED_NOTES_CHARS);
}

function localAssembly({ stageResults, pageMetadata, visible, warnings }) {
  const facts = normalizeFacts(stageResults.flatMap((result) => result.json.facts || []));
  const title = firstString(...stageResults.map((result) => result.json.title), pageMetadata.title, visible.title);
  const topic = firstString(...stageResults.map((result) => result.json.topic));
  const summary = uniqueStrings(stageResults.map((result) => result.json.summary), 6).join('\n');
  const knowledge = {
    title,
    topic,
    summary,
    facts,
    entities: uniqueStrings(stageResults.flatMap((result) => result.json.entities || []), 80),
    keyTerms: uniqueStrings(stageResults.flatMap((result) => result.json.keyTerms || []), 80),
  };
  return {
    ...knowledge,
    compactText: compactTextFromKnowledge(knowledge),
    warnings: uniqueStrings([
      ...warnings,
      ...stageResults.flatMap((result) => result.json.warnings || []),
    ], 40),
  };
}

async function runFinalOrchestrator({ stageResults, sections, images, pageMetadata, visible, onProgress }) {
  onProgress?.('Merging text and visual knowledge...');
  const prompt = buildOrchestratorPrompt({ stageResults, sections, images, pageMetadata, visible });
  logExtraction('orchestrator request', {
    model: OPENAI_CONFIG.textModel,
    maxOutputTokens: MAX_ORCHESTRATOR_OUTPUT_TOKENS,
    timeoutMs: ORCHESTRATOR_TIMEOUT_MS,
    sections,
    images,
    stageResults,
    prompt,
  });
  const result = await callOpenAIJson({
    schema: finalExtractionSchema,
    schemaName: 'page_extraction_orchestrator',
    prompt,
    model: OPENAI_CONFIG.textModel,
    maxOutputTokens: MAX_ORCHESTRATOR_OUTPUT_TOKENS,
    timeoutMs: ORCHESTRATOR_TIMEOUT_MS,
  });
  logExtraction('orchestrator response', {
    json: result.json || {},
    response: result.response,
  });
  const json = result.json || {};
  const facts = normalizeFacts(json.facts || []);
  const knowledge = {
    title: firstString(json.title, pageMetadata.title, visible.title),
    topic: String(json.topic || '').trim(),
    summary: String(json.summary || '').trim(),
    facts,
    entities: uniqueStrings(json.entities || [], 80),
    keyTerms: uniqueStrings(json.keyTerms || [], 80),
  };
  return {
    ...knowledge,
    compactText: trimText(json.compactText || compactTextFromKnowledge(knowledge), MAX_EXTRACTED_NOTES_CHARS),
    warnings: uniqueStrings(json.warnings || [], 40),
  };
}

export async function extractPageKnowledge({ tabId, pageMetadata = {}, onProgress } = {}) {
  if (!tabId) throw new Error('No active tab available for extraction');

  const started = Date.now();
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
  const pageText = trimText(visible.text || '');
  const rawSections = normalizeSections(visible, pageText);
  const textCharCount = plannedTextCharCount(rawSections, pageText);
  const imageLimit = plannedImageLimit(textCharCount);
  const websiteImages = selectWebsiteImages(visible.images || [], imageLimit);
  const sections = filterSectionImageIds(rawSections, websiteImages);
  const warnings = [];
  const textSegments = limitTextSegments(planTextSegments(sections, websiteImages, pageText), warnings);
  const imageBatches = chunkArray(websiteImages, IMAGE_BATCH_SIZE);
  logExtraction('planner output', {
    pageTextCharCount: pageText.length,
    plannedTextCharCount: textCharCount,
    plannedImageLimit: imageLimit,
    rawSectionCount: rawSections.length,
    selectedSectionCount: sections.length,
    selectedImageCount: websiteImages.length,
    textSegmentCount: textSegments.length,
    imageBatchCount: imageBatches.length,
    rawSections,
    sections,
    selectedImages: websiteImages,
    textSegments,
    imageBatches,
    warnings,
  });
  onProgress?.(`Planned ${plural(textSegments.length, 'text agent')} and ${plural(imageBatches.length, 'image agent')}.`);

  const [textResults, imageResults] = await Promise.all([
    runTextSubagents({ segments: textSegments, pageMetadata, visible, onProgress }),
    runVisionSubagents({ batches: imageBatches, pageMetadata, visible, onProgress }),
  ]);

  const failedResults = [...textResults, ...imageResults].filter((result) => !result.ok);
  for (const result of failedResults) {
    const label = result.sourceType === 'image' ? 'Image' : 'Text';
    warnings.push(`${label} subagent ${result.agentId} failed: ${result.error}`);
  }

  const successfulStageResults = [...textResults, ...imageResults]
    .filter((result) => result.ok)
    .map(normalizeStageResult);
  logExtraction('subagent settled results', {
    textResults,
    imageResults,
    failedResults,
    successfulStageResults,
    warnings,
  });
  const textFacts = successfulStageResults
    .filter((result) => result.sourceType === 'text')
    .flatMap((result) => result.json.facts || []);
  const imageFacts = successfulStageResults
    .filter((result) => result.sourceType === 'image')
    .flatMap((result) => result.json.facts || []);

  if (textSegments.length && !textFacts.length && !imageFacts.length && failedResults.some((result) => result.sourceType === 'text')) {
    const firstTextFailure = failedResults.find((result) => result.sourceType === 'text');
    throw new Error(firstTextFailure?.error || 'Could not extract text or images from this page');
  }

  if (!textFacts.length && !imageFacts.length) {
    throw new Error('Could not extract text or images from this page');
  }

  let finalKnowledge;
  let orchestratorError = '';
  try {
    finalKnowledge = await runFinalOrchestrator({
      stageResults: successfulStageResults,
      sections,
      images: websiteImages,
      pageMetadata,
      visible,
      onProgress,
    });
  } catch (error) {
    orchestratorError = errorMessage(error);
    warnings.push(`Final orchestrator failed: ${orchestratorError}`);
    logExtraction('orchestrator error; using local assembly', {
      orchestratorError,
      successfulStageResults,
      warnings,
    });
    finalKnowledge = localAssembly({ stageResults: successfulStageResults, pageMetadata, visible, warnings });
  }

  if (!finalKnowledge.facts?.length) {
    logExtraction('orchestrator returned no facts; using local assembly', {
      finalKnowledge,
      successfulStageResults,
      warnings,
    });
    finalKnowledge = localAssembly({ stageResults: successfulStageResults, pageMetadata, visible, warnings });
  }
  if (!finalKnowledge.facts?.length) {
    throw new Error('Could not extract text or images from this page');
  }

  const extraction = {
    compactText: String(finalKnowledge.compactText || compactTextFromKnowledge(finalKnowledge)).trim(),
    facts: finalKnowledge.facts,
    knowledge: {
      title: finalKnowledge.title,
      topic: finalKnowledge.topic,
      summary: finalKnowledge.summary,
      facts: finalKnowledge.facts,
      entities: finalKnowledge.entities,
      keyTerms: finalKnowledge.keyTerms,
    },
    entities: finalKnowledge.entities,
    keyTerms: finalKnowledge.keyTerms,
    summary: finalKnowledge.summary,
    rawText: trimText(pageText, MAX_RAW_TEXT_CHARS),
    rawCharCount: pageText.length,
    rawTextTruncated: pageText.length > MAX_RAW_TEXT_CHARS,
    sections,
    images: websiteImages,
    imageCount: websiteImages.length,
    plannedTextCharCount: textCharCount,
    plannedImageLimit: imageLimit,
    textSegmentCount: textSegments.length,
    imageBatchCount: imageBatches.length,
    agentCount: textResults.length + imageResults.length + 1,
    failedAgentCount: failedResults.length + (orchestratorError ? 1 : 0),
    warnings: uniqueStrings([...warnings, ...(finalKnowledge.warnings || [])], 60),
    model: OPENAI_CONFIG.textModel,
    visionModel: websiteImages.length ? OPENAI_CONFIG.visionModel : null,
    at: new Date().toISOString(),
    durationMs: Date.now() - started,
    url: pageMetadata.url || visible.url || '',
    title: finalKnowledge.title || pageMetadata.title || visible.title || '',
  };
  if (orchestratorError) extraction.orchestratorError = orchestratorError;

  logExtraction('final extraction stored', extraction);
  await chrome.storage.local.set({ lastExtraction: extraction });
  return extraction;
}
