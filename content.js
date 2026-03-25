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

// ---- DOM Clone sidebar for page renarration ----

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'IFRAME', 'OBJECT', 'EMBED']);
const BLOCK_PARENTS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'FIGCAPTION', 'DT', 'DD', 'CAPTION', 'LABEL', 'SUMMARY']);

function extractTextSegments() {
  const segments = [];
  let nextId = 0;
  const seen = new Set();

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent.trim();
      if (!text || text.length < 3) return NodeFilter.FILTER_REJECT;
      const el = node.parentElement;
      if (!el) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
      if (el.closest('#renarration-overlay, #renarration-split-panel, #renarration-trigger-btn')) return NodeFilter.FILTER_REJECT;
      // Skip hidden elements
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  while (walker.nextNode()) {
    const textNode = walker.currentNode;
    // Find the nearest block-level parent to group text
    let blockParent = textNode.parentElement;
    while (blockParent && !BLOCK_PARENTS.has(blockParent.tagName) && blockParent !== document.body) {
      blockParent = blockParent.parentElement;
    }
    if (!blockParent || blockParent === document.body) {
      blockParent = textNode.parentElement;
    }

    // Avoid duplicating segments for the same block parent
    if (seen.has(blockParent)) continue;
    seen.add(blockParent);

    const fullText = blockParent.textContent.trim();
    if (fullText.length < 3) continue;

    const id = nextId++;
    blockParent.setAttribute('data-renarration-id', String(id));
    segments.push({ id, text: fullText, tagName: blockParent.tagName });
  }

  return segments;
}

function buildCloneSidebar() {
  // Clone the entire document
  const clone = document.documentElement.cloneNode(true);

  // Remove scripts to prevent execution
  clone.querySelectorAll('script').forEach(s => s.remove());
  // Remove our own UI elements
  clone.querySelectorAll('#renarration-overlay, #renarration-split-panel, #renarration-trigger-btn, #renarration-clone-frame').forEach(el => el.remove());

  // Add base tag for resolving relative URLs
  let head = clone.querySelector('head');
  if (!head) {
    head = document.createElement('head');
    clone.prepend(head);
  }
  const base = document.createElement('base');
  base.href = document.baseURI;
  head.prepend(base);

  // Serialize the clone
  const html = '<!DOCTYPE html>' + clone.outerHTML;

  // Remove any existing panel
  hideCloneSidebar();

  // Shrink original page
  document.body.classList.add('renarration-split-active');

  // Create the sidebar panel
  const panel = document.createElement('div');
  panel.id = 'renarration-split-panel';
  panel.innerHTML = `
    <div class="split-drag-handle"></div>
    <div class="split-panel-header">
      <span class="split-panel-title">Renarrated</span>
      <button class="split-panel-close" title="Close split view">&times;</button>
    </div>
    <div class="clone-loading-overlay" id="clone-loading-overlay">
      <div class="split-panel-spinner"></div>
      <span class="clone-progress-text">Renarrating content...</span>
    </div>
  `;

  const iframe = document.createElement('iframe');
  iframe.id = 'renarration-clone-frame';
  iframe.sandbox = 'allow-same-origin';
  iframe.srcdoc = html;
  panel.appendChild(iframe);

  document.documentElement.appendChild(panel);
  panel.querySelector('.split-panel-close').addEventListener('click', hideCloneSidebar);

  // Drag handle for resizing
  const handle = panel.querySelector('.split-drag-handle');
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    handle.classList.add('dragging');
    // Transparent overlay to prevent iframe from stealing mouse events
    const overlay = document.createElement('div');
    overlay.className = 'split-drag-overlay';
    document.documentElement.appendChild(overlay);

    const onMove = (ev) => {
      const pct = Math.min(80, Math.max(20, (ev.clientX / window.innerWidth) * 100));
      document.body.style.width = pct + '%';
      panel.style.width = (100 - pct) + '%';
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      overlay.remove();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function updateCloneProgress(text) {
  const el = document.querySelector('.clone-progress-text');
  if (el) el.textContent = text;
}

function applyRenarrationToClone(replacements) {
  const iframe = document.getElementById('renarration-clone-frame');
  if (!iframe || !iframe.contentDocument) return;

  const doc = iframe.contentDocument;
  for (const rep of replacements) {
    const el = doc.querySelector(`[data-renarration-id="${rep.id}"]`);
    if (el && rep.text) {
      el.textContent = rep.text;
    }
  }

  // Remove loading overlay
  const overlay = document.getElementById('clone-loading-overlay');
  if (overlay) overlay.remove();
}

function hideCloneSidebar() {
  const panel = document.getElementById('renarration-split-panel');
  if (panel) panel.remove();
  document.body.classList.remove('renarration-split-active');
  document.body.style.width = '';
  // Clean up data attributes from original page
  document.querySelectorAll('[data-renarration-id]').forEach(el => el.removeAttribute('data-renarration-id'));
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extract-and-clone') {
    const segments = extractTextSegments();
    buildCloneSidebar();
    sendResponse({ success: true, segments });
  } else if (request.action === 'apply-dom-renarration') {
    // Wait for iframe to load before applying replacements
    const iframe = document.getElementById('renarration-clone-frame');
    if (iframe) {
      const apply = () => applyRenarrationToClone(request.replacements || []);
      if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
        apply();
      } else {
        iframe.addEventListener('load', apply, { once: true });
      }
    }
    sendResponse({ success: true });
  } else if (request.action === 'hide-dom-renarration') {
    hideCloneSidebar();
    sendResponse({ success: true });
  } else if (request.action === 'update-clone-progress') {
    updateCloneProgress(request.text || '');
    sendResponse({ success: true });
  }
  // Keep old actions working for backward compat
  else if (request.action === 'show-split-loading') {
    sendResponse({ success: true });
  } else if (request.action === 'show-split-renarration') {
    sendResponse({ success: true });
  } else if (request.action === 'hide-split-renarration') {
    hideCloneSidebar();
    sendResponse({ success: true });
  }
});

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
