# On-Device Renarration Assistant

A Chrome extension that reformulates text and images on web pages. It supports on-device WebLLM for text, remote VLM for screenshots/images, and user tasks/personas to control tone and detail.

## Installation
- Clone: `git clone https://github.com/boun-tabi-LMG/on-device-renarration.git`
- Install deps: `npm install`
- Build offscreen bundle: `npm run build` (emits `build/offscreen-entry.js`)
- Load unpacked extension in Chrome: `chrome://extensions` -> Enable Developer Mode -> Load unpacked -> select repo root.
- Configure remote VLM (optional): In options, set endpoint/model/API key (stored locally).

## Configuration
- Tasks and personas: manage in options; active task/persona is selected in the popup.
- Remote VLM: enable in options and set endpoint/model/API key.\
**IMPORTANT NOTE**: You need to provide an API key in options menu to use Full Page Renarration mode.
- On-device LLM: enable WebLLM in the popup and initialize the model (WebGPU).

## Implementation Details
- **Content script (`content.js`)**: Detects selections, injects overlay UI, handles text renarration trigger.
- **Background (`background.js`)**:
  - Text: routes to WebLLM offscreen worker when enabled; falls back to simulator.
  - Images/screenshots: captures full-page slices, optionally stitches or batches slices; sends to remote VLM; caches outputs for viewers.
  - Tasks/personas: stored in `chrome.storage.sync`; persona addendum is appended to prompts via the system prompt template.
  - Full pipeline: `Renarrate` captures page -> VLM extracts content -> LLM renarrates with active task/persona -> result saved to viewer storage and pipeline logs.
- **Offscreen worker (`src/offscreen-entry.js`)**: Hosts WebLLM engine for on-device text (placeholder for VLM on-device). Provides async message bridge.
- **UI**:
  - Popup: task/persona selection, WebLLM toggle/init, capture/describe/renarrate buttons, testing dashboard link.
  - Options: manage tasks/personas, edit system prompt template, set remote VLM config.
  - Viewers: `describe-viewer.html` (screenshot + VLM output), `renarration-viewer.html` (VLM extract + final renarration), `screenshot-viewer.html`, `testing-dashboard.html`.

## Usage
- Text: select text -> click 🔄.
- Full page: use **Capture Full Page**, **Describe Page (VLM)**, or **Renarrate** in the popup; results open in viewers. The full screenshots -> VLM -> LLM pipeline is initiated by **Renarrate** button.
- Debugging: open viewers to inspect last outputs; the testing dashboard lists capture/VLM/LLM pipeline logs.
