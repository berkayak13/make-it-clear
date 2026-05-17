# Handoff · Clear — "Document" direction (Plan B)

## Overview

**Clear** is a redesign of the existing Chrome MV3 extension currently named "OpenAI Renarration Assistant". It replaces the legacy popup + side panel + in-page overlay with a single design language: a **draggable glass overlay** that floats on top of any webpage, lets the reader set a goal/persona/task, extracts page knowledge, and renarrates the page in a split view.

This handoff documents **Plan B — the "Document" direction**: a vertical reader-companion sidebar layout where the goal, the page knowledge, and the conversation are all visible at once.

This is the recommended direction for implementation because:

- All three reader inputs (goal, persona, task) live side-by-side with the extracted page knowledge → less navigation, lower cognitive load
- Maps cleanly onto the existing data model (`storage-helpers.js`, `goal-extraction.md`, `persona-extraction.md`)
- The vertical sidebar reuses well with the existing 50/50 split-renarration panel (`content.css`)
- Easiest to ship without throwing away the existing service-worker architecture

## About the design files

The files under `reference/` are **design references created in HTML+React**. They are prototypes showing the intended look and behavior — **not production code to copy directly**.

The task is to **recreate these designs inside the existing Chrome MV3 extension codebase** using its established patterns (vanilla JS, content scripts, MV3 service worker, the `tokens.css` system, the existing message-passing protocol). Do not rip and replace the architecture — replace the **rendering** layer surface by surface.

## Fidelity

**High-fidelity.** All colors, spacing, typography, and glass-blur values are final. Recreate them pixel-faithfully. The only liberties to take are technical: use the codebase's existing patterns (vanilla DOM, `chrome.runtime.sendMessage`, the existing storage keys) rather than React.

If the team would rather adopt a small render layer (e.g. `lit-html` or `preact`), that's a defensible call — the design has no strong opinion. The current codebase is vanilla DOM.

## Product identity

| Field | Value |
|---|---|
| Visible name | **Clear** |
| Tagline | *Read what matters* |
| Logo mark | The letter **C** in Geist Mono Semibold, color `--paper` on `--ink` square, radius 7–8px |
| Avoided | Any "OpenAI" wordmark in user-facing chrome — the model is an implementation detail, not the brand |

Update `manifest.json` `name` and `description` fields, the `<h1>` in every page, and the popup/sidepanel titles.

---

## Design tokens

Single source of truth — port these into `tokens.css` (replace or supplement the existing tokens).

```css
:root {
  /* Paper / slate */
  --paper:        oklch(0.985 0.005 250);
  --paper-2:      oklch(0.97  0.006 250);
  --paper-3:      oklch(0.94  0.008 248);
  --hairline:     oklch(0.88  0.01  245);
  --hairline-soft:oklch(0.92  0.008 248);
  --muted:        oklch(0.62  0.018 250);
  --muted-2:      oklch(0.45  0.02  252);
  --ink-2:        oklch(0.32  0.02  254);
  --ink:          oklch(0.22  0.02  255);

  /* Accent — exactly one */
  --accent:       oklch(0.58 0.18 250);   /* electric slate-blue */
  --accent-ink:   oklch(0.42 0.15 250);   /* hover / on-light text */
  --accent-soft:  oklch(0.94 0.04 250);   /* tinted backgrounds */

  /* Signals */
  --pos:          oklch(0.65 0.13 160);
  --warn:         oklch(0.78 0.15 75);
  --neg:          oklch(0.62 0.18 25);

  /* Glass */
  --glass-bg:         color-mix(in oklch, var(--paper) 70%, transparent);
  --glass-bg-strong:  color-mix(in oklch, var(--paper) 86%, transparent);
  --glass-border:     color-mix(in oklch, var(--ink) 14%, transparent);
  --glass-highlight:  color-mix(in oklch, white 70%, transparent);

  /* Shadow stack */
  --shadow-glass:
    0 1px 0 0 var(--glass-highlight) inset,
    0 0 0 1px var(--glass-border),
    0 1px 2px rgba(16, 22, 36, 0.04),
    0 8px 24px -4px rgba(16, 22, 36, 0.10),
    0 24px 64px -12px rgba(16, 22, 36, 0.18);

  /* Type */
  --font-sans: 'Geist', 'Inter Tight', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --font-mono: 'Geist Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  --font-read: 'Newsreader', 'Iowan Old Style', Charter, Georgia, serif;

  /* Radii */
  --r-1: 6px;  --r-2: 10px;  --r-3: 14px;  --r-4: 20px;  --r-pill: 999px;
}
```

**Glass recipe (do not deviate):**
```css
.clear-glass {
  background: var(--glass-bg);
  backdrop-filter: blur(24px) saturate(140%);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  border-radius: var(--r-3);
  box-shadow: var(--shadow-glass);
}
```

### Type roles — three fonts, three jobs

| Font | Use for | Examples |
|---|---|---|
| **Geist** (sans) | Everything UI — chrome, buttons, body of conversation | Headers, labels, message bubbles |
| **Geist Mono** | Metadata, eyebrows, technical readouts, status text | "READING · meridian.news", "EXTRACTED 12s", task names in chips |
| **Newsreader** (serif) | **Only** the renarrated body copy in the split panel | The actual rewritten article text |

Eyebrow style: `font-mono`, 10–11px, weight 500, letter-spacing 0.08em, uppercase, color `--muted`.

### Spacing

8pt-based. Common values: 4 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 22 · 28 · 32 · 36 · 48px.

---

## Surfaces — what to build

### A. Floating overlay (replaces `popup.html` + `sidepanel.html` + the legacy `#renarration-overlay`)

This is the heart of the product. Implement as a **content script** injected into every page, NOT as a Chrome popup. The browser-action toolbar button toggles its visibility; the side-panel API can stay enabled as an alternate surface.

**Layout — Document direction**

- Width: **372px**, height: auto (grows with content, capped at `100vh - 32px`)
- Position: `position: fixed`, initial `top: 80px`, `right: 24px`
- **Draggable**: drag handle is the 6-dot grip at top-left of the title bar. Persist position to `chrome.storage.local` under key `clear.overlay.position`. On load, clamp to viewport.
- **Always on top**: `z-index: 2147483600` (below the split-panel close button but above almost everything else)
- **Survives navigation**: re-injects on each `document_end`; reads its previous position from storage
- **Resting (collapsed) state**: a 200×52 card with `C` mark + "3 insights ready" + chevron. Tap to expand.

**Section stack inside the panel** (top to bottom):

1. **Title bar** — 44px tall
   - 6-dot drag grip (left)
   - Wordmark "Clear" (Geist, 14px, weight 600, letter-spacing -0.02em)
   - Mono breadcrumb "READING · {hostname}" (10px, muted)
   - Pin icon (toggles "stay open across tabs")
   - Close icon (×)

2. **Reading goal** block — padding 14px 16px 12px
   - Eyebrow "Reading goal" + "Edit" link on the right
   - Goal sentence in 13.5px Geist, line-height 1.5
   - One-line meta row: `Depth · skim`, `Style · academic`, `As · educator` (12px, muted-2)

3. **Hairline divider**

4. **Page knowledge** block
   - Eyebrow + status `✓ EXTRACTED 12s` (success-tinted check icon + mono timestamp)
   - 2-line summary paragraph
   - List of key points, each row: 2-digit mono index (`01`, `02`, …) + 12.5px point text

5. **Hairline divider**

6. **Conversation** — last 2–3 messages visible
   - User bubble: `background: var(--ink)`, `color: var(--paper)`, padding 7px 11px, radius `12px 12px 4px 12px`, max-width 88%, font-size 12.5px
   - Assistant bubble: no background, plain text in `--ink-2`, max-width 92%
   - Older messages collapse into a "Show 4 earlier messages" link

7. **Input row + primary action** — tinted footer (`background: color-mix(in oklch, var(--paper-2) 60%, transparent)`)
   - `<input>` + send button (ghost square)
   - Below: full-width primary button **"Renarrate this page"** with sparkle icon, `background: var(--ink)`, `color: var(--paper)`

**Behavior details**

- **Drag**: pointer events on the grip → drag the whole panel. Use `pointercapture`. Snap to within 8px of viewport edges. Persist on `pointerup`.
- **Pin** toggles a boolean `clear.overlay.pinned`. When pinned, the overlay is re-injected on every navigation. When unpinned, dismissing closes it for the tab only.
- **Close** dismisses for the tab; reopen via toolbar action.
- **Edit goal**: opens an inline expansion that turns the goal block into the editable form (the current `goal-extraction.md` shape: goal, depth, focus, style, notes).
- **Extract** runs automatically on first open per page. Show a `loading` shimmer over the Page-knowledge block. Errors render in a `--neg`-tinted strip with a "Retry" link.

### B. Selection mini-popup (replaces the floating `R` trigger in `content.js`)

- Appears above the user's text selection (`getBoundingClientRect()` of the range)
- 320px wide, glass-strong, radius 14px
- Pointer triangle pointing down to the selection
- Content order:
  1. Mono eyebrow: `RENARRATE SELECTION · {n} words` + active-lens chip on the right
  2. The renarrated text (Newsreader serif, 13.5px)
  3. Feedback row: `✓ Good` / `Off` (left), `Try again` / `+ Pin` (right)

Auto-fits above OR below the selection depending on viewport room. Disappears on click-outside or new selection.

### C. Split renarration view (refactor of `content.css` split panel)

- Right half slides in over 240ms ease-out-cubic
- Left half (original page) gets `opacity: 0.94` + a 1px hairline border on its right edge — **NO** purple gradient, no shimmer
- Right panel:
  - Header (paper, 1px hairline bottom): wordmark + mono "RENARRATED · {sec}s" + lens summary on a second line + actions on the right: `Original`, `Translate`, `×`
  - TOC strip below the header — chip row with active section in accent-soft, others in default chip style
  - Body: **Newsreader serif**, 16px, line-height 1.65, max-width 720px
  - "Why this matters" callout pattern: `background: color-mix(in oklch, var(--accent) 7%, transparent)`, 2px left border in `--accent`, radius `0 8px 8px 0`. Used **sparingly** to highlight the part of the page most relevant to the goal.
  - Footer rail (sticky): "3 of 4 sections · 4 min read remaining" + `Save thread` / `Ask follow-up`

### D. Settings page (replaces `options.html`)

Tabs along the top: **General · Tasks · Personas · System prompt · Research**. Active tab uses 6% ink background, weight 600.

Two-column layout: 300px list rail on the left (list of tasks/personas with name + 1-line description; active row has 6% ink background and a hairline border), and an editor pane on the right (~640px content max-width).

Editor pane sections:
- Eyebrow + title row with `Rename` / `Delete` / `Duplicate` actions
- Form fields with hairline-bordered inputs (no boxes around groups; rely on eyebrows for structure)
- A read-only "Effective prompt preview" rendered as a near-black mono block (`background: color-mix(in oklch, var(--ink) 96%, var(--accent))`, `color: var(--paper)`). `{persona}` and `{task}` interpolation tokens highlighted in `oklch(0.78 0.15 75)` (warm).
- Sticky bottom action row: `Save changes`, `Test on current page`, and a muted "Restore default" link on the right.

### E. Extracted-page-knowledge viewer (replaces `viewers/extracted-content.html`)

Move from a raw `<pre>` dump to a structured view.

- Header: eyebrow + h1 (page title) + meta row (host, mono read-time, mono word count, `Re-extract` / `Copy JSON` / `Renarrate` actions)
- Two-column body, max-width 1080px, gap 32px:
  - **Main column**: Summary paragraph (Newsreader, 15.5px) + a **Facts & claims** table — each row has a kind chip (`CLAIM`/`COUNTER`/`FIGURE`/`QUOTE`, color-coded), the fact text, and a small confidence bar (28px wide, 3px tall, `--pos`/`--accent`/`--warn` based on threshold)
  - **Sidebar (280px)**: three small panels — Entities (chip cloud), Reading-goal match (large numeric score + percentage bar + sentence), Extraction meta (model, tokens, latency, screenshots)

### F. Research dashboard (replaces `viewers/research-dashboard.html`)

Header with wordmark + "Research" + search input + Refresh/Export.

Tabs: **Overview · Conversations · Experiments · Feedback · Preferences · Logs**.

Overview body:
- 4-up KPI strip (Participants, Renarration runs, Median feedback, Refinement events) — each card has eyebrow, large number (28px, weight 600), trend arrow, and a delta sentence
- Two-column layout:
  - Left (1.5fr): Activity chart (stacked bar by day, accent/muted/neg) + Recent runs table (USER / PAGE / TASK / LATENCY / FB columns)
  - Right (1fr): Feedback distribution (single horizontal stacked bar + legend rows) + By-task table (task name + percentage bar + run count)

---

## Components

### Buttons

```css
.clear-btn        { font-size: 13px; padding: 8px 14px; radius: 10px; }
.clear-btn--primary { background: var(--ink); color: var(--paper); }
.clear-btn--accent  { background: var(--accent); color: white; }      /* reserve for the Renarrate CTA */
.clear-btn--ghost   { background: color-mix(in oklch, var(--ink) 4%, transparent); }
.clear-btn--sm    { padding: 5px 10px; font-size: 12px; }
.clear-btn--xs    { padding: 3px 8px; font-size: 11px; radius: 6px; }
```

All buttons: `transition: all 0.15s cubic-bezier(0.2, 0.7, 0.3, 1)`. Hover lifts brightness slightly; no shadow growth.

### Chips
```css
.clear-chip            { height: 24px; padding: 0 10px; radius: 999px; font-size: 12px; background: color-mix(in oklch, var(--ink) 5%, transparent); }
.clear-chip--accent    { background: color-mix(in oklch, var(--accent) 14%, transparent); color: var(--accent-ink); }
.clear-chip--outline   { background: transparent; border: 1px solid var(--hairline); color: var(--muted-2); }
```

### Input
```css
.clear-input {
  font: 13px var(--font-sans);
  border: 1px solid var(--hairline);
  background: var(--paper);
  border-radius: 10px;
  padding: 9px 12px;
}
.clear-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--accent) 18%, transparent);
}
```

### Drag-grip
6 dots in a 2×3 grid, 3px each, 2px gap, padding 6px, radius 6px, color `--muted`. Hover background: `color-mix(in oklch, var(--ink) 6%, transparent)`.

### Eyebrow label
```css
.clear-eyebrow {
  font: 500 10px/1 var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
```

---

## Interactions & motion

| Surface | Motion |
|---|---|
| Overlay expand/collapse | 220ms ease-out-cubic on max-height + opacity |
| Overlay drag | No transition during drag (pointer-driven). 120ms ease snap when released near edge. |
| Split panel slide-in | 240ms ease-out-cubic on transform: translateX + opacity |
| Selection popup | 120ms fade + 4px upward translate |
| Hover on buttons/chips | 150ms ease-out-cubic on background only — no transform growth |
| Conversation bubble append | 180ms slide-up-fade |

All animations respect `prefers-reduced-motion: reduce` → durations become 0ms (already wired in `tokens.css`).

---

## State management — map onto existing storage

The existing code already has a working state model. Keep it. Only the storage keys for new UI state are added.

| Key | Type | Purpose |
|---|---|---|
| `clear.overlay.position` | `{x, y}` | Last drag position (per-window) |
| `clear.overlay.pinned` | `boolean` | Stay open across tabs |
| `clear.overlay.collapsed` | `boolean` | Resting-state preference |
| Existing keys | — | Goal, persona, task, extraction cache — unchanged |

Message protocol (existing) — no changes needed:
- `EXTRACT_PAGE`, `RENARRATE_PAGE`, `RENARRATE_SELECTION`, `SET_GOAL`, `CHAT_TURN`

The overlay listens to the orchestrator's `progress` events and updates the Page-knowledge block in place. No polling.

---

## Assets

| Asset | Source | Notes |
|---|---|---|
| Geist + Geist Mono | Google Fonts | Add to `web_accessible_resources`, or self-host under `/assets/fonts/` to avoid network dependency |
| Newsreader | Google Fonts | Same — self-host preferred since the extension runs offline |
| Icons | Inline SVG, 14×14 default, `stroke="currentColor"`, `stroke-width="1.3–1.6"`, `stroke-linecap: round`, `stroke-linejoin: round` | See `reference/shared.jsx` `Icon` object for the full set: `arrow`, `send`, `sparkle`, `close`, `chevron`, `dot`, `plus`, `check`, `book`, `user`, `target`, `layers`, `pin`, `minus` |
| Logo mark | The letter "C" in Geist Mono Semibold inside a rounded square — generate on the fly, no image file | |

Existing `icons/icon16.png` / `icon48.png` / `icon128.png` should be re-generated to match the new mark. Until then they can remain.

---

## Build / wiring guidance

The existing extension uses:
- MV3 manifest (`manifest.json`)
- Vite build for the service worker bundle (`build/background-entry.js`)
- Vanilla DOM in popup/sidepanel/options/content scripts
- A shared `tokens.css` linked from every HTML file

Recommended path:

1. **Tokens first.** Replace `tokens.css` with the new values. The legacy `--color-*` token names should map to the new tokens through aliases for one release, so old code keeps working while you migrate surface by surface.

2. **Build a `clear-overlay.js` content-script module** that renders the Document overlay as a `Shadow DOM` rooted under a single `<div id="clear-root">`. Shadow DOM is critical — host pages have unpredictable CSS that would otherwise leak in.

3. **Replace `popup.html`** with a 320×56 stub that just fires `OPEN_OVERLAY` to the active tab and closes. The popup is now vestigial; the overlay is the surface.

4. **Refactor the split panel** in `content.css` to drop the purple gradient and adopt the new tokens. Reuse the existing dragging/resizing code.

5. **Selection popup** — replace the floating `R` trigger entirely; on `selectionchange` with non-empty selection, render the new mini-popup.

6. **Options page** rebuild from `options.html` — keep all the same handlers in `options.js`, just rewrite the DOM and CSS.

7. **Viewers** — rebuild `extracted-content.html` and `research-dashboard.html` last; data shape is unchanged.

### Things to delete after migration

- Generic blue/purple gradient definitions in `content.css`, `popup.css`, `sidepanel.css`
- Shimmer animation on the popup header
- The "OpenAI" wordmark in every visible string
- Per-surface duplicated CSS — most chrome should now come from `tokens.css` + a single small `clear.css`

---

## Files in this bundle

```
README.md                ← This file. Full design spec.
MIGRATION.md             ← File-by-file mapping from current extension → Clear.
screenshots/
├─ README.md             ← Gallery legend tying each PNG to a section above
├─ 01-wafer.png             (reference — rejected direction)
├─ 02-document.png          ← Plan B · the recommended layout
├─ 03-compass.png           (reference — rejected direction)
├─ 04-selection-popup.png   ← Surface B
├─ 05-split-renarration.png ← Surface C
├─ 06-resting-states.png    ← Surface A (collapsed)
├─ 07-settings.png          ← Surface D
├─ 08-extracted-viewer.png  ← Surface E
└─ 09-research-dashboard.png ← Surface F
reference/
├─ Clear UI.html          ← Open this in a browser to see all surfaces side-by-side on a design canvas
├─ styles.css             ← Tokens + base components (copy/adapt into tokens.css)
├─ shared.jsx             ← FakePage backdrop + Icon set + Grip + Eyebrow primitive
├─ overlays.jsx           ← Three overlay directions; Plan B is the `<DocumentOverlay/>` component
├─ in-context.jsx         ← Selection popup + Split renarration view + Resting/collapsed states
├─ pages.jsx              ← Settings, Extracted viewer, Research dashboard
└─ design-canvas.jsx      ← Wrapper component for the canvas — not part of the product, just the presentation
```

Plan B's primary component is `DocumentOverlay` in `overlays.jsx` (lines ~115–195). The rest of the design system applies to every surface.

---

## Open questions for the implementing team

1. Does the team want to keep the side-panel API as a secondary surface, or fully retire it in favor of the overlay?
2. Should the overlay's `pinned` state be per-tab, per-window, or per-profile? Current spec assumes per-profile (`chrome.storage.sync`).
3. Newsreader weighs ~120KB. Self-hosting all needed weights vs. lazy-loading on the split-panel open?
4. Is there appetite for a keyboard shortcut to toggle the overlay (e.g. ⌘⇧K)? Easy to add in `manifest.json` `commands`.

These can be resolved as the implementation proceeds — none block starting.
