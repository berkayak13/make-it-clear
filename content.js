let isEnabled = false;
let currentTask = 'simple';
let selectionHandler = null;
let selectionPopup = null;

// Extension-context guards and font injection are shared with clear-overlay.js
// via clear-shared.js (injected first — see manifest content_scripts order).
const { hasExtensionContext, markExtensionContextDead, safeSendMessage, injectClearFonts, onContextDead } =
  globalThis.__clearRuntime;

// When the extension context goes away (reload/update with the page still open),
// tear down this script's selection listeners and popup.
onContextDead(() => {
  removeEventListeners();
  hideSelectionPopup();
});

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
  // Announce the popup to assistive technology. The body is an aria-live
  // region (below) so the renarrated result is read out when it loads.
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', 'Renarrated selection');

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
      <div class="clear-selection-body" id="clear-selection-body" role="status" aria-live="polite">
        <div style="font-family: var(--font-sans); font-style: italic; font-size: 12px; color: var(--muted);">Processing…</div>
      </div>
      <div class="clear-selection-actions" id="clear-selection-actions" style="display: none;">
        <button class="clear-btn clear-btn--xs clear-btn--ghost" data-action="good">${ClearIcons.check} Good</button>
        <button class="clear-btn clear-btn--xs clear-btn--ghost" data-action="off" style="color: var(--muted-2);">Off</button>
        <span class="spacer"></span>
        <button class="clear-btn clear-btn--xs" data-action="retry" style="color: var(--muted);">Try again</button>
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
    });
  });

  setupSelectionDrag(popup);

  // Register the dismissers on the NEXT tick. Selecting text ends with a
  // mouseup (which created this popup) immediately followed by a trailing
  // `click` from the same gesture; registering synchronously let that click
  // close the popup before it was ever usable — which is why the feature
  // appeared broken. Dismiss on `mousedown` (the current gesture's mousedown
  // already fired before the popup existed) so only a genuine new interaction
  // closes it.
  setTimeout(() => {
    if (selectionPopup !== popup) return;
    document.addEventListener('mousedown', onPointerDownOutsidePopup, true);
    document.addEventListener('selectionchange', onNewSelection);
  }, 0);
}

function onPointerDownOutsidePopup(e) {
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

// Makes the popup draggable by its eyebrow/header row. The body stays
// selectable (so the renarrated text can be copied), and once moved the pointer
// triangle is hidden since the card no longer sits against the selection.
function setupSelectionDrag(popup) {
  const handle = popup.querySelector('.clear-selection-eyebrow');
  if (!handle) return;
  let startX, startY, origLeft, origTop;

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, a')) return;
    e.preventDefault();
    try { handle.setPointerCapture(e.pointerId); } catch {}
    const rect = popup.getBoundingClientRect();
    origLeft = rect.left;
    origTop = rect.top;
    startX = e.clientX;
    startY = e.clientY;
    handle.style.cursor = 'grabbing';
    // Pin to top/left and drop the pointer triangle once the card is moved.
    popup.style.bottom = 'auto';
    popup.classList.add('clear-selection-dragged');

    const onMove = (ev) => {
      const maxLeft = Math.max(8, window.innerWidth - popup.offsetWidth - 8);
      const maxTop = Math.max(8, window.innerHeight - popup.offsetHeight - 8);
      popup.style.left = Math.max(8, Math.min(origLeft + (ev.clientX - startX), maxLeft)) + 'px';
      popup.style.top = Math.max(8, Math.min(origTop + (ev.clientY - startY), maxTop)) + 'px';
    };
    const onUp = () => {
      handle.style.cursor = '';
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  });
}

function hideSelectionPopup() {
  if (selectionPopup) {
    selectionPopup.remove();
    selectionPopup = null;
  }
  document.removeEventListener('mousedown', onPointerDownOutsidePopup, true);
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
      body.textContent = response.result;
      if (actions) actions.style.display = 'flex';
    } else {
      body.innerHTML = `<div style="color: var(--neg); font-family: var(--font-sans); font-size: 12px;">${escapeHtml(response?.error || 'Unknown error')}</div>`;
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

function handleTextSelection(e) {
  if (!isEnabled) return;
  if (e.target.closest('#clear-selection-popup')) return;

  const selection = window.getSelection();
  const text = selection.toString().trim();
  if (text && text.length > 10) {
    const range = selection.getRangeAt(0);
    showSelectionPopup(text, range);
  }
}

/* ═══════════════════════════════════════════════════════════
   PAGE EXTRACTION
═══════════════════════════════════════════════════════════ */

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'IFRAME', 'OBJECT', 'EMBED']);
const EXTENSION_UI_SELECTOR = '#clear-selection-popup';
// These are GENEROUS SAFETY BACKSTOPS against pathological DOMs (so the message
// posted to the background never balloons), NOT coverage caps: the background's
// run budget is the real ceiling on how much gets extracted. Sized far above any
// realistic page so normal content is never truncated in the content script.
const IMAGE_MAX_RESULTS = 200;
const IMAGE_MIN_RENDERED_WIDTH = 120;
const IMAGE_MIN_RENDERED_HEIGHT = 80;
const IMAGE_MIN_RENDERED_AREA = 12000;
const IMAGE_CONTEXT_CHARS = 300;
const SECTION_ELEMENT_LIMIT = 5000;
const SECTION_TEXT_CHARS = 9000;
const SECTION_MAX_RESULTS = 800;
const DECORATIVE_IMAGE_RE = /(^|[\s/_-])(adchoices|avatar|badge|blank|button|favicon|icon|logo|pixel|placeholder|share|social|spacer|spinner|sprite|tracking|transparent)([\s/_\-.]|$)/i;
const CONTENT_CLASS_RE = /(^|[\s_-])(article|content|entry|main|post|story)([\s_-]|$)/i;
const NON_CONTENT_CLASS_RE = /(^|[\s_-])(ad|ads|advert|banner|cookie|footer|header|nav|navbar|promo|share|sidebar|social|sponsor)([\s_-]|$)/i;
// Attributes that lazy-loading libraries use to hold the real image URL while
// src/currentSrc stay on a placeholder until the image scrolls into view.
const LAZY_SRC_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'data-hi-res-src', 'data-image-src', 'data-full-src', 'data-echo'];
const LAZY_SRCSET_ATTRS = ['data-srcset', 'data-lazy-srcset', 'data-original-set'];

// OFF by default: this logged the entire extracted text, every section, and
// every image object to the page console on each extraction — heavy and noisy.
// Flip to true only when debugging the content-script extraction.
const EXTRACTION_DEBUG = false;

function logContentExtraction(label, details) {
  if (!EXTRACTION_DEBUG) return;
  try {
    console.log(`[Clear Extraction][content] ${label}`, details);
  } catch {}
}

// Visibility check forces a style + layout flush (getComputedStyle +
// getBoundingClientRect), so cache the verdict per element. The text walker
// asks about the same parent element once per text node it contains — without
// the cache a paragraph with N text nodes paid for N identical reflows.
function makeVisibilityCache() {
  const cache = new WeakMap();
  return (el) => {
    if (!el) return false;
    const cached = cache.get(el);
    if (cached !== undefined) return cached;
    const style = getComputedStyle(el);
    let visible = !(style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0');
    if (visible) {
      const rect = el.getBoundingClientRect();
      visible = rect.width > 0 && rect.height > 0;
    }
    cache.set(el, visible);
    return visible;
  };
}

function extractVisiblePageText() {
  const chunks = [];
  const seen = new Set();
  const isVisible = makeVisibilityCache();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent.trim();
      if (!text || text.length < 3) return NodeFilter.FILTER_REJECT;
      const el = node.parentElement;
      if (!el || SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
      if (el.closest(EXTENSION_UI_SELECTOR)) return NodeFilter.FILTER_REJECT;
      return isVisible(el) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  while (walker.nextNode()) {
    const text = walker.currentNode.textContent.replace(/\s+/g, ' ').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    chunks.push(text);
  }

  const sectionContext = extractPageSections();
  let images = [];
  try {
    images = extractPageImages(sectionContext);
  } catch {
    images = [];
  }

  const response = {
    success: true,
    text: chunks.join('\n'),
    images,
    sections: sectionContext.sections.map((section) => ({
      id: section.id,
      index: section.index,
      heading: section.heading,
      text: section.text,
      imageIds: section.imageIds,
    })),
    title: document.title || '',
    url: location.href,
  };

  logContentExtraction('visible-page-response', {
    url: response.url,
    title: response.title,
    visibleTextChunkCount: chunks.length,
    visibleTextCharCount: response.text.length,
    sectionCount: response.sections.length,
    imageCount: response.images.length,
    text: response.text,
    sections: response.sections,
    images: response.images,
  });

  return response;
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function truncateText(text, maxChars = IMAGE_CONTEXT_CHARS) {
  const value = normalizeText(text);
  return value.length > maxChars ? value.slice(0, maxChars - 3).trimEnd() + '...' : value;
}

function stableSectionId(index) {
  return `section-${index + 1}`;
}

function isVisibleTextElement(el) {
  if (!el || SKIP_TAGS.has(el.tagName) || el.closest(EXTENSION_UI_SELECTOR)) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function extractPageSections() {
  const roots = Array.from(document.querySelectorAll('article, main, [role="main"]'));
  const root = roots.find(isVisibleTextElement) || document.body;
  const selector = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,figcaption,td,th';
  const elements = Array.from(root?.querySelectorAll?.(selector) || [])
    .filter(isVisibleTextElement)
    .slice(0, SECTION_ELEMENT_LIMIT);
  const sections = [];
  let current = null;

  const startSection = (heading, top) => {
    const section = {
      id: stableSectionId(sections.length),
      index: sections.length,
      heading: truncateText(heading || '', 160),
      textParts: [],
      imageIds: [],
      top,
    };
    sections.push(section);
    current = section;
    return section;
  };

  for (const el of elements) {
    const text = truncateText(el.innerText || el.textContent || '', SECTION_TEXT_CHARS);
    if (!text) continue;
    const rect = el.getBoundingClientRect();
    const isHeading = /^H[1-6]$/.test(el.tagName);
    if (isHeading || !current) {
      current = startSection(isHeading ? text : '', rect.top + window.scrollY);
      if (isHeading) continue;
    }
    if (!current.textParts.includes(text)) current.textParts.push(text);
  }

  return {
    sections: sections
      .map((section) => ({
        id: section.id,
        index: section.index,
        heading: section.heading,
        text: truncateText(section.textParts.join('\n'), SECTION_TEXT_CHARS),
        imageIds: section.imageIds,
        top: section.top,
      }))
      .filter((section) => section.text || section.heading)
      .slice(0, SECTION_MAX_RESULTS),
  };
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

function firstAttrValue(el, attrs) {
  for (const attr of attrs) {
    const value = el?.getAttribute?.(attr);
    if (value && value.trim()) return value.trim();
  }
  return '';
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

function isExtremeAspectRatio(meta) {
  const w = meta.renderedWidth || meta.width;
  const h = meta.renderedHeight || meta.height;
  if (!w || !h) return false;
  return Math.max(w, h) / Math.min(w, h) > 5;
}

function imageLooksUsable(meta, el) {
  const path = (() => {
    try { return new URL(meta.url).pathname.toLowerCase(); } catch { return ''; }
  })();
  if (/\.(svg|ico|gif)$/i.test(path)) return false;
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

  // Aggressive filter: real article images only. og:image (the page's declared
  // hero) bypasses container checks because it's content by definition.
  if (meta.source !== 'og:image') {
    if (!inContent) return false;
    if (inNonContent) return false;
    // Banner/skyscraper shapes are almost always ads, share bars, or layout
    // dividers. Genuine wide photos live in a <figure>; that exempts them.
    if (isExtremeAspectRatio(meta) && !el?.closest?.('figure')) return false;
  }

  if (meta.source === 'css-background' && !largeRendered) return false;
  if (meta.source !== 'og:image' && !largeRendered && !largeIntrinsicWithoutRenderedSize) return false;
  if (renderedArea > 0 && (meta.renderedWidth <= 2 || meta.renderedHeight <= 2)) return false;
  // Decorative descriptor (logo, icon, avatar, badge, sprite, ...) is never
  // main-topic content — drop unconditionally.
  if (DECORATIVE_IMAGE_RE.test(descriptor)) return false;

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

function imageSectionIds(el, sectionContext) {
  const sections = sectionContext?.sections || [];
  if (!sections.length || !el) return [];
  const heading = normalizeText(nearestHeading(el)).toLowerCase();
  if (heading) {
    const byHeading = sections.find((section) => normalizeText(section.heading).toLowerCase() === heading);
    if (byHeading) return [byHeading.id];
  }

  const top = (el.getBoundingClientRect?.().top || 0) + window.scrollY;
  const before = sections
    .filter((section) => Number.isFinite(section.top) && section.top <= top + 8)
    .sort((a, b) => b.top - a.top)[0];
  return before ? [before.id] : [sections[0].id];
}

// The element-derived parts of an image's metadata (size, caption, heading,
// nearby text, section) are identical across the several source URLs one <img>
// exposes (currentSrc, srcset, data-src, picture-source, ...). Computing them
// once per element — instead of re-running nearestHeading's querySelectorAll +
// layout reads for every candidate URL — is the bulk of the per-image savings.
function elImageContext(el, sectionContext) {
  if (!el) {
    return {
      dims: { width: 0, height: 0, renderedWidth: 0, renderedHeight: 0 },
      alt: '', caption: '', heading: '', nearbyText: '', sectionIds: [],
    };
  }
  const dims = imageDimensions(el);
  const caption = imageCaption(el);
  return {
    dims,
    alt: truncateText(el.getAttribute?.('alt') || '', 180),
    caption,
    heading: nearestHeading(el),
    nearbyText: nearbyImageText(el, caption),
    sectionIds: imageSectionIds(el, sectionContext),
  };
}

function makeImageMeta(rawUrl, el, source, index, sectionContext, context) {
  const url = normalizeImageUrl(rawUrl);
  if (!url) return null;
  const ctx = context || elImageContext(el, sectionContext);
  const meta = {
    id: `image-${index + 1}`,
    url,
    source,
    alt: ctx.alt,
    caption: ctx.caption,
    heading: ctx.heading,
    nearbyText: ctx.nearbyText,
    sectionIds: ctx.sectionIds,
    width: ctx.dims.width,
    height: ctx.dims.height,
    renderedWidth: ctx.dims.renderedWidth,
    renderedHeight: ctx.dims.renderedHeight,
    index,
  };
  if (!imageLooksUsable(meta, el)) return null;
  meta.score = scoreImage(meta, el);
  return meta;
}

// Elements whose CSS background-image might be real content: content-container
// descendants plus the handful of hero/banner wrappers that carry a background
// photo. The previous version unioned the first 800 elements of the WHOLE body
// and then called getComputedStyle + getBoundingClientRect on every one (up to
// 1600) — a full style+layout sweep over the page just to find a few
// backgrounds, almost all discarded. A targeted selector finds the same real
// images at a fraction of the cost. (<img> and og:image are handled separately,
// so nothing content-bearing is lost here.)
const BACKGROUND_IMAGE_SELECTOR = [
  'article *', 'main *', '[role="main"] *', 'figure', 'figure *',
  'header', '[style*="background"]',
  '[class*="hero" i]', '[class*="banner" i]', '[class*="cover" i]',
  '[class*="masthead" i]', '[class*="featured" i]', '[class*="thumbnail" i]',
].join(',');

function backgroundImageElements() {
  let nodes;
  try {
    nodes = document.querySelectorAll(BACKGROUND_IMAGE_SELECTOR);
  } catch {
    // Older engines may reject the case-insensitive attribute flag.
    nodes = document.querySelectorAll('article *, main *, figure *, [role="main"] *, header');
  }
  return Array.from(new Set(nodes)).slice(0, 500);
}

function extractPageImages(sectionContext) {
  const candidates = [];
  let index = 0;

  document.querySelectorAll('meta[property="og:image"], meta[property="og:image:url"], meta[name="twitter:image"], meta[name="twitter:image:src"]').forEach((meta) => {
    const item = makeImageMeta(meta.getAttribute('content'), null, 'og:image', index++, sectionContext);
    if (item) candidates.push(item);
  });

  for (const img of document.images || []) {
    if (img.closest(EXTENSION_UI_SELECTOR)) continue;
    const imageIndex = index++;
    const lazyUrl = firstAttrValue(img, LAZY_SRC_ATTRS);
    const lazySrcset = bestSrcsetUrl(firstAttrValue(img, LAZY_SRCSET_ATTRS));
    const hasLazy = !!(lazyUrl || lazySrcset);
    const sources = [
      ['img-current-src', img.currentSrc],
      ['img-data-srcset', lazySrcset],
      ['img-data-src', lazyUrl],
      ['img-srcset', bestSrcsetUrl(img.getAttribute('srcset'))],
      ['picture-source', bestPictureSourceUrl(img)],
    ];
    // When the page lazy-loads, the plain src attribute is just a placeholder.
    if (!hasLazy) sources.push(['img-src', img.getAttribute('src') || img.src]);
    const ctx = elImageContext(img, sectionContext);
    for (const [source, rawUrl] of sources) {
      const item = makeImageMeta(rawUrl, img, source, imageIndex, sectionContext, ctx);
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
    const ctx = elImageContext(el, sectionContext);
    for (const rawUrl of urls) {
      const item = makeImageMeta(rawUrl, el, 'css-background', imageIndex, sectionContext, ctx);
      if (item) candidates.push(item);
    }
  }

  const byUrl = new Map();
  for (const item of candidates) {
    const existing = byUrl.get(item.url);
    if (!existing || item.score > existing.score) byUrl.set(item.url, item);
  }

  const images = Array.from(byUrl.values())
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, IMAGE_MAX_RESULTS)
    .sort((a, b) => a.index - b.index);

  const bySection = new Map((sectionContext?.sections || []).map((section) => [section.id, section]));
  for (const image of images) {
    for (const sectionId of image.sectionIds || []) {
      const section = bySection.get(sectionId);
      if (section && !section.imageIds.includes(image.id)) section.imageIds.push(image.id);
    }
  }

  return images;
}

/* ═══════════════════════════════════════════════════════════
   MESSAGE HANDLER (unchanged protocol)
═══════════════════════════════════════════════════════════ */

if (hasExtensionContext()) {
  try {
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (request.action === 'extract-visible-page-text') {
        sendResponse(extractVisiblePageText());
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
