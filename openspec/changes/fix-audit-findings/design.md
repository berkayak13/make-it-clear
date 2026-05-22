## Context

`make-it-clear` is a Manifest V3 Chrome extension with no framework and no backend. The
service worker, content scripts, and viewer pages all run client-side. LLM access today
uses an OpenAI key inlined at build time via Vite (`import.meta.env.VITE_OPENAI_API_KEY`),
which means the key ships inside `build/background-entry.js`. Research/feedback data is
written directly to Firestore via its REST API using a `firebaseApiKey` from
`chrome.storage.local`.

This change bundles 18 audited defects (GitHub #7–#24) into one coordinated fix. Most are
independent and low-risk; the exception is the API-key fix (#7), which changes how the
extension is credentialed and is therefore the main thing this design resolves.

## Goals / Non-Goals

**Goals:**
- Remove the live OpenAI key from the shipped bundle and rotate the leaked one.
- Make the background pipeline correct under concurrency and resilient to storage/network failure.
- Stop silent data loss in research logging.
- Eliminate injected-UI resource leaks and close the worst accessibility gaps.
- Establish lint/format/test/CI baselines so future regressions are caught.

**Non-Goals:**
- No redesign of the renarration pipeline or agent architecture.
- No new product features; behavior changes only where an audit finding requires it.
- No backend service is built in this change unless the proxy option is explicitly chosen.
- No full WCAG audit — only the specific ARIA/focus gaps in issues #20–#21.

## Decisions

### D1 — API key: user-supplied key stored locally (recommended default)
Replace the build-time `import.meta.env.VITE_OPENAI_API_KEY` with a key the user enters in
the options page, stored in `chrome.storage.local` and read at call time in
`openai-client.js`. Rationale: the project has no backend, and any value bundled into an
extension is publicly extractable — a build-time secret cannot be made safe. A user-supplied
key keeps the extension fully client-side.
- *Alternative considered:* a server-side proxy holding the key. Stronger (the key never
  reaches the client) but requires standing up and operating a backend — out of scope unless
  the user opts in. Captured in Open Questions.
- Regardless of option, the leaked `sk-proj-…` key MUST be rotated.

### D2 — Concurrency lock via in-flight promise
Replace the `pageRunInProgress` boolean in `orchestrator.js` with a module-level variable
holding the in-flight run `Promise` (or `null`). New requests check-and-set synchronously
in one tick, then reject/queue. This removes the across-`await` race.

### D3 — Defensive boundaries, not schema rewrites
For #14/#15/#16, add `try/catch`, pre-write size checks (`JSON.stringify(...).length` vs a
safe threshold below `QUOTA_BYTES`), and shape validation at the existing read/normalize
sites. No storage-format migration — existing data stays readable.

### D4 — Crypto-strength IDs
Use `crypto.randomUUID()` for the study user ID and as the primary UUID path; keep a
`crypto.getRandomValues`-based fallback. `getOrCreateUserId()` becomes atomic by caching the
in-flight creation promise so concurrent callers share one result.

### D5 — Firestore retry helper
Add one small `withRetry(fn, {attempts, baseDelay})` helper in `firestore-client.js` wrapping
the existing `researchPut`/`researchGet`/`researchGetByIndex` calls; retry only on transient
status codes / network errors. Detect empty API key before the first request.

### D6 — Tooling: ESLint + Prettier + Vitest + GitHub Actions
ESLint (flat config) + Prettier with `lint`/`format`/`test` scripts; Vitest for `src/utils`
smoke tests (pure functions like `id.js`, `normalizeFact`); a single CI workflow running
install → build → lint → test.

## Risks / Trade-offs

- **[D1 changes onboarding]** → Existing users lose LLM access until they paste a key.
  Mitigation: clear options-page guidance and an explicit "configure your key" error from
  `openai-client.js` (already required by the `secret-management` spec).
- **[Pre-write size checks are heuristic]** `JSON.stringify().length` ≠ exact stored bytes.
  Mitigation: use a conservative threshold and still keep the `try/catch` fallback.
- **[Bounded image loop drops images]** Hitting the deadline leaves some images as remote
  URLs. Mitigation: acceptable degradation; the alternative is an unresponsive worker.
- **[Lint on legacy code]** ESLint will flag many pre-existing issues. Mitigation: start with
  a lean rule set (errors only) and treat warnings as non-blocking initially.
- **[Permission narrowing]** Restricting `<all_urls>` could break renarrating arbitrary
  sites. Mitigation: if narrowing isn't viable, the spec permits documenting the
  justification instead.

## Migration Plan

1. Rotate the leaked OpenAI key first (operational, before/independent of code).
2. Land tooling (#23) early so subsequent batches are linted/tested.
3. Land independent fixes (pipeline, research-data, UI) in any order — no inter-dependencies.
4. Land the API-key change (#7) last; ship options-page guidance in the same batch.
5. Rollback: each batch is self-contained and revertible; the key rotation is not reversible
   (a new key is simply issued).

## Resolved Decisions (confirmed at apply time)

- **API key (#7) — document risk only.** Keep the build-time key for now; do not add a
  user-supplied-key flow or proxy. Still rotate the leaked `sk-proj-…` key and document the
  exposure clearly. This supersedes D1; the `secret-management` spec's runtime-credential
  requirement is deferred — only the rotation + documentation scenarios apply for now.
- **Host permissions (#8) — document justification (revised at apply time).** The initial
  "narrow + `activeTab`" plan was dropped during implementation: `host_permissions:
  <all_urls>` is required for the background worker to fetch third-party images for
  static-site embedding (`collectImageDataURIs`), which `activeTab` cannot provide.
  `<all_urls>` is retained and its rationale documented in `SECURITY.md` — which the
  `extension-permissions` spec explicitly permits.
