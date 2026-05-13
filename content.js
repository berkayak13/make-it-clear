let isEnabled = false;
let currentTask = 'simple';
let renarrationOverlay = null;
let lastRunId = null;
let selectionHandler = null;

init();

async function init() {
  try {
    const settings = await chrome.runtime.sendMessage({ action: 'get-settings' });
    if (settings) {
      isEnabled = settings.enabled;
      currentTask = settings.currentTask;
    }
  } catch {
    isEnabled = false;
  }

  if (isEnabled) {
    setupEventListeners();
    createOverlay();
  }
}

chrome.storage.onChanged.addListener((changes) => {
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
  if (changes.currentTask) currentTask = changes.currentTask.newValue;
});

function createOverlay() {
  if (renarrationOverlay) return;
  renarrationOverlay = document.createElement('div');
  renarrationOverlay.id = 'renarration-overlay';
  renarrationOverlay.style.display = 'none';
  document.body.appendChild(renarrationOverlay);
}

function removeOverlay() {
  renarrationOverlay?.remove();
  renarrationOverlay = null;
}

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

  document.getElementById('renarration-close-btn')?.addEventListener('click', hideOverlay);
  renarrationOverlay.querySelectorAll('.feedback-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.dataset.type === 'correction') {
        const area = document.getElementById('correctionArea');
        if (area) area.style.display = area.style.display === 'none' ? 'block' : 'none';
      } else {
        sendFeedback(btn.dataset.type);
      }
    });
  });
  document.getElementById('submitCorrection')?.addEventListener('click', () => {
    const text = document.getElementById('correctionText')?.value?.trim();
    if (text) sendFeedback('correction', text);
  });
}

function sendFeedback(feedbackType, correctedText) {
  const statusEl = document.getElementById('feedbackStatus');
  const flashStatus = (msg) => {
    if (!statusEl) return;
    statusEl.textContent = msg;
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
  };

  chrome.runtime.sendMessage({
    action: 'submit-feedback',
    runId: lastRunId,
    feedbackType,
    correctedText: correctedText || null,
  }, (res) => {
    if (chrome.runtime.lastError) {
      flashStatus('Failed to send feedback');
      return;
    }
    flashStatus(res?.success ? 'Feedback sent!' : 'Failed to send feedback');
  });
}

function hideOverlay() {
  if (renarrationOverlay) renarrationOverlay.style.display = 'none';
}

function setupEventListeners() {
  if (selectionHandler) document.removeEventListener('mouseup', selectionHandler);
  selectionHandler = handleTextSelection;
  document.addEventListener('mouseup', selectionHandler);
}

function removeEventListeners() {
  if (selectionHandler) document.removeEventListener('mouseup', selectionHandler);
  selectionHandler = null;
}

async function handleTextSelection(e) {
  if (!isEnabled) return;
  const selection = window.getSelection();
  const text = selection.toString().trim();
  if (text && text.length > 10 && !e.target.closest('#renarration-overlay')) {
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    showRenarrationButton(rect.right + 5, rect.top, text);
  }
}

function showRenarrationButton(x, y, text) {
  document.getElementById('renarration-trigger-btn')?.remove();

  const button = document.createElement('button');
  button.id = 'renarration-trigger-btn';
  button.className = 'renarration-trigger';
  button.textContent = 'R';
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
  setTimeout(() => button.remove(), 3000);
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'IFRAME', 'OBJECT', 'EMBED']);

function extractVisiblePageText() {
  const chunks = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent.trim();
      if (!text || text.length < 3) return NodeFilter.FILTER_REJECT;
      const el = node.parentElement;
      if (!el || SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
      if (el.closest('#renarration-overlay, #renarration-split-panel, #renarration-trigger-btn')) return NodeFilter.FILTER_REJECT;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return NodeFilter.FILTER_REJECT;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  while (walker.nextNode()) {
    const text = walker.currentNode.textContent.replace(/\s+/g, ' ').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    chunks.push(text);
  }

  return {
    success: true,
    text: chunks.join('\n'),
    title: document.title || '',
    url: location.href,
  };
}

function showRenarrationPanel() {
  let panel = document.getElementById('renarration-split-panel');
  if (!panel) {
    document.body.classList.add('renarration-split-active');
    panel = document.createElement('div');
    panel.id = 'renarration-split-panel';
    panel.innerHTML = `
      <div class="split-drag-handle"></div>
      <div class="split-panel-header">
        <span class="split-panel-title">Renarrated Page</span>
        <button class="split-panel-close" title="Close split view">&times;</button>
      </div>
      <div class="split-panel-body" id="renarration-panel-body">
        <div class="split-panel-loading">
          <div class="split-panel-spinner"></div>
          <span class="renarration-progress-text">Preparing...</span>
        </div>
      </div>
    `;
    document.documentElement.appendChild(panel);
    panel.querySelector('.split-panel-close')?.addEventListener('click', hideRenarrationPanel);
    setupPanelResize(panel);
  }
  updateRenarrationProgress('Preparing...');
}

function setupPanelResize(panel) {
  const handle = panel.querySelector('.split-drag-handle');
  handle?.addEventListener('mousedown', (e) => {
    e.preventDefault();
    handle.classList.add('dragging');
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

function updateRenarrationProgress(text, isError = false) {
  const body = document.getElementById('renarration-panel-body');
  if (!body) return;
  body.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'split-panel-loading';
  if (!isError) {
    const spinner = document.createElement('div');
    spinner.className = 'split-panel-spinner';
    wrap.appendChild(spinner);
  }
  const status = document.createElement('span');
  status.className = isError ? 'renarration-progress-text is-error' : 'renarration-progress-text';
  status.textContent = text || '';
  wrap.appendChild(status);
  body.appendChild(wrap);
}

function renderRenarrationText(text) {
  const body = document.getElementById('renarration-panel-body');
  if (!body) return;
  body.innerHTML = '';
  const pre = document.createElement('div');
  pre.className = 'renarration-final-text';
  pre.textContent = text || '';
  body.appendChild(pre);
}

function hideRenarrationPanel() {
  document.getElementById('renarration-split-panel')?.remove();
  document.body.classList.remove('renarration-split-active');
  document.body.style.width = '';
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'extract-visible-page-text') {
    sendResponse(extractVisiblePageText());
    return false;
  }
  if (request.action === 'show-renarration-panel') {
    showRenarrationPanel();
    sendResponse({ success: true });
    return false;
  }
  if (request.action === 'update-renarration-progress') {
    updateRenarrationProgress(request.text || '', !!request.isError);
    sendResponse({ success: true });
    return false;
  }
  if (request.action === 'render-renarration-text') {
    renderRenarrationText(request.text || '');
    sendResponse({ success: true });
    return false;
  }
  if (request.action === 'hide-renarration-panel') {
    hideRenarrationPanel();
    sendResponse({ success: true });
    return false;
  }
  return false;
});

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function processTextRenarration(text, x, y) {
  showOverlay('Processing text...', x, y + 30);

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'renarrate-text',
      text,
      task: currentTask,
    });

    if (response.success) {
      showOverlay(response.result, x, y + 30, response.runId || null);
    } else {
      showOverlay('Error: ' + (response.error || 'Unknown error'), x, y + 30);
    }
  } catch (error) {
    showOverlay('Error: ' + (error.message || 'Unknown error'), x, y + 30);
  }
}
