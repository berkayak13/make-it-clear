## ADDED Requirements

### Requirement: Research data persisted on-device in IndexedDB
The system SHALL persist all research data — `chatSessions`, `researchLogs`, `feedbackEvents`, and `userPreferences` — in a local IndexedDB database (`renarration-research`), and SHALL NOT send research data to any remote store.

#### Scenario: Write a feedback event
- **WHEN** the user submits feedback
- **THEN** the feedback event is stored in the local IndexedDB `feedbackEvents` store with no network request

#### Scenario: Persist a chat session
- **WHEN** a side-panel chat session is saved
- **THEN** it is written to the local IndexedDB `chatSessions` store keyed by `sessionId`

#### Scenario: Auto-generated key
- **WHEN** a `userPreferences` record is stored without a `preferenceId`
- **THEN** an id is generated and the record is persisted

### Requirement: Equivalent storage API surface
The system SHALL provide `researchPut`, `researchGet`, `researchGetAll`, `researchGetByIndex`, `researchClearStore`, and `researchExportCSV` with behavior equivalent to the prior Firestore client, so callers depend only on import path.

#### Scenario: Query by index
- **WHEN** `researchGetByIndex('userPreferences', 'userId', value)` is called
- **THEN** it returns all `userPreferences` records whose `userId` matches the value

#### Scenario: Read all records
- **WHEN** `researchGetAll(storeName)` is called
- **THEN** it returns every record in that store

#### Scenario: Clear a store
- **WHEN** `researchClearStore(storeName)` is called
- **THEN** all records in that store are removed

#### Scenario: CSV export
- **WHEN** `researchExportCSV(records)` is called with research records
- **THEN** it produces the same CSV output as before the migration

### Requirement: Works across extension contexts
The system SHALL provide research storage usable from both the background service worker and the sidepanel/viewer contexts.

#### Scenario: Dashboard read
- **WHEN** the research dashboard (a viewer context) loads stored research data
- **THEN** it reads the same records written by the background service worker

### Requirement: No Firestore or Firebase dependency
The system SHALL contain no live Firestore/Firebase code, configuration, or options UI after the migration.

#### Scenario: No remaining references
- **WHEN** the source, options, and viewers are searched for `firestore` or `firebase`
- **THEN** no live references remain

#### Scenario: No Firebase config in options
- **WHEN** the options page is opened
- **THEN** no Firebase project/key fields are present
