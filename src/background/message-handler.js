// Message handler — central dispatcher for all chrome.runtime.onMessage actions.
// Uses static imports (no dynamic import()) to avoid Vite's preload polyfill
// which references DOM APIs unavailable in service workers.

import { chatbotHandlers } from '../handlers/chatbot.js';
import { pageHandlers } from '../handlers/page-renarration.js';
import { simpleHandlers } from '../handlers/simple.js';
import { runPipeline, runPredictiveAdapter } from './orchestrator.js';
import { resolveOffscreenResponse } from '../utils/offscreen-bridge.js';

const agenticHandlers = {
  'run-agentic-pipeline': async (request, sender) => {
    try {
      const result = await runPipeline(request);
      const failedAgents = result.log?.filter(e => !e.success) || [];
      return {
        success: true,
        pipelineType: result.pipelineType,
        agentCount: result.log?.length || 0,
        failedCount: failedAgents.length,
        sectionCount: result.sectionCount || result.sectionMap?.length || 0,
        renarrationCount: result.renarrationCount || result.renarrations?.length || 0,
        validationPassed: !!result.validation?.passed,
        errors: failedAgents.map(e => `${e.agent}: ${e.detail}`),
      };
    } catch (e) {
      // Send error to sidebar if possible
      const tabId = sender?.tab?.id ?? request.tabId;
      if (tabId) {
        chrome.tabs.sendMessage(tabId, {
          action: 'update-clone-progress',
          text: `Error: ${e.message}`
        }).catch(() => {});
      }
      return { success: false, error: e.message };
    }
  },
  'get-predictions': async (request) => {
    return { success: true, ...(await runPredictiveAdapter(request.tabId, request.pageMetadata)) };
  },
  'get-pipeline-visualizer': async () => {
    const data = await chrome.storage.local.get(['pipelineVisualizer', 'pipelineVisualizerLive']);
    return { success: true, ...data };
  },
};

const allHandlers = {
  ...simpleHandlers,
  ...chatbotHandlers,
  ...pageHandlers,
  ...agenticHandlers,
};

console.log(`[MessageHandler] Registered ${Object.keys(allHandlers).length} action handlers`);

export function setupMessageHandler() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Handle offscreen document responses first
    if (request?.__offscreenResponse) {
      resolveOffscreenResponse(request.requestId, request.payload);
      return;
    }

    const handler = allHandlers[request?.action];
    if (handler) {
      handler(request, sender)
        .then((result) => sendResponse(result))
        .catch((e) => sendResponse({ success: false, error: e?.message || String(e) }));
      return true; // Keep channel open for async response
    }

    console.warn('[MessageHandler] Unknown action:', request?.action);
    return false;
  });
}
