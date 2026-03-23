// Content script - Injected into web pages
// Handles text selection and UI overlay

let isEnabled = false;
let currentTask = 'simple';
let renarrationOverlay = null;

// Initialize
init();

async function init() {
  // Get current settings
  const settings = await chrome.runtime.sendMessage({ action: 'get-settings' });
  isEnabled = settings.enabled;
  currentTask = settings.currentTask;
  
  if (isEnabled) {
    setupEventListeners();
    createOverlay();
  }
}

// Listen for settings changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (changes.enabled) {
    isEnabled = changes.enabled.newValue;
    if (isEnabled) {
      setupEventListeners();
      createOverlay();
    } else {
      removeEventListeners();
      removeOverlay();
    }
  }
  if (changes.currentTask) {
    currentTask = changes.currentTask.newValue;
  }
});

// Create floating overlay for renarration results
function createOverlay() {
  if (renarrationOverlay) return;
  
  renarrationOverlay = document.createElement('div');
  renarrationOverlay.id = 'renarration-overlay';
  renarrationOverlay.style.display = 'none';
  document.body.appendChild(renarrationOverlay);
}

function removeOverlay() {
  if (renarrationOverlay && renarrationOverlay.parentNode) {
    renarrationOverlay.parentNode.removeChild(renarrationOverlay);
    renarrationOverlay = null;
  }
}

let lastRunId = null;

function showOverlay(content, x, y, runId) {
  if (!renarrationOverlay) return;
  lastRunId = runId || null;

  const feedbackHtml = runId ? `
      <div class="renarration-feedback">
        <button class="feedback-btn feedback-up" data-type="thumbs-up" title="Good renarration">&#128077;</button>
        <button class="feedback-btn feedback-down" data-type="thumbs-down" title="Needs improvement">&#128078;</button>
        <button class="feedback-btn feedback-edit" data-type="correction" title="Suggest correction">&#9998;</button>
        <span class="feedback-status" id="feedbackStatus"></span>
      </div>
      <div class="renarration-correction" id="correctionArea" style="display:none;">
        <textarea id="correctionText" placeholder="Suggest a better renarration..." rows="3"></textarea>
        <button class="correction-submit" id="submitCorrection">Submit</button>
      </div>
  ` : '';

  renarrationOverlay.innerHTML = `
    <div class="renarration-content">
      <div class="renarration-header">
        <span class="renarration-title">Renarration</span>
        <button class="renarration-close" id="renarration-close-btn">&times;</button>
      </div>
      <div class="renarration-body">${escapeHtml(content)}</div>
      ${feedbackHtml}
    </div>
  `;

  renarrationOverlay.style.display = 'block';
  renarrationOverlay.style.left = `${x}px`;
  renarrationOverlay.style.top = `${y}px`;

  // Add close button listener
  const closeBtn = document.getElementById('renarration-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', hideOverlay);
  }

  // Add feedback listeners
  renarrationOverlay.querySelectorAll('.feedback-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const type = btn.dataset.type;
      if (type === 'correction') {
        const area = document.getElementById('correctionArea');
        if (area) area.style.display = area.style.display === 'none' ? 'block' : 'none';
      } else {
        sendFeedback(type);
      }
    });
  });

  const submitBtn = document.getElementById('submitCorrection');
  if (submitBtn) {
    submitBtn.addEventListener('click', () => {
      const text = document.getElementById('correctionText')?.value?.trim();
      if (text) sendFeedback('correction', text);
    });
  }
}

function sendFeedback(feedbackType, correctedText) {
  const statusEl = document.getElementById('feedbackStatus');
  chrome.runtime.sendMessage({
    action: 'submit-feedback',
    runId: lastRunId,
    feedbackType,
    correctedText: correctedText || null
  }, (res) => {
    if (statusEl) {
      statusEl.textContent = res?.success ? 'Feedback sent!' : 'Error';
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
    }
  });
}

function hideOverlay() {
  if (renarrationOverlay) {
    renarrationOverlay.style.display = 'none';
  }
}

// Event listeners
let selectionHandler = null;

function setupEventListeners() {
  // Handle text selection
  selectionHandler = handleTextSelection;
  document.addEventListener('mouseup', selectionHandler);
  
}

function removeEventListeners() {
  if (selectionHandler) {
    document.removeEventListener('mouseup', selectionHandler);
  }
}

async function handleTextSelection(e) {
  if (!isEnabled) return;
  
  const selection = window.getSelection();
  const text = selection.toString().trim();
  
  // Only process if text is selected and it's not within our overlay
  if (text && text.length > 10 && !e.target.closest('#renarration-overlay')) {
    // Show a small indicator button near selection
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    
    showRenarrationButton(rect.right + 5, rect.top, text);
  }
}

function showRenarrationButton(x, y, text) {
  // Remove existing button if any
  const existingBtn = document.getElementById('renarration-trigger-btn');
  if (existingBtn) {
    existingBtn.remove();
  }
  
  const button = document.createElement('button');
  button.id = 'renarration-trigger-btn';
  button.className = 'renarration-trigger';
  button.innerHTML = '🔄';
  button.title = 'Renarrate selected text';
  button.style.position = 'absolute';
  button.style.left = `${x + window.scrollX}px`;
  button.style.top = `${y + window.scrollY}px`;
  button.style.zIndex = '10000';
  
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    processTextRenarration(text, x, y);
    button.remove();
  });
  
  document.body.appendChild(button);
  
  // Auto-remove after 3 seconds
  setTimeout(() => {
    if (button.parentNode) {
      button.remove();
    }
  }, 3000);
}

// ---- Split-view page renarration ----

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'show-split-loading') {
    showSplitLoading();
    sendResponse({ success: true });
  } else if (request.action === 'show-split-renarration') {
    showSplitView(request);
    sendResponse({ success: true });
  } else if (request.action === 'hide-split-renarration') {
    hideSplitView();
    sendResponse({ success: true });
  }
});

function showSplitLoading() {
  // Remove any existing panel
  hideSplitView();

  // Shrink original page to left half
  document.body.classList.add('renarration-split-active');

  // Create right panel with loading spinner
  const panel = document.createElement('div');
  panel.id = 'renarration-split-panel';
  panel.innerHTML = `
    <div class="split-panel-header">
      <span class="split-panel-title">Renarrated</span>
      <button class="split-panel-close" title="Close split view">&times;</button>
    </div>
    <div class="split-panel-loading">
      <div class="split-panel-spinner"></div>
      <span>Processing page renarration...</span>
    </div>
  `;
  document.documentElement.appendChild(panel);

  panel.querySelector('.split-panel-close').addEventListener('click', hideSplitView);
}

function showSplitView(data) {
  // Remove any existing panel
  const existing = document.getElementById('renarration-split-panel');
  if (existing) existing.remove();

  // Ensure body is in split mode
  document.body.classList.add('renarration-split-active');

  const panel = document.createElement('div');
  panel.id = 'renarration-split-panel';

  const vlmSection = data.vlmContent ? `
    <details class="split-panel-vlm-details">
      <summary>VLM Extracted Content</summary>
      <div class="split-panel-vlm-content">${escapeHtml(data.vlmContent)}</div>
    </details>
  ` : '';

  panel.innerHTML = `
    <div class="split-panel-header">
      <span class="split-panel-title">Renarrated</span>
      <button class="split-panel-close" title="Close split view">&times;</button>
    </div>
    <div class="split-panel-body">${escapeHtml(data.renarration || '')}${vlmSection}</div>
  `;
  document.documentElement.appendChild(panel);

  panel.querySelector('.split-panel-close').addEventListener('click', hideSplitView);
}

function hideSplitView() {
  const panel = document.getElementById('renarration-split-panel');
  if (panel) panel.remove();
  document.body.classList.remove('renarration-split-active');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ---- Text selection renarration ----

async function processTextRenarration(text, x, y) {
  showOverlay('<div class="renarration-loading">Processing text...</div>', x, y + 30);

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'renarrate-text',
      text: text,
      task: currentTask
    });

    if (response.success) {
      const runId = response.agenticMeta?.experimentId || response.runId || null;
      showOverlay(response.result, x, y + 30, runId);
    } else {
      showOverlay('Error: ' + (response.error || 'Unknown error'), x, y + 30);
    }
  } catch (error) {
    showOverlay('Error: ' + (error.message || 'Unknown error'), x, y + 30);
  }
}
