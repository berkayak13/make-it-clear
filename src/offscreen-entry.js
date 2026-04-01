// Offscreen entry (bundled by Vite) using direct import from @mlc-ai/web-llm
import * as webllm from '@mlc-ai/web-llm';

let engine = null;
let initializing = null;
let isReady = false;
let lastModelId = null;

function progress(report) {
  try {
    chrome.runtime.sendMessage({ __offscreenProgress: true, stage: report?.text || 'init', progress: report?.progress || 0 });
  } catch {}
}

async function initEngineIfNeeded(modelId) {
  const chosen = modelId || lastModelId || "gemma-2-2b-it-q4f16_1-MLC";
  if (isReady && chosen === lastModelId) return;
  if (initializing) return initializing;
  isReady = false;
  initializing = (async () => {
    try {
      if (!webllm.CreateMLCEngine) {
        throw new Error('WebLLM CreateMLCEngine factory not found — check @mlc-ai/web-llm version');
      }
      engine = await webllm.CreateMLCEngine(chosen, { initProgressCallback: progress });
      isReady = true;
      lastModelId = chosen;
    } catch (e) {
      console.error('WebLLM init failed:', e);
      isReady = false;
    }
  })();
  return initializing;
}

function formatMessages(task, text) {
  const system = task?.textPrompt || 'Rewrite the text clearly:';
  return [
    { role: 'system', content: system },
    { role: 'user', content: text }
  ];
}

async function webllmRenarrateText(text, task) {
  await initEngineIfNeeded();
  if (!isReady || !engine) return { success: false, error: 'WebLLM not initialized' };
  try {
    if (engine.chat?.completions?.create) {
      console.log('WebLLM chat completion request:', formatMessages(task, text));
      const res = await engine.chat.completions.create({
        messages: formatMessages(task, text),
        temperature: 0.3,
        stream: false,
      });
      console.log('WebLLM chat completion result:', res);
      const content = res?.choices?.[0]?.message?.content || '';
      return { success: true, result: content };
    }
    if (engine.generate) {
      const prompt = `${task?.textPrompt || 'Rewrite:'}\n\n${text}`;
      const out = await engine.generate(prompt, { temperature: 0.3 });
      return { success: true, result: out?.output_text || String(out) };
    }
    throw new Error('Unsupported WebLLM interface');
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

async function webllmChat(messages, options = {}) {
  await initEngineIfNeeded(options.modelId);
  if (!isReady || !engine) return { success: false, error: 'WebLLM not initialized' };
  try {
    if (engine.chat?.completions?.create) {
      const res = await engine.chat.completions.create({
        messages,
        temperature: options.temperature ?? 0.7,
        stream: false,
      });
      const content = res?.choices?.[0]?.message?.content || '';
      return { success: true, result: content };
    }
    if (engine.generate) {
      const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
      const out = await engine.generate(prompt, { temperature: options.temperature ?? 0.7 });
      return { success: true, result: out?.output_text || String(out) };
    }
    throw new Error('Unsupported WebLLM interface');
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.__toOffscreen) return; // ignore unrelated
  const { type, payload, requestId } = message;

  (async () => {
    let result;
    if (type === 'webllm-init') {
      await initEngineIfNeeded(payload?.modelId);
      result = { success: !!engine };
    } else if (type === 'webllm-renarrate-text') {
      // Ensure engine is ready with the requested model if provided
      if (!isReady || (payload?.modelId && payload.modelId !== lastModelId)) {
        await initEngineIfNeeded(payload?.modelId);
      }
      result = await webllmRenarrateText(payload?.text, payload?.task);
    } else if (type === 'webllm-chat') {
      if (!isReady || (payload?.modelId && payload.modelId !== lastModelId)) {
        await initEngineIfNeeded(payload?.modelId);
      }
      result = await webllmChat(payload?.messages || [], {
        modelId: payload?.modelId,
        temperature: payload?.temperature
      });
    } else {
      result = { success: false, error: 'Unknown offscreen message type' };
    }
    chrome.runtime.sendMessage({ __offscreenResponse: true, requestId, payload: result });
  })();

  sendResponse && sendResponse({ ack: true });
  return true;
});
