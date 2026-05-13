import { extractPageKnowledge } from './extract-page.js';
import { renarratePage } from './renarrate-page.js';

let pageRunInProgress = false;

async function activeTabFromRequest(request, sender) {
  if (request?.tabId) return chrome.tabs.get(request.tabId);
  if (sender?.tab?.id) return sender.tab;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sendToTab(tabId, message) {
  if (!tabId) return Promise.resolve();
  return chrome.tabs.sendMessage(tabId, message).catch(() => {});
}

function notifyExtraction(status, extraction = null, error = null) {
  try {
    chrome.runtime.sendMessage({
      action: 'extraction-update',
      status,
      extraction,
      error,
    }).catch(() => {});
  } catch {}
}

export const pageFlowHandlers = {
  'extract-page-knowledge': async (request, sender) => {
    const tab = await activeTabFromRequest(request, sender);
    if (!tab?.id) return { success: false, error: 'No active tab' };

    notifyExtraction('running');
    try {
      const extraction = await extractPageKnowledge({
        tabId: tab.id,
        pageMetadata: request?.pageMetadata || { url: tab.url, title: tab.title || '' },
        onProgress: (text) => {
          try {
            chrome.runtime.sendMessage({ action: 'extraction-progress', text }).catch(() => {});
          } catch {}
        },
      });
      notifyExtraction('done', extraction);
      return { success: true, extraction };
    } catch (e) {
      const error = e?.message || String(e);
      notifyExtraction('failed', null, error);
      return { success: false, error };
    }
  },

  'get-last-extraction': async () => {
    const { lastExtraction } = await chrome.storage.local.get(['lastExtraction']);
    return { success: true, extraction: lastExtraction || null };
  },

  'run-page-renarration': async (request, sender) => {
    if (pageRunInProgress) {
      return { success: false, error: 'Page renarration already in progress' };
    }

    const tab = await activeTabFromRequest(request, sender);
    if (!tab?.id) return { success: false, error: 'No active tab' };

    pageRunInProgress = true;
    const runId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());

    try {
      await sendToTab(tab.id, { action: 'show-renarration-panel' });
      await sendToTab(tab.id, {
        action: 'update-renarration-progress',
        text: 'Extracting page text and screenshots...',
      });

      const extraction = await extractPageKnowledge({
        tabId: tab.id,
        pageMetadata: request?.pageMetadata || { url: tab.url, title: tab.title || '' },
        onProgress: (text) => sendToTab(tab.id, { action: 'update-renarration-progress', text }),
      });

      await sendToTab(tab.id, {
        action: 'update-renarration-progress',
        text: 'Writing renarration with saved reading goal...',
      });

      const renarration = await renarratePage({
        extraction,
        taskName: request?.task,
      });

      await chrome.storage.local.set({
        lastPageRenarration: {
          extraction,
          renarration: renarration.text.slice(0, 30000),
          model: renarration.model,
          runId,
          at: new Date().toISOString(),
          url: tab.url,
          title: tab.title || '',
        },
      });

      await sendToTab(tab.id, {
        action: 'render-renarration-text',
        text: renarration.text,
      });

      return {
        success: true,
        runId,
        extraction,
        renarration: renarration.text,
      };
    } catch (e) {
      const error = e?.message || String(e);
      await sendToTab(tab.id, {
        action: 'update-renarration-progress',
        text: `Error: ${error}`,
        isError: true,
      });
      return { success: false, error };
    } finally {
      pageRunInProgress = false;
    }
  },
};
