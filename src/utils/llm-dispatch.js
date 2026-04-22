import { ensureOffscreen, postToOffscreen } from './offscreen-bridge.js';

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const OPENAI_TIMEOUT_MS = 30000;

const TIER_MODELS = {
  fast: 'gpt-4o-mini',
  quality: 'gpt-4o-mini'
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
 * Call OpenAI Chat Completions API.
 * @param {Array} messages - OpenAI-format [{role, content}]
 * @param {string} systemPrompt - System instruction text
 * @param {object} options - { model, temperature }
 * @returns {{success: boolean, result?: string, error?: string}}
 */
export async function callOpenAIChat(messages, systemPrompt, options = {}) {
  const apiKey = OPENAI_API_KEY;
  if (!apiKey) return { success: false, error: 'OpenAI API key not configured (set VITE_OPENAI_API_KEY in .env)' };

  const model = options.model || TIER_MODELS.quality;

  const llmMessages = [];
  if (systemPrompt) {
    llmMessages.push({ role: 'system', content: systemPrompt });
  }
  llmMessages.push(...messages);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: llmMessages,
        temperature: options.temperature ?? 0.7,
      }),
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { success: false, error: `OpenAI API error: ${res.status} ${errText}` };
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) return { success: false, error: 'No content returned from OpenAI' };
    return { success: true, result: text };
  } catch (err) {
    clearTimeout(timer);
    return { success: false, error: err?.message || String(err) };
  }
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
 * Unified LLM dispatch: routes to remote (OpenAI) or on-device (WebLLM)
 * based on global llmProvider setting.
 * @param {Array} messages - OpenAI-format [{role, content}]
 * @param {string} systemPrompt - System instruction text
 * @param {object} options - { forceProvider, temperature, modelId, timeoutMs, tier }
 */
export async function callLLM(messages, systemPrompt, options = {}) {
  const provider = options.forceProvider || await getEffectiveLLMProvider();

  if (provider === 'on-device') {
    return callWebLLMChat(messages, systemPrompt, options);
  }

  const model = (options.tier && TIER_MODELS[options.tier]) || TIER_MODELS.quality;
  return callOpenAIChat(messages, systemPrompt, { ...options, model });
}

// Keep Gemini exports for VLM (visual-cartographer uses Gemini directly)
export { callOpenAIChat as callRemoteChat };