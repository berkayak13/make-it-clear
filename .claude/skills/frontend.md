# Frontend Skill — Popup & Options Pages

## Overview

This extension has two main frontend surfaces: the **popup** (380px-wide browser action panel) and the **options page** (full-tab settings). Both are vanilla JS/CSS/HTML with no framework or build step — they load as static files directly by Chrome.

## File Map

| Surface | HTML | CSS | JS |
|---------|------|-----|----|
| Popup | `popup.html` | `popup.css` | `popup.js` |
| Options | `options.html` | `options.css` | `options.js` |

## Architecture & Patterns

### No Framework
- Pure DOM manipulation: `document.getElementById`, `document.createElement`, `innerHTML` for rendering lists.
- All event listeners attached inside `DOMContentLoaded` callback.
- No module imports — each JS file is a single `<script>` tag.

### Storage Model
- **`chrome.storage.sync`**: tasks, personas, currentTask, currentPersona, llmProvider, systemPromptTemplate, readingGoal, VLM endpoint/model config. Synced across devices.
- **`chrome.storage.local`**: API keys (`remoteVLMApiKey`), `useAgenticPipeline`, `enableResearchLogging`, `studyUserId`. Not synced (secrets/local-only state).
- Both pages listen to `chrome.storage.onChanged` so they stay in sync when the other page (or background) writes.

### Message Passing
- Popup/options communicate with the background service worker via `chrome.runtime.sendMessage({ action: '...' })`.
- Key actions used from frontend: `webllm-init`, `capture-fullpage`, `describe-page-screenshot`, `renarrate-page`, `set-user-id`, `clear-research-data`.
- Offscreen progress events arrive via `chrome.runtime.onMessage` with `msg.__offscreenProgress`.

### Backward Compatibility
- `tasks`/`currentTask` fields replaced older `profiles`/`currentProfile`. Both pages include migration logic that reads old keys and writes to new ones on load.
- `llmProvider` replaced boolean `useWebLLM`. Falls back: `settings.llmProvider || (settings.useWebLLM ? 'on-device' : 'remote')`.

## Popup (`popup.html` / `popup.js` / `popup.css`)

### Layout (card-based)
1. **Header** — gradient banner with title/subtitle.
2. **Setup Card** — LLM provider dropdown, API key input with show/hide toggle, WebLLM init button (conditionally shown).
3. **Renarration Card** — Task select, Persona select (both dynamically populated), config summary line, Enabled toggle + Agentic checkbox.
4. **Actions Card** — "Renarrate Page" primary button, secondary grid: Capture / Describe / Chat, status text for each.
5. **Footer** — links to Settings (options page) and Testing Dashboard.

### Key Behaviors
- **API key input**: debounced save on input (500ms), immediate save on blur and `visibilitychange` (safety net for popup close).
- **Task/Persona selects**: populated via `populateTaskOptions()` / `populatePersonaOptions()` helper functions that rebuild `<option>` elements from the stored objects.
- **Config summary**: `updateConfigSummary()` renders "Task: X · Persona: Y" below the selects.
- **WebLLM controls**: hidden unless `llmProvider === 'on-device'`.
- **Chat button**: opens the side panel via `chrome.sidePanel.open({ tabId })`.

### CSS Design System
- BEM-inspired naming: `.btn--primary`, `.btn--secondary`, `.btn--full`, `.btn--sm`.
- Card system: `.card` > `.card-header` + `.card-body`.
- Form fields: `.field-row`, `.field-label`, `.field-select`, `.field-input`.
- Status indicators: `.status-pill--configured` (green), `.status-pill--missing` (red).
- Toggle switch: `.toggle-container--compact` with hidden checkbox + `.toggle-slider--sm`.
- Color palette: primary gradient `#667eea` to `#764ba2`, slate grays for text.
- Fixed width: `body { width: 380px }`.

## Options Page (`options.html` / `options.js` / `options.css`)

### Layout (sections)
1. **Header** — gradient banner.
2. **User Tasks** — active task dropdown, rendered task list with edit/delete buttons, "Add Custom Task" button.
3. **Personas** — active persona dropdown, rendered persona list with edit/delete, "Add Persona" button.
4. **System Prompt Template** — editable textarea with `{task}`, `{persona}`, `{readingGoal}` placeholders, restore-default button, read-only effective prompt preview.
5. **General Settings** — LLM provider select, remote VLM toggle + endpoint/model/API key inputs.
6. **Research Settings** — participant ID, agentic pipeline toggle, research logging toggle, dashboard/clear buttons.
7. **About** — version info.
8. **Footer** — save status text + reset button.

### Modals
- **Task Editor Modal** (`#taskModal`): name input + text prompt textarea. Opened by `openTaskModal(key)`.
- **Persona Editor Modal** (`#personaModal`): name input + system addendum textarea. Opened by `openPersonaModal(key)`.
- Both close on overlay click, X button, or Cancel.

### Key Behaviors
- **`renderTasks()` / `renderPersonas()`**: rebuild the list DOM from `currentTasks` / `currentPersonas` objects. Use `innerHTML` with `escapeHtml()` for XSS safety.
- **`hydrateActiveSelectors()`**: populates the active task/persona `<select>` elements at the top of each section.
- **`updateEffectiveSystemPrompt()`**: live-previews the fully resolved system prompt by applying `applyTemplate()` with current task text, persona addendum, and reading goal.
- **System prompt template**: debounced save (400ms) on input via `queueSystemPromptSave()`.
- **Default data**: `DEFAULT_TASKS` and `DEFAULT_PERSONAS` are defined inline in `options.js` — keep in sync with `background.js`.
- **Reset**: `resetToDefaults()` restores all tasks, personas, and settings to their defaults.

### CSS Design System
- Shares the same color palette and gradient as popup.
- `.card` with `border-radius: 12px` and shadow.
- `.primary-btn` / `.secondary-btn` for buttons.
- `.task-item` for list items (used for both tasks and personas).
- `.task-badge` for status pills (Default, Active).
- `.modal` > `.modal-content` > `.modal-header` + `.modal-body` + `.modal-footer`.
- `.form-group` for labeled inputs/textareas.
- `.setting-item` with bottom border separator.
- Max width: `800px` centered.

## Data Structures

### Task Object
```js
{
  name: 'Simple Language',
  textPrompt: 'Instructions for text renarration...',
  imagePrompt: 'Instructions for image description...',  // optional
  maxLength: 150,                                         // optional
  isDefault: true                                         // prevents deletion
}
```

### Persona Object
```js
{
  name: 'General Public',
  description: 'Average reader...',           // optional display text
  systemAddendum: 'Target audience persona...' // injected into system prompt
}
```

## Rules When Modifying Frontend

1. **No frameworks or build tools** — popup/options are static files loaded by Chrome. Do not introduce React, Svelte, bundlers, etc.
2. **Keep popup compact** — fixed 380px width, no scrolling if possible. Use the card layout.
3. **Escape user content** — always use `escapeHtml()` when inserting user-provided strings via `innerHTML`.
4. **Sync storage listeners** — if adding a new setting, add a `chrome.storage.onChanged` handler so both popup and options stay in sync.
5. **Backward compat** — maintain the `profiles` -> `tasks` and `useWebLLM` -> `llmProvider` migration paths until a major version bump.
6. **Keep defaults in sync** — `DEFAULT_TASKS` and `DEFAULT_PERSONAS` are duplicated in `options.js` and `background.js`. Update both when changing defaults.
7. **CSS naming** — follow existing BEM-inspired conventions. Popup uses `.btn--*` / `.card` / `.field-*`. Options uses `.primary-btn` / `.secondary-btn` / `.task-item`.
8. **Test manually** — no automated test suite. Use `test-page.html` and the extension popup directly.
