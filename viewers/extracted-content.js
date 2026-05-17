document.addEventListener('DOMContentLoaded', async () => {
  const contentEl = document.getElementById('extractedContent');
  if (!contentEl) return;

  try {
    const { lastExtraction } = await chrome.storage.local.get(['lastExtraction']);
    if (!lastExtraction) {
      contentEl.textContent = 'No extracted content found.';
      return;
    }

    if (lastExtraction.compactText) {
      contentEl.textContent = lastExtraction.compactText;
      return;
    }
    contentEl.textContent = 'No extracted content found.';
  } catch (e) {
    contentEl.textContent = 'Could not load extracted content: ' + (e.message || 'unknown error');
  }
});
