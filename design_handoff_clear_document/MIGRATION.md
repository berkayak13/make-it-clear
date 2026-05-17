# Migration map · current → Clear (Document direction)

A file-by-file mapping from what's in the current `OpenAI Renarration Assistant` extension to what replaces it in the **Clear / Document** redesign.

The goal is **incremental**, not big-bang. Land tokens first, then migrate one surface at a time. Old and new can coexist for one or two releases.

---

## Top-level

| Current | Action | Replacement / notes |
|---|---|---|
| `manifest.json` `name`: *"OpenAI Renarration Assistant"* | **Edit** | `"Clear"` |
| `manifest.json` `description` | **Edit** | `"On-page reading overlay. Adapt any webpage to your reading goal."` |
| `manifest.json` `action.default_popup` | **Keep, then retire** | Phase 1: popup becomes a 320×56 stub that toggles the overlay. Phase 2: drop the popup entirely; the browser-action button toggles via `chrome.action.onClicked`. |
| `manifest.json` `side_panel.default_path` | **Optional retire** | Open question — see README §"Open questions". |
| `manifest.json` `commands` | **Add** | `_execute_action` bound to `Ctrl+Shift+K` / `Cmd+Shift+K` for keyboard toggle. |
| `manifest.json` `web_accessible_resources` | **Add** | Self-hosted Geist + Newsreader font files under `/assets/fonts/`. |
| `icons/icon{16,48,128}.png` | **Replace** | Regenerate from the new "C" mark (Geist Mono Semibold, paper-on-ink rounded square). Until then, keep existing. |

---

## Styles

| Current | Action | Replacement |
|---|---|---|
| `tokens.css` | **Replace** | New tokens from `README.md` §"Design tokens". Keep the legacy `--color-*` token names for one release as **aliases** that point to the new tokens, so any unmigrated CSS keeps working. |
| `popup.css` | **Delete after Phase 2** | All popup chrome is gone; the new overlay supersedes it. |
| `sidepanel.css` | **Delete after Phase 2** | Same as popup. |
| `options.css` | **Replace** | Rewritten against new tokens. Structurally similar (sections + form rows) but the visual treatment shifts to the two-column list+editor layout from `pages.jsx → SettingsPage`. |
| `content.css` | **Refactor in place** | Strip the purple/blue gradient header (`background: linear-gradient(135deg, #667eea 0%, #764ba2 100%)`), the `shimmer` keyframes, and the `transform: scale(1.1)` hover on `.renarration-trigger`. Keep the split-panel layout primitives (`#renarration-split-panel`, `body.renarration-split-active`, `.split-drag-handle`) — only restyle. |
| `viewers/research-dashboard.css` | **Replace** | New layout per `pages.jsx → ResearchDashboard`. |
| `viewers/extracted-content.css` | **Replace** | New structured-view per `pages.jsx → ExtractedViewer`. |

---

## HTML pages

| Current | Action | Replacement |
|---|---|---|
| `popup.html` (full reading-goal chat) | **Phase 1: replace with stub** · **Phase 2: delete** | Phase-1 stub is just: `<button id="open">Open Clear on this tab</button>` that fires `OPEN_OVERLAY` and `window.close()`. |
| `sidepanel.html` | **Phase 1: replace with stub** · **Phase 2: delete or keep as alt surface** | Same shape as popup stub. If kept, render the same overlay React tree but full-height in the panel. |
| `options.html` | **Replace** | New markup based on `pages.jsx → SettingsPage`. Keep all the existing handlers and IDs from `options.js`. |
| `agents.html` · `docs/*.html` | **Keep** | Internal docs — orthogonal to the redesign. |
| `viewers/extracted-content.html` | **Replace** | Structured viewer per `pages.jsx → ExtractedViewer`. |
| `viewers/research-dashboard.html` | **Replace** | Per `pages.jsx → ResearchDashboard`. Tabs add an **Overview** tab in position 0 — current tabs slide right by one. |

---

## Content script

| Current | Action | Replacement |
|---|---|---|
| `content.js` — floating `R` trigger button | **Delete** | The trigger is gone; the overlay is always available. |
| `content.js` — selection-renarration popup (`#renarration-overlay`) | **Replace** | New `SelectionPopup` (see `in-context.jsx`). Pointer-triangle above selection, glass-strong, feedback + pin actions. |
| `content.js` — split-panel injection (`#renarration-split-panel`) | **Refactor** | Keep the injection mechanism + drag handle + body-width shift. Replace the header/body markup and styles. Newsreader font for the body copy. |
| `content.js` — progress text updates | **Keep** | The `renarration-progress-text` event flow stays the same; just style differently. |
| **(new)** `clear-overlay.js` | **Add** | The Document overlay itself, injected on `document_end`. Renders into a **Shadow DOM** root (`<div id="clear-root">` → `attachShadow({mode:'open'})`) to isolate from host-page CSS. Reads previous position from `chrome.storage.local`. Subscribes to background events. |

### Manifest update for content scripts

```json
"content_scripts": [{
  "matches": ["<all_urls>"],
  "js": ["content.js", "clear-overlay.js"],
  "css": ["content.css"],
  "run_at": "document_end"
}]
```

Or, if you'd rather inject `clear-overlay.js` lazily on first toggle, omit it from manifest and use `chrome.scripting.executeScript` from the background worker.

---

## Background / handlers

| Current | Action | Notes |
|---|---|---|
| `src/background/main.js` | **Keep** | No structural change. |
| `src/background/message-handler.js` | **Extend** | Add handlers for `OPEN_OVERLAY`, `CLOSE_OVERLAY`, `SET_OVERLAY_PINNED`, `SET_OVERLAY_POSITION`. |
| `src/handlers/chatbot.js` | **Keep** | Chat protocol unchanged. |
| `src/handlers/simple.js` | **Keep** | |
| `src/page-flow/extract-page.js` | **Keep** | Output shape is what the new Extracted-viewer renders. |
| `src/page-flow/renarrate-page.js` | **Keep** | |
| `src/page-flow/orchestrator.js` | **Keep** | Progress events flow into the overlay's Page-knowledge block in place. |
| `src/prompts/goal-extraction.md` | **Keep** | Existing schema (goal, depth, focus, style, notes) is exactly what the new UI surfaces. |
| `src/prompts/persona-extraction.md` | **Keep** | |
| `src/prompts/chatbot-system.md` · `system.md` | **Light edit** | Update any references to "OpenAI Renarration Assistant" → "Clear". The model still happens to be OpenAI; the brand isn't. |

---

## Utilities

| Current | Action | Notes |
|---|---|---|
| `src/utils/openai-client.js` | **Keep** | Implementation detail. |
| `src/utils/llm-dispatch.js` | **Keep** | |
| `src/utils/storage-helpers.js` | **Extend** | Add helpers for `clear.overlay.{position,pinned,collapsed}`. |
| `src/utils/firestore-client.js` | **Keep** | Research-logging path is unchanged. |
| `src/utils/renarration.js` · `cached-prompts.js` · `prompt-loader.js` · `id.js` | **Keep** | |

---

## Build / tooling

| Current | Action |
|---|---|
| `vite.config.js` | **Light edit** — add font asset copying if self-hosting Geist/Newsreader |
| `package.json` scripts | **Keep** |
| `knip.json` | **Update** — list new entrypoints (`clear-overlay.js`) and drop retired ones (`popup.js`, `sidepanel.js` after Phase 2) |

---

## Suggested phased rollout

### Phase 1 — Tokens + content surface (1–2 days)
- Replace `tokens.css` with new tokens (with backward-compat aliases)
- Refactor `content.css` to drop the purple/blue gradient and adopt the new glass + paper palette
- Rebuild the selection popup in `content.js`
- Restyle the split-renarration panel (no behavior change)
- **Visible result**: in-page surfaces look like Clear; popup/sidepanel still look old

### Phase 2 — Overlay (3–5 days)
- Add `clear-overlay.js` with Shadow DOM root
- Build the Document overlay layout, drag, pin/unpin, persist position
- Wire it to existing message handlers
- Replace `popup.html` and `sidepanel.html` with stubs that toggle the overlay
- **Visible result**: opening Clear shows the new overlay; reading-goal flow happens there

### Phase 3 — Full pages (2–3 days)
- Rebuild `options.html` against new tokens
- Rebuild `viewers/extracted-content.html` and `viewers/research-dashboard.html`
- **Visible result**: every surface is Clear

### Phase 4 — Cleanup (½ day)
- Delete `popup.html`, `popup.css`, `popup.js`, `sidepanel.html`, `sidepanel.css`, `sidepanel.js` if the alt-surface decision says retire
- Delete legacy `--color-*` token aliases from `tokens.css`
- Regenerate `icons/icon*.png` from the new mark
- Update `README.md` (rename, image assets, install instructions)

---

## What does NOT change

To be explicit, these are unchanged by the redesign:

- The data model in `chrome.storage`
- The reading-goal extraction schema
- The chatbot session protocol
- Research-logging events and Firestore schema
- The OpenAI client and vision/text dispatch
- Page-extraction logic
- The split-panel resize behavior

This is a **visual + UX** redesign, not a re-architecture.
