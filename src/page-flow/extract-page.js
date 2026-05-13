import { captureFullPageSlices } from '../utils/screenshot-capture.js';
import { callOpenAIJson, OPENAI_CONFIG } from '../utils/openai-client.js';

const MAX_TEXT_CHARS = 20000;
const MAX_SCREENSHOT_SLICES = 8;

const extractionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'topic', 'summary', 'facts', 'entities', 'keyTerms'],
  properties: {
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

function trimText(text, maxChars = MAX_TEXT_CHARS) {
  const value = String(text || '').replace(/\n{3,}/g, '\n\n').trim();
  return value.length > maxChars ? value.slice(0, maxChars) + '\n...(truncated)' : value;
}

async function getVisibleText(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'extract-visible-page-text' });
    if (response?.success) return response;
  } catch {}
  return { success: false, text: '', title: '', url: '' };
}

function chooseSlices(images) {
  if (!images.length || images.length <= MAX_SCREENSHOT_SLICES) return images;
  const chosen = [];
  for (let i = 0; i < MAX_SCREENSHOT_SLICES; i++) {
    const index = Math.round((i * (images.length - 1)) / (MAX_SCREENSHOT_SLICES - 1));
    chosen.push(images[index]);
  }
  return chosen;
}

export async function extractPageKnowledge({ tabId, pageMetadata = {}, onProgress } = {}) {
  if (!tabId) throw new Error('No active tab available for extraction');

  const started = Date.now();
  onProgress?.('Reading visible page text...');
  const visible = await getVisibleText(tabId);
  const pageText = trimText(visible.text || '');

  onProgress?.('Capturing page screenshots...');
  const { images, partial } = await captureFullPageSlices(tabId);
  const selectedImages = chooseSlices(images || []);
  if (!pageText && !selectedImages.length) {
    throw new Error('Could not extract text or screenshots from this page');
  }

  onProgress?.('Extracting page knowledge with OpenAI...');
  const prompt = [
    'Extract compact page knowledge for a renarration system.',
    'Use the visible text first. Use screenshots to recover headings, charts, layout clues, labels, and content missing from text extraction.',
    'Write short, concrete facts. Avoid speculation.',
    '',
    `URL: ${pageMetadata.url || visible.url || ''}`,
    `Title: ${pageMetadata.title || visible.title || ''}`,
    '',
    'Visible page text:',
    pageText || '[No visible text extracted]',
  ].join('\n');

  const result = await callOpenAIJson({
    schema: extractionSchema,
    schemaName: 'page_knowledge',
    prompt,
    images: selectedImages,
    model: OPENAI_CONFIG.visionModel,
  });

  const extraction = {
    knowledge: result.json,
    rawText: pageText,
    rawCharCount: pageText.length,
    sliceCount: selectedImages.length,
    totalSliceCount: images?.length || 0,
    partial: !!partial,
    model: OPENAI_CONFIG.visionModel,
    at: new Date().toISOString(),
    durationMs: Date.now() - started,
    url: pageMetadata.url || visible.url || '',
    title: pageMetadata.title || visible.title || '',
  };

  await chrome.storage.local.set({ lastExtraction: extraction });
  return extraction;
}
