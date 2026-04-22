/**
 * Extraction agent — runs at the very beginning of the pipeline.
 *
 * Pure context capture: screenshots → VLM main-article transcription → LLM
 * compression into a compact JSON knowledge object. No chat, no persona,
 * no renarration. The only goal is to get the smallest possible faithful
 * snapshot of what the page is actually about, with ads / nav / footers /
 * sidebars / promos stripped out.
 *
 * Stored at chrome.storage.local.lastExtraction.
 */

import { loadPrompt } from '../utils/prompt-loader.js';
import { captureFullPageSlices } from '../utils/screenshot-capture.js';
import { callRemoteVLMWithImages } from '../utils/vlm-client.js';
import { callLLM } from '../utils/llm-dispatch.js';

export const name = 'extraction';
export const phase = 0;

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent';

const RAW_VLM_CAP = 6000;
const FACT_CAP = 140;
const MAX_FACTS = 20;
const MAX_ENTITIES = 12;
const MAX_KEYTERMS = 10;

/**
 * Run extraction for a tab. Returns the compact knowledge object.
 * @param {object} opts
 * @param {number} opts.tabId
 * @param {object} [opts.pageMetadata]
 * @param {(text: string) => void} [opts.onProgress]
 */
export async function runExtraction({ tabId, pageMetadata = {}, onProgress } = {}) {
  const t0 = Date.now();
  const progress = (msg) => { try { onProgress?.(msg); } catch {} };

  if (!tabId) throw new Error('extraction: tabId required');

  progress('Capturing page screenshots...');
  const { images, partial } = await captureFullPageSlices(tabId);
  if (!images?.length) throw new Error('extraction: no screenshots captured');

  progress(`VLM transcribing ${images.length} slice${images.length > 1 ? 's' : ''}...`);
  const vlmPrompt = (await loadPrompt('extraction-vlm')) || 'Transcribe only the main article content. Skip all ads, nav, sidebars, comments.';

  const settings = await chrome.storage.sync.get(['remoteVLMModel', 'remoteVLMEndpoint']);
  const model = settings.remoteVLMModel || DEFAULT_MODEL;
  const endpoint = settings.remoteVLMEndpoint || DEFAULT_ENDPOINT;

  const vlmResp = await callRemoteVLMWithImages({
    images,
    prompt: vlmPrompt,
    model,
    endpoint,
    apiKey: GEMINI_API_KEY,
  });

  if (!vlmResp?.success) {
    throw new Error(`extraction VLM failed: ${vlmResp?.error || 'unknown'}`);
  }

  const rawText = (vlmResp.result || '').slice(0, RAW_VLM_CAP).trim();
  if (!rawText) throw new Error('extraction: VLM returned empty content');

  progress('Compressing knowledge with LLM...');
  const compressPrompt = (await loadPrompt('extraction-compress')) ||
    'Return a JSON object with title, topic, summary, facts[], entities[], keyTerms[]. No markdown.';

  const llmResp = await callLLM(
    [{ role: 'user', content: rawText }],
    compressPrompt,
    { temperature: 0.1 }
  );

  let knowledge = null;
  if (llmResp?.success) {
    knowledge = parseKnowledge(llmResp.result);
  }

  if (!knowledge) {
    knowledge = fallbackKnowledge(rawText, pageMetadata);
  }

  knowledge = clampKnowledge(knowledge);

  const result = {
    url: pageMetadata?.url || '',
    pageTitle: pageMetadata?.title || knowledge.title || '',
    knowledge,
    rawCharCount: rawText.length,
    sliceCount: images.length,
    partial: !!partial,
    durationMs: Date.now() - t0,
    at: new Date().toISOString(),
  };

  try {
    await chrome.storage.local.set({ lastExtraction: result });
  } catch (e) {
    console.warn('[extraction] storage.local.set failed:', e?.message);
  }

  progress('Extraction complete');
  return result;
}

/**
 * Orchestrator-compatible run() — called from runPipeline as agent-0.5.
 * Reads context.tabId, writes context.extraction.
 */
export async function run(context) {
  if (!context?.tabId) return;
  try {
    const result = await runExtraction({
      tabId: context.tabId,
      pageMetadata: context.pageMetadata,
    });
    context.extraction = result;
  } catch (e) {
    console.warn('[extraction agent] failed:', e?.message);
    context.extraction = { error: e?.message || String(e), at: new Date().toISOString() };
  }
}

/* ── helpers ──────────────────────────────────────────────── */

function parseKnowledge(text) {
  if (!text) return null;
  let cleaned = String(text).trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function fallbackKnowledge(rawText, pageMetadata) {
  const firstLine = rawText.split('\n').map(s => s.trim()).find(Boolean) || '';
  const sentences = rawText
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 20);
  return {
    title: (pageMetadata?.title || firstLine).slice(0, 120),
    topic: '',
    summary: sentences[0]?.slice(0, 200) || firstLine.slice(0, 200),
    facts: sentences.slice(0, MAX_FACTS).map(s => s.slice(0, FACT_CAP)),
    entities: [],
    keyTerms: [],
  };
}

function clampKnowledge(k) {
  const arr = (v) => Array.isArray(v) ? v : [];
  const str = (v, max) => (typeof v === 'string' ? v : '').slice(0, max).trim();
  return {
    title: str(k.title, 120),
    topic: str(k.topic, 40),
    summary: str(k.summary, 200),
    facts: arr(k.facts).slice(0, MAX_FACTS).map(f => str(f, FACT_CAP)).filter(Boolean),
    entities: arr(k.entities).slice(0, MAX_ENTITIES).map(e => str(e, 60)).filter(Boolean),
    keyTerms: arr(k.keyTerms).slice(0, MAX_KEYTERMS).map(t => str(t, 60)).filter(Boolean),
  };
}
