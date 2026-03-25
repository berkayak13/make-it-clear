Load the frontend skill context for the popup and options pages, then apply it to the following task.

## Context

Read the file `.claude/skills/frontend.md` for full architecture, file map, CSS design system, data structures, and modification rules for the popup and options pages.

## Key files
- Popup: `popup.html`, `popup.css`, `popup.js`
- Options: `options.html`, `options.css`, `options.js`

## Rules
1. No frameworks or build tools — vanilla JS/CSS/HTML only.
2. Keep popup at 380px width, use the card layout.
3. Always use `escapeHtml()` when inserting user content via `innerHTML`.
4. Add `chrome.storage.onChanged` listeners for any new settings so popup and options stay in sync.
5. Maintain backward compat migrations (`profiles` -> `tasks`, `useWebLLM` -> `llmProvider`).
6. Keep `DEFAULT_TASKS` / `DEFAULT_PERSONAS` in sync between `options.js` and `background.js`.
7. Follow existing CSS naming: popup uses `.btn--*` / `.card` / `.field-*`; options uses `.primary-btn` / `.secondary-btn` / `.task-item`.
8. Test manually — no automated test suite.

## Task

$ARGUMENTS
