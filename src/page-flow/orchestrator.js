import { extractPageKnowledge } from './extract-page.js';
import { renarratePage } from './renarrate-page.js';
import {
  buildStaticSiteHTML,
  buildRenarratedSiteHTML,
  collectImageDataURIs,
  siteFilename,
} from './build-static-site.js';

// Holds the in-flight page-renarration run as a promise (or null when idle).
// A promise lets the busy check and the lock be set in one synchronous tick.
let pageRunPromise = null;

const RENARRATED_VIEWER_PATH = 'viewers/renarrated-page.html';

// chrome.storage.local has a fixed quota (~10MB without "unlimitedStorage").
// Reject renarration payloads above this up front rather than failing opaquely.
const STORAGE_WRITE_LIMIT = 9_000_000;

async function activeTabFromRequest(request, sender) {
  if (request?.tabId) return chrome.tabs.get(request.tabId);
  if (sender?.tab?.id) return sender.tab;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
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

// Pulls the user-relevant coverage notes (budget skips, uncurated images,
// possible duplicates) out of the extraction so the UI can show "N items
// skipped" instead of silently implying full coverage.
function coverageNotes(extraction) {
  const warnings = Array.isArray(extraction?.warnings) ? extraction.warnings : [];
  return warnings.filter((w) => /budget reached|not curated|possible duplicate/i.test(String(w)));
}

function notifyCoverage(extraction, notify) {
  const notes = coverageNotes(extraction);
  if (notes.length) notify(`Coverage notes: ${notes.join(' ')}`);
}

function hasExtractionContent(extraction) {
  if (String(extraction?.compactText || '').trim()) return true;
  const facts = extraction?.facts || extraction?.knowledge?.facts || [];
  return Array.isArray(facts) && facts.some((fact) => String(typeof fact === 'string' ? fact : fact?.text || '').trim());
}

export const pageFlowHandlers = {
  'extract-page-knowledge': async (request, sender) => {
    const tab = await activeTabFromRequest(request, sender);
    if (!tab?.id) return { success: false, error: 'No active tab' };

    notifyExtraction('running');
    const sendProgress = (text) => {
      try {
        chrome.runtime.sendMessage({ action: 'extraction-progress', text }).catch(() => {});
      } catch {}
    };
    try {
      const extraction = await extractPageKnowledge({
        tabId: tab.id,
        pageMetadata: request?.pageMetadata || { url: tab.url, title: tab.title || '' },
        onProgress: sendProgress,
      });
      notifyCoverage(extraction, sendProgress);
      notifyExtraction('done', extraction);
      return { success: true, extraction };
    } catch (e) {
      const error = e?.message || String(e);
      notifyExtraction('failed', null, error);
      return { success: false, error };
    }
  },

  // Renarrates the page from its saved extraction, builds a standalone reading
  // page from the renarrated text plus the original page's images, and opens
  // that page in a new browser tab next to the source page.
  'run-page-renarration-from-extraction': async (request, sender) => {
    if (pageRunPromise) {
      return { success: false, error: 'Page renarration already in progress' };
    }

    // Assign the lock synchronously, before the first `await`, so two requests
    // arriving back-to-back cannot both pass the busy check above.
    pageRunPromise = (async () => {
      const tab = await activeTabFromRequest(request, sender);
      if (!tab?.id) return { success: false, error: 'No active tab' };

      const { lastExtraction } = await chrome.storage.local.get(['lastExtraction']);
      if (!lastExtraction || !hasExtractionContent(lastExtraction)) {
        return { success: false, error: 'First extract the page' };
      }
      if (!lastExtraction.url || !tab.url || lastExtraction.url !== tab.url) {
        return { success: false, error: 'First extract the page' };
      }

      const runId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());

      const sendProgress = (text) => {
        try {
          chrome.runtime.sendMessage({ action: 'renarration-progress', text }).catch(() => {});
        } catch {}
      };

      try {
        const renarration = await renarratePage({
          extraction: lastExtraction,
          taskName: request?.task,
          onProgress: sendProgress,
        });

        // Images keep their remote URLs (no data-URI embedding) so the document
        // stays small enough to pass through chrome.storage.local.
        const html = buildRenarratedSiteHTML(lastExtraction, renarration.text, {}, renarration.captions || {});
        const at = new Date().toISOString();

        const storagePayload = {
          lastPageRenarration: {
            extraction: lastExtraction,
            // Full renarration text — the size check below guards the storage
            // quota loudly instead of silently clipping content.
            renarration: renarration.text,
            model: renarration.model,
            runId,
            at,
            url: tab.url,
            title: tab.title || '',
          },
          lastRenarratedSite: {
            html,
            title: lastExtraction.title || tab.title || 'Renarrated page',
            url: tab.url,
            runId,
            at,
          },
        };

        // Size-check before writing: a payload over quota would otherwise fail
        // the whole renarration at the final step with an opaque error.
        const approxBytes = JSON.stringify(storagePayload).length;
        if (approxBytes > STORAGE_WRITE_LIMIT) {
          return {
            success: false,
            error: `Renarrated page is too large to store (~${Math.round(approxBytes / 1e6)}MB).`,
          };
        }
        try {
          await chrome.storage.local.set(storagePayload);
        } catch (e) {
          return { success: false, error: `Failed to store renarrated page: ${e?.message || String(e)}` };
        }

        const createOptions = {
          url: chrome.runtime.getURL(RENARRATED_VIEWER_PATH),
          active: true,
        };
        if (typeof tab.index === 'number') createOptions.index = tab.index + 1;
        if (typeof tab.windowId === 'number') createOptions.windowId = tab.windowId;
        const newTab = await chrome.tabs.create(createOptions);

        return {
          success: true,
          runId,
          tabId: newTab?.id,
          renarration: renarration.text,
        };
      } catch (e) {
        return { success: false, error: e?.message || String(e) };
      }
    })();

    try {
      return await pageRunPromise;
    } finally {
      pageRunPromise = null;
    }
  },

  // Builds a self-contained static HTML site from a page's extracted content
  // and photos. Re-extracts first when no fresh extraction exists for the tab.
  'generate-static-site': async (request, sender) => {
    const tab = await activeTabFromRequest(request, sender);
    const tabUrl = tab?.url || '';

    const notifyProgress = (text) => {
      try {
        chrome.runtime.sendMessage({ action: 'static-site-progress', text }).catch(() => {});
      } catch {}
    };

    let { lastExtraction: extraction } = await chrome.storage.local.get(['lastExtraction']);
    const isFresh = extraction
      && hasExtractionContent(extraction)
      && (!tabUrl || !extraction.url || extraction.url === tabUrl);

    if (!isFresh) {
      if (!tab?.id || !/^https?:/i.test(tabUrl)) {
        return { success: false, error: 'Open a normal web page, then generate the static site.' };
      }
      notifyProgress('Extracting page content and photos...');
      notifyExtraction('running');
      try {
        extraction = await extractPageKnowledge({
          tabId: tab.id,
          pageMetadata: { url: tabUrl, title: tab.title || '' },
          onProgress: notifyProgress,
        });
        notifyCoverage(extraction, notifyProgress);
        notifyExtraction('done', extraction);
      } catch (e) {
        const error = e?.message || String(e);
        notifyExtraction('failed', null, error);
        return { success: false, error };
      }
    }

    if (!extraction || !hasExtractionContent(extraction)) {
      return { success: false, error: 'No extracted content available for this page.' };
    }

    try {
      notifyProgress('Embedding photos...');
      const imageMap = await collectImageDataURIs(extraction.images || [], notifyProgress);
      notifyProgress('Assembling static site...');
      const html = buildStaticSiteHTML(extraction, imageMap);
      const embeddedImages = Object.keys(imageMap).length;
      const totalImages = Array.isArray(extraction.images) ? extraction.images.length : 0;
      notifyProgress('Static site ready.');
      return {
        success: true,
        html,
        filename: siteFilename(extraction),
        title: extraction.title || '',
        url: extraction.url || '',
        embeddedImages,
        totalImages,
      };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  },

};
