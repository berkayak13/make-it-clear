# Agentic Design Patterns in the System

## What Makes This System "Agentic"?

The system implements several agentic AI design patterns — where the LLM doesn't just execute a single prompt but participates in loops, self-evaluation, and adaptive behavior. Here's each pattern and where it lives.

---

## Pattern 1: Evaluate-Retry Loop (Self-Refinement Agent)

**Location**: `background.js` → `agenticRenarrateText()` (lines ~520-616)

### How It Works

```
                    +-----------------+
                    |  Input Text +   |
                    |  Task + Persona |
                    +--------+--------+
                             |
                             v
                 +-----------+-----------+
                 |   renarrateText()      |
                 |   (generate output)    |
                 +-----------+-----------+
                             |
                             v
                 +-----------+-----------+
                 |  evaluateRenarration() |
                 |  (LLM-as-Judge)        |
                 |                        |
                 |  Scores: 1-5 each for: |
                 |  - appropriateness     |
                 |  - faithfulness        |
                 |  - clarity             |
                 |  - tone               |
                 +-----------+-----------+
                             |
                    +--------+--------+
                    | avgScore >= 3.5? |
                    +--------+--------+
                   YES |           | NO
                       v           v
              +--------+--+  +----+--------+
              | Return     |  | Inject      |
              | best result|  | improvement |
              +------------+  | suggestion  |
                              | into prompt |
                              +------+------+
                                     |
                              (max 3 attempts)
                                     |
                              Back to renarrateText()
```

### Key Design Decisions

1. **Max 3 attempts** — Prevents infinite loops and controls API cost
2. **Threshold 3.5/5.0** — Represents "acceptable quality" (70%)
3. **Best-result tracking** — Even if no attempt passes threshold, returns the highest-scoring one
4. **Improvement injection** — The evaluator's `improvementSuggestion` is literally appended to the system prompt:
   ```
   Improvement instruction from evaluator: Simplify vocabulary — words like
   'methodology' are too advanced for this persona
   ```
5. **Full logging** — Every attempt with scores is saved to `experimentRuns` in IndexedDB

### The Evaluation Prompt (`src/prompts/evaluation.md`)

Scores on 4 dimensions:
- **Appropriateness** — Does it match the persona's needs?
- **Faithfulness** — Does it preserve original meaning?
- **Clarity** — Is it readable and organized?
- **Tone** — Does tone match task + persona?

Returns structured JSON with scores and an actionable improvement suggestion.

---

## Pattern 2: Conversational Goal Discovery (Interview Agent)

**Location**: `sidepanel.js` + `background.js` chatbot handlers

### How It Works

```
  User opens side panel
         |
         v
  +------+------+
  | New Session  |
  | created in   |
  | IndexedDB    |
  +------+------+
         |
         v
  +------+------+
  | Chatbot asks |  <-- Guided by chatbot-system.md prompt
  | ONE question |      with accumulated preferences
  | at a time    |
  +------+------+
         |
    User responds (text or quick-reply button)
         |
         v
  +------+------+
  | LLM generates|  <-- Multi-turn conversation via callLLM()
  | next question |     Previous preferences injected into system prompt
  | + quick       |
  | replies       |
  +------+------+
         |
    (after 2-3 exchanges)
         |
    +----+----+          +------+------+
    | Set Goal | -------> | Goal        |
    | button   |          | Extraction  |
    +----------+          | via LLM     |
                          +------+------+
                                 |
    +----------+          +------+------+
    | Generate | -------> | Persona     |
    | Persona  |          | Extraction  |
    | button   |          | via LLM     |
    +----------+          +------+------+
```

### Agentic Aspects

1. **Adaptive questioning** — The chatbot adapts based on user responses; short answers get follow-ups, detailed answers are acknowledged and moved past
2. **Preference memory** — Previous session preferences (`userPreferences` store) are loaded and injected into the system prompt so the chatbot can reference past choices
3. **Structured extraction** — The conversation is unstructured, but goal/persona extraction produces clean JSON using separate extraction prompts
4. **Quick replies** — LLM generates suggested responses (prefixed with `>> `) rendered as buttons, guiding the conversation flow

### The Two Extraction Steps

**Goal Extraction** (`goal-extraction.md`):
```json
{
  "readingGoal": "Get key takeaways about renewable energy for a presentation",
  "desiredDepth": "moderate",
  "focusAreas": ["renewable energy", "business implications"],
  "outputStyle": "bullet-points",
  "additionalInstructions": "avoid jargon"
}
```

**Persona Extraction** (`persona-extraction.md`):
```json
{
  "name": "Architecture Grad Student",
  "description": "University architecture student experienced with 3D design",
  "systemAddendum": "Target audience persona: University student majoring in architecture...",
  "interests": ["3D modeling", "sustainable design"],
  "expertiseDomains": ["architecture", "CAD"],
  "expertiseLevel": "intermediate"
}
```

---

## Pattern 3: Feedback-Driven Refinement Loop (Closed-Loop Agent)

**Location**: `content.js` (feedback UI) + `background.js` (feedback handler + trend checker) + `sidepanel.js` (refinement banner)

### How It Works

```
  User sees renarration result
         |
    +----+----+----+
    |    |         |
    v    v         v
  [Up] [Down]  [Correct]
    |    |         |
    v    v         v
  +--+---+---+----+
  | Store in       |
  | feedbackEvents |
  | IndexedDB      |
  +-------+--------+
          |
          v
  +-------+--------+
  | checkFeedback  |
  | Trends()       |
  | (3+ negative   |
  |  in last 10?)  |
  +-------+--------+
          |
     YES  |
          v
  +-------+--------+
  | Show refinement|
  | banner in      |
  | side panel     |
  +-------+--------+
          |
          v
  User clicks "Refine" → opens chatbot with
  "I'd like to refine my reading preferences
   based on recent feedback."
```

### Agentic Aspects

1. **Trend detection** — The system automatically monitors feedback patterns
2. **Proactive intervention** — When quality drops, it suggests refinement without being asked
3. **Closed loop** — Feedback → trend detection → preference refinement → better future output
4. **Per-run tracking** — Each renarration gets a `runId` linking feedback to the specific experiment

---

## Pattern 4: Multi-Stage Pipeline with Logging (Orchestrator Agent)

**Location**: `background.js` → `renarratePage()` + `describePageScreenshot()`

### The Full Pipeline

```
  User clicks "Renarrate Full Page"
         |
         v
  +------+------+
  | STAGE 1:     |
  | Capture      |  ← Screenshots: scroll + capture viewport slices
  | Screenshots  |    Max 50 slices, 350ms settle delay
  +------+------+    200px overlap between slices
         |
         v  (logged to pipelineLogs + researchLogs)
  +------+------+
  | STAGE 2:     |
  | VLM Extract  |  ← Send all slices to Gemini VLM with vlm.md prompt
  | Content      |    Transcribe text, note images, skip ads/chrome
  +------+------+    8000 char hard cap
         |
         v  (logged to pipelineLogs + researchLogs)
  +------+------+
  | STAGE 3:     |
  | LLM          |  ← Renarrate extracted content using Task+Persona+Goal
  | Renarrate    |    If agentic pipeline enabled: evaluate-retry loop
  +------+------+
         |
         v  (logged to pipelineLogs + researchLogs)
  +------+------+
  | Store result |  ← Save to chrome.storage.local
  | Open viewer  |    Open renarration-viewer.html
  +--------------+
```

### Agentic Aspects

1. **Stage-level logging** — Each stage is independently logged with duration, success/failure, model used
2. **Conditional agentic routing** — Stage 3 checks `useAgenticPipeline` to decide whether to use simple or evaluate-retry path
3. **Error resilience** — Each stage handles failures independently; VLM failure doesn't crash the pipeline
4. **Size management** — Aggressive content trimming, thumbnail generation, storage limit handling

---

## Pattern 5: Preference Accumulation (Memory Agent)

**Location**: `background.js` → `userPreferences` store + chatbot handlers

### How It Works

1. Every time the user sets a reading goal via the chatbot, the full goal JSON is saved to `userPreferences` in IndexedDB
2. On the next chatbot session, the 5 most recent preference records are loaded and injected into the chatbot system prompt as `{preferences}`
3. The chatbot can reference previous preferences: "Last time you wanted summaries — still the case, or something different today?"
4. Preference changes (task, persona, model switches) are tracked in `preferenceHistory`

### Agentic Aspects

1. **Long-term memory** — Preferences persist across sessions and conversations
2. **Contextual adaptation** — The chatbot's behavior changes based on accumulated preferences
3. **Conflict resolution** — Goal extraction prompt specifies: "prefer conversation over old preferences when they conflict"

---

## Summary: Agentic Components Map

| Pattern | Component | Toggle | Data Store |
|---------|-----------|--------|------------|
| Evaluate-Retry | `agenticRenarrateText()` | `useAgenticPipeline` | `experimentRuns` |
| Goal Discovery | Side panel chatbot | Always on | `chatSessions`, `userPreferences` |
| Feedback Loop | Content overlay + trend check | Always on | `feedbackEvents` |
| Multi-Stage Pipeline | `renarratePage()` | Always on | `pipelineLogs`, `researchLogs` |
| Preference Memory | Chatbot system prompt injection | Always on | `userPreferences`, `preferenceHistory` |

## What Makes This Different From a Simple LLM Wrapper

1. **Self-evaluation** — The system judges its own output and retries
2. **Improvement feedback** — Evaluator suggestions are injected back into the prompt
3. **Conversational discovery** — Preferences are discovered through dialogue, not forms
4. **Closed feedback loop** — User feedback → trend detection → refinement suggestion
5. **Preference accumulation** — System gets better across sessions
6. **Multi-stage orchestration** — Capture → Extract → Renarrate with independent logging
