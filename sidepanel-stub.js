document.addEventListener('DOMContentLoaded', () => {
  const openBtn = document.getElementById('openOverlayBtn');

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
  });
});
