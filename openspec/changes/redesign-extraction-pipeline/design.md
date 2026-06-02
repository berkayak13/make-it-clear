## Context

The extraction pipeline is a map-reduce running across two execution contexts:

- **`content.js`** (in-page): walks the DOM into `sections[]` (heading + text + imageIds) and scores/filters `images[]`. Hard caps today: `SECTION_TEXT_CHARS = 9000` per section, `SECTION_MAX_RESULTS = 160`, `IMAGE_MAX_RESULTS = 40`.
- **`src/page-flow/extract-page.js`** (MV3 background service worker): plans text segments (capped `MAX_TEXT_SEGMENTS = 16`), pre-selects images (`BASE/MAX_DIRECT_IMAGES = 6/12` by heuristic score), runs N text subagents + N vision subagents in parallel, then a single orchestrator merge (`MAX_ORCHESTRATOR_OUTPUT_TOKENS = 10000`). Robust failure handling already exists: per-agent `ok:false` isolation, per-call timeouts, data-URI image fetch to dodge OpenAI download failures, and a `localAssembly` fallback when the orchestrator fails.
- **`src/page-flow/build-static-site.js`**: `selectRelevantImages()` keeps only images referenced by a fact's `imageIds`, strips ads, dedupes by URL/alt.

Two platform constraints are non-negotiable: `chrome.storage.local` has a hard ~10MB quota, and the MV3 service worker is killed if it appears unresponsive. These bound any "process everything" ambition.

The work builds on in-flight uncommitted edits that already shifted prompts from *exhaustive* to *curated* (drop chrome/ads, be selective). This change keeps that curation-quality direction and adds budget-bounded coverage on top.

## Goals / Non-Goals

**Goals:**
- Coverage scales with the page, bounded by a time/cost budget — not by fixed segment/image counts.
- No silent truncation: every coverage cut is recorded and surfaced.
- Images are curated and captioned by relevance to the page topic, decoupled from fact extraction.
- Each kept image renders exactly once.
- The fact merge never silently drops facts when the set is large.
- Extraction stays strictly page-faithful.

**Non-Goals:**
- The enrichment stage that adds related/outside context (only its `provenance` hook is added now).
- Replacing the OpenAI dependency or the on-device model story.
- Perceptual-hash or VLM-assisted semantic image dedup (explicitly deferred; see Decisions).
- Changing the renarration prompt/flow beyond consuming the new fields.

## Decisions

### D1: Time/cost budget replaces fixed coverage caps
A single `budget = { wallClockMs, maxTokens, maxStorageBytes }` governs the run. The planner estimates per-call cost (chars→token estimate) and **stops dispatching** new text/image calls when projected spend would exceed the budget — it does not abort in-flight calls. Wall-clock is the hard master (MV3 kill risk); token cost is the soft ceiling.
- *Alternatives considered:* (a) **Truly unbounded** — rejected: risks worker kills, storage-quota failures, unbounded cost. (b) **Higher fixed caps** — rejected: only moves the silent cliff further out, still silent.
- *Why:* matches "n scales with the page", respects platform physics, and the stop condition is computed, not magic.

### D2: No silent truncation — `warnings[]` is the coverage ledger
Any time the budget or a retained resource cap skips a chunk, image, or fact, an entry is appended to `warnings[]` (e.g. "Budget reached: 3 of 22 text chunks skipped"). The channel already exists but is used inconsistently (only `limitTextSegments` warns today). This change makes its use mandatory at every cut site.

### D3: Vision step becomes a curator + captioner, decoupled from facts
The vision subagent schema changes from a fact list to per-image verdicts: `{ imageId, keep: boolean, reason: string, caption: string, fact?: string }`. Downstream, `selectRelevantImages` keeps images where `keep === true` instead of where a fact references them; the caption becomes the figure caption; a present `fact` is folded into the fact stream (source `image`).
- *Alternative considered:* keep fact-coupling — rejected: drops relevant photos that yield no crisp fact, which is exactly the static-site use case.

### D4: Strict relevance bar
Keep an image only if it directly illustrates the page's main subject (figure, chart, diagram, screenshot, photo of the subject, labeled illustration). The vision prompt enumerates explicit drop categories (ads, logos, social icons, nav controls, unrelated avatars, decorative/stock filler, off-topic). The cheap `content.js` junk pre-filter stays (removes non-content like 1×1 pixels, icons) but no longer hard-caps image count — the VLM is the authoritative judge.

### D5: Render-once dedup via URL + alt heuristics (residual logged)
Dedup keys: exact URL, normalized URL (strip `-1200x630`, `@2x`, `-scaled`, `?w=…`), matching alt text, og:image-vs-in-content-hero. The same photo at a genuinely different URL or different crop is **not** detectable by these heuristics.
- *Alternatives considered:* (a) **VLM-assisted semantic dedup** and (b) **perceptual hash** — both deferred for cost/complexity. They remain a one-step upgrade (the VLM already describes every kept image).
- *Mitigation for the gap:* strict relevance shrinks the kept set (fewer dup chances), and any pair that shares no key but may be identical is **logged** per D2 — never silently double-rendered.

### D6: Hierarchical reduce in the merge
When the combined candidate fact set exceeds one orchestrator call's output budget, facts are partitioned into batches, each batch merged, then the batch results merged again — recursing until one set fits. Replaces the single capped call that silently drops overflow.
- *Alternative considered:* single call with a bigger token ceiling — rejected: still a hard cliff on very large pages.

### D7: `provenance` field for future enrichment
Each fact gains `provenance: 'page' | 'enrichment'`, defaulting to `'page'`. Nothing sets `'enrichment'` in this change; the field exists so a later stage can add related context without blurring page-faithful content. Keeps the data model forward-compatible at near-zero cost.

## Risks / Trade-offs

- **Budget estimation is approximate (chars→tokens).** A bad estimate could over- or under-spend. → Use a conservative multiplier, treat wall-clock as the hard stop, and always reconcile actual usage into `warnings[]`.
- **More calls = more cost/latency on huge pages.** → The budget is the explicit ceiling; defaults tuned so a normal article behaves like today, only large pages spend more.
- **Hierarchical reduce adds an extra LLM round on very large pages.** → Only triggers above the single-call threshold; small/medium pages keep the single-call path.
- **URL+alt dedup leaves a known gap (D5).** → Logged, not silent; upgrade path documented.
- **MV3 worker kill mid-run.** → Wall-clock budget is sized under the worker's tolerance; partial results still flow through `localAssembly` and are saved.
- **Storage quota on image-heavy pages.** → `maxStorageBytes` is part of the budget; embedding stops and logs before exceeding quota (existing `MAX_TOTAL_EMBED_BYTES` becomes budget-derived).

## Migration Plan

Additive and non-breaking: renarration still reads `facts`/`compactText`. New fields (`provenance`, per-image `keep`/`caption`) are optional to consumers. Rollback = revert the branch; no data migration, since extractions are regenerated per run and stored in `chrome.storage.local`.

## Open Questions

- Default budget values (`wallClockMs`, `maxTokens`) — tune against a sample of real pages during implementation; expose via config if needed.
- Whether to surface a user-facing "N items skipped (budget)" notice in the overlay, or keep it to `warnings[]` only.
