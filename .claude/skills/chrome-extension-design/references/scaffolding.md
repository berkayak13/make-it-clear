# Scaffolding a Chrome Extension (Manifest V3)

This reference covers project layout, manifest.json, and build setup. Read it when starting a new extension or when the user is lost on file structure.

## Recommended flat layout (buildless)

For most extensions, this is the right starting point:

```
my-extension/
├── manifest.json
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── options/          (only if needed)
│   ├── options.html
│   ├── options.css
│   └── options.js
├── content/          (only if injecting into pages)
│   ├── content.js
│   └── content.css
├── background/       (only if needed)
│   └── service-worker.js
├── styles/
│   └── tokens.css    (shared design tokens)
└── icons/
    ├── icon-16.png
    ├── icon-32.png
    ├── icon-48.png
    └── icon-128.png
```

Don't create `options/`, `content/`, or `background/` unless the extension actually uses them. An empty options page is a tell that the extension is unfinished.

## Minimal manifest.json

```json
{
  "manifest_version": 3,
  "name": "My Extension",
  "version": "0.1.0",
  "description": "One sentence describing what this does.",
  "icons": {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png"
    },
    "default_title": "My Extension"
  }
}
```

Add fields only as needed:

- `"permissions": ["storage"]` — for `chrome.storage` (almost always wanted)
- `"permissions": ["activeTab"]` — for reading the current tab on click
- `"host_permissions": ["https://*.example.com/*"]` — for content scripts or fetches to specific domains
- `"content_scripts": [{...}]` — see content-scripts.md
- `"background": {"service_worker": "background/service-worker.js"}` — for background logic
- `"side_panel": {"default_path": "sidepanel/sidepanel.html"}` — for the side panel API (Chrome 114+)
- `"options_page": "options/options.html"` — full-tab options (preferred over `options_ui` for more room)

Keep permissions minimal. Every extra permission is a warning dialog at install time and an audit-review problem later.

## MV3 gotchas to mention to the user

1. **Service workers are ephemeral.** Background scripts in MV3 are service workers that sleep when idle. Don't store state in module-level variables — use `chrome.storage`.
2. **No remote code.** MV3 forbids loading JS from a URL. No CDN scripts. Everything ships in the package.
3. **CSP is strict.** Inline `<script>` in popup.html won't run. Put all JS in external files and reference them with `<script src="popup.js"></script>`.
4. **`activeTab` is better than broad host permissions** when possible — it grants access only on user click and avoids the scary "read all your data on all websites" warning.

## Loading unpacked for development

Tell the user:

1. Open `chrome://extensions`
2. Toggle "Developer mode" (top right)
3. Click "Load unpacked" and select the extension folder
4. After changes: click the reload icon on the extension's card. For content script changes, also reload the host page.

## If the user wants a bundler (React/Vue/Svelte/TS)

The least painful path right now is **Vite + `@crxjs/vite-plugin`**:

```bash
npm create vite@latest my-extension -- --template react-ts
cd my-extension
npm install -D @crxjs/vite-plugin
```

Then in `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
});
```

CRXJS handles HMR for popup and content scripts, which is a significant quality-of-life improvement. `manifest.json` lives at the project root and references source files directly; CRXJS rewrites paths at build time.

Caveats:
- HMR for content scripts is flaky on some sites with strict CSP.
- Service workers still need to be self-contained — don't import huge dependency trees.
- Output goes to `dist/`; that's the folder the user loads unpacked.

Unless the user specifically needs a framework, the buildless layout at the top of this file is faster and easier.

## Version bumps and publishing

When the user is ready to publish:
- Bump `"version"` in manifest.json (Chrome Web Store requires monotonically increasing versions, format `major.minor.patch.build`).
- Zip the extension folder (not the parent folder — the zip should contain `manifest.json` at its root).
- Upload at https://chrome.google.com/webstore/devconsole.
- First submission requires a $5 one-time developer fee and can take days to review. Mention this if the user seems surprised.
