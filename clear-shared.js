// clear-shared.js — shared runtime for the Clear content scripts.
// Injected FIRST (see manifest content_scripts order) so content.js and
// clear-overlay.js can read globalThis.__clearRuntime. This centralizes the
// extension-context-invalidation guards and the web-font injection that were
// previously copy-pasted into both files.
//
// content scripts of one extension on one page share a global object, so a
// namespace hung off globalThis is the unambiguous way to share code between
// them (clear-overlay.js runs inside an IIFE; content.js does not — a shared
// global sidesteps every top-level-scope subtlety).
(function () {
  if (globalThis.__clearRuntime) return;

  // Single source of truth for "the extension was reloaded/updated while this
  // page stayed open". Previously each script tracked its own flag.
  let extensionContextDead = false;
  const deadHandlers = [];

  function isExtensionContextError(error) {
    return /Extension context invalidated/i.test(error?.message || String(error || ''));
  }

  // Registers a one-shot cleanup callback, fired when the context is first seen
  // as gone, so each script can tear down its own listeners/UI.
  function onContextDead(handler) {
    if (typeof handler === 'function') deadHandlers.push(handler);
  }

  function markExtensionContextDead(error) {
    if (!isExtensionContextError(error)) return false;
    if (!extensionContextDead) {
      extensionContextDead = true;
      for (const handler of deadHandlers) {
        try {
          handler();
        } catch {
          // A cleanup failure must not mask the dead-context signal.
        }
      }
    }
    return true;
  }

  function hasExtensionContext() {
    if (extensionContextDead) return false;
    try {
      return !!chrome?.runtime?.id;
    } catch (e) {
      markExtensionContextDead(e);
      return false;
    }
  }

  // Superset of both former copies: supports the callback form (used by the
  // selection feedback path) and the promise form (everywhere else).
  function safeSendMessage(message, callback) {
    if (!hasExtensionContext()) {
      if (callback) callback(null);
      return Promise.resolve(null);
    }
    try {
      if (callback) {
        chrome.runtime.sendMessage(message, (res) => {
          const error = chrome.runtime.lastError;
          if (error) {
            markExtensionContextDead(error);
            callback(null, error);
            return;
          }
          callback(res, null);
        });
        return Promise.resolve(null);
      }
      return chrome.runtime.sendMessage(message).catch((e) => {
        markExtensionContextDead(e);
        return null;
      });
    } catch (e) {
      markExtensionContextDead(e);
      if (callback) callback(null, e);
      return Promise.resolve(null);
    }
  }

  function safeRuntimeUrl(path) {
    if (!hasExtensionContext()) return '';
    try {
      return chrome.runtime.getURL(path);
    } catch (e) {
      markExtensionContextDead(e);
      return '';
    }
  }

  // Injects the Clear web fonts into the document head once (guarded by id).
  // @font-face rules registered on the document are also resolved inside shadow
  // roots, so the overlay's Shadow DOM uses them without needing its own copy.
  function injectClearFonts() {
    if (document.getElementById('clear-fonts')) return;
    const fontBase = safeRuntimeUrl('assets/fonts/');
    if (!fontBase) return;
    const style = document.createElement('style');
    style.id = 'clear-fonts';
    style.textContent = `
    @font-face {
      font-family: 'Geist';
      font-style: normal;
      font-weight: 100 900;
      font-display: swap;
      src: url(${fontBase}geist-latin.woff2) format('woff2');
      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
    }
    @font-face {
      font-family: 'Geist';
      font-style: normal;
      font-weight: 100 900;
      font-display: swap;
      src: url(${fontBase}geist-latin-ext.woff2) format('woff2');
      unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
    }
    @font-face {
      font-family: 'Geist Mono';
      font-style: normal;
      font-weight: 100 900;
      font-display: swap;
      src: url(${fontBase}geist-mono-latin.woff2) format('woff2');
      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
    }
    @font-face {
      font-family: 'Geist Mono';
      font-style: normal;
      font-weight: 100 900;
      font-display: swap;
      src: url(${fontBase}geist-mono-latin-ext.woff2) format('woff2');
      unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
    }
    @font-face {
      font-family: 'Newsreader';
      font-style: normal;
      font-weight: 400;
      font-display: swap;
      src: url(${fontBase}newsreader-latin.woff2) format('woff2');
      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
    }
    @font-face {
      font-family: 'Newsreader';
      font-style: normal;
      font-weight: 400;
      font-display: swap;
      src: url(${fontBase}newsreader-latin-ext.woff2) format('woff2');
      unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
    }
    @font-face {
      font-family: 'Newsreader';
      font-style: italic;
      font-weight: 400;
      font-display: swap;
      src: url(${fontBase}newsreader-italic-latin.woff2) format('woff2');
      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
    }
    @font-face {
      font-family: 'Newsreader';
      font-style: italic;
      font-weight: 400;
      font-display: swap;
      src: url(${fontBase}newsreader-italic-latin-ext.woff2) format('woff2');
      unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
    }
  `;
    (document.head || document.documentElement).appendChild(style);
  }

  globalThis.__clearRuntime = {
    isExtensionContextError,
    hasExtensionContext,
    markExtensionContextDead,
    onContextDead,
    safeSendMessage,
    safeRuntimeUrl,
    injectClearFonts,
  };
})();
