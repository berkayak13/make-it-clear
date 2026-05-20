// Renders the most recent renarrated page produced by the Clear extension.
// The full standalone HTML document is built in the background service worker
// and stored in chrome.storage.local; this viewer writes it into the tab.
(async () => {
  const loading = document.getElementById('loading');
  try {
    const { lastRenarratedSite } = await chrome.storage.local.get(['lastRenarratedSite']);
    const html = lastRenarratedSite && lastRenarratedSite.html;

    if (!html) {
      if (loading) {
        loading.textContent = 'No renarrated page is available yet. Renarrate a page first.';
      }
      return;
    }

    // Replace the whole document with the renarrated page. document.open()
    // clears the current DOM; the running script keeps executing.
    document.open();
    document.write(html);
    document.close();

    // Drop any inline figure whose image fails to load (dead URL, expired
    // CDN token, host that blocks the request) so the page stays clean.
    const dropFigure = (img) => {
      const figure = img.closest('figure');
      (figure || img).remove();
    };
    for (const img of Array.from(document.images)) {
      if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) {
        dropFigure(img);
      } else {
        img.addEventListener('error', () => dropFigure(img), { once: true });
      }
    }
  } catch (e) {
    if (loading) {
      loading.textContent = 'Could not load the renarrated page: ' + (e?.message || 'unknown error');
    }
  }
})();
