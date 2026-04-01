const OFFSCREEN_DEFAULT_TIMEOUT_MS = 120000;
const pendingOffscreenResponses = new Map();
let creatingOffscreen = null;

/**
 * Check whether an offscreen document is currently active.
 */
export async function hasOffscreenDocument() {
  const matched = await chrome.offscreen.hasDocument?.();
  if (typeof matched === 'boolean') return matched;
  try {
    const clients = await chrome.runtime.getContexts?.({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL('offscreen.html')]
    });
    return (clients && clients.length > 0) || false;
  } catch (e) {
    return false;
  }
}

/**
 * Create the offscreen document if it doesn't exist.
 */
export async function ensureOffscreen() {
  if (await hasOffscreenDocument()) return;
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['WORKERS'],
        justification: 'Run WebLLM with WebGPU in an offscreen document for on-device inference.'
      });
    } catch (e) {
      if (await hasOffscreenDocument()) return;
      console.error('Failed to create offscreen document:', e);
      throw e;
    } finally {
      creatingOffscreen = null;
    }
  })();
  return creatingOffscreen;
}

/**
 * Send a message to the offscreen document and wait for a response.
 * Uses requestId-based tracking for request/response matching.
 */
export function postToOffscreen(message, options = {}) {
  const timeoutMs = options.timeoutMs ?? OFFSCREEN_DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    const requestId = Math.random().toString(36).slice(2);
    const timeoutId = setTimeout(() => {
      if (!pendingOffscreenResponses.has(requestId)) return;
      pendingOffscreenResponses.delete(requestId);
      resolve({ success: false, error: 'Offscreen timeout' });
    }, timeoutMs);

    pendingOffscreenResponses.set(requestId, { resolve, timeoutId });

    chrome.runtime.sendMessage({ __toOffscreen: true, requestId, ...message }, () => {
      const sendError = chrome.runtime.lastError;
      if (sendError) {
        const pending = pendingOffscreenResponses.get(requestId);
        if (pending) {
          clearTimeout(pending.timeoutId);
          pendingOffscreenResponses.delete(requestId);
          resolve({ success: false, error: sendError.message });
        }
      }
    });
  });
}

/**
 * Resolve a pending offscreen response by requestId.
 * Call this from a message listener when the offscreen document replies.
 */
export function resolveOffscreenResponse(requestId, response) {
  const pending = pendingOffscreenResponses.get(requestId);
  if (!pending) return false;
  clearTimeout(pending.timeoutId);
  pendingOffscreenResponses.delete(requestId);
  pending.resolve(response);
  return true;
}
