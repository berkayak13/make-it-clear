## Why

An automated audit of the `make-it-clear` extension (3 parallel review agents) surfaced 18 concrete defects, filed as GitHub issues #7–#24. They span a critical secret exposure, two high-severity permission/CSP risks, several background-pipeline correctness bugs (races, missing error handling, unbounded loops), content-script resource leaks, accessibility gaps, and a total absence of lint/test/CI tooling. Left unaddressed these cause silent data loss, hard-to-debug failures, and block any Chrome Web Store submission.

## What Changes

- **Secret handling** — stop shipping the OpenAI API key inside the built bundle; rotate the leaked key and move LLM calls behind a key the extension does not bake in at build time. **BREAKING**: build/runtime config for API credentials changes.
- **Extension permissions** — narrow `host_permissions` away from `<all_urls>` (or document the justification) and review/harden the content-script injection surface against the CSP.
- **Pipeline reliability** — replace the `pageRunInProgress` boolean guard with a promise-based lock; wrap the final extraction storage write in error handling; size-check `chrome.storage.local` payloads before large renarration writes; bound the image-embedding loop with an overall deadline; validate deserialized chat sessions / preferences / extracted facts; harden study-user-ID and UUID-fallback generation to use crypto-strength randomness.
- **Research-data resilience** — detect and surface a missing Firestore API key instead of failing silently; add retry/backoff for transient Firestore failures; stop swallowing research-logging errors.
- **UI robustness** — register selection-popup document listeners once; clear `revealTimer` on overlay close; revoke blob URLs on error paths; add busy/loading states to long-running buttons; add ARIA roles and modal focus management; replace deprecated `document.write` in the renarrated-page viewer.
- **Dev tooling** — add ESLint + Prettier config and scripts, a test runner with smoke tests, a CI workflow, and reconcile the `VITE_OPENAI_IMAGE_DETAIL` mismatch between `.env` and `.env.example`.

## Capabilities

### New Capabilities
- `secret-management`: how the extension obtains and handles the OpenAI API credential without exposing it in the shipped bundle (issue #7).
- `extension-permissions`: the manifest permission scope and content-security posture for content scripts (issues #8, #9).
- `pipeline-reliability`: correctness and resource-bounding guarantees for the extract/renarrate background pipeline — concurrency locking, storage-write safety, input validation, and bounded loops (issues #10, #11, #14, #15, #16, #24).
- `research-data-resilience`: reliable delivery and clear failure reporting for research/feedback data sent to Firestore (issues #12, #13).
- `ui-robustness`: lifecycle correctness and accessibility for injected UI — listener/timer/blob cleanup, busy states, ARIA, and modern DOM APIs (issues #17, #18, #19, #20, #21, #22).
- `dev-tooling`: lint, format, test, and CI tooling plus environment-config consistency (issue #23).

### Modified Capabilities
<!-- None — openspec/specs/ is currently empty; all capabilities are new. -->

## Impact

- **Code**: `manifest.json`; `src/utils/openai-client.js`, `firestore-client.js`, `storage-helpers.js`, `id.js`; `src/page-flow/orchestrator.js`, `extract-page.js`, `build-static-site.js`; `src/handlers/chatbot.js`; `content.js`, `clear-overlay.js`, `options.js`, `viewers/extracted-content.js`, `viewers/renarrated-page.js`.
- **Build/config**: `.env`, `.env.example`, `vite.config.js`, `package.json`; new ESLint/Prettier/test/CI config files and `.github/workflows/`.
- **Operational**: the leaked OpenAI key must be rotated; if LLM calls move behind a proxy or user-supplied key, the credential-provisioning flow changes for all users.
- **Dependencies**: adds dev dependencies (ESLint, Prettier, a test runner such as Vitest).
