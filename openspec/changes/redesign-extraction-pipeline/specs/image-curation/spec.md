## ADDED Requirements

### Requirement: Vision step curates and captions, decoupled from facts
The vision subagent SHALL return a per-image verdict `{ imageId, keep, reason, caption, fact? }`, and image retention SHALL depend on `keep` rather than on whether a fact references the image.

#### Scenario: Relevant photo without a fact survives
- **WHEN** an image is on-topic (e.g. a photo of the article's subject) but yields no crisp fact
- **THEN** the image is kept because `keep === true`, with its caption, and is rendered on the static site

#### Scenario: Optional fact is folded in
- **WHEN** the vision step returns a `fact` for a kept image
- **THEN** that fact is added to the fact stream with source `image`

#### Scenario: Image is not gated on facts
- **WHEN** a kept image has no associated fact
- **THEN** it is still selected for the static site (retention is not fact-gated)

### Requirement: Strict image relevance
The system SHALL keep only images that directly illustrate the page's main subject and SHALL drop ads, logos, social icons, navigation controls, unrelated avatars, decorative or stock filler, and off-topic illustrations.

#### Scenario: Off-topic image dropped
- **WHEN** an image is an advertisement, logo, social icon, or unrelated avatar
- **THEN** the vision step returns `keep === false` and the image is excluded

#### Scenario: Topic illustration kept
- **WHEN** an image is a figure, chart, diagram, screenshot, or photo of the subject
- **THEN** the vision step returns `keep === true`

### Requirement: Render each image once
The system SHALL render each kept image at most once, deduplicating by URL and alt heuristics (CDN size variants, retina markers, `-scaled` suffix, query strings, matching alt text, og:image-vs-in-content-hero).

#### Scenario: Same photo at CDN size variants
- **WHEN** the same photo appears as `hero-1200x630.jpg` and `hero-800x420.jpg`
- **THEN** only one figure is rendered for it

#### Scenario: og:image duplicates in-content hero
- **WHEN** the og:image is the same picture as an in-content hero
- **THEN** only the in-content image is rendered

#### Scenario: Undetectable duplicate is logged
- **WHEN** two kept images may be the same photo but share no URL or alt key
- **THEN** the system logs a residual-duplicate warning rather than silently rendering both without note
