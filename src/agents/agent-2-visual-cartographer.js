/**
 * Agent 2 — Visual Cartographer
 *
 * Performs VLM screenshot analysis to produce a semantic section map of the page.
 * Falls back to DOM-based extraction when VLM is unavailable.
 */

import { loadPrompt } from '../utils/prompt-loader.js';
import { captureFullPageSlices } from '../utils/screenshot-capture.js';

export const name = 'visual-cartographer';
export const phase = 2;
export const optional = true; // skipped in 'lite' and 'translate' pipelines
export const requiredFields = ['intent'];

/* ── constants ────────────────────────────────────────────── */

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_TIMEOUT_MS = 120_000;
const DEFAULT_MODEL = 'gemini-2.5-pro';
const DEFAULT_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent';

/* ── tag-to-role heuristic for DOM fallback ───────────────── */

const TAG_ROLE_MAP = {
  H1: 'headline',
  H2: 'headline',
  H3: 'headline',
  UL: 'feature-list',
  OL: 'feature-list',
  BUTTON: 'cta',
  PRE: 'code-block',
  CODE: 'code-block',
  TABLE: 'data-table',
  NAV: 'nav',
  HEADER: 'nav',
  FOOTER: 'footer',
  ASIDE: 'sidebar',
  IMG: 'image',
  FIGURE: 'image',
  P: 'body',
  DIV: 'body',
  SECTION: 'body',
  ARTICLE: 'body',
  BLOCKQUOTE: 'testimonial',
};

const EXCLUDED_ROLES = new Set(['nav', 'footer']);

/* ── importance by role ───────────────────────────────────── */

const ROLE_IMPORTANCE = {
  headline: 5,
  'hero-banner': 5,
  'feature-list': 4,
  cta: 4,
  body: 4,
  'code-block': 3,
  testimonial: 3,
  pricing: 3,
  image: 3,
  'data-table': 3,
  sidebar: 2,
  nav: 1,
  footer: 1,
};

/* ── main run function ────────────────────────────────────── */

export async function run(context) {
  const t0 = Date.now();

  // 1. Capture screenshots if not already present
  if ((!context.screenshots || context.screenshots.length === 0) && context.tabId) {
    const { images } = await captureFullPageSlices(context.tabId);
    context.screenshots = images; // [{y, dataUrl}, ...]
  }

  // 2. Attempt VLM-based analysis
  let sectionMap = null;
  let method = 'none';
  if (context.screenshots && context.screenshots.length > 0) {
    try {
      sectionMap = await vlmAnalysis(context.screenshots);
      if (sectionMap) method = 'vlm';
    } catch (err) {
      console.warn('[visual-cartographer] VLM analysis failed, falling back to DOM:', err?.message || err);
    }
  }

  // 3. Fallback: DOM-based extraction via content script
  if (!sectionMap && context.tabId) {
    try {
      sectionMap = await domFallback(context.tabId);
      if (sectionMap.length > 0) method = 'dom';
    } catch (err) {
      console.warn('[visual-cartographer] DOM fallback failed:', err?.message || err);
      sectionMap = [];
    }
  }

  context.sectionMap = sectionMap || [];

  // 4. Log timing
  const elapsed = Date.now() - t0;
  context.log = context.log || [];
  context.log.push({
    agent: name,
    phase,
    durationMs: elapsed,
    sections: context.sectionMap.length,
    method,
  });

  return context;
}

/* ── VLM analysis with Gemini vision ──────────────────────── */

async function vlmAnalysis(screenshots) {
  const prompt = await loadPrompt('visual-cartography');

  const rawText = await callVLMWithImages(screenshots, prompt);
  if (!rawText) return null;

  return parseVLMResponse(rawText);
}

/**
 * Send screenshots to Gemini vision API and return the raw text response.
 */
async function callVLMWithImages(images, prompt) {
  const settings = await chrome.storage.sync.get(['remoteVLMModel', 'remoteVLMEndpoint']);

  const model = settings.remoteVLMModel || DEFAULT_MODEL;
  const endpointTemplate = settings.remoteVLMEndpoint || DEFAULT_ENDPOINT;

  const baseUrl = endpointTemplate.replace('{model}', model);
  const url = baseUrl.includes('key=')
    ? baseUrl
    : `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}key=${encodeURIComponent(GEMINI_API_KEY)}`;

  // Build multimodal parts: images first, then text prompt
  const parts = [];
  for (const img of images) {
    const base64Data = img.dataUrl.replace(/^data:image\/\w+;base64,/, '');
    parts.push({
      inline_data: {
        mime_type: 'image/png',
        data: base64Data,
      },
    });
  }
  parts.push({ text: prompt });

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.2 },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini API error: ${res.status} ${errText}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n').trim();
    return text || null;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Parse VLM JSON response, tolerating markdown fences.
 */
function parseVLMResponse(rawText) {
  // Strip markdown code fences if present
  let cleaned = rawText.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  const sections = JSON.parse(cleaned);
  if (!Array.isArray(sections)) throw new Error('VLM response is not a JSON array');

  // Normalize and validate each section
  return sections.map((s, i) => ({
    id: s.id ?? i,
    role: s.role || 'body',
    text: typeof s.text === 'string' ? s.text : '',
    importance: typeof s.importance === 'number' ? Math.min(5, Math.max(1, s.importance)) : 3,
    excluded: typeof s.excluded === 'boolean' ? s.excluded : EXCLUDED_ROLES.has(s.role),
    visualContext: typeof s.visualContext === 'string' ? s.visualContext : '',
  }));
}

/* ── DOM-based fallback ───────────────────────────────────── */

async function domFallback(tabId) {
  const response = await chrome.tabs.sendMessage(tabId, { action: 'extract-and-clone' });

  if (!response?.success || !Array.isArray(response.segments)) {
    return [];
  }

  return response.segments.map((seg, i) => {
    const tag = (seg.tagName || 'DIV').toUpperCase();
    const role = TAG_ROLE_MAP[tag] || 'body';
    const excluded = isExcludedSegment(seg, role);

    return {
      id: seg.id ?? i,
      role,
      text: seg.text || '',
      importance: excluded ? 1 : (ROLE_IMPORTANCE[role] || 3),
      excluded,
      visualContext: '',
    };
  });
}

/**
 * Heuristic to detect segments that should be excluded from renarration.
 */
function isExcludedSegment(seg, role) {
  if (EXCLUDED_ROLES.has(role)) return true;

  const text = (seg.text || '').toLowerCase();

  // Cookie / consent banners
  if (/\b(cookie|consent|gdpr|accept all|privacy policy)\b/.test(text) && text.length < 300) {
    return true;
  }

  // Ad markers
  if (/\b(advertisement|sponsored|ad)\b/.test(text) && text.length < 200) {
    return true;
  }

  return false;
}
