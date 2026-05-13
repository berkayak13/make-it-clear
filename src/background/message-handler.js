import { chatbotHandlers } from '../handlers/chatbot.js';
import { simpleHandlers } from '../handlers/simple.js';
import { pageFlowHandlers } from '../page-flow/orchestrator.js';

const allHandlers = {
  ...simpleHandlers,
  ...chatbotHandlers,
  ...pageFlowHandlers,
};

console.log(`[MessageHandler] Registered ${Object.keys(allHandlers).length} action handlers`);

export function setupMessageHandler() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const handler = allHandlers[request?.action];
    if (!handler) {
      console.warn('[MessageHandler] Unknown action:', request?.action);
      return false;
    }

    handler(request, sender)
      .then((result) => sendResponse(result))
      .catch((e) => sendResponse({ success: false, error: e?.message || String(e) }));
    return true;
  });
}
