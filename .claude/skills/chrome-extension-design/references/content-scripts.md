# Content Scripts: Injecting UI Without Everything Breaking

Read this whenever the extension injects UI into a page it doesn't own. This is where extensions most often look broken — not because the design is bad, but because the host page's CSS mangles the injected elements.

## The core problem

Content scripts run in the page's DOM. That means:

1. **Your CSS leaks into the page.** A rule like `button { background: blue; }` will restyle every button on the host site.
2. **The page's CSS leaks into your UI.** The host might have `* { font-family: "Comic Sans"; }` or `div { box-sizing: content-box; }` or `button { all: unset; }`. Your carefully styled overlay inherits all of it.
3. **`z-index` wars.** Some sites use `z-index: 2147483647` (the max) on their own overlays. You need to beat it.
4. **Layout interference.** Inserting a `<div>` into the page can trigger reflows, push content around, or land inside a `position: relative` ancestor that traps it.

## The solution: Shadow DOM

Always inject into a shadow DOM. This is the single most important technique in this file.

```js
// content.js

// 1. Create a host element and attach it to the page
const host = document.createElement('div');
host.id = 'my-extension-root';
// Reset everything the host page might have applied
host.style.cssText = `
  all: initial;
  position: fixed;
  top: 0;
  right: 0;
  z-index: 2147483647;
`;
document.documentElement.appendChild(host);

// 2. Attach a shadow root — this isolates CSS in both directions
const shadow = host.attachShadow({ mode: 'open' });

// 3. Load your styles into the shadow root
const styleSheet = document.createElement('link');
styleSheet.rel = 'stylesheet';
styleSheet.href = chrome.runtime.getURL('content/overlay.css');
shadow.appendChild(styleSheet);

// 4. Build your UI inside the shadow root
const container = document.createElement('div');
container.className = 'overlay';
container.innerHTML = `
  <div class="overlay__header">
    <h2>My Extension</h2>
    <button class="overlay__close" aria-label="Close">×</button>
  </div>
  <div class="overlay__body">
    <!-- content -->
  </div>
`;
shadow.appendChild(container);

// 5. Wire up events
shadow.querySelector('.overlay__close').addEventListener('click', () => {
  host.remove();
});
```

Why each piece matters:

- **`all: initial` on the host**: wipes any inherited styles from the host page (font, color, etc.). The shadow root then re-establishes its own baseline.
- **`position: fixed` on the host**: prevents the page's layout from pushing your overlay around.
- **`z-index: 2147483647`**: maximum int, beats everything. If the page uses `position: fixed` with a stacking context that traps you, you may also need to append to `document.documentElement` (not `document.body`) to escape it.
- **Shadow DOM with `mode: 'open'`**: CSS inside the shadow doesn't leak out; CSS outside doesn't leak in. This is the whole ballgame.
- **`chrome.runtime.getURL`** for stylesheets: content scripts run in the page's origin, so relative paths don't work. You must use the extension URL.

## manifest.json for content scripts

```json
{
  "content_scripts": [
    {
      "matches": ["https://*.example.com/*"],
      "js": ["content/content.js"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["content/overlay.css", "icons/*"],
      "matches": ["https://*.example.com/*"]
    }
  ]
}
```

Key points:

- **Don't use `"css"` in the content script declaration** if you're using shadow DOM. That injects styles into the page's main DOM, which is exactly what you're trying to avoid. Load CSS via `chrome.runtime.getURL` into the shadow root instead.
- **`web_accessible_resources` is required** for any file the content script loads by URL (stylesheets, images, fonts). Without it, Chrome blocks the request.
- **`run_at: "document_idle"`** is the default and usually right. Use `"document_start"` only if you need to intercept page load.
- **Match patterns matter.** `<all_urls>` is a red flag at install time. Be as specific as possible.

## Writing the overlay CSS

Inside the shadow root, you can (and should) use the same design tokens from `popup-ui.md`. Copy the `:root` block into the overlay stylesheet — shadow roots support custom properties normally.

```css
/* content/overlay.css */
:host {
  /* CSS variables defined here are scoped to the shadow root */
  --bg: #ffffff;
  --text: #1f2933;
  --border: #e4e7eb;
  --accent: #3b5bdb;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  /* ...rest of tokens */
}

@media (prefers-color-scheme: dark) {
  :host { /* dark overrides */ }
}

.overlay {
  width: 360px;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  font-size: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(15, 23, 42, 0.15);
  overflow: hidden;
}

.overlay__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.overlay__header h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.overlay__close {
  border: none;
  background: transparent;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  color: var(--text);
  padding: 4px 8px;
  border-radius: 4px;
}
.overlay__close:hover { background: rgba(0, 0, 0, 0.05); }

.overlay__body {
  padding: 16px;
  max-height: 400px;
  overflow-y: auto;
}
```

`:host` inside a shadow root refers to the host element itself. You can use it for the variable definitions and for styling the host from within the shadow.

## Positioning patterns

**Bottom-right toast / floating panel:**
```js
host.style.cssText = `
  all: initial;
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 2147483647;
`;
```

**Full-page modal backdrop:**
```js
host.style.cssText = `
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483647;
`;
// Then inside the shadow, center the modal with flex
```

**Anchored to a specific element on the page** (e.g., a tooltip next to a selected word):
```js
const rect = targetElement.getBoundingClientRect();
host.style.cssText = `
  all: initial;
  position: fixed;
  top: ${rect.bottom + 8}px;
  left: ${rect.left}px;
  z-index: 2147483647;
`;
// Re-position on scroll/resize if it needs to track
```

For tooltips and popovers, consider using `@floating-ui/dom` (bundled) for collision detection — it handles flipping the popover when it would go off-screen.

## Avoiding duplicate injections

Content scripts re-run on navigation in single-page apps. Guard against double-injection:

```js
if (document.getElementById('my-extension-root')) {
  // already injected, bail
} else {
  // inject
}
```

Or on SPA route changes, listen for history events and re-inject as needed.

## Communicating with the popup / background

Content scripts can't directly access `chrome.storage.sync` the same way the popup does in all cases (they can, but the flow matters). A clean pattern:

```js
// In content.js
chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
  applySettings(settings);
});

// In background/service-worker.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_SETTINGS') {
    chrome.storage.sync.get(['theme', 'enabled'], sendResponse);
    return true; // keep the message channel open for async response
  }
});
```

## The checklist before calling a content script "done"

- [ ] Uses shadow DOM
- [ ] Host element has `all: initial` and `position: fixed`
- [ ] Z-index is 2147483647 (or at least high enough to beat the target site)
- [ ] Dark mode works via `prefers-color-scheme` inside the shadow
- [ ] Close / dismiss works
- [ ] Doesn't re-inject on SPA navigation
- [ ] Doesn't break on pages with aggressive CSP (some extensions can't load external stylesheets — if CSP blocks `chrome.runtime.getURL` for CSS, inline the CSS into a `<style>` element inside the shadow)
- [ ] Tested on at least one site with heavy global CSS (GitHub, Gmail, Notion are good stress tests)
