import { callOpenAIJson, OPENAI_CONFIG } from '../utils/openai-client.js';

const MAX_TEXT_CHARS = 60000;
const MAX_EXTRACTED_NOTES_CHARS = 30000;
const TEXT_CHUNK_CHARS = 12000;
const RETRY_TEXT_CHUNK_CHARS = 8000;
const MAX_TEXT_CHUNK_OUTPUT_TOKENS = 1400;
const MAX_IMAGE_OUTPUT_TOKENS = 900;
const MAX_DIRECT_IMAGES = 6;
const TEXT_CHUNK_CONCURRENCY = 3;

function boundedTimeout(maxMs) {
  const configured = Number(OPENAI_CONFIG.timeoutMs);
  return Number.isFinite(configured) && configured > 0 ? Math.min(configured, maxMs) : maxMs;
}

const TEXT_STAGE_TIMEOUT_MS = boundedTimeout(30000);
const TEXT_RETRY_TIMEOUT_MS = boundedTimeout(20000);
const IMAGE_STAGE_TIMEOUT_MS = boundedTimeout(15000);

const textChunkSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['notes', 'title', 'topic', 'summary', 'facts', 'entities', 'keyTerms'],
  properties: {
    notes: { type: 'string' },
    title: { type: 'string' },
    topic: { type: 'string' },
    summary: { type: 'string' },
    facts: {
      type: 'array',
      items: { type: 'string' },
    },
    entities: {
      type: 'array',
      items: { type: 'string' },
    },
    keyTerms: {
      type: 'array',
      items: { type: 'string' },
    },
  },
};

const imageNotesSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['imageNotes', 'facts', 'entities', 'keyTerms'],
  properties: {
    imageNotes: { type: 'string' },
    facts: {
      type: 'array',
      items: { type: 'string' },
    },
    entities: {
      type: 'array',
      items: { type: 'string' },
    },
    keyTerms: {
      type: 'array',
      items: { type: 'string' },
    },
  },
};

function trimText(text, maxChars = MAX_TEXT_CHARS) {
  const value = String(text || '').replace(/\n{3,}/g, '\n\n').trim();
  return value.length > maxChars ? value.slice(0, maxChars) + '\n...(truncated)' : value;
}

function errorMessage(error) {
  return error?.message || String(error || 'unknown error');
}

function isTimeoutError(error) {
  return /abort|timed out|timeout/i.test(errorMessage(error));
}

function plural(count, singular, pluralValue = singular + 's') {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

async function getVisibleText(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'extract-visible-page-text' });
    if (response?.success) return response;
  } catch {}
  return { success: false, text: '', images: [], title: '', url: '' };
}

function selectWebsiteImages(images = []) {
  const seen = new Set();
  const selected = [];
  for (const image of images) {
    const url = String(image?.url || image?.imageUrl || '').trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const pageIndex = Number(image.index);
    selected.push({
      url,
      alt: String(image.alt || '').trim(),
      caption: String(image.caption || '').trim(),
      heading: String(image.heading || '').trim(),
      nearbyText: String(image.nearbyText || '').trim(),
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
    .slice(0, MAX_DIRECT_IMAGES)
    .sort((a, b) => a.index - b.index);
}

function formatImageMetadata(images) {
  if (!images.length) return 'Direct website images: none found.';
  const header = 'Direct website images supplied to the model, in page order:';
  const lines = [header];
  images.forEach((image, i) => {
    const dimensions = image.renderedWidth && image.renderedHeight
      ? `${image.renderedWidth}x${image.renderedHeight} rendered`
      : (image.width && image.height ? `${image.width}x${image.height} intrinsic` : '');
    lines.push([
      `Image ${i + 1}:`,
      `URL: ${image.url}`,
      image.source ? `Source: ${image.source}` : '',
      dimensions ? `Dimensions: ${dimensions}` : '',
      image.heading ? `Nearby heading: ${image.heading}` : '',
      image.alt ? `Alt text: ${image.alt}` : '',
      image.caption ? `Caption: ${image.caption}` : '',
      image.nearbyText ? `Nearby text: ${image.nearbyText}` : '',
    ].filter(Boolean).join('\n'));
  });
  return lines.join('\n\n');
}

function splitLongSegment(segment, maxChars) {
  const chunks = [];
  let remaining = segment;
  while (remaining.length > maxChars) {
    let splitAt = remaining.lastIndexOf(' ', maxChars);
    if (splitAt < Math.floor(maxChars * 0.6)) splitAt = maxChars;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function splitTextIntoChunks(text, maxChars) {
  const value = String(text || '').trim();
  if (!value) return [];

  const chunks = [];
  let current = '';
  for (const rawPart of value.split(/\n+/)) {
    const parts = rawPart.length > maxChars ? splitLongSegment(rawPart, maxChars) : [rawPart];
    for (const rawSegment of parts) {
      const segment = rawSegment.trim();
      if (!segment) continue;
      const next = current ? `${current}\n${segment}` : segment;
      if (current && next.length > maxChars) {
        chunks.push(current);
        current = segment;
      } else {
        current = next;
      }
    }
  }
  if (current) chunks.push(current);
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

function buildTextChunkPrompt({ chunk, index, total, pageMetadata, visible }) {
  return [
    'Extract article knowledge from this visible DOM text chunk for a renarration system.',
    'Use only this chunk as source material. Do not infer facts from missing chunks.',
    'Focus on the article or main page content. Omit navigation, ads, cookie banners, repeated boilerplate, decorative UI text, and unrelated sidebar items.',
    'Capture high-signal facts and claims: main claims, supporting details, quotes, attributions, dates, names, numbers, examples, causes, effects, caveats, chronology, and conclusions.',
    'The notes field must be dense plain text notes. Prefer useful coverage over polished prose.',
    'Use one atomic fact, claim, quote, or relationship per line.',
    'Do not use Markdown bullets, numbering, HTML, or JSON inside notes.',
    'Use short fragments or simple sentences. Avoid speculation.',
    '',
    `URL: ${pageMetadata.url || visible.url || ''}`,
    `Title: ${pageMetadata.title || visible.title || ''}`,
    `Text chunk: ${index + 1} of ${total}`,
    '',
    'Visible page text chunk:',
    chunk,
  ].join('\n');
}

function buildImagePrompt({ pageMetadata, visible, websiteImages }) {
  return [
    'Extract page-relevant visual knowledge from the supplied direct website images for a renarration system.',
    'Use the image pixels and the associated page metadata. The images are supplied in the same order as the metadata.',
    'Focus only on visual information that affects the article or main page meaning: figures, charts, product or event photos, captions, labels, people, places, objects, timelines, and evidence not already obvious from boilerplate.',
    'Ignore decorative, branding, ad, social, and layout-only images.',
    'If an image is not meaningful or cannot be interpreted confidently, omit it from imageNotes.',
    'The imageNotes field must be plain text. Use one atomic visual fact or relationship per line.',
    'Do not use Markdown bullets, numbering, HTML, or JSON inside imageNotes.',
    '',
    `URL: ${pageMetadata.url || visible.url || ''}`,
    `Title: ${pageMetadata.title || visible.title || ''}`,
    '',
    formatImageMetadata(websiteImages),
  ].join('\n');
}

function uniqueStrings(items, maxItems = 40) {
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

function formatTextChunkResult(json, index, total) {
  const notes = String(json?.notes || '').trim();
  const fallbackFacts = Array.isArray(json?.facts) ? json.facts.map((fact) => String(fact || '').trim()).filter(Boolean).join('\n') : '';
  const body = notes || fallbackFacts;
  if (!body) return '';
  return total > 1 ? `Text chunk ${index + 1} of ${total}\n${body}` : body;
}

function formatImageResult(json) {
  const notes = String(json?.imageNotes || '').trim();
  if (notes) return notes;
  return Array.isArray(json?.facts) ? json.facts.map((fact) => String(fact || '').trim()).filter(Boolean).join('\n') : '';
}

function assembleStageKnowledge({ textStage = {}, imageStage = {}, pageMetadata = {}, visible = {} }) {
  const textKnowledge = textStage.knowledge || {};
  const imageKnowledge = imageStage.knowledge || {};
  const summaries = [
    textKnowledge.summary,
  ].map((item) => String(item || '').trim()).filter(Boolean);

  return {
    title: firstString(textKnowledge.title, pageMetadata.title, visible.title),
    topic: firstString(textKnowledge.topic),
    summary: summaries.join('\n'),
    facts: uniqueStrings([
      ...(textKnowledge.facts || []),
      ...(imageKnowledge.facts || []),
    ], 50),
    entities: uniqueStrings([
      ...(textKnowledge.entities || []),
      ...(imageKnowledge.entities || []),
    ], 50),
    keyTerms: uniqueStrings([
      ...(textKnowledge.keyTerms || []),
      ...(imageKnowledge.keyTerms || []),
    ], 50),
  };
}

function localExtractionFromStages({ textStage, imageStage, pageMetadata, visible }) {
  const sections = [
    textStage?.notes ? ['Page text', textStage.notes] : null,
    imageStage?.notes ? ['Page images', imageStage.notes] : null,
  ].filter(Boolean);
  const compactText = trimText(sections.map(([label, value]) => `${label}\n${value}`).join('\n\n'), MAX_EXTRACTED_NOTES_CHARS);
  const knowledge = assembleStageKnowledge({ textStage, imageStage, pageMetadata, visible });
  return { compactText, knowledge };
}

async function runTextChunks({ pageText, chunkChars, timeoutMs, pageMetadata, visible, onProgress }) {
  const chunks = splitTextIntoChunks(pageText, chunkChars);
  if (!chunks.length) {
    return { notes: '', knowledge: {}, chunkCount: 0, model: OPENAI_CONFIG.textModel };
  }

  onProgress?.(`Extracting text knowledge from ${plural(chunks.length, 'chunk')}...`);
  const results = await mapWithConcurrency(chunks, TEXT_CHUNK_CONCURRENCY, async (chunk, index) => {
    if (chunks.length > 1) onProgress?.(`Extracting text chunk ${index + 1}/${chunks.length}...`);
    const result = await callOpenAIJson({
      schema: textChunkSchema,
      schemaName: 'page_text_chunk',
      prompt: buildTextChunkPrompt({ chunk, index, total: chunks.length, pageMetadata, visible }),
      model: OPENAI_CONFIG.textModel,
      maxOutputTokens: MAX_TEXT_CHUNK_OUTPUT_TOKENS,
      timeoutMs,
    });
    return result.json || {};
  });

  const notes = results
    .map((json, index) => formatTextChunkResult(json, index, results.length))
    .filter(Boolean)
    .join('\n\n');
  const knowledge = {
    title: firstString(...results.map((json) => json.title), pageMetadata.title, visible.title),
    topic: firstString(...results.map((json) => json.topic)),
    summary: results.map((json) => String(json.summary || '').trim()).filter(Boolean).join('\n'),
    facts: uniqueStrings(results.flatMap((json) => json.facts || []), 60),
    entities: uniqueStrings(results.flatMap((json) => json.entities || []), 60),
    keyTerms: uniqueStrings(results.flatMap((json) => json.keyTerms || []), 60),
  };

  return { notes, knowledge, chunkCount: chunks.length, model: OPENAI_CONFIG.textModel };
}

async function extractTextStage({ pageText, pageMetadata, visible, onProgress }) {
  if (!pageText) return { notes: '', knowledge: {}, chunkCount: 0, retried: false, model: OPENAI_CONFIG.textModel };
  try {
    return await runTextChunks({
      pageText,
      chunkChars: TEXT_CHUNK_CHARS,
      timeoutMs: TEXT_STAGE_TIMEOUT_MS,
      pageMetadata,
      visible,
      onProgress,
    });
  } catch (error) {
    if (!isTimeoutError(error)) throw error;
    onProgress?.('Text extraction timed out; retrying smaller chunks...');
    const retry = await runTextChunks({
      pageText,
      chunkChars: RETRY_TEXT_CHUNK_CHARS,
      timeoutMs: TEXT_RETRY_TIMEOUT_MS,
      pageMetadata,
      visible,
      onProgress,
    });
    return { ...retry, retried: true };
  }
}

async function extractImageStage({ websiteImages, pageMetadata, visible, onProgress }) {
  if (!websiteImages.length) return { notes: '', knowledge: {}, model: null };

  onProgress?.(`Extracting visual knowledge from ${plural(websiteImages.length, 'image')}...`);
  const result = await callOpenAIJson({
    schema: imageNotesSchema,
    schemaName: 'page_image_notes',
    prompt: buildImagePrompt({ pageMetadata, visible, websiteImages }),
    images: websiteImages,
    imageDetail: 'low',
    model: OPENAI_CONFIG.visionModel,
    maxOutputTokens: MAX_IMAGE_OUTPUT_TOKENS,
    timeoutMs: IMAGE_STAGE_TIMEOUT_MS,
  });
  const json = result.json || {};

  return {
    notes: formatImageResult(json),
    knowledge: json,
    model: OPENAI_CONFIG.visionModel,
  };
}

export async function extractPageKnowledge({ tabId, pageMetadata = {}, onProgress } = {}) {
  if (!tabId) throw new Error('No active tab available for extraction');

  const started = Date.now();
  onProgress?.('Reading page text and images...');
  const visible = await getVisibleText(tabId);
  const pageText = trimText(visible.text || '');
  const websiteImages = selectWebsiteImages(visible.images || []);

  let textStage = { notes: '', knowledge: {}, chunkCount: 0, retried: false, model: OPENAI_CONFIG.textModel };
  let imageStage = { notes: '', knowledge: {}, model: null };
  let imageError = '';

  const textPromise = pageText
    ? extractTextStage({ pageText, pageMetadata, visible, onProgress })
    : Promise.resolve(textStage);
  const imagePromise = websiteImages.length
    ? extractImageStage({ websiteImages, pageMetadata, visible, onProgress })
    : Promise.resolve(imageStage);

  const [textResult, imageResult] = await Promise.allSettled([textPromise, imagePromise]);
  if (textResult.status === 'fulfilled') {
    textStage = textResult.value;
  } else {
    throw textResult.reason;
  }

  if (imageResult.status === 'fulfilled') {
    imageStage = imageResult.value;
  } else {
    imageError = errorMessage(imageResult.reason);
    if (textStage.notes) onProgress?.('Direct image extraction failed; continuing with text extraction...');
  }

  if (!textStage.notes && !imageStage.notes) {
    throw new Error('Could not extract text or images from this page');
  }

  const assembled = {
    ...localExtractionFromStages({ textStage, imageStage, pageMetadata, visible }),
    model: textStage.model || imageStage.model || OPENAI_CONFIG.textModel,
  };

  const extraction = {
    compactText: String(assembled.compactText || '').trim(),
    knowledge: assembled.knowledge || {},
    rawText: pageText,
    rawCharCount: pageText.length,
    images: websiteImages,
    imageCount: websiteImages.length,
    textChunkCount: textStage.chunkCount || 0,
    textRetried: !!textStage.retried,
    model: assembled.model,
    at: new Date().toISOString(),
    durationMs: Date.now() - started,
    url: pageMetadata.url || visible.url || '',
    title: pageMetadata.title || visible.title || '',
  };
  if (imageError) extraction.imageError = imageError;

  await chrome.storage.local.set({ lastExtraction: extraction });
  return extraction;
}
