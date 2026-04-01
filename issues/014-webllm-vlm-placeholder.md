# Issue #014: ~~Implement WebLLM VLM (On-Device Image Analysis)~~ RESOLVED

**Labels:** `resolved`, `on-device`, `vlm`  
**Status:** Done

## Resolution

On-device WebLLM does not support multimodal/vision models. Instead of implementing a separate on-device VLM path, `describeImage()` in `src/utils/vlm-client.js` now **always routes image analysis through the Gemini API**, regardless of whether the LLM provider is set to on-device or remote.

### Changes Made
- **`src/utils/vlm-client.js`**: Removed the WebLLM offscreen VLM fallback path from `describeImage()`. VLM always goes to Gemini with sensible defaults (`gemini-2.5-flash`, standard endpoint) when user config is missing.
- Removed unused `ensureOffscreen`/`postToOffscreen` imports from vlm-client.js.
- The offscreen placeholder `webllmDescribeImage()` in `src/offscreen-entry.js` is now dead code (can be cleaned up separately).

### Behavior
- **LLM set to remote (Gemini):** Text + images both go through Gemini API. No change.
- **LLM set to on-device (WebLLM):** Text goes through WebLLM locally, images still go through Gemini API. Previously this hit a placeholder that returned fake descriptions.
