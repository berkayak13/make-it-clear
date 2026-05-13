document.addEventListener('DOMContentLoaded', async () => {
  const contentEl = document.getElementById('extractedContent');
  if (!contentEl) return;

  try {
    const { lastExtraction } = await chrome.storage.local.get(['lastExtraction']);
    if (!lastExtraction) {
      contentEl.textContent = 'No extracted content found.';
      return;
    }

    const parts = [];
    if (lastExtraction.compactText) {
      parts.push('COMPREHENSIVE EXTRACTED KNOWLEDGE\n\n' + lastExtraction.compactText);
    }
    if (lastExtraction.rawText) {
      parts.push('CAPTURED VISIBLE PAGE TEXT\n\n' + lastExtraction.rawText);
    }
    contentEl.textContent = parts.join('\n\n---\n\n') || 'No extracted content found.';
  } catch (e) {
    contentEl.textContent = 'Could not load extracted content: ' + (e.message || 'unknown error');
  }
});
