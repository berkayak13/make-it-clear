## 1. Budget infrastructure

- [x] 1.1 Add a `buildBudget()` helper producing `{ wallClockMs, maxTokens, maxStorageBytes, startedAt }`, derived from `OPENAI_CONFIG` timeouts and MV3-safe defaults
- [x] 1.2 Add a token-cost estimator (`estimateTokens(chars)`) and a running spend tracker shared across text + vision dispatch
- [x] 1.3 Add a `canDispatch(projectedCost)` gate that returns false once wall-clock or token budget would be exceeded

## 2. Remove fixed coverage caps + warnings discipline

- [x] 2.1 Remove `MAX_TEXT_SEGMENTS` truncation in `extract-page.js`; dispatch all planned segments gated by `canDispatch`, logging skipped segments to `warnings[]`
- [x] 2.2 Replace `BASE_DIRECT_IMAGES` / `MAX_DIRECT_IMAGES` heuristic image cap with budget-gated image dispatch (all candidate images eligible)
- [x] 2.3 Raise/remove `IMAGE_MAX_RESULTS`, `SECTION_MAX_RESULTS` hard caps in `content.js`; keep the cheap junk pre-filter (decorative/ad regex, container checks, tiny-image checks)
- [x] 2.4 Audit every cut site (segment, image, fact, embed) to append a `warnings[]` entry; remove any silent `.slice()` truncation that drops content

## 3. Decoupled image curation (vision)

- [x] 3.1 Change the vision schema to per-image verdicts `{ imageId, keep, reason, caption, fact? }`
- [x] 3.2 Rewrite `buildVisionPrompt` to instruct strict relevance keep/drop + a brief caption per kept image, fact optional
- [x] 3.3 Normalize vision results into kept-image records + optional facts (source `image`); attach captions to the image objects

## 4. Image retention, dedup, captions on the static site

- [x] 4.1 Rewrite `selectRelevantImages` in `build-static-site.js` to keep images where `keep === true` (not fact-gated)
- [x] 4.2 Use the VLM caption as the figure caption; fall back to original page caption/alt
- [x] 4.3 Keep URL + alt dedup; add a residual-duplicate detector that logs a warning when two kept images may match but share no key
- [x] 4.4 Ensure each kept image renders exactly once across sections + gallery

## 5. Hierarchical reduce in the merge

- [x] 5.1 Add a `reduceFactsHierarchically()` that batches candidate facts when they exceed one orchestrator call's output budget, merges each batch, then merges the batch results
- [x] 5.2 Route the orchestrator through the reducer; preserve the existing single-call path for small fact sets
- [x] 5.3 Keep the `localAssembly` fallback; add a warning when any reduce batch fails

## 6. Provenance + data shape

- [x] 6.1 Add `provenance: 'page' | 'enrichment'` to the fact schema and `normalizeFact`, defaulting to `'page'`
- [x] 6.2 Thread the new `budget` usage + richer `warnings` into the stored extraction object

## 7. Surface coverage to the UI

- [x] 7.1 Pass budget-skip / residual-dup warnings through `orchestrator.js` progress messages so the overlay can show "N items skipped"

## 8. Verification

- [ ] 8.1 Manually load the unpacked extension and run extraction on a long article — confirm coverage beyond the old 16-segment cap and a clean `warnings[]`
- [ ] 8.2 Run on an image-heavy page — confirm relevant images survive without facts, ads/avatars dropped, no duplicate figures
- [ ] 8.3 Run on a huge page — confirm budget stops dispatch gracefully, warnings list the skips, no MV3 worker kill
- [x] 8.4 `npm run lint` (and any existing tests) pass

## 9. Exhaustive extraction + remove summary

- [x] 9.1 Rewrite `buildTextPrompt` to be EXHAUSTIVE — every substantive point as its own atomic fact/claim, skip only chrome, add nothing
- [x] 9.2 Rewrite the orchestrator prompt to CONSOLIDATE (merge true duplicates only), not curate down to a focused set
- [x] 9.3 Raise output-token caps (`MAX_TEXT_OUTPUT_TOKENS`, `MAX_ORCHESTRATOR_OUTPUT_TOKENS`) and run token budget so comprehensive output isn't truncated
- [x] 9.4 Remove `summary` from the stage + final schemas, normalization, assembly, orchestrator output, `meta`, and the stored extraction object
- [x] 9.5 Remove the summary block + unused `.cl-summary` CSS from the static-site builder
- [x] 9.6 Confirm renarration is driven from facts/claims only (no summary dependency)
