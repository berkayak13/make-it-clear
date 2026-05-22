## ADDED Requirements

### Requirement: Injected UI does not leak listeners, timers, or blob URLs

Injected UI MUST clean up document-level listeners, intervals, and object URLs across its lifecycle.

#### Scenario: Selection-popup listeners are registered once

- **WHEN** the user makes multiple text selections
- **THEN** the `click` / `selectionchange` document listeners MUST NOT accumulate — they are registered once or removed when the popup hides

#### Scenario: Reveal timer is cleared on overlay close

- **WHEN** the overlay panel closes while `revealWords()` is running
- **THEN** the `revealTimer` interval MUST be cleared

#### Scenario: Blob URL is revoked on error

- **WHEN** an error occurs after a blob URL is created in the extracted-content viewer
- **THEN** the blob URL MUST still be revoked (e.g. in a `finally` block)

### Requirement: Long-running actions show a busy state

Buttons that trigger operations lasting several seconds MUST present a clear in-progress state for the full duration.

#### Scenario: Renarrate / build buttons indicate progress

- **WHEN** the "Renarrate this page" or "Build static site" action is running
- **THEN** the triggering button MUST stay disabled with a visible progress indicator until the operation settles, re-enabling in a `finally` path

### Requirement: Injected UI is accessible

Injected UI surfaces MUST expose appropriate ARIA semantics and manage keyboard focus.

#### Scenario: Selection popup is announced

- **WHEN** the selection popup appears or its result loads
- **THEN** it MUST carry a `role` and `aria-live` so assistive technology announces it

#### Scenario: Modal focus is restored

- **WHEN** the options-page task modal closes
- **THEN** focus MUST return to the control that opened it

### Requirement: Renarrated viewer avoids deprecated DOM APIs

The renarrated-page viewer MUST render content without `document.write()`.

#### Scenario: Viewer builds DOM directly

- **WHEN** the renarrated-page viewer renders content
- **THEN** it MUST use DOM-builder APIs (e.g. `createElement` / `DocumentFragment`) instead of `document.open()` / `document.write()`
