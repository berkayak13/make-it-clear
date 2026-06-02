## Why

The extraction pipeline silently loses content on real pages. Coverage is bounded by **fixed caps** — at most 16 text segments (~144k chars), 6–12 images, per-section truncation at 9k chars — so long articles and image-heavy pages are quietly truncated with no signal to the user. Separately, an image survives to the static site **only if a vision subagent minted a hard "FACT" from it**, so genuinely relevant photos (a portrait of the subject, a scene photo) get dropped because they carry no crisp fact. The result is a pipeline that is robust (never crashes) but not faithful (settles for a subset and pretends it covered everything).

## What Changes

- **Replace fixed coverage caps with a time/cost budget.** Text chunks and image candidates are processed up to a `{ wallClockMs, maxTokens, maxStorageBytes }` budget instead of fixed counts (`MAX_TEXT_SEGMENTS`, `BASE/MAX_DIRECT_IMAGES`, `IMAGE_MAX_RESULTS`). The number of LLM/VLM calls scales with the page.
- **No silent truncation.** Whenever the budget (or any retained resource cap) forces work to be skipped, it is recorded in `warnings[]` and surfaced. Resource caps that are platform physics (chrome.storage ~10MB quota, MV3 worker wall-clock) are kept but made explicit and reported.
- **Decouple image curation from fact extraction.** The vision step becomes a **curator + captioner**: for each image it returns `{ imageId, keep, reason, caption, fact? }`. An image is kept on **relevance to the page's main topic**, not on whether it produced a fact. A fact is a bonus, folded into the fact stream when present.
- **Strict image relevance.** Keep only images that directly illustrate the main subject (figure, chart, diagram, screenshot, photo of the subject, labeled illustration). Drop ads, logos, social icons, nav controls, unrelated avatars, decorative/stock filler, and off-topic illustrations.
- **Render each image once.** Dedup by URL + alt heuristics (CDN size variants, retina, `-scaled`, query strings, matching alt, og:image-vs-hero). Residual duplicates the heuristics cannot detect (same photo at a genuinely different URL/crop) are **logged as a known limitation**, not silently double-rendered.
- **Hierarchical reduce in the merge.** When the combined fact set exceeds one orchestrator call's output budget, facts are merged in batches up a tree instead of being silently dropped at the 10k-token ceiling.
- **Page-faithful extraction is preserved.** Extraction and renarration still add nothing beyond what is on the page. A `provenance` field (`page` | `enrichment`) is added to facts so a **future** enrichment stage can layer related context without blurring "what the page says" vs "what we added". The enrichment stage itself is **out of scope** for this change.

## Capabilities

### New Capabilities
- `page-extraction`: Budget-bounded text extraction that scales LLM calls with page size, produces page-faithful FACT/CLAIM knowledge, merges via hierarchical reduce, and reports every coverage cut instead of truncating silently.
- `image-curation`: Vision step that curates and captions images by strict relevance to the page topic, decoupled from fact extraction, with render-once deduplication and logged residual-duplicate limits.

### Modified Capabilities
<!-- None: no archived specs exist in openspec/specs/ yet. -->

## Impact

- **Code**: `src/page-flow/extract-page.js` (budget object, decoupled vision schema + prompt, hierarchical reduce, warnings discipline), `content.js` (remove `IMAGE_MAX_RESULTS` / section-count hard caps; keep cheap junk pre-filter), `src/page-flow/build-static-site.js` (`selectRelevantImages` keyed on `keep` not `fact.imageIds`; dedup + residual-dup logging), `src/page-flow/orchestrator.js` (surface new warnings to progress UI).
- **Data shape**: facts gain `provenance`; vision results gain per-image `{ keep, reason, caption }`; extraction result gains explicit `budget` usage + richer `warnings`.
- **Behavior**: more complete coverage on large pages; more (relevant) images on the static site; bounded by a budget rather than fixed counts.
- **Non-breaking** for downstream consumers (renarration reads `facts`/`compactText` as before); new fields are additive.
- **Out of scope**: the enrichment stage (only its `provenance` hook is added here).
