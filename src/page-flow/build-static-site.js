// build-static-site.js
// Turns a page extraction (sections, facts, images) into a single self-contained
// static HTML document. Images are embedded as data URIs so the file works
// offline, and the full extraction JSON is embedded so the site can be
// regenerated from the file itself.

const MAX_IMAGE_BYTES = 1_800_000; // skip embedding any single image larger than this
const MAX_TOTAL_EMBED_BYTES = 14_000_000; // overall embedded-image budget
const IMAGE_FETCH_TIMEOUT_MS = 15000;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function slugify(text, fallback = 'page') {
  const slug = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}

export function siteFilename(extraction) {
  const host = hostnameOf(extraction?.url || '');
  const base = slugify(extraction?.title || host || 'page');
  return `clear-site-${base}.html`;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Fetches each extracted image and returns { [imageId]: dataUri }. Runs in the
// background service worker, which has <all_urls> host permissions, so most
// cross-origin images are reachable. Images that fail keep their remote URL.
export async function collectImageDataURIs(images = [], onProgress) {
  const map = {};
  let totalBytes = 0;
  const list = Array.isArray(images) ? images : [];

  for (let i = 0; i < list.length; i += 1) {
    const image = list[i];
    const url = String(image?.url || '').trim();
    if (!/^https?:\/\//i.test(url)) continue;

    onProgress?.(`Embedding image ${i + 1}/${list.length}...`);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
      let response;
      try {
        response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) continue;

      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (contentType && !contentType.startsWith('image/')) continue;

      const buffer = await response.arrayBuffer();
      if (!buffer.byteLength || buffer.byteLength > MAX_IMAGE_BYTES) continue;
      if (totalBytes + buffer.byteLength > MAX_TOTAL_EMBED_BYTES) continue;

      totalBytes += buffer.byteLength;
      const mime = contentType || 'image/jpeg';
      map[image.id] = `data:${mime};base64,${arrayBufferToBase64(buffer)}`;
    } catch {
      // Unreachable image — the builder falls back to the remote URL.
    }
  }
  return map;
}

function textToParagraphList(text) {
  return String(text || '')
    .split(/\n{2,}|\r\n\r\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`);
}

function textToParagraphs(text) {
  return textToParagraphList(text).join('\n');
}

function renderFigure(image, imageMap, captionOverride) {
  let src = imageMap?.[image.id] || image.url;
  if (!src) return '';
  // A secure-context page (chrome-extension://, https://) blocks plain-http
  // images as mixed content — upgrade them so they have a chance to load.
  if (/^http:\/\//i.test(src)) src = src.replace(/^http:/i, 'https:');
  // captionOverride carries the renarrated (e.g. translated) caption when one
  // was produced; otherwise fall back to the original page caption.
  const captionText = String(captionOverride || '').trim() || image.caption || image.alt || '';
  const alt = escapeHtml(captionText || image.heading || '');
  const caption = captionText ? `<figcaption>${escapeHtml(captionText)}</figcaption>` : '';
  // referrerpolicy="no-referrer" stops hotlink-protected hosts from rejecting
  // the request because it came from a foreign (extension) origin.
  return `<figure class="cl-figure"><img src="${escapeHtml(src)}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer">${caption}</figure>`;
}

function imagesForSection(section, images) {
  const bySection = images.filter((image) => (image.sectionIds || []).includes(section.id));
  const byList = images.filter((image) => (section.imageIds || []).includes(image.id));
  const seen = new Set();
  const result = [];
  for (const image of [...bySection, ...byList]) {
    if (seen.has(image.id)) continue;
    seen.add(image.id);
    result.push(image);
  }
  return result;
}

function renderChips(label, items) {
  const values = (items || []).map((item) => String(item || '').trim()).filter(Boolean);
  if (!values.length) return '';
  const chips = values.map((value) => `<span class="cl-chip">${escapeHtml(value)}</span>`).join('');
  return `<section class="cl-aside"><h2 class="cl-aside-title">${escapeHtml(label)}</h2><div class="cl-chips">${chips}</div></section>`;
}

function factTextValue(fact) {
  return typeof fact === 'string' ? fact : String(fact?.text || fact?.content || '').trim();
}

function renderFacts(facts) {
  const items = (facts || [])
    .map((fact) => {
      const text = factTextValue(fact);
      if (!text) return '';
      const kind = (typeof fact === 'object' && (fact.kind || fact.type)) || 'POINT';
      return `<li><span class="cl-fact-kind">${escapeHtml(String(kind).toUpperCase())}</span><span>${escapeHtml(text)}</span></li>`;
    })
    .filter(Boolean);
  if (!items.length) return '';
  return `<section class="cl-section"><h2>Key points</h2><ul class="cl-facts">${items.join('\n')}</ul></section>`;
}

const SITE_CSS = `
:root{color-scheme:light dark;--ink:#1c1c1e;--muted:#69696f;--paper:#f6f6f4;--card:#ffffff;--line:#e3e3e1;--accent:#2f6f6a;}
@media (prefers-color-scheme:dark){:root{--ink:#e7e7ea;--muted:#999aa0;--paper:#14151a;--card:#1d1e24;--line:#2e2f38;--accent:#5fb0a8;}}
*{box-sizing:border-box;}
body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.65 Georgia,'Times New Roman',serif;-webkit-font-smoothing:antialiased;}
.cl-wrap{max-width:720px;margin:0 auto;padding:48px 24px 96px;}
.cl-eyebrow{font:600 11px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);}
h1{font-size:2.45rem;line-height:1.18;letter-spacing:-.02em;margin:14px 0 12px;}
h2{font-size:1.4rem;letter-spacing:-.01em;margin:2.4em 0 .5em;}
.cl-meta{font:13px/1.5 ui-sans-serif,system-ui,sans-serif;color:var(--muted);display:flex;flex-wrap:wrap;gap:6px 10px;}
.cl-meta a{color:var(--muted);}
.cl-summary{font-size:1.18rem;line-height:1.6;color:var(--ink);border-left:3px solid var(--accent);padding:4px 0 4px 20px;margin:28px 0;}
.cl-section p{margin:0 0 1.1em;}
.cl-figure{margin:28px auto;text-align:center;}
.cl-figure img{display:block;width:auto;max-width:min(100%,440px);max-height:360px;height:auto;margin:0 auto;border-radius:8px;background:var(--card);}
.cl-figure figcaption{font:13px/1.5 ui-sans-serif,system-ui,sans-serif;color:var(--muted);margin-top:8px;}
.cl-facts{list-style:none;padding:0;margin:0;}
.cl-facts li{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--line);font-size:.98rem;}
.cl-facts li:last-child{border-bottom:none;}
.cl-fact-kind{font:600 10px/1.6 ui-sans-serif,system-ui,sans-serif;letter-spacing:.08em;color:var(--accent);flex:0 0 64px;}
.cl-aside{margin:34px 0;}
.cl-aside-title{font:600 12px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:0 0 12px;}
.cl-chips{display:flex;flex-wrap:wrap;gap:8px;}
.cl-chip{font:13px/1 ui-sans-serif,system-ui,sans-serif;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:7px 12px;color:var(--ink);}
.cl-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;}
.cl-gallery .cl-figure{margin:0;}
.cl-divider{border:none;border-top:1px solid var(--line);margin:48px 0;}
.cl-footer{font:13px/1.6 ui-sans-serif,system-ui,sans-serif;color:var(--muted);}
.cl-footer a{color:var(--accent);}
`.trim();

// Pure builder: given an extraction and an { imageId: dataUri } map, returns a
// complete standalone HTML document string. No network or chrome APIs used.
export function buildStaticSiteHTML(extraction = {}, imageMap = {}) {
  const knowledge = extraction.knowledge || {};
  const title = String(extraction.title || knowledge.title || 'Captured page').trim();
  const topic = String(extraction.topic || knowledge.topic || '').trim();
  const summary = String(extraction.summary || knowledge.summary || '').trim();
  const sourceUrl = String(extraction.url || '').trim();
  const host = hostnameOf(sourceUrl);
  const images = Array.isArray(extraction.images) ? extraction.images.filter((image) => image && image.id) : [];
  const sections = Array.isArray(extraction.sections) ? extraction.sections.slice() : [];
  sections.sort((a, b) => (Number(a?.index) || 0) - (Number(b?.index) || 0));
  const facts = extraction.facts || knowledge.facts || [];

  const capturedAt = extraction.at ? new Date(extraction.at) : new Date();
  const capturedLabel = Number.isNaN(capturedAt.getTime())
    ? ''
    : capturedAt.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  const placed = new Set();
  const sectionHtml = [];
  for (const section of sections) {
    const heading = String(section?.heading || '').trim();
    const body = textToParagraphs(section?.text || '');
    const sectionImages = imagesForSection(section, images);
    if (!heading && !body && !sectionImages.length) continue;
    const figures = sectionImages
      .map((image) => {
        placed.add(image.id);
        return renderFigure(image, imageMap);
      })
      .filter(Boolean)
      .join('\n');
    sectionHtml.push(
      `<section class="cl-section">${heading ? `<h2>${escapeHtml(heading)}</h2>` : ''}${body}${figures}</section>`,
    );
  }

  // Fall back to raw text when the extraction produced no usable sections.
  let mainHtml = sectionHtml.join('\n');
  if (!mainHtml.trim()) {
    const rawParas = textToParagraphs(extraction.rawText || extraction.compactText || '');
    mainHtml = rawParas
      ? `<section class="cl-section">${rawParas}</section>`
      : '<section class="cl-section"><p>No readable content was extracted from this page.</p></section>';
  }

  const leftoverImages = images.filter((image) => !placed.has(image.id));
  const galleryHtml = leftoverImages.length
    ? `<section class="cl-section"><h2>Images</h2><div class="cl-gallery">${
        leftoverImages.map((image) => renderFigure(image, imageMap)).filter(Boolean).join('\n')
      }</div></section>`
    : '';

  const embeddedCount = images.filter((image) => imageMap[image.id]).length;

  const metaBits = [];
  if (host) {
    metaBits.push(sourceUrl
      ? `<a href="${escapeHtml(sourceUrl)}">${escapeHtml(host)}</a>`
      : escapeHtml(host));
  }
  if (capturedLabel) metaBits.push(`<span>Captured ${escapeHtml(capturedLabel)}</span>`);
  if (topic) metaBits.push(`<span>${escapeHtml(topic)}</span>`);

  // The full extraction is embedded so this file is self-describing: it can be
  // re-opened and the static site regenerated from #clear-page-data.
  const dataIsland = JSON.stringify({
    generator: 'clear-static-site',
    version: 1,
    generatedAt: new Date().toISOString(),
    extraction,
  }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="generator" content="Clear · static site">
${sourceUrl ? `<link rel="canonical" href="${escapeHtml(sourceUrl)}">` : ''}
<title>${escapeHtml(title)}</title>
<style>${SITE_CSS}</style>
</head>
<body>
<main class="cl-wrap">
<header class="cl-header">
<span class="cl-eyebrow">Captured with Clear</span>
<h1>${escapeHtml(title)}</h1>
${metaBits.length ? `<div class="cl-meta">${metaBits.join('<span aria-hidden="true">·</span>')}</div>` : ''}
</header>
${summary ? `<p class="cl-summary">${escapeHtml(summary)}</p>` : ''}
${mainHtml}
${renderFacts(facts)}
${galleryHtml}
${renderChips('Entities', extraction.entities || knowledge.entities)}
${renderChips('Key terms', extraction.keyTerms || knowledge.keyTerms)}
<hr class="cl-divider">
<footer class="cl-footer">
<p>Static page generated by the Clear extension from ${
    sourceUrl ? `<a href="${escapeHtml(sourceUrl)}">${escapeHtml(host || sourceUrl)}</a>` : 'a web page'
  }. ${embeddedCount} of ${images.length} image${images.length === 1 ? '' : 's'} embedded for offline use.</p>
<p>This file embeds its source data and can be regenerated.</p>
</footer>
</main>
<script type="application/json" id="clear-page-data">${dataIsland}</script>
</body>
</html>`;
}

// URLs/alt text that look like ad, sponsor, or ad-network creatives. These are
// never worth showing on a reading page even if they slipped past extraction.
const AD_IMAGE_RE = /(^|[\s/_.-])(ad|ads|adv|advert|advertising|adserver|adservice|adsystem|banner|doubleclick|googlesyndication|2mdn|outbrain|taboola|promo|sponsor|sponsored)([\s/_.-]|$)/i;

function isAdImage(image) {
  const haystack = `${image?.url || ''} ${image?.alt || ''} ${image?.caption || ''} ${image?.source || ''}`.toLowerCase();
  return AD_IMAGE_RE.test(haystack);
}

// Reduces a URL to a stable identity for one picture, collapsing the variants
// that make the same image look unique: query strings (?w=800), responsive
// filename size tokens (hero-1200x630.jpg), retina markers (hero@2x.jpg), and
// WordPress's -scaled suffix. Without this, an og:image and the in-content
// hero — the same photo at two CDN sizes — render as two separate figures.
function imageDedupeKey(image) {
  const url = String(image?.url || '').trim();
  let path = url.toLowerCase().split(/[?#]/)[0];
  try {
    const parsed = new URL(url);
    path = `${parsed.origin}${parsed.pathname}`.toLowerCase();
  } catch {
    /* keep the query-stripped raw string */
  }
  return path
    .replace(/[-_]\d{2,4}x\d{2,4}(?=(\.[a-z0-9]+)?$)/, '')
    .replace(/@\d+x(?=(\.[a-z0-9]+)?$)/, '')
    .replace(/-scaled(?=(\.[a-z0-9]+)?$)/, '');
}

// Picks the images worth showing on a renarrated reading page: only the ones
// the extraction tied to actual facts, with ads and duplicates removed.
function selectRelevantImages(extraction) {
  const images = Array.isArray(extraction?.images)
    ? extraction.images.filter((image) => image && image.id)
    : [];
  if (!images.length) return [];

  const facts = extraction?.facts || extraction?.knowledge?.facts || [];
  const relevantIds = new Set();
  for (const fact of facts) {
    for (const id of (fact && fact.imageIds) || []) {
      if (id) relevantIds.add(String(id));
    }
  }
  // No fact references an image -> nothing is relevant enough to show.
  if (!relevantIds.size) return [];

  let pool = images.filter((image) => relevantIds.has(String(image.id)) && !isAdImage(image));

  // The og:image is the social-share card — almost always a duplicate of an
  // in-content hero shot. Drop it whenever real in-content images exist.
  const inContent = pool.filter((image) => image.source !== 'og:image');
  if (inContent.length) pool = inContent;

  const seenUrl = new Set();
  const seenAlt = new Set();
  const result = [];
  for (const image of pool) {
    const urlKey = imageDedupeKey(image);
    if (!urlKey || seenUrl.has(urlKey)) continue;
    // Identical non-empty alt text means the same picture even when the URLs
    // differ (e.g. og:image vs in-content image of the same photo).
    const altKey = String(image.alt || '').trim().toLowerCase();
    if (altKey && seenAlt.has(altKey)) continue;
    seenUrl.add(urlKey);
    if (altKey) seenAlt.add(altKey);
    result.push(image);
  }
  return result;
}

// Pure builder: turns a renarration's plain text plus the original page's
// images into a complete standalone HTML reading page. Images use their remote
// URLs unless a { imageId: dataUri } map is supplied, so the document stays
// small enough to hand between extension contexts. No network or chrome APIs.
export function buildRenarratedSiteHTML(extraction = {}, renarrationText = '', imageMap = {}, captionMap = {}) {
  const knowledge = extraction.knowledge || {};
  const title = String(extraction.title || knowledge.title || 'Renarrated page').trim();
  const sourceUrl = String(extraction.url || '').trim();
  const host = hostnameOf(sourceUrl);
  const images = selectRelevantImages(extraction);

  const wordCount = String(renarrationText || '').split(/\s+/).filter(Boolean).length;
  const readMin = Math.max(1, Math.round(wordCount / 250));

  // Interleave the page's images within the renarrated text rather than
  // dumping them in a trailing gallery. The renarration is plain prose with no
  // image anchors, so figures are spread evenly across the paragraphs.
  const paragraphs = textToParagraphList(renarrationText);
  const figures = images
    .map((image) => renderFigure(image, imageMap, captionMap?.[image.id]))
    .filter(Boolean);

  let bodyHtml;
  if (!paragraphs.length) {
    bodyHtml = ['<p>No renarrated text was produced for this page.</p>', ...figures].join('\n');
  } else if (!figures.length) {
    bodyHtml = paragraphs.join('\n');
  } else {
    const afterParagraph = new Map();
    figures.forEach((figure, k) => {
      let pos = Math.round(((k + 1) * paragraphs.length) / (figures.length + 1)) - 1;
      pos = Math.min(Math.max(pos, 0), paragraphs.length - 1);
      if (!afterParagraph.has(pos)) afterParagraph.set(pos, []);
      afterParagraph.get(pos).push(figure);
    });
    const pieces = [];
    paragraphs.forEach((paragraph, i) => {
      pieces.push(paragraph);
      (afterParagraph.get(i) || []).forEach((figure) => pieces.push(figure));
    });
    bodyHtml = pieces.join('\n');
  }

  const metaBits = [];
  if (host) {
    metaBits.push(sourceUrl
      ? `<a href="${escapeHtml(sourceUrl)}">${escapeHtml(host)}</a>`
      : escapeHtml(host));
  }
  metaBits.push(`<span>${readMin} min read</span>`);
  metaBits.push('<span>Renarrated</span>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="generator" content="Clear · renarrated page">
<title>${escapeHtml(title)}</title>
<style>${SITE_CSS}</style>
</head>
<body>
<main class="cl-wrap">
<header class="cl-header">
<span class="cl-eyebrow">Renarrated with Clear</span>
<h1>${escapeHtml(title)}</h1>
${metaBits.length ? `<div class="cl-meta">${metaBits.join('<span aria-hidden="true">·</span>')}</div>` : ''}
</header>
<section class="cl-section">${bodyHtml}</section>
<hr class="cl-divider">
<footer class="cl-footer">
<p>This page was renarrated by the Clear extension from ${
    sourceUrl ? `<a href="${escapeHtml(sourceUrl)}">${escapeHtml(host || sourceUrl)}</a>` : 'a web page'
  } to match your reading goal.</p>
</footer>
</main>
</body>
</html>`;
}
