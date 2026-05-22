## ADDED Requirements

### Requirement: OpenAI credential is not exposed in the shipped bundle

The extension MUST NOT embed a usable OpenAI API key as a static string in any artifact distributed to end users (the built `background-entry.js` or any other bundled file).

#### Scenario: Built bundle contains no static API key

- **WHEN** the extension is built for distribution
- **THEN** grepping the build output for `sk-proj-` or a `Bearer ` literal followed by a key MUST yield no live credential

#### Scenario: Leaked key is rotated

- **WHEN** this change is applied
- **THEN** the previously committed `sk-proj-…` key MUST be rotated/revoked so the exposed value is no longer valid

### Requirement: API credential is obtained at runtime

The extension SHALL obtain the OpenAI credential at runtime — either from a user-supplied value entered in the options page and stored in `chrome.storage.local`, or via a server-side proxy that holds the key — rather than from a build-time-inlined `import.meta.env` value.

#### Scenario: Missing credential is reported clearly

- **WHEN** an LLM call is attempted and no credential is available
- **THEN** the call MUST fail with a clear, user-visible error directing the user to configure a key, not a generic network error

#### Scenario: User-supplied key is used

- **WHEN** the user has saved an API key in the options page
- **THEN** subsequent LLM requests MUST use that stored key
