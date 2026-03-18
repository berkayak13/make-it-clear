# Evolution — What Changed From Start to Current State

## Phase 1: Basic Renarration Extension (Original)

The system started as a straightforward Chrome Extension for text reformulation:

### Original Components
- **content.js** — Detected text selection, showed a trigger button, displayed results in a floating overlay
- **background.js** — Routed messages, managed task/profile storage, ran simulated LLM responses
- **offscreen.html + offscreen-entry.js** — Hosted WebLLM engine for on-device inference via WebGPU
- **popup.html** — Toggle extension on/off, select task, switch LLM mode
- **options.html** — Manage tasks (Simple, Detailed, Academic, Summary), configure VLM settings

### Original Capabilities
- Select text on a page → renarrate it using on-device WebLLM or simulated fallback
- 4 default tasks (Simple Language, Detailed Explanation, Academic Style, Summary)
- WebLLM via offscreen document for on-device processing
- Remote VLM (Gemini API) for image/screenshot description
- Full-page screenshot capture and slicing
- Basic pipeline: Capture → VLM → LLM → Viewer
- Test cases via `config/test-cases.json` with a testing dashboard

### What Was Missing
- No concept of "personas" (audience adaptation)
- No way to discover user preferences conversationally
- No quality evaluation or retry mechanism
- No feedback collection
- No research data infrastructure
- Single LLM path without unified dispatch

---

## Phase 2: Persona System (Added)

### What Changed
- **7 default personas** added to `background.js` and `options.js`: Berat, Student, Researcher, General, High-School Gamer, Small Business Owner, Architecture Student
- **Persona selector** in popup and options pages
- **System prompt enhanced** — Persona addendum appended to every LLM call
- `systemAddendum` field in persona objects provides audience-specific LLM instructions
- Options page got a full persona editor (add/edit/delete custom personas)

### Impact
Every renarration now considers both *what to do* (task) and *who to write for* (persona). The same text renarrated for a barber vs. a researcher produces fundamentally different output.

---

## Phase 3: Unified LLM Dispatch + Remote Chat (Added)

### What Changed
- **`callLLM()` unified dispatcher** — Single function that routes to either WebLLM (on-device) or Gemini API (remote) based on `llmProvider` setting
- **`callGeminiChat()`** — Multi-turn Gemini API support with `system_instruction` field
- **`callGeminiChatFromMessages()`** — Converts OpenAI-format messages to Gemini format
- **`callWebLLMChat()`** — Routes chat-format messages to offscreen WebLLM
- **`llmProvider` setting** replaces old `useWebLLM` boolean (backward compatible)

### Impact
All LLM calls go through one function. Switching between on-device and remote is a single setting change. The chatbot, agentic pipeline, and renarration all use the same dispatch.

---

## Phase 4: Side Panel Chatbot + Goal Discovery (Added)

### What Changed
- **`sidepanel.html` + `sidepanel.js`** — Full chatbot UI in Chrome's side panel
- **`src/prompts/chatbot-system.md`** — Goal-oriented reading assistant prompt with `{preferences}` placeholder
- **`src/prompts/goal-extraction.md`** — Structured goal extraction (readingGoal, desiredDepth, focusAreas, outputStyle)
- **`src/prompts/persona-extraction.md`** — Structured persona extraction from conversation
- **Quick replies** — Model responses can include `>> Option` lines rendered as clickable buttons
- **Reading Goal flow**: Chat → Extract Goal JSON → Store as `readingGoal` in sync storage
- **Persona Generation flow**: Chat → Extract Persona JSON → Save to personas list → Set as active

### Impact
Users can conversationally discover their reading preferences instead of manually configuring tasks/personas. The chatbot asks one question at a time, learns about the user, then extracts a structured reading goal and optionally a new persona.

---

## Phase 5: Research Infrastructure + IndexedDB (Added)

### What Changed
- **IndexedDB (`renarration-research`)** with 6 stores:
  - `chatSessions` — Full conversation history with extracted profiles
  - `researchLogs` — Timestamped log entries categorized by type
  - `feedbackEvents` — Thumbs up/down + corrections linked to run IDs
  - `experimentRuns` — Agentic pipeline attempt history with scores
  - `preferenceHistory` — Tracks changes to settings (task, persona, model)
  - `userPreferences` — Accumulated reading goal preferences per user
- **`lib/research-db.js`** — Clean API wrapper for viewer/sidepanel contexts
- **Inline IndexedDB copy in `background.js`** — Service worker can't import modules, so the DB code is duplicated inline
- **Participant ID system** — `studyUserId` for multi-user research
- **Preference tracking** — `chrome.storage.onChanged` listener logs every change to tracked settings

### Impact
Every interaction is logged for research purposes. Chat sessions, renarration runs, feedback events, and preference changes are all stored in IndexedDB with user IDs and timestamps, enabling post-hoc analysis.

---

## Phase 6: Agentic Pipeline (Added)

### What Changed
- **`agenticRenarrateText()`** — Evaluate-retry loop wrapping `renarrateText()`
- **`evaluateRenarration()`** — LLM-as-judge scoring on 4 criteria (1-5 each)
- **`src/prompts/evaluation.md`** — Evaluation prompt for appropriateness, faithfulness, clarity, tone
- **Max 3 attempts**, quality threshold of 3.5/5.0
- **Improvement feedback loop** — Evaluator's `improvementSuggestion` is injected into the next attempt's system prompt
- **Toggle**: `useAgenticPipeline` in `chrome.storage.local`

### Impact
When enabled, every renarration is automatically evaluated. If quality is below threshold, the system retries with the evaluator's specific improvement suggestion appended to the prompt. Results are logged as experiment runs with full attempt history.

---

## Phase 7: Feedback System (Added)

### What Changed
- **Feedback UI in content.js overlay** — Thumbs up, thumbs down, and correction text area buttons appear on every renarration result
- **`submit-feedback` message handler** — Stores feedback events in IndexedDB
- **`checkFeedbackTrends()`** — Analyzes recent feedback; if 3+ of last 10 are negative, suggests refinement
- **Refinement banner in side panel** — "Your recent renarrations had some issues. Want to refine your preferences?"

### Impact
Users can rate every renarration. Negative feedback accumulates and triggers a suggestion to re-engage with the chatbot to refine preferences. This creates a closed feedback loop.

---

## Phase 8: Research Dashboard (Added)

### What Changed
- **`viewers/research-dashboard.html` + `.js` + `.css`** — Full tabbed dashboard
- **Tabs**: Conversations, Experiments, Feedback, Preferences, Logs, Export
- **Filters**: User ID filter, text search, log category filter
- **Export**: Per-store JSON/CSV export, or all-data bulk export
- **Expandable rows** — Click to view full conversation transcripts, experiment details, etc.

### Impact
Researchers can view, filter, and export all collected data without touching code. Each IndexedDB store gets its own tab with relevant columns and visualization.

---

## Phase 9: System Prompt Template Engine (Added)

### What Changed
- **Editable system prompt template** in options page with `{task}`, `{persona}`, `{readingGoal}` placeholders
- **`src/prompts/system.md`** — Rich 110-line system prompt defining the renarration assistant's role, rules, and behavior
- **`applyPromptTemplate()`** — Template variable substitution engine
- **Live preview** — "Effective System Prompt" textarea in options shows the fully resolved prompt
- **Restore to default** button

### Impact
Researchers/users can customize the exact prompt structure without editing code. The reading goal from the chatbot flows into the template, creating a fully dynamic prompt pipeline.

---

## Summary: Baseline → Current

| Aspect | Baseline | Current |
|--------|----------|---------|
| Audience adaptation | None (task only) | Task + Persona + Reading Goal |
| LLM backends | WebLLM only + simulated fallback | WebLLM + Gemini API unified dispatch |
| Quality control | None | Agentic evaluate-retry loop |
| User feedback | None | Thumbs up/down + corrections |
| Preference discovery | Manual task selection | Conversational chatbot |
| Data collection | Basic test logs | Full IndexedDB research infrastructure |
| Dashboard | Testing dashboard only | Testing + Research dashboard |
| Prompt control | Hardcoded | Editable template with live preview |
| Personas | None | 7 defaults + custom + chatbot-generated |
