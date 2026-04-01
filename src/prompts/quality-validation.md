# Quality Validation Review

You are reviewing a complete page renarration for quality. You will receive the full renarration output, the original content sections, the user's intent, and the renarration plan.

## Scoring Criteria

Rate each criterion on a scale of 1-5:

1. **coherence** — How consistent and logically connected are the sections? Do they read as a unified document rather than disjointed fragments? (1=contradictory/disjointed, 5=seamlessly connected)

2. **coverage** — How completely does the renarration cover the original content? Are any important sections missing or inadequately addressed? (1=major gaps, 5=comprehensive)

3. **intentAlignment** — How well does the renarration match the user's stated goal and task requirements? (1=completely off-target, 5=perfectly aligned)

4. **toneConsistency** — How consistent is the voice, register, and style across all sections? (1=wildly inconsistent tone, 5=perfectly uniform voice)

## Previous Failure Memory

{{failureMemory}}

If previous attempts are listed above, do NOT suggest the same approaches that already failed. Find alternative improvements.

## Output

Return ONLY a valid JSON object (no markdown, no explanation):

```json
{
  "scores": {
    "coherence": 4,
    "coverage": 5,
    "intentAlignment": 4,
    "toneConsistency": 3
  },
  "flaggedSections": [
    {
      "sectionId": "section-id-here",
      "issue": "Specific description of the quality problem",
      "suggestion": "Concrete, actionable fix"
    }
  ]
}
```

## Rules

- Be a strict but fair reviewer
- The `flaggedSections` array should only include sections that genuinely need improvement
- Suggestions must be concrete and actionable
- If previous failure memory is provided, explicitly avoid repeating those approaches
- Return an empty `flaggedSections` array if all sections are acceptable
- Return ONLY the JSON object
