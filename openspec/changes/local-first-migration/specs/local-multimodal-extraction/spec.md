## ADDED Requirements

### Requirement: Visual facts extracted by a local vision-language model
The system SHALL extract visual facts from page images using the configured local vision-language model served by Ollama, and SHALL NOT send images to any cloud vision endpoint.

#### Scenario: Image-bearing page
- **WHEN** a page has on-topic images and a vision model is configured
- **THEN** the vision subagents send those images to the local vision model and produce visual facts tagged `source:"image"` with correct `imageIds`

#### Scenario: Images sent in the local model's expected format
- **WHEN** images are dispatched to the vision model
- **THEN** they are encoded in the format the configured endpoint accepts (data-URI `image_url` for the OpenAI-compatible endpoint, or base64 `images[]` for the native endpoint)

### Requirement: Graceful degradation when images are absent or unfetchable
The system SHALL complete extraction without error when a page has no images, and SHALL skip — not fail — any image batch whose images cannot be fetched.

#### Scenario: No images on the page
- **WHEN** a page contains no eligible images
- **THEN** extraction runs text-only and completes successfully

#### Scenario: Batch with all fetches failing
- **WHEN** every image in a vision batch fails to fetch as a data URI
- **THEN** that batch is skipped and the overall extraction is not aborted

#### Scenario: Vision model not configured or unavailable
- **WHEN** no vision model is configured or the vision call fails
- **THEN** text extraction still completes and the failure is recorded in `warnings[]`

### Requirement: Extraction fan-out bounded for serial local inference
The system SHALL bound the number of concurrent extraction calls with a configurable concurrency limit defaulting to a low value suited to a single local model, and SHALL NOT assume cloud-level parallelism.

#### Scenario: Default concurrency on a single model
- **WHEN** a long page is extracted with default settings against one local model
- **THEN** extraction calls are dispatched within the configured low concurrency limit and complete without overwhelming the model

#### Scenario: User raises concurrency
- **WHEN** a user on stronger hardware increases the concurrency setting
- **THEN** the system dispatches up to that many concurrent calls

### Requirement: Timeouts tuned for local latency
The system SHALL apply stage timeouts that accommodate local first-token latency and cold model load, and a long page on a correctly configured local model SHALL complete without spurious timeouts on default settings.

#### Scenario: Cold-start extraction
- **WHEN** the first extraction after model load runs on a long article
- **THEN** it completes without hitting a stage timeout under default settings
