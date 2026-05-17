let isEnabled = false;
let currentTask = 'simple';
let lastRunId = null;
let selectionHandler = null;
let selectionPopup = null;
let extensionContextDead = false;

function isExtensionContextError(error) {
  return /Extension context invalidated/i.test(error?.message || String(error || ''));
}

function hasExtensionContext() {
  if (extensionContextDead) return false;
  try {
    return !!chrome?.runtime?.id;
  } catch (e) {
    if (isExtensionContextError(e)) extensionContextDead = true;
    return false;
  }
}

function markExtensionContextDead(error) {
  if (!isExtensionContextError(error)) return false;
  extensionContextDead = true;
  removeEventListeners();
  hideSelectionPopup();
  return true;
}

function safeSendMessage(message, callback) {
  if (!hasExtensionContext()) {
    if (callback) callback(null);
    return Promise.resolve(null);
  }
  try {
    if (callback) {
      chrome.runtime.sendMessage(message, (res) => {
        const error = chrome.runtime.lastError;
        if (error) {
          markExtensionContextDead(error);
          callback(null, error);
          return;
        }
        callback(res, null);
      });
      return Promise.resolve(null);
    }
    return chrome.runtime.sendMessage(message).catch((e) => {
      markExtensionContextDead(e);
      return null;
    });
  } catch (e) {
    markExtensionContextDead(e);
    if (callback) callback(null, e);
    return Promise.resolve(null);
  }
}

function safeRuntimeUrl(path) {
  if (!hasExtensionContext()) return '';
  try {
    return chrome.runtime.getURL(path);
  } catch (e) {
    markExtensionContextDead(e);
    return '';
  }
}

init();

async function init() {
  try {
    const settings = await safeSendMessage({ action: 'get-settings' });
    if (settings) {
      isEnabled = settings.enabled;
      currentTask = settings.currentTask;
    }
  } catch {
    isEnabled = false;
  }

  if (isEnabled) {
    setupEventListeners();
  }
  if (hasExtensionContext()) {
    try {
      chrome.storage.onChanged.addListener((changes) => {
        if (changes.enabled) {
          isEnabled = changes.enabled.newValue;
          if (isEnabled) {
            setupEventListeners();
          } else {
            removeEventListeners();
            hideSelectionPopup();
          }
        }
        if (changes.currentTask) currentTask = changes.currentTask.newValue;
      });
    } catch (e) {
      markExtensionContextDead(e);
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   SVG ICONS — inline, 14×14 default, stroke-based
═══════════════════════════════════════════════════════════ */

const ClearIcons = {
  check: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="m2.5 6.5 2.5 2.5 4.5-5.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="m3 3 6 6m0-6-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  plus: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  sparkle: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5v3M7 9.5v3M1.5 7h3M9.5 7h3M3.5 3.5l2 2M8.5 8.5l2 2M3.5 10.5l2-2M8.5 5.5l2-2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
};

/* ═══════════════════════════════════════════════════════════
   SELECTION POPUP — glass card above text selection
═══════════════════════════════════════════════════════════ */

function showSelectionPopup(text, range) {
  hideSelectionPopup();
  const rect = range.getBoundingClientRect();
  const wordCount = text.split(/\s+/).length;

  const popup = document.createElement('div');
  popup.id = 'clear-selection-popup';

  const spaceAbove = rect.top;
  const spaceBelow = window.innerHeight - rect.bottom;
  const showAbove = spaceAbove > 180 || spaceAbove > spaceBelow;
  const pointerClass = showAbove ? 'clear-selection-pointer--below' : 'clear-selection-pointer--above';

  let left = rect.left + (rect.width / 2) - 60;
  left = Math.max(8, Math.min(left, window.innerWidth - 328));

  if (showAbove) {
    popup.style.bottom = (window.innerHeight - rect.top + 10) + 'px';
    popup.style.top = 'auto';
  } else {
    popup.style.top = (rect.bottom + 10) + 'px';
    popup.style.bottom = 'auto';
  }
  popup.style.left = left + 'px';

  const taskLabel = currentTask === 'simple' ? 'default' : currentTask;

  popup.innerHTML = `
    <div class="clear-selection-pointer ${pointerClass}"></div>
    <div class="clear-selection-card">
      <div class="clear-selection-eyebrow">
        <span class="clear-selection-eyebrow-text">RENARRATE SELECTION · ${wordCount} words</span>
        <span class="clear-selection-lens">${escapeHtml(taskLabel)} lens</span>
      </div>
      <div class="clear-selection-body" id="clear-selection-body">
        <div style="font-family: var(--font-sans); font-style: italic; font-size: 12px; color: var(--muted);">Processing…</div>
      </div>
      <div class="clear-selection-actions" id="clear-selection-actions" style="display: none;">
        <button class="clear-btn clear-btn--xs clear-btn--ghost" data-action="good">${ClearIcons.check} Good</button>
        <button class="clear-btn clear-btn--xs clear-btn--ghost" data-action="off" style="color: var(--muted-2);">Off</button>
        <span class="spacer"></span>
        <button class="clear-btn clear-btn--xs" data-action="retry" style="color: var(--muted);">Try again</button>
        <button class="clear-btn clear-btn--xs clear-btn--primary" data-action="pin">${ClearIcons.plus} Pin</button>
      </div>
      <span class="feedback-status" id="clear-feedback-status"></span>
    </div>
  `;

  document.documentElement.appendChild(popup);
  selectionPopup = popup;

  processSelectionRenarration(text, popup);

  popup.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'good') sendFeedback('thumbs-up');
      else if (action === 'off') sendFeedback('thumbs-down');
      else if (action === 'retry') {
        const body = popup.querySelector('#clear-selection-body');
        if (body) body.innerHTML = '<div style="font-family: var(--font-sans); font-style: italic; font-size: 12px; color: var(--muted);">Retrying…</div>';
        popup.querySelector('#clear-selection-actions').style.display = 'none';
        processSelectionRenarration(text, popup);
      }
      else if (action === 'pin') console.log('[Clear] Pin action — not yet wired');
    });
  });

  document.addEventListener('click', onClickOutsidePopup, true);
  document.addEventListener('selectionchange', onNewSelection);
}

function onClickOutsidePopup(e) {
  if (selectionPopup && !selectionPopup.contains(e.target)) {
    hideSelectionPopup();
  }
}

function onNewSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) {
    hideSelectionPopup();
  }
}

function hideSelectionPopup() {
  if (selectionPopup) {
    selectionPopup.remove();
    selectionPopup = null;
  }
  document.removeEventListener('click', onClickOutsidePopup, true);
  document.removeEventListener('selectionchange', onNewSelection);
}

async function processSelectionRenarration(text, popup) {
  try {
    const response = await safeSendMessage({
      action: 'renarrate-text',
      text,
      task: currentTask,
    });

    const body = popup.querySelector('#clear-selection-body');
    const actions = popup.querySelector('#clear-selection-actions');
    if (!body) return;

    if (response?.success) {
      lastRunId = response.runId || null;
      body.textContent = response.result;
      if (actions) actions.style.display = 'flex';
    } else {
      body.innerHTML = `<div style="color: var(--neg); font-family: var(--font-sans); font-size: 12px;">${escapeHtml(response.error || 'Unknown error')}</div>`;
    }
  } catch (error) {
    const body = popup.querySelector('#clear-selection-body');
    if (body) {
      body.innerHTML = `<div style="color: var(--neg); font-family: var(--font-sans); font-size: 12px;">${escapeHtml(error.message || 'Unknown error')}</div>`;
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   FEEDBACK
═══════════════════════════════════════════════════════════ */

function sendFeedback(feedbackType, correctedText) {
  const statusEl = document.getElementById('clear-feedback-status');
  const flashStatus = (msg) => {
    if (!statusEl) return;
    statusEl.textContent = msg;
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
  };

  safeSendMessage({
    action: 'submit-feedback',
    runId: lastRunId,
    feedbackType,
    correctedText: correctedText || null,
  }, (res, error) => {
    if (error) {
      flashStatus('Failed');
      return;
    }
    flashStatus(res?.success ? 'Sent!' : 'Failed');
  });
}

/* ═══════════════════════════════════════════════════════════
   EVENT LISTENERS
═══════════════════════════════════════════════════════════ */

function setupEventListeners() {
  injectClearFonts();
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
  if (e.target.closest('#clear-selection-popup')) return;
  if (e.target.closest('#renarration-split-panel')) return;

  const selection = window.getSelection();
  const text = selection.toString().trim();
  if (text && text.length > 10) {
    const range = selection.getRangeAt(0);
    showSelectionPopup(text, range);
  }
}

/* ═══════════════════════════════════════════════════════════
   SPLIT RENARRATION PANEL
═══════════════════════════════════════════════════════════ */

function showRenarrationPanel() {
  let panel = document.getElementById('renarration-split-panel');
  if (!panel) {
    document.body.classList.add('renarration-split-active');
    panel = document.createElement('div');
    panel.id = 'renarration-split-panel';
    panel.innerHTML = `
      <div class="split-drag-handle"></div>
      <div class="split-panel-header">
        <div class="split-header-info">
          <div class="split-header-top">
            <span class="split-header-wordmark">Clear</span>
            <span class="split-header-meta">RENARRATED</span>
          </div>
          <div class="split-header-lens"></div>
        </div>
        <span class="split-header-spacer"></span>
        <button class="split-panel-close" data-action="original">Original</button>
        <button class="split-panel-close" data-action="translate">Translate</button>
        <button class="split-panel-close" data-action="close">${ClearIcons.close}</button>
      </div>
      <div class="split-panel-toc" id="split-panel-toc">
        <span class="clear-chip clear-chip--accent">① Summary</span>
        <span class="clear-chip">② Key points</span>
        <span class="clear-chip">③ Analysis</span>
        <span class="clear-chip">④ Implications</span>
      </div>
      <div class="split-panel-body" id="renarration-panel-body">
        <div class="split-panel-loading">
          <div class="split-panel-spinner"></div>
          <span class="renarration-progress-text">Preparing…</span>
        </div>
      </div>
      <div class="split-panel-footer">
        <span class="clear-eyebrow" id="split-footer-meta"></span>
        <span class="spacer"></span>
        <button class="clear-btn clear-btn--xs clear-btn--ghost" onclick="console.log('[Clear] Save thread')">Save thread</button>
        <button class="clear-btn clear-btn--xs clear-btn--ghost" onclick="console.log('[Clear] Ask follow-up')">Ask follow-up</button>
      </div>
    `;
    document.documentElement.appendChild(panel);

    panel.querySelector('[data-action="close"]')?.addEventListener('click', hideRenarrationPanel);
    panel.querySelector('[data-action="original"]')?.addEventListener('click', () => console.log('[Clear] Original view — not yet wired'));
    panel.querySelector('[data-action="translate"]')?.addEventListener('click', () => console.log('[Clear] Translate — not yet wired'));
    setupPanelResize(panel);
  }
  updateRenarrationProgress('Preparing…');
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
  const content = document.createElement('div');
  content.className = 'renarration-final-text';
  content.textContent = text || '';
  body.appendChild(content);

  const meta = document.getElementById('split-footer-meta');
  if (meta) {
    const wordCount = (text || '').split(/\s+/).filter(Boolean).length;
    const readMin = Math.max(1, Math.round(wordCount / 250));
    meta.textContent = `${readMin} MIN READ`;
  }
}

function hideRenarrationPanel() {
  document.getElementById('renarration-split-panel')?.remove();
  document.body.classList.remove('renarration-split-active');
  document.body.style.width = '';
}

/* ═══════════════════════════════════════════════════════════
   PAGE EXTRACTION (unchanged)
═══════════════════════════════════════════════════════════ */

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'IFRAME', 'OBJECT', 'EMBED']);
const EXTENSION_UI_SELECTOR = '#clear-selection-popup, #renarration-split-panel';
const IMAGE_MAX_RESULTS = 40;
const IMAGE_MIN_RENDERED_WIDTH = 120;
const IMAGE_MIN_RENDERED_HEIGHT = 80;
const IMAGE_MIN_RENDERED_AREA = 12000;
const IMAGE_CONTEXT_CHARS = 300;
const DECORATIVE_IMAGE_RE = /(^|[\s/_-])(adchoices|avatar|badge|blank|button|favicon|icon|logo|pixel|placeholder|share|social|spacer|spinner|sprite|tracking|transparent)([\s/_\-.]|$)/i;
const CONTENT_CLASS_RE = /(^|[\s_-])(article|content|entry|main|post|story)([\s_-]|$)/i;
const NON_CONTENT_CLASS_RE = /(^|[\s_-])(ad|ads|advert|banner|cookie|footer|header|nav|navbar|promo|share|sidebar|social|sponsor)([\s_-]|$)/i;

function extractVisiblePageText() {
  const chunks = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent.trim();
      if (!text || text.length < 3) return NodeFilter.FILTER_REJECT;
      const el = node.parentElement;
      if (!el || SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
      if (el.closest(EXTENSION_UI_SELECTOR)) return NodeFilter.FILTER_REJECT;
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

  let images = [];
  try {
    images = extractPageImages();
  } catch {
    images = [];
  }

  return {
    success: true,
    text: chunks.join('\n'),
    images,
    title: document.title || '',
    url: location.href,
  };
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function truncateText(text, maxChars = IMAGE_CONTEXT_CHARS) {
  const value = normalizeText(text);
  return value.length > maxChars ? value.slice(0, maxChars - 3).trimEnd() + '...' : value;
}

function normalizeImageUrl(rawUrl) {
  const raw = String(rawUrl || '').trim();
  if (!raw || raw.startsWith('#')) return '';
  if (/^(data|blob|chrome|chrome-extension|moz-extension|about):/i.test(raw)) return '';
  try {
    const url = new URL(raw, document.baseURI);
    if (!/^https?:$/i.test(url.protocol)) return '';
    return url.href;
  } catch {
    return '';
  }
}

function parseSrcset(srcset) {
  return String(srcset || '').split(',')
    .map((part) => {
      const value = part.trim();
      if (!value) return null;
      const pieces = value.split(/\s+/);
      const rawUrl = pieces[0];
      const descriptor = pieces[1] || '';
      const width = descriptor.endsWith('w') ? Number.parseFloat(descriptor) : 0;
      const density = descriptor.endsWith('x') ? Number.parseFloat(descriptor) : 0;
      return {
        url: rawUrl,
        score: width || density * 10000 || 1,
      };
    })
    .filter(Boolean);
}

function bestSrcsetUrl(srcset) {
  return parseSrcset(srcset)
    .sort((a, b) => b.score - a.score)[0]?.url || '';
}

function bestPictureSourceUrl(img) {
  const picture = img.closest('picture');
  if (!picture) return '';

  const candidates = [];
  for (const source of picture.querySelectorAll('source')) {
    const media = source.getAttribute('media');
    if (media && window.matchMedia && !window.matchMedia(media).matches) continue;
    const parsed = parseSrcset(source.getAttribute('srcset'));
    const best = parsed.sort((a, b) => b.score - a.score)[0];
    const url = best?.url || source.getAttribute('src') || '';
    if (!url) continue;
    candidates.push({ url, score: best?.score || 1 });
  }

  return candidates.sort((a, b) => b.score - a.score)[0]?.url || '';
}

function cssBackgroundUrls(backgroundImage) {
  const urls = [];
  const re = /url\((["']?)(.*?)\1\)/g;
  let match;
  while ((match = re.exec(String(backgroundImage || '')))) {
    if (match[2]) urls.push(match[2]);
  }
  return urls;
}

function elementSignature(el) {
  return normalizeText([
    el?.id || '',
    typeof el?.className === 'string' ? el.className : '',
    el?.getAttribute?.('role') || '',
    el?.getAttribute?.('aria-label') || '',
  ].join(' '));
}

function ancestorMatches(el, re, maxDepth = 5) {
  let node = el;
  for (let depth = 0; node && depth < maxDepth; depth++) {
    if (re.test(elementSignature(node))) return true;
    node = node.parentElement;
  }
  return false;
}

function isContentImageElement(el) {
  return !!(
    el?.closest?.('article, main, figure, [role="main"]') ||
    ancestorMatches(el, CONTENT_CLASS_RE)
  );
}

function isNonContentImageElement(el) {
  return !!(
    el?.closest?.('nav, header, footer, aside, form, [role="navigation"], [role="banner"], [role="contentinfo"]') ||
    ancestorMatches(el, NON_CONTENT_CLASS_RE)
  );
}

function isVisibleElement(el) {
  if (!el || el.closest(EXTENSION_UI_SELECTOR)) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function imageDimensions(el) {
  const rect = el?.getBoundingClientRect?.() || { width: 0, height: 0 };
  const attrWidth = Number.parseInt(el?.getAttribute?.('width') || '', 10) || 0;
  const attrHeight = Number.parseInt(el?.getAttribute?.('height') || '', 10) || 0;
  return {
    width: Math.round(el?.naturalWidth || attrWidth || rect.width || 0),
    height: Math.round(el?.naturalHeight || attrHeight || rect.height || 0),
    renderedWidth: Math.round(rect.width || attrWidth || 0),
    renderedHeight: Math.round(rect.height || attrHeight || 0),
  };
}

function nearestHeading(el) {
  const headingSelector = 'h1,h2,h3,h4,h5,h6';
  const container = el.closest('section, article, main, [role="main"]');
  if (container) {
    const headings = Array.from(container.querySelectorAll(headingSelector))
      .filter((heading) => heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    const heading = headings[headings.length - 1];
    if (heading) return truncateText(heading.textContent, 160);
  }

  let node = el;
  for (let depth = 0; node && depth < 4; depth++) {
    let prev = node.previousElementSibling;
    for (let step = 0; prev && step < 8; step++) {
      if (prev.matches?.(headingSelector)) return truncateText(prev.textContent, 160);
      const nested = Array.from(prev.querySelectorAll?.(headingSelector) || []).pop();
      if (nested) return truncateText(nested.textContent, 160);
      prev = prev.previousElementSibling;
    }
    node = node.parentElement;
  }
  return '';
}

function imageCaption(el) {
  const figure = el.closest('figure');
  const caption = figure?.querySelector('figcaption');
  if (caption) return truncateText(caption.textContent, IMAGE_CONTEXT_CHARS);
  return truncateText(el.getAttribute?.('title') || el.getAttribute?.('aria-label') || '', 180);
}

function nearbyImageText(el, captionText) {
  const container = el.closest('figure') || el.parentElement;
  if (!container) return '';
  const text = truncateText(container.innerText || container.textContent || '', IMAGE_CONTEXT_CHARS);
  return text === captionText ? '' : text;
}

function imageLooksUsable(meta, el) {
  const path = (() => {
    try { return new URL(meta.url).pathname.toLowerCase(); } catch { return ''; }
  })();
  if (/\.(svg|ico)$/i.test(path)) return false;
  if (meta.source !== 'og:image' && (!el || !isVisibleElement(el))) return false;

  const renderedArea = meta.renderedWidth * meta.renderedHeight;
  const intrinsicArea = meta.width * meta.height;
  const largeRendered = (
    meta.renderedWidth >= IMAGE_MIN_RENDERED_WIDTH &&
    meta.renderedHeight >= IMAGE_MIN_RENDERED_HEIGHT &&
    renderedArea >= IMAGE_MIN_RENDERED_AREA
  );
  const largeIntrinsicWithoutRenderedSize = (
    !meta.renderedWidth &&
    !meta.renderedHeight &&
    meta.width >= IMAGE_MIN_RENDERED_WIDTH &&
    meta.height >= IMAGE_MIN_RENDERED_HEIGHT &&
    intrinsicArea >= IMAGE_MIN_RENDERED_AREA
  );
  const inContent = el ? isContentImageElement(el) : false;
  const inNonContent = el ? isNonContentImageElement(el) : false;
  const descriptor = normalizeText(`${meta.url} ${meta.alt} ${meta.caption} ${elementSignature(el)}`);

  if (meta.source === 'css-background' && (!largeRendered || (!inContent && inNonContent))) return false;
  if (meta.source !== 'og:image' && !largeRendered && !largeIntrinsicWithoutRenderedSize && !inContent) return false;
  if (renderedArea > 0 && (meta.renderedWidth <= 2 || meta.renderedHeight <= 2)) return false;
  if (DECORATIVE_IMAGE_RE.test(descriptor) && (!inContent || renderedArea < 90000)) return false;
  if (inNonContent && !inContent && renderedArea < 160000) return false;

  return true;
}

function scoreImage(meta, el) {
  const area = Math.max(meta.renderedWidth * meta.renderedHeight, meta.width * meta.height, 0);
  let score = Math.min(90, Math.round(area / 12000));
  if (el?.closest?.('figure')) score += 50;
  if (el?.closest?.('article')) score += 45;
  if (el?.closest?.('main, [role="main"]')) score += 35;
  if (ancestorMatches(el, CONTENT_CLASS_RE)) score += 25;
  if (isNonContentImageElement(el)) score -= 45;
  if (meta.caption) score += 25;
  if (meta.alt) score += 10;
  if (meta.heading) score += 10;
  if (meta.source === 'og:image') score += 30;
  if (meta.source === 'css-background') score += 10;
  return score;
}

function makeImageMeta(rawUrl, el, source, index) {
  const url = normalizeImageUrl(rawUrl);
  if (!url) return null;
  const dims = el ? imageDimensions(el) : { width: 0, height: 0, renderedWidth: 0, renderedHeight: 0 };
  const caption = el ? imageCaption(el) : '';
  const meta = {
    url,
    source,
    alt: truncateText(el?.getAttribute?.('alt') || '', 180),
    caption,
    heading: el ? nearestHeading(el) : '',
    nearbyText: el ? nearbyImageText(el, caption) : '',
    width: dims.width,
    height: dims.height,
    renderedWidth: dims.renderedWidth,
    renderedHeight: dims.renderedHeight,
    index,
  };
  if (!imageLooksUsable(meta, el)) return null;
  meta.score = scoreImage(meta, el);
  return meta;
}

function backgroundImageElements() {
  const prioritized = Array.from(document.querySelectorAll('article *, main *, figure *, [role="main"] *'));
  const fallback = Array.from(document.body?.querySelectorAll('*') || []).slice(0, 800);
  return Array.from(new Set([...prioritized, ...fallback])).slice(0, 1600);
}

function extractPageImages() {
  const candidates = [];
  let index = 0;

  document.querySelectorAll('meta[property="og:image"], meta[property="og:image:url"], meta[name="twitter:image"], meta[name="twitter:image:src"]').forEach((meta) => {
    const item = makeImageMeta(meta.getAttribute('content'), null, 'og:image', index++);
    if (item) candidates.push(item);
  });

  for (const img of document.images || []) {
    if (img.closest(EXTENSION_UI_SELECTOR)) continue;
    const imageIndex = index++;
    const sources = [
      ['img-current-src', img.currentSrc],
      ['img-src', img.getAttribute('src') || img.src],
      ['img-srcset', bestSrcsetUrl(img.getAttribute('srcset'))],
      ['picture-source', bestPictureSourceUrl(img)],
    ];
    for (const [source, rawUrl] of sources) {
      const item = makeImageMeta(rawUrl, img, source, imageIndex);
      if (item) candidates.push(item);
    }
  }

  for (const el of backgroundImageElements()) {
    if (!el || el.closest(EXTENSION_UI_SELECTOR)) continue;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
    const urls = cssBackgroundUrls(style.backgroundImage);
    if (!urls.length) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 220 || rect.height < 120) continue;
    const imageIndex = index++;
    for (const rawUrl of urls) {
      const item = makeImageMeta(rawUrl, el, 'css-background', imageIndex);
      if (item) candidates.push(item);
    }
  }

  const byUrl = new Map();
  for (const item of candidates) {
    const existing = byUrl.get(item.url);
    if (!existing || item.score > existing.score) byUrl.set(item.url, item);
  }

  return Array.from(byUrl.values())
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, IMAGE_MAX_RESULTS)
    .sort((a, b) => a.index - b.index);
}

/* ═══════════════════════════════════════════════════════════
   MESSAGE HANDLER (unchanged protocol)
═══════════════════════════════════════════════════════════ */

if (hasExtensionContext()) {
  try {
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (request.action === 'renarration-content-ready') {
        sendResponse({ success: true });
        return false;
      }
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
  } catch (e) {
    markExtensionContextDead(e);
  }
}

/* ═══════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════ */

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function injectClearFonts() {
  if (document.getElementById('clear-fonts')) return;
  const fontBase = safeRuntimeUrl('assets/fonts/');
  if (!fontBase) return;
  const style = document.createElement('style');
  style.id = 'clear-fonts';
  style.textContent = `
    @font-face {
      font-family: 'Geist';
      font-style: normal;
      font-weight: 100 900;
      font-display: swap;
      src: url(${fontBase}geist-latin.woff2) format('woff2');
      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
    }
    @font-face {
      font-family: 'Geist';
      font-style: normal;
      font-weight: 100 900;
      font-display: swap;
      src: url(${fontBase}geist-latin-ext.woff2) format('woff2');
      unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
    }
    @font-face {
      font-family: 'Geist Mono';
      font-style: normal;
      font-weight: 100 900;
      font-display: swap;
      src: url(${fontBase}geist-mono-latin.woff2) format('woff2');
      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
    }
    @font-face {
      font-family: 'Geist Mono';
      font-style: normal;
      font-weight: 100 900;
      font-display: swap;
      src: url(${fontBase}geist-mono-latin-ext.woff2) format('woff2');
      unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
    }
    @font-face {
      font-family: 'Newsreader';
      font-style: normal;
      font-weight: 400;
      font-display: swap;
      src: url(${fontBase}newsreader-latin.woff2) format('woff2');
      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
    }
    @font-face {
      font-family: 'Newsreader';
      font-style: normal;
      font-weight: 400;
      font-display: swap;
      src: url(${fontBase}newsreader-latin-ext.woff2) format('woff2');
      unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
    }
    @font-face {
      font-family: 'Newsreader';
      font-style: italic;
      font-weight: 400;
      font-display: swap;
      src: url(${fontBase}newsreader-italic-latin.woff2) format('woff2');
      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
    }
    @font-face {
      font-family: 'Newsreader';
      font-style: italic;
      font-weight: 400;
      font-display: swap;
      src: url(${fontBase}newsreader-italic-latin-ext.woff2) format('woff2');
      unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}
