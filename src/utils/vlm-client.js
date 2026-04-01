/**
 * VLM (Vision Language Model) API client utilities.
 * Handles remote VLM calls and the describeImage orchestration.
 */

import { toDataUrl } from './image-processing.js';
import { getSettingsWithTaskMigration, DEFAULT_TASKS } from './storage-helpers.js';
import { ensureOffscreen, postToOffscreen } from './offscreen-bridge.js';
import { simulateLocalVLM } from './renarration.js';

const GEMINI_API_KEY = 'AIzaSyCLkywSZTLnJXKt6e-5jtaTWAssJhloeN8';
const VLM_TIMEOUT_MS = 120000;

/**
 * Build the full Gemini API URL from the endpoint template, model, and API key.
 */
function buildVlmUrl(endpoint, model, apiKey) {
  const resolved = endpoint.replace('{model}', model);
  if (resolved.includes('key=')) return resolved;
  const sep = endpoint.includes('?') ? '&' : '?';
  return `${resolved}${sep}key=${encodeURIComponent(apiKey)}`;
}

/**
 * Parse the Gemini response and return the concatenated text from candidate parts.
 */
function extractVlmText(data) {
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n').trim() || '';
}

/**
 * Send a single image to the Gemini vision API.
 * @param {Object} opts
 * @param {string} opts.imageDataUrl - base64 data URL of the image
 * @param {string} opts.prompt - text prompt for the VLM
 * @param {string} opts.model - model identifier
 * @param {string} opts.endpoint - endpoint URL template with {model} placeholder
 * @param {string} opts.apiKey - API key
 * @param {string} [opts.mode] - mode hint (e.g. 'describe')
 * @returns {Promise<{success: boolean, result?: string, source?: string, error?: string}>}
 */
export async function callRemoteVLM({ imageDataUrl, prompt, model, endpoint, apiKey, mode }) {
  if (!endpoint || !model || !apiKey) return { success: false, error: 'Missing remote VLM configuration' };
  const url = buildVlmUrl(endpoint, model, apiKey);
  const base64 = imageDataUrl.split(',')[1];
  const body = {
    contents: [
      {
        parts: [
          { text: prompt || 'Describe this image.' },
          { inline_data: { mime_type: 'image/png', data: base64 } }
        ]
      }
    ],
    generationConfig: {
      temperature: mode === 'describe' ? 0.2 : 0
    }
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VLM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Remote VLM error: ${res.status} ${text}`);
    }
    const data = await res.json();
    const text = extractVlmText(data);
    if (!text) return { success: false, error: 'No content returned from remote VLM' };
    return { success: true, result: text, source: 'remote-vlm' };
  } catch (err) {
    clearTimeout(timer);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Send multiple images (screenshot slices) to the Gemini vision API.
 * Each image becomes an inline_data part followed by a slice label.
 * @param {Object} opts
 * @param {Array<{dataUrl: string}>} opts.images - array of image data URLs
 * @param {string} opts.prompt - text prompt for the VLM
 * @param {string} opts.model - model identifier
 * @param {string} opts.endpoint - endpoint URL template with {model} placeholder
 * @param {string} opts.apiKey - API key
 * @returns {Promise<{success: boolean, result?: string, source?: string, error?: string}>}
 */
export async function callRemoteVLMWithImages({ images, prompt, model, endpoint, apiKey }) {
  if (!Array.isArray(images) || images.length === 0) return { success: false, error: 'No images provided' };
  if (!endpoint || !model || !apiKey) return { success: false, error: 'Missing remote VLM configuration' };
  const url = buildVlmUrl(endpoint, model, apiKey);

  const parts = [{ text: prompt || 'Describe these images.' }];
  images.forEach((img, idx) => {
    if (!img?.dataUrl) return;
    const base64 = img.dataUrl.split(',')[1];
    parts.push({ inline_data: { mime_type: 'image/png', data: base64 } });
    parts.push({ text: `Slice ${idx + 1} of ${images.length}` });
  });

  const body = {
    contents: [
      {
        parts
      }
    ],
    generationConfig: {
      temperature: 0.2
    }
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VLM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Remote VLM error: ${res.status} ${text}`);
    }
    const data = await res.json();
    const text = extractVlmText(data);
    if (!text) return { success: false, error: 'No content returned from remote VLM' };
    return { success: true, result: text, source: 'remote-vlm' };
  } catch (err) {
    clearTimeout(timer);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Describe an image using the best available VLM backend.
 * Tries remote VLM first, then WebLLM offscreen, then simulator fallback.
 */
export async function describeImage(imageUrl, taskName) {
  try {
    const settings = await getSettingsWithTaskMigration([
      'useWebLLM',
      'useWebVLM',
      'webvlmModel',
      'useRemoteVLM',
      'remoteVLMModel',
      'remoteVLMEndpoint'
    ]);
    const tasks = settings.tasks || DEFAULT_TASKS;
    const task = tasks[taskName || settings.currentTask] || tasks.simple || DEFAULT_TASKS.simple;

    // Placeholder for future on-device VLM
    if (settings.useWebVLM) {
      console.warn('WebVLM placeholder enabled but not implemented; using remote/simulator.');
    }

    // Try remote VLM first if configured
    if (settings.useRemoteVLM) {
      try {
        const imageDataUrl = await toDataUrl(imageUrl);
        const remote = await callRemoteVLM({
          imageDataUrl,
          prompt: task?.imagePrompt || 'Describe this image accurately. Transcribe any visible text exactly.',
          model: settings.remoteVLMModel,
          endpoint: settings.remoteVLMEndpoint,
          apiKey: GEMINI_API_KEY,
          mode: 'describe'
        });
        if (remote?.success) return remote;
      } catch (err) {
        console.warn('Remote VLM failed, falling back:', err && err.message);
      }
    }

    // Try WebLLM offscreen document
    if (settings.useWebLLM && ensureOffscreen && postToOffscreen) {
      try {
        await ensureOffscreen();
        const response = await postToOffscreen({
          type: 'webllm-describe-image',
          payload: { imageUrl, task, modelId: settings.webllmModel }
        }, { timeoutMs: 90000 });
        if (response && response.success) return response;
      } catch (e) {
        // ignore, fall back
      }
    }

    // Simulator fallback
    if (simulateLocalVLM) {
      const description = await simulateLocalVLM(imageUrl, task);
      return { success: true, result: description };
    }

    return { success: false, error: 'No VLM backend available' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
