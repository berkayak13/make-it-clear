## 1. Dev tooling (issue #23)

- [x] 1.1 Add ESLint flat config and Prettier config; add `lint` and `format` scripts to `package.json`
- [x] 1.2 Add Vitest as a dev dependency with a `test` script
- [x] 1.3 Write smoke tests for `src/utils` pure functions (e.g. `id.js`, `normalizeFact`)
- [x] 1.4 Add a `.github/workflows/ci.yml` running install → build → lint → test on push/PR
- [x] 1.5 Reconcile `VITE_OPENAI_IMAGE_DETAIL` between `.env` and `.env.example`; document each var in `.env.example`

## 2. Pipeline reliability (issues #10, #11, #14, #15, #16, #24)

- [x] 2.1 Replace the `pageRunInProgress` boolean in `src/page-flow/orchestrator.js` with an in-flight-promise lock so renarration runs are serialized (#10)
- [x] 2.2 Wrap the final `chrome.storage.local.set({ lastExtraction })` in `src/page-flow/extract-page.js` in try/catch with a clear error (#14)
- [x] 2.3 Add a pre-write size check before storing `lastPageRenarration` / `lastRenarratedSite` in `orchestrator.js`; trim or report a quota error if oversized (#15)
- [x] 2.4 Add an overall deadline (and/or total-bytes budget) to the image-embedding loop in `src/page-flow/build-static-site.js`; fall back to remote URLs past the deadline (#24)
- [x] 2.5 Add shape validation to `getLocalChatSessions()` / `getLocalUserPreferences()` in `src/handlers/chatbot.js` and to `normalizeFact()` in `extract-page.js` (#16) — container checks and primitive handling were already present; added per-element guarding in `getLocalUserPreferences()`
- [x] 2.6 Use `crypto.randomUUID()` for the study user ID in `src/utils/storage-helpers.js` and make `getOrCreateUserId()` atomic; harden the `id.js` UUID fallback to use `crypto.getRandomValues` (#11)

## 3. Research-data resilience (issues #12, #13)

- [x] 3.1 In `src/utils/firestore-client.js`, detect a missing/empty `firebaseApiKey` before requesting and emit a clear visible error plus a stored status flag (#12)
- [x] 3.2 Stop silently swallowing `bestEffortResearchPut()` / `logResearch()` failures in `src/handlers/chatbot.js` — log them with diagnostic detail (#12) — both already `console.warn` failures; the new missing-key error now surfaces through that logging
- [x] 3.3 Add a `withRetry` helper in `firestore-client.js` and wrap `researchPut` / `researchGet` / `researchGetByIndex` with exponential backoff on transient errors (#13)

## 4. UI robustness (issues #17, #18, #19, #20, #21, #22)

- [x] 4.1 Register the selection-popup `click` / `selectionchange` document listeners once (or remove them in `hideSelectionPopup()`) in `content.js` (#17) — already correct: `showSelectionPopup()` calls `hideSelectionPopup()` first (which `removeEventListener`s both), and re-adding an identical listener triple is a DOM no-op, so no accumulation occurs
- [x] 4.2 Clear `revealTimer` when the overlay panel closes in `clear-overlay.js` (#18)
- [x] 4.3 Revoke the blob URL in a `finally` block in `viewers/extracted-content.js` (#19)
- [x] 4.4 Add a held disabled state + progress indicator to the "Renarrate this page" and "Build static site" buttons (`clear-overlay.js`, `viewers/extracted-content.js`) (#20) — added a spinner to the renarrate button; the static-site button already held disabled + streamed progress text + re-enabled in `finally`
- [x] 4.5 Add `role` + `aria-live` to the selection popup in `content.js`; restore focus to the trigger on task-modal close in `options.js` (#21)
- [x] 4.6 Replace `document.open()` / `document.write()` in `viewers/renarrated-page.js` with DOM-builder APIs (#22)

## 5. Extension permissions (issues #8, #9)

- [x] 5.1 Document the `<all_urls>` justification in `SECURITY.md` + README (#8) — superseded the "narrow + activeTab" plan: `host_permissions: <all_urls>` is required for the background to fetch third-party images for static-site embedding, which `activeTab` cannot cover
- [x] 5.2 Audit every `innerHTML` sink in `content.js` / `clear-overlay.js`; document the content-script CSP posture (#9) — all sinks take static markup or `escapeHtml()`/`esc()`-escaped input; documented in `SECURITY.md`

## 6. Secret management (issue #7 — document risk only)

- [ ] 6.1 Rotate/revoke the leaked `sk-proj-…` key — **REQUIRES PROJECT OWNER ACTION**: the agent cannot access the OpenAI account. Revoke the old key and issue a new one in the OpenAI dashboard.
- [x] 6.2 Document the build-time key exposure (README/SECURITY note): the bundled key is extractable, and the mitigation is key rotation + usage limits until a runtime-credential flow is built
- [x] 6.3 File a follow-up note that the `secret-management` spec's runtime-credential requirement remains open for a future change

## 7. Verification

- [x] 7.1 Run `lint` and `test` — all pass (build OK, lint 0 errors / 12 pre-existing warnings, 3/3 tests, knip clean)
- [ ] 7.2 Load the unpacked extension and exercise extract → renarrate → static-site end to end — **REQUIRES MANUAL VERIFICATION**: needs a real Chrome with a configured OpenAI key; cannot be run by the agent
- [x] 7.3 Confirm each of issues #7–#24 is addressed (see the change PR description for the issue-by-issue mapping)
