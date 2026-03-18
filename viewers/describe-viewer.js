async function loadResult() {
  const status = document.getElementById('status');
  const meta = document.getElementById('meta');
  const output = document.getElementById('vlmOutput');
  const preview = document.getElementById('previewImg');
  status.textContent = 'Loading…';
  const { lastDescribeResult, lastDescribeImage } = await chrome.storage.local.get(['lastDescribeResult', 'lastDescribeImage']);
  if (lastDescribeResult && lastDescribeResult.content) {
    output.value = lastDescribeResult.content;
    meta.textContent = `Model: ${lastDescribeResult.model || 'remote'} • ${lastDescribeResult.at || 'recent'}`;
    status.textContent = 'Loaded';
    if (preview && lastDescribeImage) {
      preview.src = lastDescribeImage;
      preview.style.display = 'block';
    } else if (preview) {
      preview.style.display = 'none';
    }
  } else {
    output.value = '';
    meta.textContent = 'No recent VLM description found. Run "Describe Page (VLM)" from the popup.';
    status.textContent = 'Empty';
    if (preview) preview.style.display = 'none';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('refreshBtn').addEventListener('click', loadResult);
  loadResult();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.lastDescribeResult) {
    loadResult();
  }
});
