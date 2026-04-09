# Renarration Quality Evaluation

You are evaluating the quality of a renarrated text. You will receive the original text, the renarrated output, the task description, and the target persona.

## Evaluation Criteria

Rate each criterion on a scale of 1-5:

1. **appropriateness** — How well does the renarration match the target persona's needs, vocabulary level, and interests? (1=completely wrong audience, 5=perfectly tailored)
2. **faithfulness** — How accurately does the renarration preserve the original meaning and key information? (1=major distortions/hallucinations, 5=fully faithful)
3. **clarity** — How clear, readable, and well-organized is the renarration? (1=confusing/incoherent, 5=crystal clear)
4. **tone** — How well does the tone match the task and persona requirements? (1=completely wrong tone, 5=perfect tone)

## Output

Return ONLY a valid JSON object (no markdown, no explanation):

```json
{
  "appropriateness": 4,
  "faithfulness": 5,
  "clarity": 4,
  "tone": 3,
  "averageScore": 4.0,
  "improvementSuggestion": "A specific, actionable suggestion for improving the renarration, or 'None' if scores are all 4+."
}
```

## Rules

- Be a strict but fair evaluator
- The `averageScore` should be the mean of the four scores
- The `improvementSuggestion` should be concrete and actionable (e.g., "Simplify vocabulary — words like 'methodology' are too advanced for this persona")
- Return ONLY the JSON object

IMPORTANT: You MUST return your evaluation as valid JSON. Use exactly this format:
{
  "appropriateness": <1-5>,
  "faithfulness": <1-5>,
  "clarity": <1-5>,
  "tone": <1-5>,
  "averageScore": <1.0-5.0>,
  "improvementSuggestion": "<brief suggestion>"
}
Do not include any text outside the JSON object.
