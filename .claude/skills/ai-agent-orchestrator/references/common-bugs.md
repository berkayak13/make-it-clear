# Common Bugs & Footguns

Known issues, silent failures, and patterns that break in non-obvious ways. Read this before modifying the pipeline.

## 1. Background agents may run twice

**Bug**: Agents 7-9 (Memory Manager, Feedback Analyst, Predictive Adapter) are defined in `ALL_AGENTS` and may also appear in `PIPELINE_CONFIGS`. If they're in both, they execute once in the main pipeline and once in `runBackgroundAgents()`.

**Fix**: Either exclude them from pipeline configs entirely (they should only run via `runBackgroundAgents()`) or check in `runBackgroundAgents()` whether they already ran.

**Symptom**: Duplicate episodic memory entries, double-counted feedback events.

## 2. No per-agent timeout

**Bug**: Only the VLM call in Agent 2 has an explicit timeout (120s). All other LLM calls have no timeout. A slow model or network issue can hang the pipeline indefinitely.

**Fix when encountered**: Add timeout wrappers around `callLLM()` calls, or add a global per-agent timeout in the orchestrator's `executeAgent()`.

**Symptom**: Pipeline hangs with no progress updates. User sees last progress message frozen.

## 3. JSON parse failures from LLM

**Bug**: LLMs sometimes return JSON wrapped in markdown fences (```json ... ```) or with trailing text after the JSON object. Direct `JSON.parse()` fails.

**Fix**: Strip markdown fences and trailing content before parsing:
```javascript
function safeParse(raw) {
  let cleaned = raw.trim();
  // Strip markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '');
  // Find the JSON object/array boundaries
  const start = cleaned.indexOf('{') !== -1 ? cleaned.indexOf('{') : cleaned.indexOf('[');
  const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  if (start !== -1 && end !== -1) {
    cleaned = cleaned.substring(start, end + 1);
  }
  return JSON.parse(cleaned);
}
```

**Symptom**: Agent falls back to rule-based output even when LLM was accessible.

## 4. Replan signal not applied

**Bug**: When `applyReplanSignal()` in Agent 3 receives flagged sections, it may fail to match `sectionId` values if they changed type (string vs number) between agents.

**Fix**: Always compare section IDs as strings: `String(flagged.sectionId) === String(plan.sectionId)`.

**Symptom**: Quality scores don't improve across retries. The visualizer shows the same plan before and after retry.

## 5. Readability score division by zero

**Bug**: In Agent 6's readability calculations (Flesch-Kincaid), dividing by sentence count or word count can produce `NaN` or `Infinity` if the renarrated text is empty or a single word.

**Fix**: Guard against zero:
```javascript
const score = totalWords > 0 && totalSentences > 0
  ? 206.835 - 1.015 * (totalWords / totalSentences) - 84.6 * (totalSyllables / totalWords)
  : 0;
```

**Symptom**: Quality scores come back as `NaN`, causing the retry loop to behave unpredictably.

## 6. Screenshots as base64 blow up storage

**Bug**: Full-page screenshots stored as base64 in `context.screenshots` can be several MB each. If the context object is logged to `chrome.storage.local` (pipeline visualizer), it can exceed the 10MB quota.

**Fix**: Strip screenshots from the context before saving to storage. The orchestrator should do this in the logging step.

**Symptom**: `chrome.storage.local.set()` fails silently or throws quota errors. Pipeline visualizer shows incomplete data.

## 7. Tab closed during pipeline

**Bug**: If the user closes the tab while the pipeline is running, `chrome.tabs.sendMessage()` calls fail. The orchestrator wraps these in `.catch(() => {})`, but agent code that sends messages directly will throw.

**Fix**: Always use `context.sendProgress?.()` (optional chaining) instead of calling `chrome.tabs.sendMessage()` directly from agents.

**Symptom**: Unhandled promise rejection in background service worker. Pipeline may continue running with no visible output.

## 8. Memory system silent failures

**Bug**: Agent 7 (Memory Manager) swallows all errors. If the memory system's IndexedDB or chrome.storage calls fail, the user's preferences are never saved, but no error is visible.

**Fix when debugging**: Temporarily add `console.error` logging in Agent 7's catch blocks. Check that `chrome.storage.local` has space and IndexedDB transactions are completing.

**Symptom**: The extension "forgets" user preferences between sessions. Predictive Adapter (Agent 9) always gives generic suggestions.

## 9. Gemini API format gotchas

**Bug**: The Gemini API uses `system_instruction` (snake_case), not `systemInstruction` (camelCase). Multi-turn format requires `contents: [{ role: 'user'|'model', parts: [{ text }] }]`.

**Fix**: Always use snake_case for Gemini API fields. This is already handled in `src/utils/llm-dispatch.js` but can be reintroduced if agents call the API directly.

**Symptom**: 400 errors from Gemini API with "invalid argument" messages.

## 10. Content script message race condition

**Bug**: When Agent 4 (Narrator) streams renarrations to the content script one section at a time, the content script may receive them out of order if multiple sections complete simultaneously.

**Fix**: Include a sequence number or section index in the message, and have the content script apply them in order.

**Symptom**: Renarrated sections appear in wrong positions on the page, or overwrite each other.

## 11. Optional chaining on context utilities

**Bug**: `context.callLLM` and `context.sendProgress` are injected by the orchestrator, but if an agent is tested standalone (outside the pipeline), these won't exist.

**Fix**: Always use optional chaining: `context.sendProgress?.('...')`. For `callLLM`, either check existence or import a fallback directly.

**Symptom**: `TypeError: context.callLLM is not a function` when testing agents in isolation.

## 12. Pipeline visualizer state size

**Bug**: The pipeline visualizer stores the full context object (minus screenshots) in `chrome.storage.local`. With 20 runs in history and large renarration outputs, this can grow to several MB.

**Fix**: Trim renarration text in visualizer state to first 200 chars per section. Store full output separately if needed.

**Symptom**: Slow pipeline visualizer load times. Storage quota warnings.
