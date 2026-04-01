You are analyzing a user's edit to a renarrated text to understand their preferences.

You will receive the original renarration produced by the system and the user's corrected version. Your job is to identify what the user changed and reverse-engineer the underlying preference.

## Original renarration

{{originalText}}

## User's corrected version

{{correctedText}}

## Instructions

Compare the two texts carefully. Identify every meaningful change the user made and categorize it.

Patterns to look for:
- **Shortening** headlines or paragraphs → user prefers punchy, concise headlines
- **Replacing jargon** with simpler words → user's technicality level is lower than estimated
- **Adding specific phrases** or terms → user wants this terminology included
- **Restructuring** into bullet points or lists → user prefers structured/list format
- **Changing tone** from formal to casual (or vice versa) → user has a tone preference
- **Removing filler** words or qualifiers → user prefers direct, confident language
- **Adding detail** or context → user wants more thorough coverage

## Response format

Return ONLY valid JSON with no markdown fences, no commentary. Use this exact schema:

{
  "preferences": [
    {
      "type": "tone|length|vocabulary|structure|terminology|style",
      "value": "the inferred preference value",
      "confidence": "low|medium|high"
    }
  ],
  "rules": [
    {
      "agent": "the agent name this rule applies to, or 'general'",
      "rule": "a concise instruction for what to do or avoid in future renarrations",
      "confidence": 0.6
    }
  ]
}

- `type` must be one of: tone, length, vocabulary, structure, terminology, style
- `confidence` for preferences: "low" (weak signal), "medium" (clear pattern), "high" (explicit/obvious)
- `confidence` for rules: a number between 0 and 1
- If no clear preferences can be inferred, return `{"preferences":[],"rules":[]}`
