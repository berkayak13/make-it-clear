async function loadRenarration() {
  const status = document.getElementById('status');
  const meta = document.getElementById('meta');
  const renarrationOutput = document.getElementById('renarrationOutput');
  const vlmOutput = document.getElementById('vlmOutput');
  status.textContent = 'Loading...';
  try {
    const { lastPageRenarration } = await chrome.storage.local.get(['lastPageRenarration']);
    if (lastPageRenarration && lastPageRenarration.renarration) {
      renarrationOutput.textContent = lastPageRenarration.renarration || '';
      vlmOutput.textContent = lastPageRenarration.vlmContent || '';
      meta.textContent = `${lastPageRenarration.at || 'recent'}`;
      status.textContent = 'Loaded';
    } else {
      renarrationOutput.textContent = '';
      vlmOutput.textContent = '';
      meta.textContent = 'No renarration available. Run "Describe + Renarrate" from the popup.';
      status.textContent = 'Empty';
    }
  } catch (err) {
    console.error('Failed to load renarration:', err);
    renarrationOutput.textContent = '';
    vlmOutput.textContent = '';
    meta.textContent = 'Failed to load data: ' + (err.message || 'Unknown error');
    status.textContent = 'Error';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('refreshBtn').addEventListener('click', loadRenarration);
  loadRenarration();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.lastPageRenarration) {
    loadRenarration();
  }
});
