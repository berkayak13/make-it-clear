## ADDED Requirements

### Requirement: Budget-bounded text coverage
The system SHALL process page text in chunks whose count scales with page size, bounded only by a run budget of `{ wallClockMs, maxTokens, maxStorageBytes }`, and SHALL NOT cap coverage at a fixed number of segments.

#### Scenario: Long page exceeds the old fixed cap
- **WHEN** a page produces more text chunks than the previous fixed limit (e.g. 22 chunks vs the old 16) and the budget has room
- **THEN** the system dispatches extraction calls for all chunks the budget allows, not a fixed 16

#### Scenario: Budget exhausted mid-page
- **WHEN** the projected token/wall-clock spend for the next text chunk would exceed the budget
- **THEN** the system stops dispatching further text chunks and does not abort already in-flight calls

#### Scenario: Normal article unaffected
- **WHEN** a typical article fits comfortably within the budget
- **THEN** all of its text chunks are extracted with no budget-driven skips

### Requirement: No silent truncation
The system SHALL record every coverage cut (skipped text chunk, skipped image, or dropped fact) in the extraction `warnings[]` and SHALL NOT discard content without a corresponding warning.

#### Scenario: Chunks skipped for budget
- **WHEN** the budget forces N text chunks to be skipped
- **THEN** `warnings[]` contains an entry naming how many chunks were skipped and why

#### Scenario: Full coverage
- **WHEN** no chunk, image, or fact is skipped
- **THEN** no truncation warning is added

### Requirement: Exhaustive, page-faithful fact extraction
The system SHALL extract ALL substantive knowledge present on the page as discrete FACT/CLAIM/QUOTE/FIGURE/COUNTER/VISUAL items — emitting each distinct point as its own atomic item rather than summarizing or merging — and SHALL NOT add related or outside information during extraction. The only content excluded is non-content page chrome (navigation, ads, cookie banners, related/trending lists, comments, footers, legal notices).

#### Scenario: Exhaustive capture
- **WHEN** a content-rich text chunk is extracted
- **THEN** every substantive fact, claim, statistic, quote, definition, example, and caveat in that chunk is emitted as its own item, not collapsed into a short highlight list

#### Scenario: No invented content
- **WHEN** a text chunk is extracted
- **THEN** every emitted fact is supported by that chunk's content and no external/related facts are introduced

#### Scenario: Consolidation preserves coverage
- **WHEN** the orchestrator merges candidate facts
- **THEN** it only collapses genuine duplicates and SHALL retain every distinct substantive fact (consolidation, not curation)

#### Scenario: Provenance tagging
- **WHEN** a fact is produced by extraction
- **THEN** it carries `provenance: "page"`

### Requirement: Knowledge stored as facts and claims, no summary
The system SHALL store the page's knowledge solely as the structured facts/claims set (plus a derived `compactText` over those facts) and SHALL NOT produce or store a separate prose summary. Renarration SHALL be driven from the facts/claims, not a summary.

#### Scenario: No summary field
- **WHEN** an extraction completes
- **THEN** the stored extraction contains no `summary` field, and the static site renders no summary block

#### Scenario: Renarration from facts
- **WHEN** the page is renarrated
- **THEN** the renarration input is the structured facts/claims list, covering every fact

### Requirement: Hierarchical reduce in the merge
The system SHALL merge candidate facts without silent loss when the combined set exceeds a single orchestrator call's output budget, by merging in batches up a tree until one set fits.

#### Scenario: Fact set exceeds one call
- **WHEN** the combined candidate facts would exceed one orchestrator call's output capacity
- **THEN** the system partitions them into batches, merges each batch, and merges the batch results, losing no distinct fact to truncation

#### Scenario: Small fact set
- **WHEN** the candidate facts fit within one orchestrator call
- **THEN** a single merge call is used (no extra reduce round)
