---
name: chrome-extension-design
description: Build Chrome (Manifest V3) browser extensions that look polished and feel native, not like a weekend hack. Use this skill whenever the user wants to create, scaffold, build, or redesign a browser extension — including Chrome, Edge, Brave, Arc, or any Chromium-based browser — even if they don't explicitly say "make it pretty." Covers project scaffolding, manifest.json, popup/options/side-panel UI, content script styling and shadow DOM isolation, design tokens, dark mode, icons, and the small details (micro-interactions, empty states, spacing) that separate professional extensions from amateur ones. Trigger on phrases like "chrome extension," "browser extension," "manifest v3," "popup UI," "content script," "extension icon," or any request to style an extension's UI or an injected overlay.
---

# Chrome Extension Design

This skill is for building Chrome extensions that feel like products, not prototypes. Most extension tutorials stop at "it works" — the popup has Times New Roman, the buttons are unstyled, the icons are stretched pixel art. This skill picks up where those leave off.

## When to consult the references

This SKILL.md is the overview and the design philosophy. For specifics, read the relevant reference file when you actually need it:

- `references/scaffolding.md` — manifest.json, file layout, build setup, permissions, MV3 gotchas. Read this when starting a new extension from scratch or when the user is confused about project structure.
- `references/popup-ui.md` — styling the popup, options page, and side panel. Design tokens, layout constraints (popups have weird sizing rules!), dark mode, typography. Read this when building or restyling any extension-owned UI surface.
- `references/content-scripts.md` — injecting UI into other people's websites without everything exploding. Shadow DOM, CSS isolation, positioning overlays, avoiding conflicts with host page styles. Read this whenever the extension touches the DOM of a page it doesn't own.
- `references/icons-and-assets.md` — the icon sizes Chrome actually needs, how to make them not look terrible, and where they go. Read this when generating or updating icons.
- `references/polish-checklist.md` — the final pass. Micro-interactions, empty states, loading states, keyboard support, accessibility. Read this before shipping or when the user says "it works but feels off."

Don't read all of them upfront. Pull in what the current task needs.

## Core design philosophy

Extensions fail the "looks pretty" bar in predictable ways. Keep these in mind regardless of which surface you're building.

**1. Constrain before you decorate.** A Chrome popup is not a web page. It has a minimum width of ~300px, a max of ~800px, and it closes the moment the user clicks outside it. Design for a small, focused surface with one job. If the user asks for a popup that does ten things, push back — suggest a side panel or options page for the secondary stuff.

**2. Use a real design system, even a tiny one.** Every extension in this skill should define CSS custom properties for color, spacing, radius, and typography at the top of the stylesheet. Ad-hoc `#3b82f6` sprinkled through the code is how extensions end up looking unprofessional. A dozen tokens is enough. See `references/popup-ui.md` for a starter set.

**3. Respect the host browser.** Match the user's system dark mode via `prefers-color-scheme`. Use system font stacks (`-apple-system, BlinkMacSystemFont, "Segoe UI", ...`) so the extension feels like it belongs to the OS, not to a random web framework. Don't bundle 400KB of Inter unless the user specifically wants a branded look.

**4. Content scripts must not leak.** When injecting UI into another site, always use shadow DOM or scoped class prefixes. CSS from the host page will bleed into your overlay and vice versa. This is the #1 reason extension overlays look broken. `references/content-scripts.md` covers the pattern.

**5. Icons are not an afterthought.** A blurry upscaled 16x16 is the first thing a user sees in their toolbar. Generate icons at the exact sizes Chrome requests (16, 32, 48, 128) from a clean vector source. Never let Chrome upscale for you.

## Default workflow for a new extension

When the user asks for a new extension, follow roughly this path:

1. **Clarify the surfaces.** Does it need a popup? Options page? Content script? Side panel? Background service worker? Don't build surfaces that aren't needed — an extension with an empty options page screams unfinished.
2. **Read `references/scaffolding.md`** and set up the manifest + file layout. Prefer a flat, buildless structure (plain HTML/CSS/JS) unless the user specifically wants React/TypeScript/a bundler. Buildless is faster to iterate on and easier to load unpacked.
3. **Define design tokens first.** Before writing any component CSS, create a `styles/tokens.css` (or inline `:root` block) with the color, spacing, and type scale. Everything downstream references these.
4. **Build the popup with real content, not Lorem Ipsum.** Stub realistic data so spacing decisions are grounded. Empty states matter — design one from the start.
5. **Icons.** Generate or request all four sizes. See `references/icons-and-assets.md`.
6. **Polish pass.** Read `references/polish-checklist.md` and go through it. This is where "works" becomes "looks pretty."

## Default workflow for redesigning an existing extension

1. **Inspect first.** Read the manifest.json, the popup HTML/CSS, and any content script styles. Identify which surfaces exist and what shape they're in.
2. **Name what's wrong.** Be specific with the user: "The popup has no design tokens, the buttons use browser defaults, there's no dark mode, and the content script overlay inherits the host page's font." Vague redesigns produce vague results.
3. **Propose a token set** and get buy-in before rewriting components. Changing tokens later is cheap; changing inline styles later is not.
4. **Rewrite surface by surface**, not all at once. Popup first (it's what users see most), then options, then content scripts.
5. **Polish pass** at the end, same checklist.

## Things to push back on

- **"Make the popup 1200px wide."** Chrome will clamp it. Suggest a side panel or a full-tab options page.
- **"Use !important everywhere in the content script."** That's a smell. Use shadow DOM instead.
- **"Copy the exact look of [famous app]."** Trademarked UI is a legal problem and usually also a taste problem. Draw inspiration, don't clone.
- **"Ship without icons, I'll add them later."** Users judge extensions on the toolbar icon before they ever click it. At minimum, generate a placeholder that isn't the default puzzle piece.

## A note on frameworks

The user may ask for React, Vue, Svelte, or a bundler like Vite with `@crxjs/vite-plugin`. That's fine — this skill's design guidance applies regardless. But default to buildless vanilla HTML/CSS/JS when the user hasn't specified, because:

- It loads unpacked instantly with no build step.
- It's easier to debug in chrome://extensions.
- Most popups are small enough that a framework is overkill.
- It sidesteps MV3's service worker restrictions on bundled code.

If the user wants a framework, `references/scaffolding.md` has notes on the Vite + CRXJS setup, which is currently the least-painful option.
