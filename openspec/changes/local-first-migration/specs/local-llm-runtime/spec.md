## ADDED Requirements

### Requirement: All LLM inference served by a local Ollama instance
The system SHALL send every text and structured-output LLM request to a user-run Ollama server reachable at a configured base URL (default `http://localhost:11434`), and SHALL NOT call any cloud LLM endpoint.

#### Scenario: Text renarration request
- **WHEN** the system renarrates a page or answers in the side-panel chatbot
- **THEN** the request is sent to the configured Ollama base URL, not to `api.openai.com`

#### Scenario: Structured-output request
- **WHEN** the system requests JSON-schema-constrained output (extraction stage, orchestrator merge, captions)
- **THEN** the request uses Ollama's JSON-schema output mechanism and the parsed result validates against the supplied schema

#### Scenario: No cloud fallback
- **WHEN** the local server is unreachable
- **THEN** the system surfaces a local-server error and does NOT fall back to any cloud provider

### Requirement: No API keys baked into the bundle
The system SHALL NOT embed any LLM API key in the built extension, and SHALL NOT read `VITE_OPENAI_*` build-time environment variables for runtime LLM configuration.

#### Scenario: Built bundle contains no key
- **WHEN** the extension is built and inspected
- **THEN** no `VITE_OPENAI_API_KEY` value is present in the bundle

### Requirement: Runtime-editable model and endpoint configuration
The system SHALL read the Ollama base URL, text model, and vision model from runtime storage editable in the options page, and changing them SHALL take effect without rebuilding the extension.

#### Scenario: Change model without rebuild
- **WHEN** the user changes the configured text or vision model in options
- **THEN** subsequent LLM calls use the new model without a rebuild

#### Scenario: Config cache invalidation
- **WHEN** the stored configuration changes
- **THEN** the cached client configuration is invalidated and the next call uses the new values

### Requirement: Connection health check
The system SHALL provide a way to test connectivity to the configured Ollama server that reports reachability and the installed models, and SHALL warn when a configured model is not installed.

#### Scenario: Server reachable
- **WHEN** the user runs the connection test against a running Ollama instance
- **THEN** the system reports success and lists the installed models

#### Scenario: Configured model missing
- **WHEN** the configured text or vision model is not among the installed models
- **THEN** the system warns that the model must be pulled

#### Scenario: Server unreachable
- **WHEN** the connection test cannot reach the base URL
- **THEN** the system reports an actionable failure (including the CORS / `OLLAMA_ORIGINS` hint), not a silent or opaque error

### Requirement: Stable transport surface for callers
The system SHALL expose a local LLM client whose text and structured-output entry points accept the same parameters as the prior client, treating cloud-only parameters as no-ops, so existing callsites change by import only.

#### Scenario: Cloud-only parameter passed
- **WHEN** a caller passes a `reasoningEffort` (or equivalent cloud-only) argument
- **THEN** the call succeeds and the parameter is ignored rather than rejected
