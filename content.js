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
const EXTENSION_UI_SELECTOR = '#renarration-overlay, #renarration-split-panel, #renarration-trigger-btn';
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
    const raw = bestSrcsetUrl(source.getAttribute('srcset')) || source.getAttribute('src') || '';
    if (!raw) continue;
    const parsed = parseSrcset(source.getAttribute('srcset'));
    const score = parsed.sort((a, b) => b.score - a.score)[0]?.score || 1;
    candidates.push({ url: raw, score });
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

function nearbyImageText(el) {
  const container = el.closest('figure') || el.parentElement;
  if (!container) return '';
  const text = truncateText(container.innerText || container.textContent || '', IMAGE_CONTEXT_CHARS);
  return text === imageCaption(el) ? '' : text;
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
  const meta = {
    url,
    source,
    alt: truncateText(el?.getAttribute?.('alt') || '', 180),
    caption: el ? imageCaption(el) : '',
    heading: el ? nearestHeading(el) : '',
    nearbyText: el ? nearbyImageText(el) : '',
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
    if (!isVisibleElement(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 220 || rect.height < 120) continue;
    const style = getComputedStyle(el);
    const urls = cssBackgroundUrls(style.backgroundImage);
    if (!urls.length) continue;
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
