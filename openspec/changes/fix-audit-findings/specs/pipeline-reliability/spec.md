## ADDED Requirements

### Requirement: Page renarration runs are serialized

The background pipeline MUST guarantee that only one page renarration run executes at a time, with no check-and-set race across `await` boundaries.

#### Scenario: Concurrent requests do not overlap

- **WHEN** two `run-page-renarration-from-extraction` messages arrive before the first run completes
- **THEN** the second request MUST be rejected or queued, and the two runs MUST NOT execute concurrently

### Requirement: Storage writes are size-checked and error-handled

The pipeline MUST handle `chrome.storage.local` write failures gracefully and avoid attempting writes that exceed the quota.

#### Scenario: Final extraction write failure is caught

- **WHEN** the final `chrome.storage.local.set` of `lastExtraction` fails
- **THEN** the failure MUST be caught and reported as a clear error rather than surfacing as an uncaught rejection

#### Scenario: Oversized renarration payload is handled

- **WHEN** a renarration payload (including embedded image data) would exceed the available storage quota
- **THEN** the pipeline MUST detect this before writing and either trim the payload or report a clear quota error

### Requirement: Bounded image embedding

The static-site image-embedding loop MUST be bounded by an overall deadline (and/or a total-bytes budget), not only a per-image timeout.

#### Scenario: Slow page does not hang the worker

- **WHEN** a page has many slow or unreachable images
- **THEN** the embedding loop MUST stop once the overall deadline is reached and fall back to leaving remaining images as remote URLs

### Requirement: Stored and model-produced data is validated

Code that reads chat sessions, user preferences, or model-produced facts MUST validate shape before use.

#### Scenario: Corrupt stored data does not crash handlers

- **WHEN** `getLocalChatSessions()` / `getLocalUserPreferences()` read malformed data
- **THEN** the handler MUST coerce or skip invalid entries and continue without throwing

#### Scenario: Malformed fact is normalized safely

- **WHEN** `normalizeFact()` receives `null`, `undefined`, or a primitive
- **THEN** it MUST produce a valid default or skip the entry rather than emit a corrupted fact

### Requirement: Identifiers use crypto-strength randomness

Study user IDs and fallback UUIDs MUST be generated with sufficient entropy to be effectively unique.

#### Scenario: Study user ID is not collision-prone

- **WHEN** a study user ID is generated
- **THEN** it MUST be derived from a cryptographic random source, not the last 4 digits of `Date.now()`

#### Scenario: Concurrent ID creation is atomic

- **WHEN** multiple callers invoke `getOrCreateUserId()` concurrently with no stored ID
- **THEN** all callers MUST resolve to a single consistent stored ID
