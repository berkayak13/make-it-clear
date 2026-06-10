document.addEventListener('DOMContentLoaded', () => {
  const openBtn = document.getElementById('openOverlayBtn');
  const statusEl = document.getElementById('spStatus');

  function showStatus(message) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.hidden = false;
  }

  function hideStatus() {
    if (statusEl) statusEl.hidden = true;
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
    hideStatus();
    const opened = await openOverlay(tab);
    openBtn.disabled = false;
    if (!opened) {
      showStatus("Clear can't run on this page. Try a regular website.");
    }
  });
});
