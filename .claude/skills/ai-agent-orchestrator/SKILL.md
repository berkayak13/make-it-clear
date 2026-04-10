---
name: ai-agent-orchestrator
description: Design, build, debug, and extend the multi-agent agentic pipeline that powers page renarration. Use this skill whenever the user wants to create a new agent, modify an existing agent, change pipeline flow, fix orchestration bugs, tune the quality/retry loop, adjust agent communication, or understand how agents chain together. Trigger on phrases like "agent," "pipeline," "orchestrator," "renarration pipeline," "retry loop," "quality score," "guardrails," "add an agent," "agent context," "pipeline step," or any request involving the src/agents/ or src/background/orchestrator.js files.
---

# AI Agent Orchestrator

This skill governs the 11-agent agentic pipeline that transforms web pages into renarrated content. The pipeline is the core product differentiator — getting it right means high-quality, persona-aware renarrations that feel intentional, not generated.

## When to consult the references

- `references/agent-contract.md` — The interface every agent must follow. Read this before creating or modifying any agent.
- `references/pipeline-flow.md` — How agents chain together, what each pipeline variant includes, and where retry/fallback logic lives. Read this when debugging pipeline issues or adding new pipeline variants.
- `references/context-object.md` — The shared context object that flows through every agent. Read this when an agent needs to read from or write to the pipeline state.
- `references/quality-loop.md` — The quality validator, retry mechanism, replan signals, and guardrails. Read this when tuning quality thresholds, fixing retry bugs, or adjusting what triggers a replan.
- `references/common-bugs.md` — Known pain points, footguns, and patterns that break silently. Read this before making changes to catch issues early.

## Core design philosophy

**1. Agents are pure functions on context.** Every agent reads from `context`, does work, writes back to `context`, and returns it. No side effects beyond logging and progress messages. No direct agent-to-agent communication — the orchestrator is the only coordinator.

**2. Every agent must have a fallback.** LLM calls fail. VLM calls timeout. APIs go down. Every agent must degrade gracefully — either via a rule-based fallback that produces the same output schema, or by being marked `optional: true` so the pipeline skips it on failure. An agent that throws and halts the pipeline is a bug.

**3. The quality loop is the safety net, not the happy path.** The retry loop (Quality Validator flags sections -> Strategist replans -> Narrator rewrites -> Guardrails recheck -> Quality rescores) exists for edge cases. If most runs hit retry, the upstream agents need tuning, not the retry count.

**4. Schema consistency is non-negotiable.** Downstream agents depend on upstream output shapes. If you change what Agent 2 writes to `context.sectionMap`, you must update every agent that reads it. The context object reference (`references/context-object.md`) is the source of truth.

**5. Progress streaming makes the pipeline feel fast.** Users see real-time updates ("Analyzing page structure...", "Rewriting section 3 of 8...") via `sendProgress()`. Every agent should emit at least one progress message. Silence for more than 10 seconds feels broken.

**6. Guardrails are a hard gate, quality is a soft gate.** Guardrail errors (XSS, severe hallucination) halt the pipeline immediately. Quality scores below threshold trigger retry but never halt — after max retries, the best attempt is used. Never weaken guardrails to improve throughput.

## Default workflow for creating a new agent

1. **Read `references/agent-contract.md`** to understand the required exports and interface.
2. **Decide where it fits in the pipeline.** Check `references/pipeline-flow.md` for the current agent order and identify dependencies — what does your agent need from context, and what does it produce?
3. **Define the output schema first.** Before writing any logic, document exactly what your agent writes to the context object. Add it to the context reference.
4. **Implement with LLM + fallback.** The pattern is: try LLM call -> parse response -> validate schema -> fallback on failure. Use `callLLM()` from the orchestrator utilities.
5. **Register in the orchestrator.** Import the agent in `src/background/orchestrator.js`, add it to `ALL_AGENTS`, and add it to the appropriate pipeline configs.
6. **Add progress messages.** At minimum: one message when the agent starts, one when it completes.
7. **Test the fallback path.** Temporarily break the LLM call and verify the agent produces valid output via its fallback.

## Default workflow for debugging pipeline issues

1. **Check the pipeline visualizer.** Open `viewers/pipeline-visualizer.html` — it shows the full pipeline state including which agents ran, their outputs, validation scores, and retry history.
2. **Identify the failing agent.** The visualizer log shows the exact agent and step where things went wrong.
3. **Read the agent's code** in `src/agents/` and trace the context fields it depends on.
4. **Check upstream agents.** If an agent fails because its input is malformed, the bug is usually in the agent that produced that input, not the one consuming it.
5. **Read `references/common-bugs.md`** — many pipeline issues have known patterns.

## Default workflow for modifying the retry/quality loop

1. **Read `references/quality-loop.md`** to understand the full retry flow.
2. **Check current thresholds.** The quality pass threshold is in Agent 6 (currently 3.5/5.0). The max retry count is in both Agent 6 and the orchestrator (currently 2).
3. **Look at failure memory.** The quality validator tracks what strategies failed across retries. If the same sections keep failing, the issue is usually in the Strategist's plan, not the Narrator's execution.
4. **Test with the visualizer.** Run a renarration and check the validation scores across retry attempts. Scores should improve with each retry — if they don't, the replan signal isn't being applied correctly.

## Things to push back on

- **"Remove the fallback, it never triggers."** It will, at the worst possible time. Keep fallbacks.
- **"Let agents call each other directly."** All communication goes through context. Direct calls create hidden dependencies that break when agents are reordered or pipelines change.
- **"Lower the quality threshold so retries don't happen."** Fix the upstream agents instead. Retries exist because the output wasn't good enough.
- **"Add more agents to the retry loop."** The retry loop should be tight: Strategist -> Narrator -> Guardrails -> Quality. Adding more agents makes retries slow and unpredictable.
- **"Skip guardrails in development."** XSS in renarrated content is a real security risk. Never skip guardrails.

## Agent numbering convention

| # | Agent | Role | Optional |
|---|-------|------|----------|
| 0 | Pipeline Router | Select pipeline variant | No |
| 1 | Intent Analyst | Parse user request | No |
| 2 | Visual Cartographer | Map page sections via VLM | Yes (DOM fallback) |
| 2b | Meaning Extractor | Extract semantics | Yes |
| 3 | Content Strategist | Plan renarration per section | No (has rule fallback) |
| 4 | Narrator | Renarrate sections in parallel | No |
| 5 | Diagram Generator | Mermaid diagrams | Yes (disabled) |
| 6 | Quality Validator | Score + trigger retries | No |
| 7 | Memory Manager | Update user memory | Yes (background) |
| 8 | Feedback Analyst | Process user corrections | Yes (background) |
| 9 | Predictive Adapter | Suggest next actions | Yes (background) |
| 10 | Guardrails | XSS/hallucination/bias check | No |

New agents should use the next available number. Background agents (post-pipeline) use numbers 7-9. Core pipeline agents use 0-6 and 10.
