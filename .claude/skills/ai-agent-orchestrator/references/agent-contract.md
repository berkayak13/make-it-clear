# Agent Contract

Every agent in `src/agents/` must follow this interface. No exceptions — the orchestrator depends on these exports to discover, filter, and execute agents.

## Required exports

```javascript
// src/agents/agent-N-name.js

/** Human-readable name, used as the key in agentMap */
export const name = 'agent-name';

/** One-line description shown in pipeline visualizer */
export const description = 'What this agent does';

/** If true, pipeline continues on failure instead of halting */
export const optional = false;

/** If true, agent is excluded from ALL_AGENTS entirely */
export const disabled = false;

/** Context fields this agent requires. Orchestrator checks these before running. */
export const requiredFields = ['intent', 'sectionMap'];

/**
 * Main entry point. Receives the shared context, returns it with new fields.
 * @param {Object} context - The pipeline context object
 * @returns {Object} context - The same object with new fields added
 */
export async function run(context) {
  // ... agent logic
  return context;
}
```

## The `run(context)` function

### Rules

1. **Always return context.** Even on failure. The orchestrator expects the context object back.
2. **Write to your designated context fields only.** Don't overwrite fields owned by other agents. See `context-object.md` for ownership.
3. **Never throw unless you want to halt the pipeline.** If `optional: false`, a thrown error stops everything. If `optional: true`, the orchestrator catches it and moves on. Prefer returning context with empty/default values over throwing.
4. **Emit progress messages.** Call `context.sendProgress?.(text)` if the function exists on context. The orchestrator injects this for UI updates.
5. **Handle LLM parse failures.** LLM responses are unpredictable. Always try-catch JSON parsing and fall back to a rule-based or default output.

### Pattern: LLM with fallback

```javascript
export async function run(context) {
  context.sendProgress?.('Analyzing intent...');
  
  try {
    const prompt = buildPrompt(context);
    const raw = await context.callLLM(prompt, { tier: 'quality' });
    const parsed = JSON.parse(raw);
    
    // Validate required fields
    if (!parsed.goal || !parsed.depth) {
      throw new Error('Missing required fields');
    }
    
    context.intent = normalise(parsed);
  } catch (err) {
    console.warn(`[${name}] LLM failed, using fallback:`, err.message);
    context.intent = buildFallbackIntent(context);
  }
  
  return context;
}
```

### Pattern: VLM with DOM fallback

```javascript
export async function run(context) {
  try {
    context.sendProgress?.('Analyzing page visually...');
    const sections = await vlmAnalysis(context);
    context.sectionMap = sections;
  } catch (err) {
    console.warn(`[${name}] VLM failed, falling back to DOM`);
    context.sendProgress?.('Falling back to text extraction...');
    context.sectionMap = await domFallback(context);
  }
  
  return context;
}
```

## LLM call conventions

Use `context.callLLM(prompt, options)` which is injected by the orchestrator. Options:

```javascript
{
  tier: 'quality' | 'speed',  // quality = larger model, speed = smaller/local
  maxTokens: 2048,            // default varies by tier
  temperature: 0.3,           // lower for structured output, higher for creative
  json: true                  // hint to use JSON mode if available
}
```

- **Quality tier**: Used for intent analysis, strategy planning, quality validation — anything that needs reasoning.
- **Speed tier**: Used for per-section narration, simple extraction — high volume, lower stakes per call.

## Testing an agent

1. **Unit test the fallback.** The fallback path is the most important — it's what runs when everything else breaks. Verify it produces a valid output schema.
2. **Test with empty/minimal context.** Agents should handle missing optional fields gracefully.
3. **Test the LLM parse path.** Feed malformed JSON and verify the agent falls back instead of throwing.
4. **Check progress messages.** Run the full pipeline and verify your agent's progress messages appear in the UI.

## File naming convention

```
src/agents/agent-{number}-{kebab-name}.js
```

Examples:
- `agent-0-pipeline-router.js`
- `agent-1-intent.js`
- `agent-2-visual-cartographer.js`
- `agent-2b-meaning-extractor.js`
- `agent-10-guardrails.js`

Background agents (7-9) follow the same convention but are called separately by `runBackgroundAgents()` after the main pipeline completes.
