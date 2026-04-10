# Issue #015: Fix Agentic Pipeline — Broken Agent callLLM Signatures & Evaluation Failures

**Labels:** `bug`, `critical`, `agentic-pipeline`  
**Status:** Fixed

## Summary

The 11-agent agentic pipeline (added in `07397ba`) has several bugs that prevent it from functioning correctly. Three agents pass the wrong argument format to `callLLM()`, the quality validator silently fails and masks errors with default scores, and the evaluation loop in `background.js` has no JSON parse error handling. Together, these issues mean the pipeline's evaluate-retry loop never works as intended.

## Bugs

### 1. Wrong `callLLM()` signature in 3 agents (Critical)

`callLLM()` expects `(messages, systemPrompt, options)` where `messages` is an array of `{role, content}` objects (see `src/utils/llm-dispatch.js`). Three agents pass a single object with a `prompt` key instead:

- **`src/agents/agent-1-intent.js`** (~line 142)
- **`src/agents/agent-6-quality-validator.js`** (~line 68)
- **`src/agents/agent-10-guardrails.js`** (~line 53)

```javascript
// Current (broken)
const response = await callLLM({ prompt: fullPrompt, tier: 'quality' });

// Correct (matches llm-dispatch.js signature)
const response = await callLLM(
  [{ role: 'user', content: fullPrompt }],
  systemPrompt,
  { tier: 'quality' }
);
```

**Impact:** Intent analysis, quality validation, and guardrail checks all fail silently. The pipeline's core evaluate-retry loop is non-functional because the quality validator can never score a renarration.

### 2. Quality validator response format mismatch (High)

In `agent-6-quality-validator.js` (~line 77), the response is handled as:

```javascript
const text = response?.text || response || '';
```

But `callLLM()` returns `{ success, result }`. Even after fixing the signature, the response extraction needs to use `response?.result`.

### 3. Default scores mask failures (High)

When JSON parsing fails in the quality validator (~line 73), all scores default to `3.0`. Since the pass threshold is `3.5`, validation always fails on parse errors — causing the pipeline to exhaust all retries and return worst-case output, with no indication of *why* it failed.

### 4. Missing JSON parse error handling in `evaluateRenarration()` (Medium)

`background.js` (~line 666) parses evaluator JSON with no try-catch:

```javascript
const scores = JSON.parse(jsonStr);
```

If the LLM returns malformed JSON, this throws an uncaught exception that stops the entire pipeline.

### 5. No timeout on evaluation calls (Medium)

The evaluation loop in `agenticRenarrateText()` (`background.js` ~line 679-775) has no timeout. If the Gemini API hangs during an evaluation call, the pipeline blocks indefinitely with no fallback.

### 6. Unbounded prompt augmentation (Low)

Each retry appends the evaluator's improvement suggestion to the system prompt (~line 724-728) without length limits or deduplication. Over 3 attempts this can push the prompt toward token limits.

## Fix Plan

1. **Fix `callLLM()` calls** in agents 1, 6, and 10 to use `(messages[], systemPrompt, options)` signature.
2. **Fix response extraction** in agent-6 to read `response.result` instead of `response.text`.
3. **Wrap JSON.parse** calls in try-catch in both `evaluateRenarration()` and `agent-6-quality-validator.js`, with meaningful error logging.
4. **Add timeout** to evaluation calls (e.g. 30s `Promise.race`).
5. **Test the full retry loop** end-to-end: trigger a renarration, verify that quality scores are returned, and confirm retry/pass behavior at the 3.5 threshold.