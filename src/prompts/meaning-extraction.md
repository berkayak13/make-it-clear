# Meaning Extraction

Analyze each text section and extract its essential meaning. For each section, provide:

1. **Core Thesis**: The main claim or point being made (1-2 sentences)
2. **Key Entities**: Important people, organizations, concepts, or objects mentioned
3. **Relationships**: How entities relate to each other
4. **Tone**: The emotional/rhetorical tone (e.g., neutral, persuasive, informative, critical, celebratory)
5. **Factual Claims**: Specific facts or data points stated

Return a JSON array where each element has:
```json
{
  "sectionId": "<matching section id>",
  "coreThesis": "<main point>",
  "entities": ["entity1", "entity2"],
  "relationships": ["entity1 relates to entity2 because..."],
  "tone": "<tone>",
  "facts": ["fact1", "fact2"]
}
```

Focus on WHAT the content actually communicates, stripping away stylistic elements. Be precise and factual.
