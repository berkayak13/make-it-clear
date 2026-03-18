# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome Extension (Manifest V3) that reformulates text and images on web pages using on-device WebLLM for text and remote VLM for screenshots/images. Users configure tasks and personas to control renarration tone, detail level, and audience.

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run build        # Build offscreen bundle (emits build/offscreen-entry.js)
npm run clean        # Remove build/ directory
```

**Loading the extension:** After building, go to `chrome://extensions`, enable Developer Mode, click "Load unpacked", and select the repo root directory.

Only `src/offscreen-entry.js` is bundled by Vite. All other extension files (background.js, content.js, popup.*, options.*, viewers/*) are loaded as static files directly by Chrome. There is no automated test suite — testing is manual using `test-page.html` and `viewers/testing-dashboard.html`.

## Architecture

### Message Passing Flow

All cross-component communication uses `chrome.runtime.sendMessage` / `chrome.runtime.onMessage`:

```
Content Script (content.js) ←→ Background Service Worker (background.js) ←→ Offscreen Document (offscreen.html + build/offscreen-entry.js)
```

- **content.js**: Runs on every page. Detects text selection, shows trigger button, displays renarration overlay.
- **background.js** (1200+ lines): Central hub. Handles all message routing, task/persona defaults, storage management, screenshot capture/stitching, VLM calls, and WebLLM coordination.
- **src/offscreen-entry.js**: Hosts the WebLLM engine in a Chrome offscreen document. Communicates with background.js via message passing with requestId-based response tracking.

### Full Page Renarration Pipeline

`Capture → VLM → LLM → Viewer`

1. Background captures full-page screenshots (sliced and optionally stitched)
2. Screenshots sent to remote VLM endpoint for content extraction
3. Extracted text sent to LLM (WebLLM or simulated) with active task/persona
4. Results saved to storage and opened in viewer pages

### Storage

- `chrome.storage.sync`: Tasks, personas, settings, current selections (synced across devices)
- `chrome.storage.local`: API keys, VLM config secrets (not synced)

### Key Data Structures

Tasks have `name`, `textPrompt`, `imagePrompt`, `maxLength`, and optional `isDefault`. Personas have `name`, `description`, `systemAddendum`. Default tasks: Simple, Detailed, Academic, Summary. Default personas: Berat, Student, Researcher, General, Gamer, Business Owner, Architecture Student.

### Prompt Templates

`src/prompts/system.md` defines the system prompt template with persona/task placeholders. `src/prompts/vlm.md` defines the VLM extraction prompt for screenshots.

### Viewer Pages (viewers/)

Standalone HTML pages that read results from chrome.storage: testing-dashboard, describe-viewer, renarration-viewer, screenshot-viewer.

## Code Style

- ES6+ JavaScript with async/await
- No TypeScript, no framework — vanilla JS throughout
- BEM-inspired CSS naming
- Chrome Extension APIs v3 patterns

## Key Implementation Notes

- WebLLM requires `wasm-unsafe-eval` in the CSP (already configured in manifest.json)
- The offscreen document is created on-demand when WebLLM is enabled
- Some LLM/VLM processing paths still use placeholder/simulated responses — look for `simulateLocalLLM` and similar functions in background.js
- Remote VLM requires an API key configured in the options page
