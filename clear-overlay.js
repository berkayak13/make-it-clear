// clear-overlay.js — Document overlay (Plan B), injected as content script.
// Renders into Shadow DOM to isolate from host-page CSS.

(function () {
  if (document.getElementById('clear-root')) return;

  const root = document.createElement('div');
  root.id = 'clear-root';
  root.style.all = 'initial';
  const shadow = root.attachShadow({ mode: 'open' });

  /* ── State ── */
  let overlayVisible = false;
  let collapsed = false;
  let posX = null;
  let posY = null;
  let goal = null;
  let extraction = null;
  let chatMessages = [];
  let chatSessionId = null;
  let revealTimer = null;
  let extractionInProgress = false;
  let extensionContextDead = false;

  function isStaleLocalExtraction(value) {
    return value?.model === 'local-fast-text';
  }

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
    return true;
  }

  function safeLocalSet(values) {
    if (!hasExtensionContext()) return Promise.resolve();
    try {
      return chrome.storage.local.set(values).catch((e) => {
        if (!markExtensionContextDead(e)) console.warn('[Clear] Storage write failed:', e?.message || e);
      });
    } catch (e) {
      if (!markExtensionContextDead(e)) console.warn('[Clear] Storage write failed:', e?.message || e);
      return Promise.resolve();
    }
  }

  function safeLocalGet(keys) {
    if (!hasExtensionContext()) return Promise.resolve({});
    try {
      return chrome.storage.local.get(keys).catch((e) => {
        markExtensionContextDead(e);
        return {};
      });
    } catch (e) {
      markExtensionContextDead(e);
      return Promise.resolve({});
    }
  }

  function safeSyncGet(keys) {
    if (!hasExtensionContext()) return Promise.resolve({});
    try {
      return chrome.storage.sync.get(keys).catch((e) => {
        markExtensionContextDead(e);
        return {};
      });
    } catch (e) {
      markExtensionContextDead(e);
      return Promise.resolve({});
    }
  }

  function safeSendMessage(message) {
    if (!hasExtensionContext()) return Promise.resolve(null);
    try {
      return chrome.runtime.sendMessage(message).catch((e) => {
        markExtensionContextDead(e);
        return null;
      });
    } catch (e) {
      markExtensionContextDead(e);
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

  /* ── Icons ── */
  const I = {
    grip: `<span class="ov-grip" data-drag="grip"><i></i><i></i><i></i><i></i><i></i><i></i></span>`,
    close: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="m3 3 6 6m0-6-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    send: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    sparkle: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5v3M7 9.5v3M1.5 7h3M9.5 7h3M3.5 3.5l2 2M8.5 8.5l2 2M3.5 10.5l2-2M8.5 5.5l2-2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
    check: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="m2.5 6.5 2.5 2.5 4.5-5.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    chevron: `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="m3 4 2 2 2-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  };

  /* ── Fonts (inject into shadow) ── */
  const fontBase = safeRuntimeUrl('assets/fonts/');
  const fontCSS = fontBase ? `
    @font-face { font-family:'Geist'; font-style:normal; font-weight:100 900; font-display:swap; src:url(${fontBase}geist-latin.woff2) format('woff2'); }
    @font-face { font-family:'Geist Mono'; font-style:normal; font-weight:100 900; font-display:swap; src:url(${fontBase}geist-mono-latin.woff2) format('woff2'); }
    @font-face { font-family:'Newsreader'; font-style:normal; font-weight:400; font-display:swap; src:url(${fontBase}newsreader-latin.woff2) format('woff2'); }
  ` : '';

  /* ── Styles ── */
  const styles = document.createElement('style');
  styles.textContent = fontCSS + `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    .ov-vars {
      --paper: oklch(0.985 0.005 250);
      --paper-2: oklch(0.97 0.006 250);
      --paper-3: oklch(0.94 0.008 248);
      --hairline: oklch(0.88 0.01 245);
      --hairline-soft: oklch(0.92 0.008 248);
      --muted: oklch(0.62 0.018 250);
      --muted-2: oklch(0.45 0.02 252);
      --ink-2: oklch(0.32 0.02 254);
      --ink: oklch(0.22 0.02 255);
      --accent: oklch(0.58 0.18 250);
      --accent-ink: oklch(0.42 0.15 250);
      --accent-soft: oklch(0.94 0.04 250);
      --pos: oklch(0.65 0.13 160);
      --neg: oklch(0.62 0.18 25);
      --glass-bg: color-mix(in oklch, var(--paper) 94%, transparent);
      --glass-border: color-mix(in oklch, var(--ink) 14%, transparent);
      --glass-highlight: color-mix(in oklch, white 70%, transparent);
      --shadow-glass: 0 1px 0 0 var(--glass-highlight) inset, 0 0 0 1px var(--glass-border), 0 1px 2px rgba(16,22,36,0.04), 0 8px 24px -4px rgba(16,22,36,0.10), 0 24px 64px -12px rgba(16,22,36,0.18);
      --font-sans: 'Geist','Inter Tight',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
      --font-mono: 'Geist Mono','JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
      --r-2: 10px; --r-3: 14px; --r-pill: 999px;
      --ease: cubic-bezier(0.2,0.7,0.3,1);
      font-family: var(--font-sans);
      color: var(--ink);
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    /* ── Panel ── */
    .ov-panel {
      position: fixed;
      width: 372px;
      height: min(680px, calc(100vh - 32px));
      max-height: calc(100vh - 32px);
      z-index: 2147483600;
      background: var(--glass-bg);
      backdrop-filter: blur(24px) saturate(140%);
      -webkit-backdrop-filter: blur(24px) saturate(140%);
      border-radius: 18px;
      box-shadow: var(--shadow-glass);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      animation: ov-in 220ms var(--ease) both;
    }
    .ov-panel.ov-hidden { display: none; }
    @keyframes ov-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }

    .ov-scroll { overflow-y: auto; flex: 1; overscroll-behavior: contain; }

    /* ── Collapsed pill ── */
    .ov-collapsed {
      position: fixed;
      z-index: 2147483600;
      width: 200px;
      padding: 10px 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      border-radius: 12px;
      background: var(--glass-bg);
      backdrop-filter: blur(24px) saturate(140%);
      -webkit-backdrop-filter: blur(24px) saturate(140%);
      box-shadow: var(--shadow-glass);
      cursor: pointer;
      animation: ov-in 220ms var(--ease) both;
    }
    .ov-collapsed.ov-hidden { display: none; }
    .ov-collapsed .ov-cmark {
      width: 28px; height: 28px; border-radius: 8px;
      background: var(--ink); color: var(--paper);
      display: flex; align-items: center; justify-content: center;
      font-family: var(--font-mono); font-size: 11px; font-weight: 600;
      flex-shrink: 0;
    }
    .ov-collapsed .ov-cinfo { flex: 1; }
    .ov-collapsed .ov-cinfo div:first-child { font-size: 12px; font-weight: 600; }
    .ov-collapsed .ov-cinfo div:last-child { font-family: var(--font-mono); font-size: 10px; color: var(--muted); text-transform: uppercase; }
    .ov-collapsed .ov-cchev { color: var(--muted); transform: rotate(-90deg); flex-shrink: 0; }

    /* ── Title bar ── */
    .ov-titlebar {
      display: flex; align-items: center; gap: 10px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--hairline-soft);
      flex-shrink: 0;
      cursor: default;
    }
    .ov-wordmark { font-weight: 600; font-size: 14px; letter-spacing: -0.02em; }
    .ov-breadcrumb { font-family: var(--font-mono); font-size: 10px; color: var(--muted); letter-spacing: 0.06em; text-transform: uppercase; }
    .ov-titlebar .spacer { flex: 1; }
    .ov-ibtn {
      background: transparent; border: 0; cursor: pointer; color: var(--muted);
      padding: 3px 6px; border-radius: 6px; display: inline-flex; align-items: center;
      transition: background 150ms var(--ease);
    }
    .ov-ibtn:hover { background: color-mix(in oklch, var(--ink) 6%, transparent); }

    /* ── Grip ── */
    .ov-grip {
      display: inline-grid; grid-template-columns: repeat(2,3px); grid-template-rows: repeat(3,3px);
      gap: 2px; cursor: grab; padding: 6px; margin: -6px; border-radius: 6px;
    }
    .ov-grip:hover { background: color-mix(in oklch, var(--ink) 6%, transparent); }
    .ov-grip > i { width:3px; height:3px; border-radius:999px; background:var(--muted); display:block; }

    /* ── Eyebrow ── */
    .ov-eye { font-family: var(--font-mono); font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }

    /* ── Hairline ── */
    .ov-hr { height: 1px; background: var(--hairline-soft); border: 0; }

    /* ── Goal block ── */
    .ov-goal { padding: 14px 16px 12px; }
    .ov-goal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .ov-goal-text { font-size: 13.5px; line-height: 1.5; margin-bottom: 10px; color: var(--ink); }
    .ov-goal-meta { display: flex; gap: 12px; font-size: 11.5px; color: var(--muted-2); }
    .ov-goal-meta b { color: var(--muted); font-weight: 400; }
    .ov-edit { background:transparent; border:0; cursor:pointer; font-family:var(--font-sans); font-size:11px; font-weight:500; color:var(--muted); padding:3px 8px; border-radius:6px; }
    .ov-edit:hover { background: color-mix(in oklch, var(--ink) 5%, transparent); }
    .ov-edit:disabled { opacity:0.55; cursor:default; }
    .ov-goal-empty { font-size: 12.5px; line-height: 1.5; color: var(--muted-2); font-style: italic; }

    /* ── Page knowledge ── */
    .ov-knowledge { padding: 14px 16px 12px; }
    .ov-knowledge-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .ov-head-actions { display: flex; align-items: center; gap: 4px; }
    .ov-knowledge-status { font-family: var(--font-mono); font-size: 10px; color: var(--muted); display: flex; align-items: center; gap: 4px; }
    .ov-knowledge-status svg { color: var(--pos); }
    .ov-knowledge-summary { font-size: 13px; line-height: 1.55; color: var(--ink-2); margin-bottom: 10px; }
    .ov-knowledge-points { display: flex; flex-direction: column; gap: 4px; }
    .ov-kp { display: flex; gap: 10px; padding: 4px 0; align-items: baseline; }
    .ov-kp-idx { font-family: var(--font-mono); font-size: 10px; color: var(--muted); min-width: 18px; }
    .ov-kp-text { font-size: 12.5px; line-height: 1.5; color: var(--ink-2); }
    .ov-knowledge-empty { font-size: 12.5px; color: var(--muted-2); font-style: italic; }
    .ov-knowledge-loading { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
    .ov-knowledge-loading .ov-minispin { width:14px; height:14px; border:2px solid var(--hairline); border-top-color:var(--accent); border-radius:50%; animation: ov-spin 0.8s linear infinite; }
    @keyframes ov-spin { to { transform: rotate(360deg); } }
    .ov-knowledge-error { font-size: 12px; color: var(--neg); }
    .ov-retry { background:transparent; border:0; cursor:pointer; font-family:var(--font-sans); font-size:11px; font-weight:500; color:var(--accent); text-decoration:underline; margin-left:6px; }

    /* ── Conversation ── */
    .ov-chat { padding: 14px 16px 12px; display: flex; flex-direction: column; gap: 8px; }
    .ov-chat-empty { font-size: 12px; color: var(--muted-2); font-style: italic; }
    .ov-msg-user {
      align-self: flex-end; max-width: 88%;
      background: var(--ink); color: var(--paper);
      padding: 7px 11px; border-radius: 12px 12px 4px 12px;
      font-size: 12.5px; line-height: 1.45;
      animation: ov-msg-in 180ms var(--ease) both;
    }
    .ov-msg-model {
      align-self: flex-start; max-width: 92%;
      font-size: 12.5px; line-height: 1.5; color: var(--ink-2);
      animation: ov-msg-in 180ms var(--ease) both;
      white-space: pre-wrap;
    }
    @keyframes ov-msg-in { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
    .ov-chat-older { font-size: 11px; color: var(--accent); cursor: pointer; background: transparent; border: 0; font-family: var(--font-sans); font-weight: 500; padding: 2px 0; }
    .ov-chat-older:hover { text-decoration: underline; }

    /* ── Footer input ── */
    .ov-footer {
      padding: 10px 12px 12px;
      background: color-mix(in oklch, var(--paper-2) 60%, transparent);
      border-top: 1px solid var(--hairline-soft);
      flex-shrink: 0;
    }
    .ov-input-row { display: flex; gap: 6px; margin-bottom: 8px; }
    .ov-input {
      flex: 1; font-family: var(--font-sans); font-size: 12.5px;
      border: 1px solid var(--hairline); background: var(--paper);
      border-radius: var(--r-2); padding: 8px 10px; color: var(--ink);
      transition: border 150ms var(--ease), box-shadow 150ms var(--ease);
    }
    .ov-input:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px color-mix(in oklch, var(--accent) 18%, transparent); }
    .ov-send {
      background: color-mix(in oklch, var(--ink) 4%, transparent);
      border: 0; cursor: pointer; padding: 7px 10px; border-radius: var(--r-2);
      color: var(--ink); display: flex; align-items: center;
      transition: background 150ms var(--ease);
    }
    .ov-send:hover { background: color-mix(in oklch, var(--ink) 8%, transparent); }
    .ov-cta {
      width: 100%; font-family: var(--font-sans); font-size: 13px; font-weight: 500;
      background: var(--ink); color: var(--paper); border: 0; border-radius: var(--r-2);
      padding: 8px 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
      transition: background 150ms var(--ease);
    }
    .ov-cta:hover { background: var(--ink-2); }

    @media (prefers-reduced-motion: reduce) {
      .ov-panel, .ov-collapsed, .ov-msg-user, .ov-msg-model { animation-duration: 0ms; }
    }
  `;
  shadow.appendChild(styles);

  /* ── Build DOM ── */
  const wrapper = document.createElement('div');
  wrapper.className = 'ov-vars';
  shadow.appendChild(wrapper);

  // Collapsed pill
  const collapsedEl = document.createElement('div');
  collapsedEl.className = 'ov-collapsed ov-hidden';
  collapsedEl.innerHTML = `
    <div class="ov-cmark">C</div>
    <div class="ov-cinfo">
      <div>3 insights ready</div>
      <div>TAP TO EXPAND</div>
    </div>
    <span class="ov-cchev">${I.chevron}</span>
  `;
  wrapper.appendChild(collapsedEl);

  // Expanded panel
  const panel = document.createElement('div');
  panel.className = 'ov-panel ov-hidden';
  panel.innerHTML = `
    <div class="ov-titlebar">
      ${I.grip}
      <div style="display:flex;align-items:baseline;gap:8px;flex:1">
        <span class="ov-wordmark">Clear</span>
        <span class="ov-breadcrumb" id="ov-breadcrumb">READING · ${location.hostname}</span>
      </div>
      <button class="ov-ibtn" id="ov-close-btn" title="Close">${I.close}</button>
    </div>
    <div class="ov-scroll">
      <div class="ov-goal" id="ov-goal-block">
        <div class="ov-goal-head">
          <span class="ov-eye">Reading goal</span>
          <div class="ov-head-actions">
            <button class="ov-edit" id="ov-set-goal">Set reading goal</button>
            <button class="ov-edit" id="ov-edit-goal">Edit</button>
          </div>
        </div>
        <div class="ov-goal-empty" id="ov-goal-content">No reading goal set. Start a conversation below to set one.</div>
        <div class="ov-goal-meta" id="ov-goal-meta" style="display:none"></div>
      </div>
      <hr class="ov-hr"/>
      <div class="ov-knowledge" id="ov-knowledge-block">
        <div class="ov-knowledge-head">
          <span class="ov-eye">Page knowledge</span>
          <div class="ov-head-actions">
            <span class="ov-knowledge-status" id="ov-knowledge-status"></span>
            <button class="ov-edit" id="ov-view-extraction">View</button>
            <button class="ov-edit" id="ov-extract-page">Extract page</button>
          </div>
        </div>
        <div id="ov-knowledge-content">
          <div class="ov-knowledge-empty">Not extracted yet. Click "Renarrate this page" to extract.</div>
        </div>
      </div>
      <hr class="ov-hr"/>
      <div class="ov-chat" id="ov-chat">
        <span class="ov-eye">Conversation</span>
        <div class="ov-chat-empty" id="ov-chat-empty">Ask anything about this page.</div>
      </div>
    </div>
    <div class="ov-footer">
      <div class="ov-input-row">
        <input class="ov-input" id="ov-input" placeholder="Ask about this page…"/>
        <button class="ov-send" id="ov-send">${I.send}</button>
      </div>
      <button class="ov-cta" id="ov-cta">${I.sparkle} Renarrate this page</button>
    </div>
  `;
  wrapper.appendChild(panel);

  /* ── Position ── */
  async function loadPosition() {
    try {
      const data = await safeLocalGet(['clear.overlay.position', 'clear.overlay.collapsed', 'clear.overlay.visible']);
      if (data['clear.overlay.position']) {
        posX = data['clear.overlay.position'].x;
        posY = data['clear.overlay.position'].y;
      }
      collapsed = !!data['clear.overlay.collapsed'];
      overlayVisible = !!data['clear.overlay.visible'];
    } catch {}
    if (posX === null) { posX = window.innerWidth - 372 - 24; posY = 80; }
    clampPosition();
    applyPosition();
  }

  function clampPosition() {
    posX = Math.max(8, Math.min(posX, window.innerWidth - 200));
    posY = Math.max(8, Math.min(posY, window.innerHeight - 52));
  }

  function applyPosition() {
    panel.style.left = posX + 'px';
    panel.style.top = posY + 'px';
    collapsedEl.style.left = posX + 'px';
    collapsedEl.style.top = posY + 'px';
  }

  function savePosition() {
    safeLocalSet({ 'clear.overlay.position': { x: posX, y: posY } });
  }

  /* ── Drag ── */
  function setupDrag() {
    const grip = shadow.querySelector('[data-drag="grip"]');
    if (!grip) return;
    let startX, startY, origX, origY;

    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      startX = e.clientX; startY = e.clientY;
      origX = posX; origY = posY;
      grip.style.cursor = 'grabbing';

      const onMove = (ev) => {
        posX = origX + (ev.clientX - startX);
        posY = origY + (ev.clientY - startY);
        clampPosition();
        applyPosition();
      };
      const onUp = () => {
        grip.style.cursor = '';
        grip.removeEventListener('pointermove', onMove);
        grip.removeEventListener('pointerup', onUp);
        savePosition();
      };
      grip.addEventListener('pointermove', onMove);
      grip.addEventListener('pointerup', onUp);
    });
  }

  /* ── Show/hide ── */
  function show() {
    overlayVisible = true;
    safeLocalSet({ 'clear.overlay.visible': true });
    if (collapsed) {
      panel.classList.add('ov-hidden');
      collapsedEl.classList.remove('ov-hidden');
    } else {
      panel.classList.remove('ov-hidden');
      collapsedEl.classList.add('ov-hidden');
    }
    applyPosition();
    setTimeout(() => {
      try {
        ensureExtractionForPage();
      } catch (e) {
        if (!isExtensionContextError(e)) console.warn('[Clear] Auto extraction failed:', e?.message || e);
      }
    }, 0);
  }

  function hide() {
    overlayVisible = false;
    panel.classList.add('ov-hidden');
    collapsedEl.classList.add('ov-hidden');
    safeLocalSet({ 'clear.overlay.visible': false });
  }

  function toggleCollapse() {
    collapsed = !collapsed;
    overlayVisible = true;
    safeLocalSet({ 'clear.overlay.collapsed': collapsed, 'clear.overlay.visible': true });
    if (collapsed) {
      panel.classList.add('ov-hidden');
      collapsedEl.classList.remove('ov-hidden');
    } else {
      panel.classList.remove('ov-hidden');
      collapsedEl.classList.add('ov-hidden');
    }
  }

  /* ── Goal rendering ── */
  function renderGoal() {
    const contentEl = shadow.getElementById('ov-goal-content');
    const metaEl = shadow.getElementById('ov-goal-meta');
    if (!goal || !goal.readingGoal) {
      contentEl.className = 'ov-goal-empty';
      contentEl.textContent = 'No reading goal set. Start a conversation below to set one.';
      metaEl.style.display = 'none';
      return;
    }
    contentEl.className = 'ov-goal-text';
    contentEl.textContent = goal.readingGoal;
    metaEl.style.display = 'flex';
    metaEl.innerHTML = `
      <span><b>Depth</b> · ${esc(goal.desiredDepth || '—')}</span>
      <span><b>Style</b> · ${esc(goal.outputStyle || '—')}</span>
      <span><b>Focus</b> · ${esc((goal.focusAreas || []).join(', ') || '—')}</span>
    `;
  }

  /* ── Knowledge rendering ── */
  function renderKnowledge(state) {
    const statusEl = shadow.getElementById('ov-knowledge-status');
    const contentEl = shadow.getElementById('ov-knowledge-content');

    if (state === 'loading') {
      statusEl.innerHTML = '';
      contentEl.innerHTML = `<div class="ov-knowledge-loading"><div class="ov-minispin"></div>Extracting page…</div>`;
      return;
    }
    if (state === 'error') {
      statusEl.innerHTML = '';
      contentEl.innerHTML = `<div class="ov-knowledge-error">Extraction failed<button class="ov-retry" id="ov-retry">Retry</button></div>`;
      shadow.getElementById('ov-retry')?.addEventListener('click', triggerExtraction);
      return;
    }
    if (!extraction || !extraction.compactText) {
      statusEl.innerHTML = '';
      contentEl.innerHTML = `<div class="ov-knowledge-empty">Not extracted yet. Click "Renarrate this page" to extract.</div>`;
      return;
    }
    statusEl.innerHTML = `${I.check}<span style="color:var(--muted)">EXTRACTED</span>`;
    const text = extraction.compactText || '';
    const lines = text.split('\n').filter(l => l.trim());
    const summary = lines.slice(0, 2).join(' ');
    const points = lines.slice(2, 5);
    contentEl.innerHTML = `
      <div class="ov-knowledge-summary">${esc(summary)}</div>
      <div class="ov-knowledge-points">
        ${points.map((p, i) => `<div class="ov-kp"><span class="ov-kp-idx">${String(i + 1).padStart(2, '0')}</span><span class="ov-kp-text">${esc(p)}</span></div>`).join('')}
      </div>
    `;
  }

  /* ── Chat rendering ── */
  function normalizeAssistantMessage(content) {
    return String(content || '')
      .split('\n')
      .filter(line => !line.trim().startsWith('>> '))
      .join('\n')
      .trim();
  }

  function revealWords(el, text, onDone) {
    if (revealTimer) {
      clearInterval(revealTimer);
      revealTimer = null;
    }
    const chunks = String(text || '').match(/\S+\s*/g) || [];
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (!chunks.length || reduceMotion) {
      el.textContent = text || '';
      onDone?.();
      return;
    }
    el.textContent = '';
    let index = 0;
    revealTimer = setInterval(() => {
      el.textContent += chunks[index];
      index += 1;
      if (index >= chunks.length) {
        clearInterval(revealTimer);
        revealTimer = null;
        onDone?.();
      }
    }, 35);
  }

  function appendChatMessage(chatEl, message, { animate = false } = {}) {
    const div = document.createElement('div');
    div.className = message.role === 'user' ? 'ov-msg-user' : 'ov-msg-model';

    if (message.role === 'user') {
      div.textContent = message.content;
      chatEl.appendChild(div);
      return;
    }

    const text = normalizeAssistantMessage(message.content);
    chatEl.appendChild(div);
    if (animate) {
      revealWords(div, text);
    } else {
      div.textContent = text;
    }
  }

  function renderChat({ animateLastModel = false } = {}) {
    const chatEl = shadow.getElementById('ov-chat');
    const emptyEl = shadow.getElementById('ov-chat-empty');
    // Remove old messages (keep eyebrow and empty)
    chatEl.querySelectorAll('.ov-msg-user, .ov-msg-model, .ov-chat-older').forEach(el => el.remove());

    if (!chatMessages.length) {
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    const visible = chatMessages.slice(-4);
    const hidden = chatMessages.length - visible.length;
    if (hidden > 0) {
      const link = document.createElement('button');
      link.className = 'ov-chat-older';
      link.textContent = `Show ${hidden} earlier message${hidden > 1 ? 's' : ''}`;
      link.addEventListener('click', () => {
        chatEl.querySelectorAll('.ov-msg-user, .ov-msg-model, .ov-chat-older').forEach(el => el.remove());
        chatMessages.forEach(m => appendChatMessage(chatEl, m));
        chatEl.scrollTop = chatEl.scrollHeight;
      });
      chatEl.appendChild(link);
    }
    visible.forEach(m => {
      appendChatMessage(chatEl, m, {
        animate: animateLastModel && m === chatMessages[chatMessages.length - 1] && m.role !== 'user',
      });
    });
  }

  /* ── Actions ── */
  async function sendChatMessage() {
    const input = shadow.getElementById('ov-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    if (!chatSessionId) {
      try {
        const res = await safeSendMessage({ action: 'chatbot-new-session' });
        if (res?.success) chatSessionId = res.sessionId;
      } catch {}
    }
    if (!chatSessionId) return;

    chatMessages.push({ role: 'user', content: text });
    renderChat();

    try {
      const res = await safeSendMessage({ action: 'chatbot-send', sessionId: chatSessionId, message: text });
      if (res?.success && res.reply) {
        chatMessages.push({ role: 'model', content: res.reply });
        renderChat({ animateLastModel: true });
      }
    } catch {}
  }

  async function setReadingGoalFromChat() {
    const btn = shadow.getElementById('ov-set-goal');
    const previousText = btn?.textContent || 'Set reading goal';
    try {
      if (!chatSessionId || !chatMessages.length) {
        const input = shadow.getElementById('ov-input');
        input.placeholder = 'Tell Clear what you need first...';
        input.focus();
        return;
      }
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Setting...';
      }
      const res = await safeSendMessage({ action: 'chatbot-set-reading-goal', sessionId: chatSessionId });
      if (res?.success && res.goal) {
        goal = res.goal;
        renderGoal();
        chatMessages.push({ role: 'model', content: 'Reading goal set. You can extract the page or renarrate it now.' });
        renderChat({ animateLastModel: true });
      } else {
        throw new Error(res?.error || 'Could not set reading goal.');
      }
    } catch (e) {
      chatMessages.push({ role: 'model', content: e?.message || 'Could not set reading goal.' });
      renderChat({ animateLastModel: true });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = previousText;
      }
    }
  }

  async function triggerExtraction() {
    if (extractionInProgress) return null;
    extractionInProgress = true;
    renderKnowledge('loading');
    try {
      const res = await safeSendMessage({
        action: 'extract-page-knowledge',
        pageMetadata: { url: location.href, title: document.title },
      });
      if (!res?.success || !res.extraction) {
        throw new Error(res?.error || 'Could not extract this page.');
      }
      extraction = res.extraction;
      renderKnowledge();
      return extraction;
    } catch (e) {
      console.warn('[Clear] Page extraction failed:', e?.message || e);
      renderKnowledge('error');
      return null;
    } finally {
      extractionInProgress = false;
    }
  }

  function ensureExtractionForPage() {
    if (extractionInProgress) return;
    if (extraction?.compactText && extraction.url === location.href && !isStaleLocalExtraction(extraction)) return;
    triggerExtraction();
  }

  async function openExtractionViewer() {
    try {
      await safeSendMessage({ action: 'open-extracted-content-viewer' });
    } catch (e) {
      console.warn('[Clear] Could not open extracted page viewer:', e?.message || e);
    }
  }

  async function triggerRenarration() {
    try {
      const pageExtraction = extraction || await triggerExtraction();
      if (!pageExtraction) return;
      const res = await safeSendMessage({
        action: 'run-page-renarration-from-extraction',
        pageMetadata: { url: location.href, title: document.title },
      });
      if (res?.success === false) throw new Error(res.error || 'Could not renarrate this page.');
    } catch {}
  }

  /* ── Event wiring ── */
  function wireEvents() {
    shadow.getElementById('ov-close-btn').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hide();
    });
    shadow.getElementById('ov-send').addEventListener('click', sendChatMessage);
    shadow.getElementById('ov-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
    });
    shadow.getElementById('ov-cta').addEventListener('click', triggerRenarration);
    shadow.getElementById('ov-set-goal').addEventListener('click', setReadingGoalFromChat);
    shadow.getElementById('ov-extract-page').addEventListener('click', triggerExtraction);
    shadow.getElementById('ov-view-extraction').addEventListener('click', openExtractionViewer);
    shadow.getElementById('ov-edit-goal').addEventListener('click', () => {
      const input = shadow.getElementById('ov-input');
      input.value = 'I want to change my reading goal. ';
      input.focus();
    });
    collapsedEl.addEventListener('click', toggleCollapse);
    setupDrag();
  }

  /* ── Message handler — toggle from popup/background ── */
  if (hasExtensionContext()) {
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'OPEN_OVERLAY') {
          if (overlayVisible && !collapsed) { hide(); }
          else { collapsed = false; show(); }
        }
        if (msg.action === 'SHOW_OVERLAY') {
          collapsed = false;
          show();
        }
        if (msg.action === 'CLOSE_OVERLAY') hide();
        if (msg.action === 'extraction-progress' && msg.text) {
          renderKnowledge('loading');
        }
        if (msg.action === 'extraction-update') {
          if (msg.status === 'done' && msg.extraction) {
            extraction = msg.extraction;
            renderKnowledge();
          } else if (msg.status === 'failed') {
            renderKnowledge('error');
          }
        }
        return false;
      });
    } catch (e) {
      markExtensionContextDead(e);
    }
  }

  if (hasExtensionContext()) {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync' || !changes.readingGoal) return;
        goal = changes.readingGoal.newValue || null;
        renderGoal();
      });
    } catch (e) {
      if (!markExtensionContextDead(e)) {
        console.warn('[Clear] Could not listen for storage changes:', e?.message || e);
      }
    }
  }

  /* ── Load goal from storage ── */
  async function loadGoal() {
    try {
      const { readingGoal } = await safeSyncGet(['readingGoal']);
      if (readingGoal) { goal = readingGoal; renderGoal(); }
    } catch {}
  }

  /* ── Load existing extraction ── */
  async function loadExtraction() {
    try {
      const { lastExtraction } = await safeLocalGet(['lastExtraction']);
      if (
        lastExtraction &&
        lastExtraction.compactText &&
        lastExtraction.url === location.href &&
        !isStaleLocalExtraction(lastExtraction)
      ) {
        extraction = lastExtraction;
        renderKnowledge();
      }
    } catch {}
  }

  /* ── Load chat session ── */
  async function loadChat() {
    try {
      const { currentChatSessionId } = await safeLocalGet(['currentChatSessionId']);
      if (currentChatSessionId) {
        chatSessionId = currentChatSessionId;
        const res = await safeSendMessage({ action: 'chatbot-get-session', sessionId: currentChatSessionId });
        if (res?.success && res.session?.messages) {
          chatMessages = res.session.messages;
          renderChat();
        }
      }
    } catch {}
  }

  /* ── Init ── */
  async function init() {
    document.documentElement.appendChild(root);
    wireEvents();

    await Promise.all([loadPosition(), loadGoal(), loadExtraction(), loadChat()]);

    if (overlayVisible) show();
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  init();
})();
