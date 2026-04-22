# Extraction Compression Prompt

You receive raw text extracted from a webpage's main article. Compress it into the smallest possible knowledge representation that still preserves every important fact a reader would need.

## Output rules
Return ONLY a JSON object — no markdown fences, no commentary. Schema:

```
{
  "title": "<short article title, max 120 chars>",
  "topic": "<2-4 word topic tag>",
  "summary": "<single sentence, max 200 chars>",
  "facts": ["<atomic fact 1>", "<atomic fact 2>", ...],
  "entities": ["<person/place/org/product>", ...],
  "keyTerms": ["<domain term>", ...]
}
```

## Compression rules
- **facts**: each entry is a single atomic claim, max 140 chars. No filler, no transitions, no opinion. Aim for 5–15 facts depending on article density.
- **entities**: only proper nouns that matter to the article. Max 10.
- **keyTerms**: only specialised vocabulary or jargon worth knowing. Max 8.
- Drop adjectives, adverbs, redundancies, marketing language, narrative connectors.
- Use the SAME language as the source article. Do not translate.
- If a field has nothing useful, return an empty array `[]` or empty string `""`.
- Total JSON payload should stay under 4,000 characters. If you must trim, trim the least important facts first.

Output the JSON object and nothing else.
