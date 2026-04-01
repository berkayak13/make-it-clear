const CAPTURE_MAX_RETRIES = 6;
const CAPTURE_BASE_DELAY_MS = 900;
const CAPTURE_MAX_SLICES = 50;
const CAPTURE_SETTLE_DELAY_MS = 350;
const CAPTURE_SLICE_OVERLAP_PX = 200;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function evalInTab(tabId, func, args = []) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args
  });
  return result;
}

async function getPageMetrics(tabId) {
  return await evalInTab(tabId, () => {
    const d = document;
    const body = d.body;
    const de = d.documentElement;
    const scrollHeight = Math.max(
      body ? body.scrollHeight : 0,
      de ? de.scrollHeight : 0
    );
    const clientHeight = window.innerHeight || (de && de.clientHeight) || 0;
    const dpr = window.devicePixelRatio || 1;
    const y = window.scrollY || window.pageYOffset || 0;
    return { scrollHeight, clientHeight, dpr, y };
  });
}

async function scrollToY(tabId, y) {
  await evalInTab(tabId, (yy) => {
    window.scrollTo(0, yy);
  }, [y]);
}

/**
 * Capture a single viewport screenshot with retry logic for rate limiting.
 */
async function captureVisibleTabWithRetry(windowId, format = 'png', quality = 100) {
  let attempt = 0;
  while (true) {
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format, quality });
    } catch (e) {
      const msg = e?.message || String(e);
      if (/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(msg) && attempt < CAPTURE_MAX_RETRIES) {
        const backoff = CAPTURE_BASE_DELAY_MS + attempt * 400;
        await new Promise(r => setTimeout(r, backoff));
        attempt++;
        continue;
      }
      throw e;
    }
  }
}

/**
 * Capture current viewport screenshot for a given tab.
 */
export async function captureViewport(tabId) {
  const tab = tabId ? await chrome.tabs.get(tabId) : await getActiveTab();
  if (!tab) throw new Error('No active tab found');
  return captureVisibleTabWithRetry(tab.windowId);
}

/**
 * Capture full-page screenshots as ordered slices by scrolling the page.
 * Returns { images: [{y, dataUrl}], meta: {overlapPx, clientHeight, dpr}, partial: boolean }
 */
export async function captureFullPageSlices(tabId) {
  const tab = tabId ? await chrome.tabs.get(tabId) : await getActiveTab();
  if (!tab) throw new Error('No active tab found');
  try { await chrome.tabs.update(tab.id, { active: true }); } catch {}

  const startMetrics = await getPageMetrics(tab.id);
  let total = startMetrics.scrollHeight;
  const originalY = startMetrics.y || 0;

  const images = [];
  let y = 0;
  let sliceIndex = 0;

  while (y < total && sliceIndex < CAPTURE_MAX_SLICES) {
    await scrollToY(tab.id, y);
    await new Promise(r => setTimeout(r, CAPTURE_SETTLE_DELAY_MS));

    let dataUrl;
    try {
      dataUrl = await captureVisibleTabWithRetry(tab.windowId, 'png', 95);
    } catch (e) {
      if (/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(e?.message || '')) break;
      throw e;
    }

    images.push({ y, dataUrl });
    sliceIndex++;

    if (sliceIndex % 5 === 0) {
      const m = await getPageMetrics(tab.id);
      if (m.scrollHeight > total) total = m.scrollHeight;
    }

    const step = Math.max(1, startMetrics.clientHeight - CAPTURE_SLICE_OVERLAP_PX);
    y += step;
    if (y >= total - 1) break;
  }

  await scrollToY(tab.id, originalY);

  const partial = images.length < Math.ceil(total / Math.max(1, startMetrics.clientHeight));
  const meta = {
    overlapPx: CAPTURE_SLICE_OVERLAP_PX,
    clientHeight: startMetrics.clientHeight,
    dpr: startMetrics.dpr || 1
  };
  return { images, meta, partial };
}
