## Why

Clear depends on two external cloud services for every core operation, which undercuts the extension's "on-device" promise and creates hard operational coupling:

- **OpenAI** (`/v1/responses`) powers every LLM call — text extraction, vision extraction, the orchestrator merge, renarration, caption rewriting, and the side-panel chatbot. The API key is **baked into the bundle at build time** (`VITE_OPENAI_API_KEY`), so the key cannot be rotated and the model cannot be changed without a rebuild, and every page's content leaves the device.
- **Firestore** (REST) stores all research data — `chatSessions`, `researchLogs`, `feedbackEvents`, `userPreferences` — sending research/usage data off-device and requiring a configured Firebase key.

Going local removes both: the model runs on the user's own machine via **Ollama** (`http://localhost:11434`), and research data returns to **IndexedDB** (the design that predated Firestore). The multimodal vision capability is preserved with a local vision-language model. Nothing the user reads leaves their device.

> Tracking: GitHub epic **#33**, child issues **#34–#42**. Implementation lands on the `local-branch` branch.

## What Changes

- **Replace the OpenAI transport with an Ollama client.** A new client targets `http://localhost:11434` (recommended OpenAI-compatible `/v1/chat/completions`) and exposes the same `callText` / `callJson` surface as `openai-client.js`, so the ~6 callsites change minimally. OpenAI-only params (`reasoning.effort`, `store`) become no-ops; JSON-schema structured output maps to Ollama `response_format` / `format`.
- **Move model config from build-time to runtime.** The baked-in `VITE_OPENAI_*` env is removed. Base URL, text model, and vision model become editable in the options page, backed by `chrome.storage`, with a "Test connection" health check.
- **Keep real multimodal vision via a local VLM.** `runVisionSubagents` routes page images (already fetched as data URIs) to a configured local vision model (default **Qwen2.5-VL**). Graceful zero-image / dead-URL degradation is preserved.
- **Make the extraction fan-out sane for serial local inference.** A single local model serves requests serially; the current 16-text / N-vision parallel fan-out is made configurable (low default) with retuned segment sizing and timeouts, and honest progress.
- **Replace Firestore with IndexedDB.** A research-storage module mirrors the `firestore-client.js` surface (`researchPut`/`researchGet`/`researchGetAll`/`researchGetByIndex`/`researchClearStore`/`researchExportCSV`) over the `renarration-research` IndexedDB database, consolidating with the existing inline IndexedDB code. All Firestore code, Firebase config, and options UI are deleted.
- **Document local setup + CORS.** Ollama must be started with `OLLAMA_ORIGINS=chrome-extension://<id>`; the README/onboarding and in-product error states cover install, model pulls, and server-unreachable cases.

## Capabilities

### New Capabilities
- `local-llm-runtime`: All LLM inference is served by a user-run Ollama instance over `http://localhost:11434`, configured at runtime (base URL + model names), with a connection health check and no API keys baked into the bundle.
- `local-multimodal-extraction`: Visual-fact extraction runs against a local vision-language model, and the extraction fan-out is bounded for single-model serial inference while preserving graceful degradation when images are absent or unfetchable.
- `local-research-storage`: Research data (chat sessions, logs, feedback, preferences) is persisted in on-device IndexedDB with no network calls, replacing Firestore.

### Modified Capabilities
<!-- None: no archived specs exist in openspec/specs/ yet; these are net-new capabilities. -->

## Impact

- **Code (new):** `src/utils/ollama-client.js`, `src/utils/research-db.js` (or consolidated into `lib/research-db.js`).
- **Code (modified):** `src/utils/llm-dispatch.js`, `src/page-flow/extract-page.js` (vision routing, concurrency, timeouts), `src/page-flow/renarrate-page.js`, `src/utils/renarration.js`, `src/handlers/chatbot.js`, `src/handlers/simple.js`, `viewers/research-dashboard.js`, `options.html`/`options.js`/`options.css`, `manifest.json`, `vite.config.js`, `.env`/`.env.example`, `README.md`, `SECURITY.md`.
- **Code (deleted):** `src/utils/openai-client.js`, `src/utils/firestore-client.js`, all `VITE_OPENAI_*` env, Firebase config keys + options UI.
- **Behavior:** all inference and storage are on-device; extraction is slower (serial local model) but private; multimodal vision is preserved.
- **Privacy:** page content and research data no longer leave the device — a strict improvement.
- **Branch:** unlike the usual `web-branch → PR → main` flow, this change's implementation is merged into **`local-branch`**.
- **Out of scope:** in-browser WebLLM/WebGPU runtime (rejected in favor of localhost Ollama); bundling models with the extension; non-desktop targets.
