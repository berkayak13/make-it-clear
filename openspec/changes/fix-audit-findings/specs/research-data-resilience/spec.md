## ADDED Requirements

### Requirement: Firestore misconfiguration is surfaced

The Firestore client MUST detect a missing or empty API key and report it clearly instead of issuing requests that fail with an opaque 401.

#### Scenario: Missing API key is reported

- **WHEN** a Firestore operation is attempted with no configured `firebaseApiKey`
- **THEN** the client MUST emit a clear, visible error (console plus a stored status flag) identifying the missing key

#### Scenario: Research-logging failures are not silently swallowed

- **WHEN** `bestEffortResearchPut()` or `logResearch()` fails
- **THEN** the failure MUST be logged with enough detail to diagnose it, rather than discarded silently

### Requirement: Transient Firestore failures are retried

Firestore reads and writes MUST retry transient failures with backoff before giving up.

#### Scenario: Transient error is retried

- **WHEN** a Firestore call fails with a transient error (e.g. 503 or network timeout)
- **THEN** the client MUST retry with exponential backoff up to a bounded number of attempts before reporting failure
