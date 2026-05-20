let isEnabled = false;
let currentTask = 'simple';
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
const IMAGE_MAX_RESULTS = 40;
const IMAGE_MIN_RENDERED_WIDTH = 120;
const IMAGE_MIN_RENDERED_HEIGHT = 80;
const IMAGE_MIN_RENDERED_AREA = 12000;
const IMAGE_CONTEXT_CHARS = 300;
const SECTION_ELEMENT_LIMIT = 1200;
const SECTION_TEXT_CHARS = 9000;
const SECTION_MAX_RESULTS = 160;
const DECORATIVE_IMAGE_RE = /(^|[\s/_-])(adchoices|avatar|badge|blank|button|favicon|icon|logo|pixel|placeholder|share|social|spacer|spinner|sprite|tracking|transparent)([\s/_\-.]|$)/i;
const CONTENT_CLASS_RE = /(^|[\s_-])(article|content|entry|main|post|story)([\s_-]|$)/i;
const NON_CONTENT_CLASS_RE = /(^|[\s_-])(ad|ads|advert|banner|cookie|footer|header|nav|navbar|promo|share|sidebar|social|sponsor)([\s_-]|$)/i;
// Attributes that lazy-loading libraries use to hold the real image URL while
// src/currentSrc stay on a placeholder until the image scrolls into view.
const LAZY_SRC_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'data-hi-res-src', 'data-image-src', 'data-full-src', 'data-echo'];
const LAZY_SRCSET_ATTRS = ['data-srcset', 'data-lazy-srcset', 'data-original-set'];

function logContentExtraction(label, details) {
  try {
    console.log(`[Clear Extraction][content] ${label}`, details);
  } catch {}
}

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

function makeImageMeta(rawUrl, el, source, index, sectionContext) {
  const url = normalizeImageUrl(rawUrl);
  if (!url) return null;
  const dims = el ? imageDimensions(el) : { width: 0, height: 0, renderedWidth: 0, renderedHeight: 0 };
  const caption = el ? imageCaption(el) : '';
  const meta = {
    id: `image-${index + 1}`,
    url,
    source,
    alt: truncateText(el?.getAttribute?.('alt') || '', 180),
    caption,
    heading: el ? nearestHeading(el) : '',
    nearbyText: el ? nearbyImageText(el, caption) : '',
    sectionIds: imageSectionIds(el, sectionContext),
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
    for (const [source, rawUrl] of sources) {
      const item = makeImageMeta(rawUrl, img, source, imageIndex, sectionContext);
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
      const item = makeImageMeta(rawUrl, el, 'css-background', imageIndex, sectionContext);
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
