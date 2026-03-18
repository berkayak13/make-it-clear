async function loadScreens() {
  const { lastScreenshots = [], lastScreenshotMeta = null } = await chrome.storage.local.get(['lastScreenshots','lastScreenshotMeta']);
  const gallery = document.getElementById('gallery');
  gallery.innerHTML = '';
  if (!lastScreenshots.length) {
    const div = document.createElement('div');
    div.className = 'sv-empty';
    div.textContent = 'No screenshots yet. Run a capture from the popup.';
    gallery.appendChild(div);
    return;
  }
  // Store meta for stitch button availability
  window.__svMeta = lastScreenshotMeta;
  lastScreenshots.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'sv-card';
    card.innerHTML = `
      <header>
        <div class="sv-meta">Slice #${idx + 1} @ y=${item.y}</div>
        <a download="slice-${String(idx+1).padStart(2,'0')}.png" href="${item.dataUrl}" class="sv-btn" style="text-decoration:none;padding:4px 8px;border-radius:6px;background:#4c51bf;color:#fff;">Download</a>
      </header>
      <img class="sv-img" src="${item.dataUrl}" alt="screenshot slice ${idx+1}"/>
    `;
    gallery.appendChild(card);
  });
}

document.getElementById('refreshBtn').addEventListener('click', loadScreens);

document.getElementById('openTabHelp').addEventListener('click', () => {
  alert('Tip: Use the extension popup and click "Capture Full Page". The captured slices will show up here.');
});

async function stitchScreens() {
  const { lastScreenshots = [], lastScreenshotMeta = null } = await chrome.storage.local.get(['lastScreenshots','lastScreenshotMeta']);
  if (!lastScreenshots.length) return alert('No screenshots to stitch.');

  // Load images
  const imgs = await Promise.all(lastScreenshots.map(s => loadImage(s.dataUrl)));
  const first = imgs[0];
  const width = first.width;
  const overlapPx = Math.max(0, (lastScreenshotMeta?.overlapPx || 0) * (lastScreenshotMeta?.dpr || 1));
  const stepDevice = Math.max(1, ((lastScreenshotMeta?.clientHeight || Math.round(first.height)) - (lastScreenshotMeta?.overlapPx || 0)) * (lastScreenshotMeta?.dpr || 1));

  // Compute total height: top of last + its full height
  const topLast = stepDevice * (imgs.length - 1);
  const totalHeight = topLast + imgs[imgs.length - 1].height;

  // Draw onto canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d');

  imgs.forEach((img, idx) => {
    const dy = stepDevice * idx;
    if (idx === 0 || overlapPx === 0) {
      ctx.drawImage(img, 0, dy);
    } else {
      // Crop the top overlap from subsequent images
      const sy = Math.min(overlapPx, img.height - 1);
      const sh = img.height - sy;
      ctx.drawImage(img, 0, sy, img.width, sh, 0, dy, img.width, sh);
    }
  });

  const dataUrl = canvas.toDataURL('image/png');
  // Show preview and enable download
  const stitchedContainer = document.getElementById('stitchedContainer');
  const stitchedImg = document.getElementById('stitchedImg');
  const stitchedMeta = document.getElementById('stitchedMeta');
  const download = document.getElementById('downloadStitched');
  stitchedImg.src = dataUrl;
  stitchedContainer.style.display = '';
  stitchedMeta.textContent = `Stitched image: ${width}x${totalHeight}`;
  download.href = dataUrl;
  download.style.display = '';
  const ts = new Date();
  const pad = n => String(n).padStart(2,'0');
  download.download = `stitched-${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.png`;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

document.getElementById('stitchBtn').addEventListener('click', () => {
  stitchScreens().catch(err => alert('Stitch failed: ' + (err?.message || err)));
});

loadScreens();
