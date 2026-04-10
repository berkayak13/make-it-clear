# Quality Loop & Guardrails

The quality loop is the self-improvement mechanism that catches bad renarrations and retries with feedback. It involves Agent 6 (Quality Validator), Agent 10 (Guardrails), and the orchestrator's retry logic.

## How the retry loop works

```
Normal flow:
  ... → Narrator → Guardrails → Quality Validator → Done

If Quality Validator scores below threshold:
  ... → Quality Validator (fail, sets needsRetry=true)
      → Strategist (receives replanSignal with flagged sections)
      → Narrator (re-runs with updated plan)
      → Guardrails (re-checks)
      → Quality Validator (re-scores)
      → [repeat up to MAX_RETRIES=2 times]

After max retries:
  → Use the best attempt so far (highest average score)
```

## Quality scoring

Agent 6 asks the LLM to score renarrations on 5 dimensions (each 0-5):

| Dimension | What it measures |
|-----------|-----------------|
| coherence | Does the text flow logically? |
| coverage | Are all important sections renarrated? |
| intentAlignment | Does the output match what the user asked for? |
| toneConsistency | Does the tone match the persona? |
| literacyAppropriate | Is the reading level right for the target audience? |

**Pass threshold: averageScore >= 3.5** (configurable in Agent 6)

## Replan signal

When quality fails, the validator produces a replan signal:

```javascript
context.replanSignal = {
  flaggedSections: [
    { sectionId: '3', issue: 'Too technical for target literacy level', suggestion: 'Simplify vocabulary' },
    { sectionId: '7', issue: 'Missing coverage of key points', suggestion: 'Include data table summary' }
  ]
}
```

The Strategist (Agent 3) merges this into its plan via `applyReplanSignal()`:
- Flagged sections get updated strategies
- Unflagged sections keep their original plan
- Previous failure strategies are tracked in `failureMemory` to avoid repeating them

## Failure memory

The quality validator maintains `context.validation.failureMemory` — an array of strings describing what went wrong in each retry attempt. This is passed to both the Strategist and the LLM scoring prompt to prevent the same mistakes:

```javascript
context.validation.failureMemory = [
  'Attempt 1: Sections 3,7 scored low on literacy appropriateness — vocabulary too advanced',
  'Attempt 2: Section 3 improved but section 7 still missing key data points'
]
```

## Guardrails (Agent 10)

Guardrails run before quality validation and check for safety issues:

### XSS sanitization (always runs, no LLM needed)
- Strips `<script>`, `<iframe>`, `<svg>` tags
- Removes `on*` event handlers
- Removes `javascript:` URIs
- **Severity: error** — blocks pipeline

### Hallucination detection (LLM-based)
- Compares renarrated text against original section text
- Flags fabricated facts, invented statistics, false attributions
- **Severity: error** — blocks pipeline

### Bias detection (LLM-based)
- Checks for political bias, cultural stereotypes, inappropriate generalizations
- **Severity: warning** — logged but doesn't block

Guardrails run their LLM checks in parallel via `Promise.allSettled()`.

## Tuning the quality loop

### To make quality more strict
- Raise the pass threshold above 3.5
- Add new scoring dimensions to Agent 6
- Lower the "reinforce" threshold in Agent 7 (Memory Manager) so good strategies are remembered at a higher bar

### To make quality less strict
- Lower the pass threshold (but never below 3.0 — that produces noticeably bad output)
- Reduce MAX_RETRIES to 1 (faster but less chance to recover)

### To improve retry effectiveness
- Ensure `applyReplanSignal()` in Agent 3 actually changes the strategy, not just the parameters
- Add more specific suggestions in Agent 6's flagged sections
- Check that failure memory is formatted clearly for the LLM

### Common retry loop bugs
- **Infinite loop**: If `retryCount` isn't incremented, the loop never terminates. Both Agent 6 AND the orchestrator should enforce MAX_RETRIES.
- **Same score on retry**: Usually means the replan signal is being ignored. Check Agent 3's `applyReplanSignal()`.
- **Score drops on retry**: The narrator may be getting confused by conflicting instructions. Check that failure memory doesn't contradict the new plan.
- **Guardrails block after retry**: XSS can be introduced by LLM on retry if prompts are different. Guardrails should always run, even on retries.

## Monitoring quality

The pipeline visualizer (`viewers/pipeline-visualizer.html`) shows:
- Per-run validation scores
- Retry count and score progression across retries
- Flagged sections with issues and suggestions
- Guardrail flags
- Pipeline history (last 20 runs) for trend analysis
