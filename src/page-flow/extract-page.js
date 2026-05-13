import { captureFullPageSlices } from '../utils/screenshot-capture.js';
import { callOpenAIJson, OPENAI_CONFIG } from '../utils/openai-client.js';

const MAX_TEXT_CHARS = 120000;
const MAX_EXTRACTED_NOTES_CHARS = 30000;
const MAX_EXTRACTION_OUTPUT_TOKENS = 16000;
const MAX_SCREENSHOT_SLICES = 20;

const extractionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['compactText', 'title', 'topic', 'summary', 'facts', 'entities', 'keyTerms'],
  properties: {
    compactText: { type: 'string' },
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
  return images.slice(0, MAX_SCREENSHOT_SLICES);
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
    'Extract comprehensive article knowledge for a renarration system.',
    'Use the visible text first. Use screenshots to recover headings, charts, layout clues, labels, and content missing from text extraction.',
    'Focus on the article or main page content. Omit navigation, ads, cookie banners, repeated boilerplate, decorative UI text, and unrelated sidebar items.',
    'Capture every distinct article fact or claim that affects meaning: main claims, supporting details, quotes, attributions, dates, names, numbers, examples, causes, effects, caveats, chronology, and conclusions.',
    'Do not collapse the article into a short summary. Coverage is more important than polished prose.',
    `The compactText field is the main source artifact. Make it dense, comprehensive fact-by-fact notes up to about ${MAX_EXTRACTED_NOTES_CHARS} characters.`,
    'Format compactText as plain text grouped by source section when section order is clear.',
    'Use one atomic fact, claim, quote, or relationship per line.',
    'Cover the beginning, middle, and end of the page text. Continue until all meaningful page content has been represented.',
    'Use short fragments or simple sentences. Avoid speculation.',
    'Do not use Markdown bullets, numbering, HTML, or JSON inside compactText.',
    'Make the facts array a shorter scan-friendly subset of the most important facts. compactText must remain the complete extracted knowledge artifact.',
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
    maxOutputTokens: MAX_EXTRACTION_OUTPUT_TOKENS,
  });

  const { compactText = '', ...knowledge } = result.json || {};
  const capExceeded = (images?.length || 0) > selectedImages.length;
  const extraction = {
    compactText: String(compactText || '').trim(),
    knowledge,
    rawText: pageText,
    rawCharCount: pageText.length,
    sliceCount: selectedImages.length,
    totalSliceCount: images?.length || 0,
    partial: !!partial || capExceeded,
    model: OPENAI_CONFIG.visionModel,
    at: new Date().toISOString(),
    durationMs: Date.now() - started,
    url: pageMetadata.url || visible.url || '',
    title: pageMetadata.title || visible.title || '',
  };

  await chrome.storage.local.set({ lastExtraction: extraction });
  return extraction;
}
