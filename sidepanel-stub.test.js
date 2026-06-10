import { describe, it, expect, vi, beforeEach } from 'vitest';

// sidepanel-stub.js is a plain DOM script — stub out document/chrome and
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
  const elements = {
    openOverlayBtn: makeElement(),
    spStatus: makeElement(),
  };
  globalThis.document = {
    addEventListener: (type, fn) => {
      documentListeners[type] = fn;
    },
    getElementById: (id) => elements[id] ?? null,
  };
  globalThis.window = { close: vi.fn() };
  return { documentListeners, elements };
}

function setupChrome({ contentScriptPresent = false, injectable = true } = {}) {
  let injected = contentScriptPresent;
  const chrome = {
    storage: { local: { set: vi.fn(async () => {}) } },
    tabs: {
      query: vi.fn(async () => [{ id: 7 }]),
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
  };
  globalThis.chrome = chrome;
  return chrome;
}

async function loadSidepanel(chromeOpts) {
  const dom = setupDom();
  const chrome = setupChrome(chromeOpts);
  vi.resetModules();
  await import('./sidepanel-stub.js');
  dom.documentListeners.DOMContentLoaded();
  return { ...dom, chrome };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('side panel open-overlay flow', () => {
  it('falls back to injecting all three content scripts in manifest order', async () => {
    const { elements, chrome } = await loadSidepanel({ contentScriptPresent: false });
    await elements.openOverlayBtn.listeners.click();

    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ['clear-shared.js', 'content.js', 'clear-overlay.js'],
    });
  });

  it('re-sends SHOW_OVERLAY after injection so the overlay actually shows', async () => {
    const { elements, chrome } = await loadSidepanel({ contentScriptPresent: false });
    await elements.openOverlayBtn.listeners.click();

    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
    expect(chrome.tabs.sendMessage.mock.calls[1]).toEqual([7, { action: 'SHOW_OVERLAY' }]);
  });

  it('does not write the dead clear.overlay.visible storage key', async () => {
    const { elements, chrome } = await loadSidepanel({ contentScriptPresent: true });
    await elements.openOverlayBtn.listeners.click();

    for (const [values] of chrome.storage.local.set.mock.calls) {
      expect(values).not.toHaveProperty('clear.overlay.visible');
    }
  });

  it('shows an error and re-enables the button on restricted pages', async () => {
    const { elements } = await loadSidepanel({ contentScriptPresent: false, injectable: false });
    await elements.openOverlayBtn.listeners.click();

    expect(elements.spStatus.hidden).toBe(false);
    expect(elements.spStatus.textContent).not.toBe('');
    expect(elements.openOverlayBtn.disabled).toBe(false);
  });
});
