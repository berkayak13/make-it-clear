/**
 * Image manipulation utilities for the service worker context.
 * Uses OffscreenCanvas and createImageBitmap (no DOM).
 */

/**
 * Convert a Blob to a data URL via FileReader.
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export async function blobToDataUrl(blob) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Fetch an image URL and return it as a data URL.
 * @param {string} imageUrl
 * @returns {Promise<string>}
 */
export async function toDataUrl(imageUrl) {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const blob = await res.blob();
  return await blobToDataUrl(blob);
}

/**
 * Convert a data URL to an ImageBitmap via fetch + createImageBitmap.
 * @param {string} dataUrl
 * @returns {Promise<ImageBitmap>}
 */
export async function dataUrlToBitmap(dataUrl) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return await createImageBitmap(blob);
}

/**
 * Get the width and height of an image from its data URL.
 * @param {string} dataUrl
 * @returns {Promise<{width: number, height: number}>}
 */
export async function getImageDimensions(dataUrl) {
  const bmp = await dataUrlToBitmap(dataUrl);
  const dims = { width: bmp.width, height: bmp.height };
  bmp.close && bmp.close();
  return dims;
}

/**
 * Create a thumbnail of an image, scaling it to fit within maxW x maxH.
 * Uses OffscreenCanvas for service worker compatibility.
 * @param {string} dataUrl
 * @param {number} [maxW=240]
 * @param {number} [maxH=240]
 * @returns {Promise<string>} thumbnail data URL
 */
export async function createThumbnail(dataUrl, maxW = 240, maxH = 240) {
  if (typeof OffscreenCanvas === 'undefined') return dataUrl;
  const bmp = await dataUrlToBitmap(dataUrl);
  const ratio = Math.min(maxW / bmp.width, maxH / bmp.height, 1);
  const w = Math.max(1, Math.round(bmp.width * ratio));
  const h = Math.max(1, Math.round(bmp.height * ratio));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close && bmp.close();
  const thumbBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  return await blobToDataUrl(thumbBlob);
}

/**
 * Stitch multiple screenshot slices into one tall image, accounting for overlap.
 * Each slice is an object with at least { dataUrl }.
 * Slices may also have a `y` property indicating their vertical offset;
 * if absent, slices are stacked sequentially with the given overlap subtracted.
 * @param {Array<{dataUrl: string, y?: number}>} images
 * @param {number} [overlapPx=200] - pixels of overlap between consecutive slices
 * @returns {Promise<string|null>} combined data URL, or null on empty input
 */
export async function stitchSlicesToDataUrl(images, overlapPx = 200) {
  if (!images || !images.length) return null;
  try {
    // Decode all slices once, reusing bitmaps for both measurement and drawing
    const slices = [];
    for (const img of images) {
      const bmp = await dataUrlToBitmap(img.dataUrl);
      slices.push({ bmp, y: img.y, width: bmp.width, height: bmp.height });
    }

    const canvasWidth = Math.max(...slices.map(s => s.width));

    const yPositions = [];
    let currentY = 0;
    for (let i = 0; i < slices.length; i++) {
      if (typeof slices[i].y === 'number') {
        yPositions.push(slices[i].y);
      } else {
        yPositions.push(currentY);
      }
      const overlap = i === 0 ? 0 : overlapPx;
      currentY = yPositions[i] + slices[i].height - overlap;
    }

    const totalHeight = Math.max(
      ...slices.map((s, i) => yPositions[i] + s.height)
    );

    const canvas = new OffscreenCanvas(canvasWidth, totalHeight);
    const ctx = canvas.getContext('2d');

    for (let i = 0; i < slices.length; i++) {
      ctx.drawImage(slices[i].bmp, 0, yPositions[i]);
      slices[i].bmp.close && slices[i].bmp.close();
    }

    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return await blobToDataUrl(blob);
  } catch (e) {
    console.warn('Stitch failed, falling back to first slice:', e?.message || e);
    return images[0].dataUrl || null;
  }
}
