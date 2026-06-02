## Context

Clear runs as an MV3 Chrome extension. All LLM and storage I/O happens in the **background service worker**:

- **LLM transport:** `src/utils/openai-client.js` is the single cloud client. It exposes `callOpenAIText({systemPrompt,userText,model,temperature,maxOutputTokens,timeoutMs,reasoningEffort})`, `callOpenAIJson({prompt,images,imageDetail,schema,schemaName,model,maxOutputTokens,timeoutMs,reasoningEffort})`, and `OPENAI_CONFIG`. It POSTs to `https://api.openai.com/v1/responses` with Responses-API shapes (`instructions`, `input`, `text.format.json_schema` strict, `reasoning.effort`, `store:false`). `src/utils/llm-dispatch.js` wraps text as `callLLM`. Config comes from build-time `import.meta.env.VITE_OPENAI_*`.
- **Callsites:** `extract-page.js` (text subagents, vision subagents, orchestrator merge — all `callOpenAIJson`), `renarrate-page.js` (`callOpenAIJson` captions + `callOpenAIText` body), `renarration.js` + `chatbot.js` (`callLLM`).
- **Vision (the only multimodal surface):** `runVisionSubagents` in `extract-page.js` selects page images, fetches each as a **data URI** (`fetchImageAsDataUrl`, 3MB cap, `detail:'low'`) because OpenAI's servers often can't download hotlink-protected URLs, then sends them to the vision model. It already degrades gracefully: a batch with no fetchable images is skipped; a page with no images runs text-only.
- **Concurrency:** `TEXT_CONCURRENCY=4`, `IMAGE_CONCURRENCY=2`, `MAX_TEXT_SEGMENTS=16`, `IMAGE_BATCH_SIZE=2`, via `mapWithConcurrency`. Built for cheap parallel cloud calls.
- **Storage:** `src/utils/firestore-client.js` exposes `researchPut/Get/GetAll/GetByIndex/ClearStore/ExportCSV` over the Firestore REST API, with `RESEARCH_STORES` = `chatSessions`(sessionId) / `researchLogs`(logId) / `feedbackEvents`(feedbackId) / `userPreferences`(preferenceId, autoGenerate). Per project memory, research data lived in IndexedDB before Firestore; `background.js` already has an inline IndexedDB copy and `lib/research-db.js` exists for sidepanel/viewer contexts.

Two platform constraints stay in force: the MV3 worker is killed if unresponsive, and `chrome.storage.local` has a ~10MB quota.

## Goals / Non-Goals

**Goals:**
- All inference served by a user-run Ollama instance on `localhost`; no cloud LLM, no baked-in key.
- Model + endpoint config editable at runtime with a health check.
- Real multimodal vision preserved via a local VLM, with graceful degradation intact.
- Extraction fan-out bounded for single-model serial inference; no false timeouts.
- Research data fully on-device in IndexedDB; Firestore removed entirely.
- Page-faithful extraction/renarration behavior otherwise unchanged.

**Non-Goals:**
- In-browser WebLLM/WebGPU runtime (rejected — see D1).
- Bundling or auto-downloading models.
- Changing extraction quality logic (prompts/schemas) beyond what the transport swap requires.
- Multi-user sync or any remote research-collection path.

## Decisions

### D1: Localhost Ollama server, not in-browser WebLLM
The model runs as an Ollama process on the user's machine; the extension calls it with plain `fetch` from the existing service worker.
- *Alternatives considered:* (a) **WebLLM in-browser (WebGPU)** — zero-install, but in-browser vision models are still buggy/inaccurate in 2026 and require offscreen-document plumbing in MV3; rejected because "must keep real multimodal" is a hard requirement. (b) **Hybrid (WebLLM text + local vision server)** — most moving parts; deferred.
- *Why:* mature multimodal (Qwen2.5-VL is strong at documents/charts/OCR — the exact use case), bigger models, and no WebGPU/offscreen complexity. Cost: the user must install and run Ollama.

### D2: New client mirrors the existing exported surface
`ollama-client.js` exposes the same `callText`/`callJson` + config object as `openai-client.js`, so callsites change by import path, not signature. Recommended endpoint: OpenAI-compatible `/v1/chat/completions`, because its content shape (`[{type:'text'},{type:'image_url',image_url:{url}}]`) already matches what `callOpenAIJson` builds for data-URI images.
- *Alternative considered:* native `/api/chat` with top-level base64 `images[]` — viable fallback; documented, but requires stripping the `data:` prefix and a different message shape.

### D3: OpenAI-only params degrade to no-ops; JSON schema is portable
`reasoning.effort` and `store` are dropped (kept in signatures as no-ops so callers don't change). Strict `json_schema` output maps to Ollama `response_format: {type:'json_schema', json_schema:{name,strict,schema}}` (OpenAI-compat) or `format: <schema>` (native). The existing truncation/oversize retry guard is preserved.

### D4: Config moves to runtime storage with a health check
Base URL (default `http://localhost:11434`), text model, and vision model live in `chrome.storage`, edited in options, cached with `chrome.storage.onChanged` invalidation (mirroring the cache pattern in `firestore-client.js`). A "Test connection" action pings `/api/tags` (or `/v1/models`), confirms reachability, and warns when a configured model isn't pulled.

### D5: Bound the fan-out for serial local inference
A single local model serves serially, so the 16-text / N-vision parallel fan-out is made configurable with a low default (1–2). Segment sizing (`TEXT_SEGMENT_CHARS`, `MAX_TEXT_SEGMENTS`) and timeouts (`TEXT/IMAGE_STAGE_TIMEOUT_MS`, `ORCHESTRATOR_TIMEOUT_MS`) are retuned for local first-token latency + cold model load. Progress messaging is honest about the slower timing.
- *Why:* the cloud assumption (calls are cheap and parallel) is false locally; left unchanged, long pages would queue for minutes or hit timeouts.

### D6: IndexedDB module mirrors the firestore-client surface
`research-db.js` exposes the identical six functions over the `renarration-research` IndexedDB database with stores matching `RESEARCH_STORES` (keyPaths + `userId` index to back `researchGetByIndex`). It consolidates with the existing inline IndexedDB code in `background.js` / `lib/research-db.js` rather than adding a third copy, respecting the service-worker vs sidepanel/viewer context split. `researchExportCSV` is a pure function, ported as-is. Callers swap import paths only.
- *Note:* the Firestore "resilience" semantics (transient-retry/backoff in the `research-data-resilience` spec) no longer apply to local IndexedDB and are dropped.

### D7: CORS is the real connectivity gate
`<all_urls>` host permission already covers `http://localhost`, so no manifest connectivity change is strictly required. The actual gate is **server-side**: Ollama must run with `OLLAMA_ORIGINS=chrome-extension://<id>` (or `*` for dev). This is documented and surfaced in the connection-test failure path.

### D8: Implementation merges into `local-branch`
Per the request, this change deviates from the usual `web-branch → PR → main` flow: all implementation work is committed to and merged into a branch named **`local-branch`**.

## Risks / Trade-offs

- **Latency regression.** Local inference is much slower than OpenAI, and the fan-out goes serial. → D5 retunes concurrency/segments/timeouts and sets honest expectations; document latency by model size.
- **Setup burden.** Users must install Ollama, pull models, and set `OLLAMA_ORIGINS`. → Onboarding docs + a first-run "server unreachable / model missing" experience with actionable links (issue #41).
- **Structured-output fidelity.** Local models constrained by JSON schema can be less reliable than OpenAI strict mode. → Keep the existing normalize/fallback paths (`localAssembly`, per-agent `ok:false` isolation) which already tolerate imperfect output.
- **Model quality variance.** A user's chosen model may be weaker than gpt-5.5. → Recommend model tiers by hardware; the health check warns on missing models; quality is the user's tradeoff for privacy.
- **Hardware contention.** High concurrency on a single GPU can OOM. → Low default concurrency (D5).
- **Loss of resilience spec.** Dropping Firestore retry semantics (D6) is acceptable: IndexedDB is local and synchronous-ish; failures are quota/availability, handled by best-effort writes already used in `chatbot.js`.
