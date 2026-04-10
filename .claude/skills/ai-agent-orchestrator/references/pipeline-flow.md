# Pipeline Flow

## Pipeline variants

Agent 0 (Pipeline Router) selects which variant to run based on page metadata and user request. Each variant is a subset of the full agent list.

```
full:      Router → Intent → Cartographer → [Extractor] → Strategist → Narrator → [Diagram] → Guardrails → Quality
lite:      Router → Intent → Strategist → Narrator → Guardrails → Quality
translate: Router → Intent → Narrator → Quality
annotate:  Router → Intent → Narrator
```

Agents in `[brackets]` are optional and may be skipped if disabled or if they fail.

### When each variant is used

- **full**: Default. Used for pages with rich visual content (images, complex layouts, data tables).
- **lite**: Pages where DOM text extraction is sufficient (articles, documentation, wikis). Skips VLM.
- **translate**: Language translation requests. Only needs intent + narrator.
- **annotate**: Simple annotations/highlights. No quality check needed.

## Orchestrator execution flow

```
1. Setup
   ├── Open sidebar on target tab
   ├── Extract text segments from page via content script
   └── Build initial context object

2. Memory load
   └── Load semantic + episodic + procedural memory for user

3. Agent-0: Pipeline Router
   └── Determine pipeline type → sets context.pipelineType and context.agentPlan

4. Sequential agent execution
   for each agent in agentPlan:
     ├── Check requiredFields are present in context
     ├── Send progress update to UI
     ├── Execute agent.run(context)
     ├── On success: continue to next agent
     ├── On failure (optional agent): log warning, continue
     └── On failure (required agent): halt pipeline, use fallback renarration

5. Quality retry loop (if context.needsRetry && retryCount < 2)
   ├── Strategist re-runs with context.replanSignal
   ├── Narrator re-runs with updated plan
   ├── Guardrails re-check
   └── Quality Validator re-scores
   (loop back to start of step 5 if still failing)

6. Apply results
   ├── If renarrations exist: send to content script for DOM replacement
   └── If no renarrations: fall back to legacy batch LLM renarration

7. Background agents (fire-and-forget)
   ├── Agent-7: Memory Manager — save session to memory
   ├── Agent-8: Feedback Analyst — process any pending feedback
   └── Agent-9: Predictive Adapter — generate suggestions for next interaction

8. Logging
   ├── Save pipeline state to chrome.storage.local (pipelineVisualizer)
   └── Append to pipeline history (last 20 runs)
```

## Agent execution in the orchestrator

The orchestrator (`src/background/orchestrator.js`) runs agents via `executeAgent()`:

```javascript
async function executeAgent(agent, context) {
  // 1. Check required fields
  for (const field of agent.requiredFields || []) {
    if (!context[field]) {
      if (agent.optional) return context;
      throw new Error(`Missing required field: ${field}`);
    }
  }
  
  // 2. Run the agent
  const result = await agent.run(context);
  
  // 3. Special handling
  if (context.guardrails?.passed === false) {
    // Hard stop — guardrails failed
  }
  if (context.needsRetry) {
    // Enter retry loop
  }
  
  return result;
}
```

## Adding a new agent to the pipeline

1. Create `src/agents/agent-N-name.js` following `agent-contract.md`.
2. In `src/background/orchestrator.js`:
   - Import the agent: `import * as myAgent from '../agents/agent-N-name.js';`
   - Add to `ALL_AGENTS` array (it auto-filters disabled agents).
   - Add to relevant pipeline configs in `PIPELINE_CONFIGS`.
3. The agent's position in the pipeline config array determines execution order.
4. If it's a background agent, add it to `runBackgroundAgents()` instead of the main pipeline.

## Fallback renarration pipeline

If the agentic pipeline fails to produce `context.renarrations`, the orchestrator falls back to a simpler approach:

1. Batch extracted text segments (max 4000 chars per batch)
2. Call LLM directly with task prompt + persona for each batch
3. Apply text replacements to the DOM via content script message

This ensures the user always gets some output, even if the agent pipeline is broken.

## Progress message flow

```
Orchestrator → chrome.tabs.sendMessage(tabId, {
  action: 'update-clone-progress',
  text: 'Analyzing page structure...'
})
→ Content script shows progress in sidebar overlay
```

Good progress messages:
- "Analyzing your request..." (Agent 1)
- "Mapping page structure..." (Agent 2)
- "Planning renarration strategy..." (Agent 3)
- "Rewriting section 3 of 8..." (Agent 4)
- "Checking quality..." (Agent 6)
- "Retry 1 of 2 — improving sections 2, 5..." (Retry loop)
- "Running safety checks..." (Agent 10)

Bad progress messages:
- "Running agent-2-visual-cartographer" (too technical)
- "Processing..." (too vague)
- "Error in step 4" (alarming, not actionable)
