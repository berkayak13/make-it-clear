> Tracking: GitHub epic #33 (issues #34–#42). Implementation merges into `local-branch`.

## 1. Ollama transport client — issue #34

- [ ] 1.1 Add `src/utils/ollama-client.js` hitting `${baseUrl}/v1/chat/completions` (`stream:false`), exposing the same surface as `openai-client.js` (`callText`/`callJson` + config)
- [ ] 1.2 Map params: `temperature` → top-level/`options`; `maxOutputTokens` → `max_tokens`; `timeoutMs` → `AbortController`; drop `reasoning`/`store` (keep args as no-ops)
- [ ] 1.3 Map strict JSON-schema output to `response_format: {type:'json_schema', json_schema:{name,strict,schema}}`; preserve parse + truncation/oversize retry guard
- [ ] 1.4 Point `src/utils/llm-dispatch.js` (`callLLM`) at the new client; update imports in `extract-page.js`, `renarrate-page.js`, `renarration.js`, `chatbot.js`
- [ ] 1.5 Verify a text call and a JSON-schema call validate against `extractionStageSchema` / `finalExtractionSchema` / `captionSchema`; remove `src/utils/openai-client.js`

## 2. Runtime config + connection health — issue #35

- [ ] 2.1 Add options fields: Ollama base URL (default `http://localhost:11434`), text model, vision model (default `qwen2.5vl:7b`), optional timeout
- [ ] 2.2 Client reads config from `chrome.storage` with `onChanged` cache invalidation (mirror `firestore-client.js` cache pattern)
- [ ] 2.3 Add a "Test connection" action pinging `/api/tags` (or `/v1/models`): report reachable + installed models, warn on a missing configured model
- [ ] 2.4 Expose a readable connection status the rest of the UI can consume

## 3. Multimodal vision via local VLM — issue #36

- [ ] 3.1 Route `runVisionSubagents` images to the configured vision model via the new client (OpenAI-compat `image_url` data URIs, or native base64 `images[]`)
- [ ] 3.2 Preserve `fetchImageAsDataUrl`, the 3MB cap, and dead-URL/zero-image skip behavior; treat OpenAI `detail` as a no-op locally
- [ ] 3.3 Confirm visual facts still carry `source:'image'` + correct `imageIds`; a no-image page completes text-only

## 4. Serial-inference fan-out — issue #37

- [ ] 4.1 Make `TEXT_CONCURRENCY` / `IMAGE_CONCURRENCY` configurable (low default 1–2) via options/storage
- [ ] 4.2 Retune segment sizing (`TEXT_SEGMENT_CHARS`, `MAX_TEXT_SEGMENTS`) for fewer, larger local calls; measure
- [ ] 4.3 Raise/retune timeouts (`TEXT/IMAGE_STAGE_TIMEOUT_MS`, `ORCHESTRATOR_TIMEOUT_MS`) for local first-token + cold-load latency
- [ ] 4.4 Make progress messaging honest about local timing; document expected latency by model size

## 5. IndexedDB research store — issue #38

- [ ] 5.1 Implement the `renarration-research` IndexedDB stores matching `RESEARCH_STORES` (keyPaths + autoGenerate for `userPreferences`)
- [ ] 5.2 Add a `userId` index to back `researchGetByIndex`
- [ ] 5.3 Expose the identical six functions (`researchPut/Get/GetAll/GetByIndex/ClearStore/ExportCSV`); port `researchExportCSV` as-is
- [ ] 5.4 Consolidate with existing inline IndexedDB in `background.js` / `lib/research-db.js`; work in both service-worker and viewer/sidepanel contexts

## 6. Migrate callsites + remove Firestore — issue #39

- [ ] 6.1 Swap imports in `handlers/simple.js`, `handlers/chatbot.js`, `viewers/research-dashboard.js` to the IndexedDB module
- [ ] 6.2 Delete `src/utils/firestore-client.js`; remove `firebaseProjectId`/`firebaseApiKey`/`firestoreStatus` usage and Firebase fields from options
- [ ] 6.3 `grep -ri "firestore\|firebase"` returns no live references in `src/`, options, or viewers

## 7. Config / build / permissions — issue #40

- [ ] 7.1 Remove all `VITE_OPENAI_*` env usage; update `.env` / `.env.example`
- [ ] 7.2 Confirm `<all_urls>` (or add explicit `http://localhost:11434/*`) covers the local fetch; verify CSP doesn't block; clean `vite.config.js`
- [ ] 7.3 Document the `OLLAMA_ORIGINS=chrome-extension://<id>` CORS requirement and surface it in the connection-test error path

## 8. Docs / onboarding — issue #41

- [ ] 8.1 README: install Ollama, pull text + vision models, start with `OLLAMA_ORIGINS`, configure options; recommend model tiers by hardware
- [ ] 8.2 First-run UX: server-unreachable / model-missing shows an actionable, linked message (ties to 2.3)
- [ ] 8.3 Update `SECURITY.md` privacy story; remove OpenAI-key / Firestore instructions everywhere

## 9. Verification — issue #42

- [ ] 9.1 Unit-test the new client's param mapping, JSON-schema parsing, truncation/retry, timeout/abort (mock `fetch`)
- [ ] 9.2 Test the IndexedDB module's six functions + the `userId` index across the four stores
- [ ] 9.3 Degradation tests: Ollama unreachable; model not pulled; no-image page (text-only); all-image-fetches-fail batch skipped; orchestrator-failure → `localAssembly` fallback
- [ ] 9.4 Remove tests referencing OpenAI/Firestore creds; re-run the pending `7.2 e2e` audit item against the local stack; `npm run lint` passes
- [ ] 9.5 Manual smoke: load the unpacked extension and renarrate a real article + an image-heavy page against a local Ollama instance
