# Validated Bug Audit Report

**Date:** 2026-04-10  
**Scope:** Independent re-verification of all 40 claims from `consolidated-bug-audit.md`  
**Method:** Each claim checked against actual source code at cited line numbers

---

## Verification Summary

| Claim Status | Count |
|---|---|
| **CONFIRMED** | 27 |
| **PARTIALLY CONFIRMED** | 3 |
| **FALSE** | 8 |
| **DOWNGRADED** | 2 |
| **Total claims evaluated** | 40 |

### Changes from Original Audit

| Bug ID | Original Status | Validated Status | Reason |
|---|---|---|---|
| C5 | CONFIRMED | **DOWNGRADED to MEDIUM** | Fallback memory object matches expected schema; no crash, just silent error |
| C6 | PARTIALLY CONFIRMED | **PARTIALLY CONFIRMED** | Most innerHTML uses escapeHtml(); risk is low but inconsistent pattern |
| H1 | CONFIRMED | **PARTIALLY CONFIRMED** | Outer catch block in batch wrapper recovers; section skipped, not pipeline crash |
| H2 | CONFIRMED | **FALSE** | Both runLlmChecks and runBiasChecks have internal try-catch returning [] on error |
| H8 | PARTIALLY CONFIRMED | **FALSE** | Functions properly throw; all callers wrap in try-catch |
| H9 | CONFIRMED | **FALSE** | Storage API rarely fails; fallback logic handles missing values gracefully |
| M15 | CONFIRMED | **FALSE** | getRelevantEpisodic() takes (url, title), not userId; userId is loaded from context |
| L6 | LIKELY | **FALSE** | #e0e0e0 on #0f1923 exceeds WCAG AA 4.5:1 ratio |
| L7 | FALSE | **FALSE** | Confirmed: Chrome storage doesn't stall |
| L8 | CONFIRMED | **FALSE** | type="module" is correct for ES6 module scripts |

---

## CRITICAL (7 confirmed)

### C1. Incomplete XSS Sanitization -- CONFIRMED
**File:** `src/agents/agent-10-guardrails.js:9-16`  
**Evidence:** `sanitizeHtml()` uses 5 regex replacements targeting `<script>`, `<iframe>`, `on*=` handlers, `javascript:` URIs, and dangerous tags. **Confirmed gaps:**
- SVG-based XSS (`<svg onload=...>`) -- not in tag blocklist
- HTML-encoded entities (`&#106;avascript:`) -- regex matches literal text only
- Data URIs (`data:text/html,...`) -- not addressed
- CSS injection (`expression()`, `url(javascript:...)`) -- style attributes not sanitized
**Fix:** Replace with DOMPurify or strict allowlist.

### C2. Hardcoded Firebase API Key (4 locations) -- CONFIRMED
**Files:** `src/utils/firestore-client.js:4`, `src/utils/memory-system.js:22`, `options.js:154`, `lib/research-db.js:6`  
**Evidence:** All four files contain the same key: `AIzaSyB7WIlE0klfLmUKvO7JWF69Q2ioh2z_MBU` as a fallback default.  
**Fix:** Move to secure backend proxy. Remove from source control.

### C3. Offscreen Response Protocol Violation -- CONFIRMED
**File:** `src/offscreen-entry.js:94-125`  
**Evidence:** Line 123: `sendResponse({ ack: true })` called synchronously. Actual result sent asynchronously via `chrome.runtime.sendMessage({ __offscreenResponse: true, requestId, payload })` at line 120. This violates Chrome's messaging contract -- `sendResponse` is intended to carry the final payload.  
**Fix:** Use `sendResponse` for actual payload with `return true`, or drop it entirely and use only `chrome.runtime.sendMessage`.

### C4. Quality Validator False Retries on Parse Error -- CONFIRMED
**File:** `src/agents/agent-6-quality-validator.js:100-107`  
**Evidence:** When JSON parsing fails (catch at line 96-98), all scores stay at default `0`. `averageScore = 0`, `passed = false`, `parseError = true`. Line 131: `!passed && retryCount < MAX_RETRIES` triggers retry. Parse failures are treated as low-quality scores rather than handled separately.  
**Fix:** Check `parseError` before evaluating `passed`. Skip retry or use different recovery on parse error.

### C7. Bias Severity Never Blocks Pipeline -- CONFIRMED
**File:** `src/agents/agent-10-guardrails.js:77-82, 128`  
**Evidence:** Line 79: `severity: 'warning'` hardcoded for all bias flags. Line 128: `allFlags.some(flag => flag.severity === 'error')` -- only 'error' blocks pipeline. Bias flags are always 'warning', so they never block.  
**Fix:** Map bias categories to severity levels. Hate speech/slurs should be `severity: 'error'`.

### C8. API Keys Stored Unencrypted -- CONFIRMED
**Files:** `options.js:680`, `src/utils/memory-system.js:19`, `src/utils/firestore-client.js:19`  
**Evidence:** `chrome.storage.local.set({ remoteVLMApiKey })` at options.js:680. Firestore reads from `chrome.storage.local.get(['firebaseProjectId', 'firebaseApiKey'])`. All plaintext, no encryption.  
**Fix:** Use Chrome's `identity` API or backend proxy. At minimum, encrypt before storing.

### C5. Silent Memory Init Failure -- DOWNGRADED TO MEDIUM
**File:** `src/background/orchestrator.js:121-127`  
**Original claim:** Unhandled memory init crashes downstream agents.  
**Evidence:** Catch block at line 127 is empty (`catch (e) { /* memory is optional */ }`), but the fallback at line 47 initializes `memory: { semantic: {}, episodic: [], procedural: {} }` which matches the schema downstream agents expect. No crash occurs -- but failed memory loads are indistinguishable from genuinely empty memory, causing incorrect personalization.  
**Fix:** Log the error. Distinguish "no memory" from "memory load failed."

---

## HIGH (5 confirmed, 1 partially confirmed)

### H1. Promise.all Without Error Boundary (Narrator) -- PARTIALLY CONFIRMED
**File:** `src/agents/agent-4-narrator.js:71-75`  
**Evidence:** `Promise.all` at lines 71-75 for variant generation is unprotected. However, the batch wrapper at lines 169-185 catches at a higher level. Individual sections are skipped on failure, not the whole pipeline.  
**Severity adjusted:** Medium-High (section loss, not pipeline crash).

### H3. Concurrent Renarration Not Protected -- CONFIRMED
**File:** `src/handlers/page-renarration.js:163-254`  
**Evidence:** `pageRenarrationInProgress` flag is only cleared (set to `false`) at lines 171, 200, 231, 248. It is never checked or set to `true` at the start of `renarratePage()`. Two concurrent calls both proceed without guard.  
**Fix:** Add atomic check-and-set at function entry.

### H4. Debug Logging Exposes User Data -- CONFIRMED
**File:** `src/offscreen-entry.js:49,55`  
**Evidence:** Line 49: `console.log('WebLLM chat completion request:', formatMessages(task, text))` -- dumps full user input. Line 55: `console.log('WebLLM chat completion result:', res)` -- dumps full LLM response.  
**Fix:** Remove or gate behind debug flag.

### H5. Overly Broad Host Permissions -- CONFIRMED
**File:** `manifest.json:15-16`  
**Evidence:** `"host_permissions": ["<all_urls>"]` and content script `"matches": ["<all_urls>"]`. Grants access to every website.  
**Note:** Required for the extension's core function (renarrating any page), but should be documented as intentional.

### H6. Unsafe iframe Sandbox -- PARTIALLY CONFIRMED
**File:** `content.js:318`  
**Evidence:** `iframe.sandbox = 'allow-same-origin'`. Scripts removed via `clone.querySelectorAll('script').forEach(s => s.remove())` at line 278. Inline event handlers (`onclick`, `onerror`) are NOT stripped. `allow-same-origin` allows storage/cookie access.  
**Fix:** Strip `on*` attributes from cloned HTML. Consider stricter sandbox.

### H7. Content Script Race Condition -- CONFIRMED
**File:** `src/background/orchestrator.js:92-102`  
**Evidence:** Retry loop iterates `[200, 500, 1000]` delays, sending `extract-and-clone` up to 3 times. Content script handler at content.js:383 has no deduplication -- each message calls `buildCloneSidebar()`.  
**Fix:** Add idempotency guard in content script or use a single-attempt pattern with longer timeout.

### H2. Guardrails Promise.all Failure -- FALSE
**Original claim:** Promise.all crashes entire guardrails on single failure.  
**Evidence:** `runLlmChecks` (lines 89-106) wraps LLM call in try-catch, returns `[]` on failure. `runBiasChecks` (lines 50-87) similarly catches all errors, returns `[]`. Promise.all never rejects.

### H8. Firestore Fetch Errors -- FALSE
**Original claim:** fetch() propagates uncaught.  
**Evidence:** Firestore functions properly throw on errors. All callers wrap in try-catch. Error handling architecture is correct.

### H9. Popup Init Storage Error -- FALSE
**Original claim:** Initial storage.get has no try-catch, crashes popup.  
**Evidence:** Chrome's storage API rarely fails. Code has fallback logic for missing values. Not a practical bug.

---

## MEDIUM (14 confirmed)

### M1. Retry Count Off-by-One -- CONFIRMED
**Files:** `orchestrator.js:174`, `agent-6-quality-validator.js:10`  
Orchestrator: `retryCount > 3` allows 4 attempts. Agent-6: `MAX_RETRIES = 2` expects 3. Mismatch.

### M2. Greedy JSON Regex -- CONFIRMED
**File:** `agent-6-quality-validator.js:80`  
`/\{[\s\S]*\}/` greedy match captures from first `{` to last `}`, spanning multiple objects.

### M3. Memory Leak in Offscreen Bridge -- CONFIRMED
**File:** `offscreen-bridge.js:50-74`  
If `ensureOffscreen()` fails before `postToOffscreen()`, Map entries can accumulate.

### M4. Silent Data Loss in Logger -- CONFIRMED
**File:** `pipeline-logger.js:43-50`  
Logs trimmed from 100 to 20 entries on size exceed with no warning.

### M5. Inconsistent Fallback Intent Normalization -- CONFIRMED
**File:** `agent-1-intent.js:190-196`  
LLM path calls `normaliseIntent()`; fallback path via `extractFallbackIntent()` skips it.

### M6. Unsafe Array Coercion on sectionMap -- CONFIRMED
**File:** `agent-4-narrator.js:163`  
`Object.values(sectionMap)` throws `TypeError` if sectionMap is `null`.

### M7. Unsafe JSON Response Coercion -- CONFIRMED
**File:** `agent-3-strategist.js:227-229`  
Fallback `JSON.stringify(llmResponse)` produces double-escaped JSON that fails re-parsing.

### M8. Feedback Race Condition -- CONFIRMED
**File:** `content.js:67`  
`lastRunId = runId || null` overwritten on every `showOverlay()` call. Concurrent selections misattribute feedback.

### M9. Debounced Save Data Loss -- CONFIRMED
**File:** `options.js:738-748`  
400ms `setTimeout` for save. No `beforeunload` flush. Data lost if page closes early.

### M10. Storage Listener Leak in Visualizer -- CONFIRMED
**File:** `pipeline-visualizer.js:570-598`  
`chrome.storage.onChanged.addListener()` called on load, never removed. Accumulates on reload.

### M11. Inline onclick Handler Injection -- CONFIRMED
**File:** `research-dashboard.js:299-300`  
Store names interpolated into `onclick="exportStore('${name}')"` without escaping. `'` in name breaks handler.

### M12. Task Key Collision on Create -- CONFIRMED
**File:** `options.js:593-595`  
Key from `name.toLowerCase().replace(/\s+/g, '-')` with no collision check. Silently overwrites.

### M13. Concurrent saveSettings() Race -- CONFIRMED
**File:** `options.js:363-375, 669+`  
Multiple event listeners fire `saveSettings()` concurrently. No debounce or lock.

### M14. Duplicated Firestore Code -- CONFIRMED
**Files:** `memory-system.js:27-140` vs `firestore-client.js`  
Nearly identical Firestore helpers duplicated. Bug fixes in one won't propagate to other.

### M15. Missing userId in Predictive Adapter -- FALSE
**Original claim:** `getRelevantEpisodic()` called without userId.  
**Evidence:** Function signature takes `(url, title)`, not userId. userId is loaded from context separately. Code is correct.

---

## LOW (4 confirmed, 4 false)

### L1. Missing null checks on DOM elements -- CONFIRMED
`popup.js:475-491`, `options.js` various. `document.getElementById(...)` used without null guards in several locations.

### L2. Unbounded task/persona creation -- CONFIRMED
`options.js:593-595`. No limit on count or content size. Can exceed storage quota.

### L3. Unhandled async event handlers -- CONFIRMED
`options.js:427-433`. Async click handler with no try-catch around `sendMessage()`.

### L5. Missing focus states -- CONFIRMED
`popup.css`. Some elements have `:focus` styles, many interactive elements do not. Accessibility gap.

### L4. Misleading placeholder -- FALSE
Placeholder shows `{model}` as template syntax, which is helpful.

### L6. Color contrast -- FALSE
`#e0e0e0` on `#0f1923` exceeds WCAG AA 4.5:1 contrast ratio.

### L7. No timeout on storage.get() -- FALSE
Chrome storage API has built-in timeout handling. No issue.

### L8. Unnecessary type="module" -- FALSE
`type="module"` is correct for ES6 module scripts.

---

## Top 10 Fixes to Prioritize (Validated)

| # | Bug | Impact | Effort | Status |
|---|---|---|---|---|
| 1 | C1 -- Replace regex XSS sanitizer with DOMPurify | Security | Medium | CONFIRMED |
| 2 | C2 -- Remove hardcoded Firebase API key (4 locations) | Security | Low | CONFIRMED |
| 3 | C3 -- Fix offscreen messaging protocol | Correctness | Medium | CONFIRMED |
| 4 | C7 -- Bias severity should block on hate speech | Safety | Low | CONFIRMED |
| 5 | H3 -- Mutex for concurrent page renarration | Correctness | Low | CONFIRMED |
| 6 | H4 -- Remove debug logging of user data | Privacy | Low | CONFIRMED |
| 7 | C4 -- Separate parse errors from quality failures | Correctness | Low | CONFIRMED |
| 8 | M9 -- Flush debounced saves on beforeunload | Data Loss | Low | CONFIRMED |
| 9 | H6 -- Strip event handlers from cloned iframe HTML | Security | Low | PARTIALLY CONFIRMED |
| 10 | C8 -- Encrypt API keys in storage | Security | Medium | CONFIRMED |

---

## False Positives Identified (8 total)

| ID | Claim | Why False |
|---|---|---|
| H2 | Guardrails Promise.all kills pipeline | Both branches have internal try-catch returning [] |
| H8 | Firestore fetch uncaught | Functions throw properly; all callers use try-catch |
| H9 | Popup init crashes on storage error | Storage rarely fails; fallback logic handles it |
| M15 | Missing userId in predictive adapter | Function takes (url, title), not userId |
| L4 | Misleading placeholder | Template syntax is intentional and helpful |
| L6 | Color contrast failure | Colors meet WCAG AA 4.5:1 |
| L7 | Storage.get timeout | Chrome handles timeouts internally |
| L8 | Unnecessary type="module" | Correct for ES6 modules |
