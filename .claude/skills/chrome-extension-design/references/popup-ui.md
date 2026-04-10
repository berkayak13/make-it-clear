# Popup, Options, and Side Panel UI

This is where most of the "looks pretty" lives. Read this when building or restyling any UI surface the extension owns (popup, options page, side panel).

## The popup is not a web page

Before writing any CSS, internalize these constraints:

- **Width**: Chrome allows 25px–800px. Practical range is 320–420px. Narrower feels cramped; wider gets clamped on some displays.
- **Height**: Max ~600px. Anything taller scrolls inside the popup, which feels bad. Design for the short axis.
- **Lifecycle**: The popup closes the instant the user clicks outside it or switches tabs. All state must persist to `chrome.storage` — don't rely on in-memory state surviving.
- **No horizontal scroll, ever.** If content overflows horizontally the popup looks broken.

Design implication: one job, one screen. If the user wants more, use tabs inside the popup, a side panel, or a full options page.

## Design tokens: the non-negotiable starter set

Every extension popup should begin with a tokens block. Put this at the top of the stylesheet (or in `styles/tokens.css` and `@import` it). Adjust the values to taste, but keep the structure.

```css
:root {
  /* Color — neutral scale */
  --bg: #ffffff;
  --bg-subtle: #f6f7f9;
  --bg-hover: #eef0f3;
  --border: #e4e7eb;
  --border-strong: #cbd2d9;
  --text: #1f2933;
  --text-muted: #616e7c;
  --text-subtle: #9aa5b1;

  /* Color — accent (pick one, don't sprinkle) */
  --accent: #3b5bdb;
  --accent-hover: #364fc7;
  --accent-fg: #ffffff;

  /* Feedback */
  --danger: #e03131;
  --success: #2f9e44;
  --warning: #f08c00;

  /* Spacing scale — 4px base */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;

  /* Type */
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
          "Helvetica Neue", Arial, sans-serif;
  --text-xs: 11px;
  --text-sm: 13px;
  --text-base: 14px;
  --text-lg: 16px;
  --text-xl: 20px;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.06);
  --shadow-md: 0 4px 12px rgba(15, 23, 42, 0.08);

  /* Motion */
  --ease: cubic-bezier(0.2, 0, 0, 1);
  --dur-fast: 120ms;
  --dur-base: 200ms;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1a1b1e;
    --bg-subtle: #25262b;
    --bg-hover: #2c2e33;
    --border: #2c2e33;
    --border-strong: #3b3d42;
    --text: #e9ecef;
    --text-muted: #adb5bd;
    --text-subtle: #6c757d;
    --accent: #5c7cfa;
    --accent-hover: #748ffc;
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
  }
}
```

Twelve neutral colors + one accent is enough for 90% of extensions. Resist the urge to add a second accent unless the design actually needs it.

## Popup base layout

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <header class="popup-header">
    <h1>Extension Name</h1>
    <button class="icon-btn" aria-label="Settings">⚙</button>
  </header>
  <main class="popup-body">
    <!-- content -->
  </main>
  <footer class="popup-footer">
    <span class="status">Ready</span>
  </footer>
  <script src="popup.js"></script>
</body>
</html>
```

```css
* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  font-family: var(--font);
  font-size: var(--text-base);
  color: var(--text);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
}

body {
  width: 360px;          /* fixed width — pick one and commit */
  min-height: 200px;
  max-height: 560px;
  overflow-y: auto;
  overflow-x: hidden;
}

.popup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  position: sticky;
  top: 0;
  z-index: 1;
}

.popup-header h1 {
  font-size: var(--text-base);
  font-weight: 600;
  margin: 0;
}

.popup-body {
  padding: var(--space-4);
}

.popup-footer {
  padding: var(--space-2) var(--space-4);
  border-top: 1px solid var(--border);
  font-size: var(--text-xs);
  color: var(--text-muted);
}
```

Notes:
- **Fix the width.** A popup that reflows as content changes looks jittery. Pick 340, 360, or 400 and stick with it.
- **Sticky header + footer** keeps chrome visible when the body scrolls.
- **Padding, not margin**, on the outer container — margin collapse causes weird gaps at the top of popups.

## Buttons

The #1 tell of a cheap extension is unstyled `<button>` elements. Define two or three variants and use them everywhere.

```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  height: 32px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease),
              border-color var(--dur-fast) var(--ease),
              transform var(--dur-fast) var(--ease);
  user-select: none;
}

.btn:active { transform: translateY(1px); }
.btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--accent);
  color: var(--accent-fg);
}
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }

.btn-secondary {
  background: var(--bg-subtle);
  color: var(--text);
  border-color: var(--border);
}
.btn-secondary:hover:not(:disabled) { background: var(--bg-hover); }

.btn-ghost {
  background: transparent;
  color: var(--text);
}
.btn-ghost:hover:not(:disabled) { background: var(--bg-hover); }

.icon-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-muted);
}
.icon-btn:hover { background: var(--bg-hover); color: var(--text); }
```

## Form controls

Browser-default `<input>` and `<select>` look dated. Restyle them:

```css
.input, .select, .textarea {
  width: 100%;
  height: 32px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: var(--text-sm);
  transition: border-color var(--dur-fast) var(--ease),
              box-shadow var(--dur-fast) var(--ease);
}

.textarea {
  height: auto;
  padding: var(--space-2) var(--space-3);
  resize: vertical;
  min-height: 72px;
}

.input:focus, .select:focus, .textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
}

.label {
  display: block;
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: var(--space-1);
}
```

## Lists

Most popups are really "a list of things plus an action bar." Give list items breathing room and a clear hover state:

```css
.list { list-style: none; margin: 0; padding: 0; }
.list-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease);
}
.list-item:hover { background: var(--bg-hover); }
.list-item + .list-item { margin-top: 2px; }

.list-item__title {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text);
  /* truncate gracefully */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.list-item__meta {
  font-size: var(--text-xs);
  color: var(--text-subtle);
}
```

## Options pages

The options page is a full browser tab. It has room, so use it — but don't spread content edge-to-edge on a 27" monitor. Center a column:

```css
.options-container {
  max-width: 640px;
  margin: 0 auto;
  padding: var(--space-6) var(--space-5);
}
.options-section {
  padding: var(--space-5) 0;
  border-bottom: 1px solid var(--border);
}
.options-section:last-child { border-bottom: none; }
.options-section h2 {
  font-size: var(--text-lg);
  margin: 0 0 var(--space-2);
}
.options-section p.description {
  color: var(--text-muted);
  font-size: var(--text-sm);
  margin: 0 0 var(--space-4);
}
```

A good options page looks like a settings screen: section title, short description under it, controls below, generous spacing between sections.

## Side panel

The side panel (Chrome 114+) is a persistent vertical strip. It doesn't close on click-out like a popup, so you can design for longer sessions. Treat it like a narrow app: 320–400px wide, full browser height, scrollable. Most of the popup CSS above works, but you can skip the `max-height` clamp.

## Typography rules

- **One font family.** System stack by default. If the user insists on a custom font, pick exactly one and use it everywhere.
- **Four sizes max.** xs (labels, meta), sm (body), base (controls), lg (headings). More than four and it gets chaotic.
- **Line height 1.4–1.5 for body, 1.2 for headings.**
- **Weight 400 for body, 500 for emphasis, 600 for headings.** Don't use 700 in small UI — it reads heavy.

## Things that immediately look bad

- `<h1>` at default size (2em) inside a 360px popup. Override it.
- Default `<button>` styling (gray with beveled edges on some OSes).
- Blue underlined links inside a branded interface. Style links to match.
- Scrollbars on the wrong axis. Set `overflow-x: hidden` on body.
- `box-shadow` with pure black at 50% opacity. Use `rgba(15, 23, 42, 0.08)` or similar — shadows should be subtle.
- Animations longer than 300ms. Extensions are utilities; snappy beats fancy.
