import { describe, it, expect, vi, beforeEach } from 'vitest';

// popup-stub.js is a plain DOM script — stub out document/window/chrome and
// capture the DOMContentLoaded handler it registers.

function makeElement() {
  return {
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    disabled: false,
    hidden: true,
    textContent: '',
  };
}

function setupDom() {
  const documentListeners = {};
  const elements = {};
  for (const id of [
    'openOverlayBtn',
    'settingsBtn',
    'viewExtractionBtn',
    'staticSiteBtn',
    'optionsLink',
    'popupStatus',
    'popupVersion',
  ]) {
    elements[id] = makeElement();
  }
  globalThis.document = {
    addEventListener: (type, fn) => {
      documentListeners[type] = fn;
    },
    getElementById: (id) => elements[id] ?? null,
  };
  globalThis.window = { close: vi.fn() };
  return { documentListeners, elements };
}

// Mirrors real behavior: tabs.sendMessage rejects until a content script with
// an onMessage listener exists in the tab (i.e. until executeScript ran).
function setupChrome({ contentScriptPresent = false, injectable = true } = {}) {
  let injected = contentScriptPresent;
  const chrome = {
    storage: { local: { set: vi.fn(async () => {}) } },
    tabs: {
      query: vi.fn(async () => [{ id: 7 }]),
      create: vi.fn(),
      sendMessage: vi.fn(async () => {
        if (!injected) {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }
      }),
    },
    scripting: {
      insertCSS: vi.fn(async () => {
        if (!injectable) throw new Error('Cannot access a chrome:// URL');
      }),
      executeScript: vi.fn(async () => {
        if (!injectable) throw new Error('Cannot access a chrome:// URL');
        injected = true;
      }),
    },
    runtime: {
      openOptionsPage: vi.fn(),
      getURL: (path) => `chrome-extension://test/${path}`,
      getManifest: () => ({ version: '1.0.0' }),
    },
  };
  globalThis.chrome = chrome;
  return chrome;
}

async function loadPopup(chromeOpts) {
  const dom = setupDom();
  const chrome = setupChrome(chromeOpts);
  vi.resetModules();
  await import('./popup-stub.js');
  dom.documentListeners.DOMContentLoaded();
  return { ...dom, chrome };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('popup open-overlay flow', () => {
  it('messages the existing content script and closes the popup', async () => {
    const { elements, chrome } = await loadPopup({ contentScriptPresent: true });
    await elements.openOverlayBtn.listeners.click();

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { action: 'SHOW_OVERLAY' });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(globalThis.window.close).toHaveBeenCalled();
  });

  it('falls back to injecting all three content scripts in manifest order', async () => {
    const { elements, chrome } = await loadPopup({ contentScriptPresent: false });
    await elements.openOverlayBtn.listeners.click();

    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ['clear-shared.js', 'content.js', 'clear-overlay.js'],
    });
    expect(chrome.scripting.insertCSS).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ['content.css'],
    });
  });

  it('re-sends SHOW_OVERLAY after injection so the overlay actually shows', async () => {
    const { elements, chrome } = await loadPopup({ contentScriptPresent: false });
    await elements.openOverlayBtn.listeners.click();

    // First send fails (no listener yet); second runs after executeScript.
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
    expect(chrome.tabs.sendMessage.mock.calls[1]).toEqual([7, { action: 'SHOW_OVERLAY' }]);
    expect(globalThis.window.close).toHaveBeenCalled();
  });

  it('does not write the dead clear.overlay.visible storage key', async () => {
    const { elements, chrome } = await loadPopup({ contentScriptPresent: true });
    await elements.openOverlayBtn.listeners.click();

    for (const [values] of chrome.storage.local.set.mock.calls) {
      expect(values).not.toHaveProperty('clear.overlay.visible');
    }
  });

  it('keeps the popup open and shows an error on restricted pages', async () => {
    const { elements } = await loadPopup({ contentScriptPresent: false, injectable: false });
    await elements.openOverlayBtn.listeners.click();

    expect(globalThis.window.close).not.toHaveBeenCalled();
    expect(elements.popupStatus.hidden).toBe(false);
    expect(elements.popupStatus.textContent).not.toBe('');
    expect(elements.openOverlayBtn.disabled).toBe(false);
  });
});
