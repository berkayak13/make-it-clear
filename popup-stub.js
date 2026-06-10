document.addEventListener('DOMContentLoaded', () => {
  const openBtn = document.getElementById('openOverlayBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const viewExtractionBtn = document.getElementById('viewExtractionBtn');
  const optionsLink = document.getElementById('optionsLink');
  const statusEl = document.getElementById('popupStatus');
  const versionEl = document.getElementById('popupVersion');

  if (versionEl) versionEl.textContent = `v${chrome.runtime.getManifest().version}`;

  function showStatus(message) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.hidden = false;
  }

  async function openOverlay(tab) {
    await chrome.storage.local.set({ 'clear.overlay.collapsed': false });

    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'SHOW_OVERLAY' });
      return true;
    } catch {}

    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['content.css']
      });
      // content.js and clear-overlay.js both read globalThis.__clearRuntime,
      // which clear-shared.js defines — keep the manifest injection order.
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['clear-shared.js', 'content.js', 'clear-overlay.js']
      });
      // The freshly injected overlay initializes hidden (per-tab visibility
      // lives in the page's sessionStorage); now that its listener exists,
      // tell it to show itself.
      await chrome.tabs.sendMessage(tab.id, { action: 'SHOW_OVERLAY' });
      return true;
    } catch (e) {
      console.warn('[Clear] Could not open overlay on this page:', e?.message || e);
      return false;
    }
  }

  openBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    openBtn.disabled = true;
    const opened = await openOverlay(tab);
    if (opened) {
      window.close();
      return;
    }
    openBtn.disabled = false;
    showStatus("Clear can't run on this page. Try a regular website.");
  });

  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  viewExtractionBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('viewers/extracted-content.html') });
    window.close();
  });

  const staticSiteBtn = document.getElementById('staticSiteBtn');
  staticSiteBtn?.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabParam = tab?.id ? `&tabId=${encodeURIComponent(tab.id)}` : '';
    chrome.tabs.create({
      url: chrome.runtime.getURL(`viewers/extracted-content.html?action=site${tabParam}`),
    });
    window.close();
  });

  optionsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
    window.close();
  });
});
