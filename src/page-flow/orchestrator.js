import { extractPageKnowledge } from './extract-page.js';
import { renarratePage } from './renarrate-page.js';

let pageRunInProgress = false;
const CONTENT_READY_ACTION = 'renarration-content-ready';

async function activeTabFromRequest(request, sender) {
  if (request?.tabId) return chrome.tabs.get(request.tabId);
  if (sender?.tab?.id) return sender.tab;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sendToTabOptional(tabId, message) {
  if (!tabId) return Promise.resolve();
  return chrome.tabs.sendMessage(tabId, message).catch(() => {});
}

async function sendToTabRequired(tabId, message) {
  if (!tabId) throw new Error('No active tab');
  const response = await chrome.tabs.sendMessage(tabId, message);
  if (response?.success === false) {
    throw new Error(response.error || `Page panel action failed: ${message.action}`);
  }
  return response;
}

async function isContentScriptReady(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: CONTENT_READY_ACTION });
    return response?.success === true;
  } catch {
    return false;
  }
}

async function injectContentScript(tab) {
  if (!tab?.id) throw new Error('No active tab');
  if (!/^https?:/i.test(tab.url || '')) {
    throw new Error('Could not open the page panel on this page. Open a normal webpage and try again.');
  }

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['content.css'],
    });
  } catch (e) {
    console.warn('[PageFlow] Content CSS injection skipped:', e?.message || e);
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js'],
  });
}

async function ensureContentScript(tab) {
  if (await isContentScriptReady(tab.id)) return;

  try {
    await injectContentScript(tab);
  } catch (e) {
    throw new Error(e?.message || 'Could not open the page panel. Reload the page and try again.');
  }

  if (!(await isContentScriptReady(tab.id))) {
    throw new Error('Could not connect to the page panel. Reload the page and try again.');
  }
}

async function openRenarrationPanel(tab) {
  await ensureContentScript(tab);
  await sendToTabRequired(tab.id, { action: 'show-renarration-panel' });
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

  'run-page-renarration-from-extraction': async (request, sender) => {
    if (pageRunInProgress) {
      return { success: false, error: 'Page renarration already in progress' };
    }

    const tab = await activeTabFromRequest(request, sender);
    if (!tab?.id) return { success: false, error: 'No active tab' };

    const { lastExtraction } = await chrome.storage.local.get(['lastExtraction']);
    if (!lastExtraction) {
      return { success: false, error: 'First extract the page' };
    }
    if (!String(lastExtraction.compactText || '').trim()) {
      return { success: false, error: 'First extract the page' };
    }
    if (!lastExtraction.url || !tab.url || lastExtraction.url !== tab.url) {
      return { success: false, error: 'First extract the page' };
    }

    pageRunInProgress = true;
    const runId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());

    try {
      await openRenarrationPanel(tab);
      await sendToTabRequired(tab.id, {
        action: 'update-renarration-progress',
        text: 'Writing renarration with saved reading goal...',
      });

      const renarration = await renarratePage({
        extraction: lastExtraction,
        taskName: request?.task,
      });

      await chrome.storage.local.set({
        lastPageRenarration: {
          extraction: lastExtraction,
          renarration: renarration.text.slice(0, 30000),
          model: renarration.model,
          runId,
          at: new Date().toISOString(),
          url: tab.url,
          title: tab.title || '',
        },
      });

      await sendToTabRequired(tab.id, {
        action: 'render-renarration-text',
        text: renarration.text,
      });

      return {
        success: true,
        runId,
        extraction: lastExtraction,
        renarration: renarration.text,
      };
    } catch (e) {
      const error = e?.message || String(e);
      await sendToTabOptional(tab.id, {
        action: 'update-renarration-progress',
        text: `Error: ${error}`,
        isError: true,
      });
      return { success: false, error };
    } finally {
      pageRunInProgress = false;
    }
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
      await openRenarrationPanel(tab);
      await sendToTabRequired(tab.id, {
        action: 'update-renarration-progress',
        text: 'Extracting page text and screenshots...',
      });

      const extraction = await extractPageKnowledge({
        tabId: tab.id,
        pageMetadata: request?.pageMetadata || { url: tab.url, title: tab.title || '' },
        onProgress: (text) => sendToTabOptional(tab.id, { action: 'update-renarration-progress', text }),
      });

      await sendToTabRequired(tab.id, {
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

      await sendToTabRequired(tab.id, {
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
      await sendToTabOptional(tab.id, {
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
