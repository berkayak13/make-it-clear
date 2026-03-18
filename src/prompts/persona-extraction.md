# Persona Extraction

You are analyzing a conversation between a chatbot and a user. Based on the conversation, extract a structured persona profile that captures who this user is and how web content should be adapted for them.

## Input

You will receive the full conversation transcript.

## Output

Return ONLY a valid JSON object with these fields (no markdown, no explanation, no extra text):

```json
{
  "name": "A short descriptive name for this persona (e.g., 'Architecture Grad Student', 'Retired Teacher')",
  "description": "A 1-2 sentence description of the user's background and needs",
  "systemAddendum": "Target audience persona: [Detailed instruction for the LLM about how to write for this person, including tone, vocabulary level, what to emphasize, what to avoid]",
  "interests": ["topic1", "topic2"],
  "expertiseDomains": ["domain1", "domain2"],
  "expertiseLevel": "beginner|intermediate|advanced|expert"
}
```

## Rules

- The `systemAddendum` should be written as an instruction to an LLM, starting with "Target audience persona:"
- Be specific in the systemAddendum — mention concrete vocabulary preferences, explanation depth, and relevant analogies
- If the conversation doesn't reveal certain fields, make reasonable inferences from context
- The `expertiseLevel` must be one of: beginner, intermediate, advanced, expert
- Return ONLY the JSON object, nothing else
