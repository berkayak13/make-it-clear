# Consolidated Bug Audit Report

**Date:** 2026-04-10  
**Scope:** Full codebase review + verification of 40 external claims  
**Method:** Every claim verified against actual source code at cited line numbers

---

## CRITICAL (8)

### C1. Incomplete XSS Sanitization
**File:** `src/agents/agent-10-guardrails.js:9-16`  
**Status:** CONFIRMED  
Regex-based `sanitizeHtml()` strips `<script>`, `<iframe>`, `on*=` handlers, and `javascript:` URIs. **Misses:**
- SVG-based XSS (`<svg onload=...>`)
- Event handlers with whitespace (`on load = ...`)
- Data URIs (`data:text/html,...`)
- HTML-encoded entities (`&#106;avascript:`)
- CSS-based injection (`expression()`, `url()`)

**Fix:** Replace with DOMPurify or a proper HTML sanitizer.

### C2. Hardcoded Firebase API Key (3 locations)
**Files:** `src/utils/firestore-client.js:4`, `src/utils/memory-system.js:22`, `options.js:154`  
**Status:** CONFIRMED  
`AIzaSyB7WIlE0klfLmUKvO7JWF69Q2ioh2z_MBU` hardcoded in source. Also found in `lib/research-db.js:6`.

**Fix:** Move to secure backend proxy or environment config. Remove from source control.

### C3. Offscreen Response Protocol Violation
**File:** `src/offscreen-entry.js:94-125`  
**Status:** CONFIRMED  
`sendResponse({ ack: true })` called synchronously, then actual response sent async via `chrome.runtime.sendMessage()`. The `return true` is misleading — Chrome keeps the channel open for `sendResponse`, but the real payload goes through a separate message. Breaks the messaging contract.

**Fix:** Either use `sendResponse` for the actual payload (with `return true` to keep channel open), or drop `sendResponse` entirely and use only `chrome.runtime.sendMessage`.

### C4. Quality Validator False Retries on Parse Error
**File:** `src/agents/agent-6-quality-validator.js:100-104`  
**Status:** CONFIRMED  
When LLM response parsing fails, all scores default to 0. `parseError` is detected (line 107) but `averageScore = 0` still triggers retry logic (`!passed && retryCount < MAX_RETRIES`). Parse failures should be handled separately from low-quality scores.

**Fix:** Check `parseError` before evaluating `passed`. On parse error, either skip retry or use a different recovery strategy.

### C5. Unhandled Memory Init Crashes Downstream Agents
**File:** `src/background/orchestrator.js:386`  
**Status:** CONFIRMED  
`context.memory = await loadMemory(userId)` wrapped in empty `catch (e) {}`. If `loadMemory` fails, context retains the initial `{ semantic: {}, episodic: [], procedural: {} }` — but downstream agents (7-memory-manager, 9-predictive-adapter) may access properties that don't exist on the empty fallback.

**Fix:** Log the error. Ensure fallback memory object matches the full schema expected by downstream agents.

### C6. XSS via innerHTML in Pipeline Visualizer
**File:** `viewers/pipeline-visualizer.js` (~20 innerHTML locations)  
**Status:** PARTIALLY CONFIRMED  
`escapeHtml()` is used in most critical paths, but some computed labels and phase segments are interpolated without escaping. Risk is lower since data is internally computed, but pattern is inconsistent.

**Fix:** Apply `escapeHtml()` uniformly to all template literal interpolations in innerHTML assignments.

### C7. Bias Severity Never Blocks Pipeline
**File:** `src/agents/agent-10-guardrails.js:77-82`  
**Status:** CONFIRMED  
All bias flags hardcoded to `severity: 'warning'`. Pipeline only halts on `severity: 'error'` (line 128). Even detected hate speech passes through as a warning.

**Fix:** Map bias categories to appropriate severity levels. Hate speech, slurs, and discrimination should be `severity: 'error'`.

### C8. API Keys Stored Unencrypted
**Files:** `options.js:680`, `src/utils/memory-system.js:19`, `src/utils/firestore-client.js:19`  
**Status:** CONFIRMED  
`remoteVLMApiKey` and `firebaseApiKey` stored in `chrome.storage.local` in plaintext. Not encrypted at rest. Accessible to any code running in extension context.

**Fix:** Use Chrome's `identity` API or a backend proxy. At minimum, encrypt before storing.

---

## HIGH (9)

### H1. Promise.all Without Error Boundary (Narrator)
**File:** `src/agents/agent-4-narrator.js:71-93`  
**Status:** CONFIRMED  
Best-of-N variant generation uses `Promise.all([narrateSection(...), ...])`. One failed LLM call crashes the entire batch. The scoring `Promise.all` below it IS protected with per-item try-catch.

**Fix:** Use `Promise.allSettled()` and filter fulfilled results.

### H2. Guardrails Promise.all Failure
**File:** `src/agents/agent-10-guardrails.js:120-123`  
**Status:** CONFIRMED  
`Promise.all([runLlmChecks, runBiasChecks])` — if either throws, the entire guardrails agent fails, halting the pipeline for what should be an optional safety check.

**Fix:** Use `Promise.allSettled()`. Treat failed checks as warnings rather than pipeline-killing errors.

### H3. Concurrent Renarration Not Protected
**File:** `src/handlers/page-renarration.js:163-254`  
**Status:** CONFIRMED  
`pageRenarrationInProgress` flag has no atomic check-and-set. Two concurrent calls can both proceed past the check, causing duplicate work and wasted API calls.

**Fix:** Add a mutex/lock pattern. Check and set the flag atomically before proceeding.

### H4. Debug Logging Exposes User Data
**File:** `src/offscreen-entry.js:49,55`  
**Status:** CONFIRMED  
`console.log` dumps full user text, task instructions, and LLM responses to browser console in production.

**Fix:** Remove or gate behind a debug flag.

### H5. Overly Broad Host Permissions
**File:** `manifest.json:15-16`  
**Status:** CONFIRMED  
`<all_urls>` grants access to every website. Required for content script injection on arbitrary pages, but should be narrowed if possible or use `activeTab` permission.

### H6. Unsafe iframe sandbox
**File:** `content.js:318`  
**Status:** PARTIALLY CONFIRMED  
`iframe.sandbox = 'allow-same-origin'` on iframe with cloned page HTML. Scripts are removed via `querySelectorAll('script').remove()`, but inline event handlers (`onclick`, `onload`, etc.) in the cloned HTML survive and could execute.

**Fix:** Also strip event handler attributes from cloned HTML, or use stricter sandbox.

### H7. Content Script Race Condition (Duplicate Sidebars)
**File:** `src/background/orchestrator.js:76-110`  
**Status:** CONFIRMED  
Retry loop sends `extract-and-clone` at 200ms, 500ms, 1000ms intervals without deduplication. If content script is slow to respond, multiple messages process concurrently, potentially creating duplicate sidebars.

**Fix:** Add a deduplication guard or idempotency check in the content script handler.

### H8. Firestore Fetch Errors Propagate Uncaught
**File:** `src/utils/firestore-client.js:109-119`  
**Status:** PARTIALLY CONFIRMED  
`fetch()` has no try-catch. Network errors (DNS failure, connection refused) propagate uncaught. HTTP error responses ARE handled (`!resp.ok` check).

**Fix:** Wrap `fetch()` in try-catch with retry logic for transient failures.

### H9. Popup Init Failure on Storage Error
**File:** `popup.js:42-45`  
**Status:** CONFIRMED  
Initial `chrome.storage.sync.get()` and `chrome.storage.local.get()` calls have no try-catch. Storage corruption or unavailability crashes the entire popup load.

**Fix:** Wrap in try-catch with sensible defaults.

---

## MEDIUM (15)

### M1. Retry Count Off-by-One
**File:** `src/background/orchestrator.js:173-189` vs `src/agents/agent-6-quality-validator.js:10`  
**Status:** CONFIRMED  
Orchestrator allows retries when `retryCount > 3` (4 attempts). Agent-6 defines `MAX_RETRIES = 2` (3 attempts). Mismatch means orchestrator allows more retries than the validator expects.

### M2. Greedy JSON Regex
**File:** `src/agents/agent-6-quality-validator.js:80`  
**Status:** CONFIRMED  
`/\{[\s\S]*\}/` matches first `{` to last `}`. With multiple JSON objects in response, captures malformed combined text.

**Fix:** Use lazy quantifier `\{[\s\S]*?\}` or a proper JSON extraction approach.

### M3. Memory Leak in Offscreen Bridge
**File:** `src/utils/offscreen-bridge.js:50-74`  
**Status:** PARTIALLY CONFIRMED  
`pendingOffscreenResponses` Map has timeout cleanup, but if `ensureOffscreen()` fails, queued requests never resolve and entries accumulate.

### M4. Silent Data Loss in Logger
**File:** `src/utils/pipeline-logger.js:44-50`  
**Status:** CONFIRMED  
When logs exceed 2MB, silently trimmed to 20 entries with no warning or user notification.

### M5. Inconsistent Fallback Intent Normalization
**File:** `src/agents/agent-1-intent.js:190-196`  
**Status:** CONFIRMED  
`normaliseIntent()` called on LLM-parsed intents but skipped on fallback path. Fallback intents have inconsistent structure vs normal intents.

### M6. Unsafe Array Coercion on sectionMap
**File:** `src/agents/agent-4-narrator.js:163`  
**Status:** CONFIRMED  
`Object.values(sectionMap)` fallback fails if `sectionMap` is `null` or a primitive.

### M7. Unsafe JSON Response Coercion
**File:** `src/agents/agent-3-strategist.js:227-229`  
**Status:** CONFIRMED  
If `llmResponse` is an object without `result`, `JSON.stringify(llmResponse)` produces doubled-escaped JSON that fails parsing.

### M8. Feedback Race Condition
**File:** `content.js:65-67`  
**Status:** CONFIRMED  
`lastRunId` global overwritten on every `showOverlay()` call. Concurrent selections attribute feedback to wrong renarration.

### M9. Debounced Save Data Loss
**File:** `options.js:738-748`  
**Status:** CONFIRMED  
`queueSystemPromptSave()` uses 400ms `setTimeout`. Closing the page before timer fires loses the edit.

**Fix:** Use `beforeunload` event to flush pending saves, or save immediately.

### M10. Storage Listener Leak in Visualizer
**File:** `viewers/pipeline-visualizer.js:570-598`  
**Status:** CONFIRMED  
`chrome.storage.onChanged.addListener()` registered but never removed. Accumulates on page reloads.

### M11. Inline onclick Handler Injection
**File:** `viewers/research-dashboard.js:165,299,300,308`  
**Status:** CONFIRMED  
Store names interpolated into inline `onclick` handlers without escaping. A name containing `'` breaks the handler or enables injection.

### M12. Task Key Collision on Create
**File:** `options.js:593-595`  
**Status:** CONFIRMED  
Key generated from `name.toLowerCase().replace(/\s+/g, '-')` with no collision check. Existing task silently overwritten.

### M13. Concurrent saveSettings() Race
**File:** `options.js:363-375, 669+`  
**Status:** CONFIRMED  
Rapid field changes fire multiple concurrent `saveSettings()` calls. Later reads may overwrite earlier writes.

### M14. Duplicated Firestore Code
**Files:** `src/utils/memory-system.js:82-140` vs `src/utils/firestore-client.js`  
**Status:** CONFIRMED  
Inline Firestore functions in memory-system.js duplicate firestore-client.js. Bug fixes in one won't propagate.

### M15. Missing userId in Predictive Adapter
**File:** `src/agents/agent-9-predictive-adapter.js:221`  
**Status:** CONFIRMED  
`getRelevantEpisodic()` called without `userId` parameter that the function signature expects.

---

## LOW (8)

### L1. Missing null checks on DOM elements
**File:** `popup.js:475-491`, `options.js` (various)  
**Status:** PARTIALLY CONFIRMED — some locations have checks, others don't.

### L2. Unbounded task/persona creation
**File:** `options.js:593-595`  
**Status:** CONFIRMED — can exceed `chrome.storage.sync` quota (102KB).

### L3. Unhandled async event handlers
**File:** `options.js:427-433`  
**Status:** CONFIRMED — async handlers with no try-catch.

### L4. Misleading placeholder
**File:** `options.html:90`  
**Status:** FALSE — placeholder is a helpful example URL with `{model}` syntax.

### L5. Missing focus states
**File:** `popup.css:76-93`  
**Status:** CONFIRMED — no `:focus-visible` on interactive elements.

### L6. Color contrast
**File:** `viewers/pipeline-visualizer.css:94`  
**Status:** LIKELY — `#5a7a9a` on dark background may fail WCAG AA 4.5:1.

### L7. No timeout on storage.get()
**File:** `viewers/describe-viewer.js:7-31`  
**Status:** FALSE — async `await` on `chrome.storage.local.get()` works normally; Chrome storage doesn't "stall."

### L8. Unnecessary type="module"
**File:** `viewers/screenshot-viewer.html:28`  
**Status:** CONFIRMED — no imports/exports used. Harmless but unnecessary.

---

## Verification Summary

| Claim Status | Count |
|---|---|
| **CONFIRMED** | 31 |
| **PARTIALLY CONFIRMED** | 5 |
| **FALSE** | 4 |
| **Total claims evaluated** | 40 |

### False Claims
- **#8** (popup sendMessage): HAS try-catch — error IS handled
- **#28** (unescaped error in overlay): `escapeHtml()` IS applied at line 88
- **L4** (misleading placeholder): It's a useful example URL
- **L7** (storage.get timeout): Chrome storage doesn't stall like network APIs

---

## Top 10 Fixes to Prioritize

| Priority | Bug | Impact | Effort |
|---|---|---|---|
| 1 | C1 — Replace regex XSS sanitizer with DOMPurify | Security | Medium |
| 2 | C2 — Remove hardcoded Firebase API key | Security | Low |
| 3 | C3 — Fix offscreen messaging protocol | Correctness | Medium |
| 4 | C7 — Bias severity should block on hate speech | Safety | Low |
| 5 | H1+H2 — Promise.allSettled for narrator + guardrails | Reliability | Low |
| 6 | H3 — Mutex for concurrent page renarration | Correctness | Low |
| 7 | H4 — Remove debug logging of user data | Privacy | Low |
| 8 | C4 — Separate parse errors from quality failures | Correctness | Low |
| 9 | M9 — Flush debounced saves on beforeunload | Data loss | Low |
| 10 | H6 — Strip event handlers from cloned iframe HTML | Security | Low |
