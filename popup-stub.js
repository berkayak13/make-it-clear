document.addEventListener('DOMContentLoaded', () => {
  const openBtn = document.getElementById('openOverlayBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const viewExtractionBtn = document.getElementById('viewExtractionBtn');
  const optionsLink = document.getElementById('optionsLink');

  async function openOverlay(tab) {
    await chrome.storage.local.set({
      'clear.overlay.visible': true,
      'clear.overlay.collapsed': false
    });

    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'SHOW_OVERLAY' });
      return true;
    } catch {}

    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['content.css']
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['clear-overlay.js']
      });
      return true;
    } catch (e) {
      console.warn('[Clear] Could not open overlay on this page:', e?.message || e);
      return false;
    }
  }

  openBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await openOverlay(tab);
    window.close();
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
