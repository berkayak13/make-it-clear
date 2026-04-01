import { ensureOffscreen, postToOffscreen } from './offscreen-bridge.js';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_TIMEOUT_MS = 60000;

const TIER_MODELS = {
  fast: 'gemini-2.0-flash-lite',
  quality: 'gemini-2.5-flash'
};

/**
 * Read the effective LLM provider from storage.
 * Falls back to legacy useWebLLM boolean for backward compat.
 */
export async function getEffectiveLLMProvider() {
  const { llmProvider, useWebLLM } = await chrome.storage.sync.get(['llmProvider', 'useWebLLM']);
  if (llmProvider) return llmProvider;
  return useWebLLM ? 'on-device' : 'remote';
}

/**
 * Call Gemini API with native Gemini conversation format.
 * @param {Array} conversationContents - Gemini-format [{role, parts}]
 * @param {string} systemInstruction - System instruction text
 * @returns {{success: boolean, result?: string, error?: string}}
 */
export async function callGeminiChat(conversationContents, systemInstruction, overrides = {}) {
  const settings = await chrome.storage.sync.get(['remoteVLMModel', 'remoteVLMEndpoint']);
  const model = overrides.model || settings.remoteVLMModel || 'gemini-2.5-flash';
  const endpoint = settings.remoteVLMEndpoint ||
    'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent';

  const replaced = endpoint.replace('{model}', model);
  const url = replaced.includes('key=')
    ? replaced
    : `${replaced}${replaced.includes('?') ? '&' : '?'}key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const body = {
    contents: conversationContents,
    generationConfig: { temperature: 0.7 }
  };
  if (systemInstruction) {
    body.system_instruction = { parts: [{ text: systemInstruction }] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { success: false, error: `Gemini API error: ${res.status} ${errText}` };
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n').trim();
    if (!text) return { success: false, error: 'No content returned from Gemini' };
    return { success: true, result: text };
  } catch (err) {
    clearTimeout(timer);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Convert OpenAI-format messages to Gemini format and call callGeminiChat.
 * Filters out system messages (handled via systemInstruction param).
 */
export async function callGeminiChatFromMessages(messages, systemPrompt, overrides = {}) {
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
  return callGeminiChat(contents, systemPrompt, overrides);
}

/**
 * Send messages to WebLLM via offscreen document.
 * Prepends system prompt as a system message.
 */
export async function callWebLLMChat(messages, systemPrompt, options = {}) {
  const llmMessages = [];
  if (systemPrompt) {
    llmMessages.push({ role: 'system', content: systemPrompt });
  }
  llmMessages.push(...messages);

  try {
    await ensureOffscreen();
    const { webllmModel } = await chrome.storage.sync.get(['webllmModel']);
    const response = await postToOffscreen({
      type: 'webllm-chat',
      payload: {
        messages: llmMessages,
        modelId: options.modelId || webllmModel,
        temperature: options.temperature
      }
    }, { timeoutMs: options.timeoutMs || 120000 });
    return response;
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

/**
 * Unified LLM dispatch: routes to remote (Gemini) or on-device (WebLLM)
 * based on global llmProvider setting.
 * @param {Array} messages - OpenAI-format [{role, content}]
 * @param {string} systemPrompt - System instruction text
 * @param {object} options - { forceProvider, temperature, modelId, timeoutMs, tier }
 *   tier: 'fast' uses gemini-2.0-flash-lite, 'quality' uses gemini-2.5-flash
 */
export async function callLLM(messages, systemPrompt, options = {}) {
  const provider = options.forceProvider || await getEffectiveLLMProvider();

  if (provider === 'on-device') {
    return callWebLLMChat(messages, systemPrompt, options);
  }

  // For remote/Gemini, handle tier-based model override without mutating storage
  const overrides = {};
  if (options.tier && TIER_MODELS[options.tier]) {
    overrides.model = TIER_MODELS[options.tier];
  }

  return callGeminiChatFromMessages(messages, systemPrompt, overrides);
}
