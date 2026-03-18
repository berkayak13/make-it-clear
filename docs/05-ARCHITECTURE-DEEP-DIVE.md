# Architecture Deep Dive — File-by-File Technical Reference

## File Map

```
on-device-renarration-main/
├── manifest.json              # Extension config (MV3)
├── background.js              # Service worker — central hub (~2080 lines)
├── content.js                 # Content script — runs on every page
├── content.css                # Overlay and trigger button styles
├── popup.html / popup.js / popup.css
│                              # Extension popup — quick controls
├── options.html / options.js / options.css
│                              # Full settings page
├── sidepanel.html / sidepanel.js / sidepanel.css
│                              # Side panel chatbot
├── offscreen.html             # Offscreen document host
├── src/
│   ├── offscreen-entry.js     # WebLLM engine (bundled by Vite)
│   └── prompts/
│       ├── system.md          # Main renarration system prompt
│       ├── chatbot-system.md  # Chatbot goal-discovery prompt
│       ├── evaluation.md      # Agentic quality evaluation prompt
│       ├── persona-extraction.md  # Persona JSON extraction prompt
│       ├── goal-extraction.md     # Reading goal JSON extraction prompt
│       └── vlm.md             # VLM screenshot transcription prompt
├── lib/
│   └── research-db.js         # IndexedDB wrapper (for viewer/sidepanel contexts)
├── config/
│   └── test-cases.json        # Test case definitions
├── viewers/
│   ├── testing-dashboard.html/js   # Test runner + results
│   ├── renarration-viewer.html/js  # Full-page renarration results
│   ├── describe-viewer.html/js     # VLM description results
│   ├── screenshot-viewer.html/js/css # Screenshot slice viewer
│   └── research-dashboard.html/js/css # Research data dashboard
├── icons/                     # Extension icons
├── test-page.html             # Manual test page
├── test-runner.html/js        # Test runner page
├── vite.config.js             # Vite build config (offscreen bundle only)
└── package.json               # Dependencies
```

---

## background.js — The Central Hub

This is the largest and most important file (~2080 lines). It's a Chrome service worker that handles all message routing, LLM/VLM calls, research logging, and pipeline orchestration.

### Section Breakdown

| Lines | Section | Purpose |
|-------|---------|---------|
| 1-82 | DEFAULT_TASKS, DEFAULT_PERSONAS | Hardcoded default configurations |
| 84-119 | `getSettingsWithTaskMigration()` | Load settings with backward-compatible migration from profiles→tasks |
| 122-259 | IndexedDB inline code | Full research DB implementation (duplicated from `lib/research-db.js` because service workers can't import) |
| 264-314 | Session/User ID + Preference tracking | Participant IDs, `chrome.storage.onChanged` listener |
| 319-374 | Prompt loaders | Cached async loaders for all 5 prompt template files |
| 379-491 | LLM dispatch | `getEffectiveLLMProvider()`, `callGeminiChat()`, `callGeminiChatFromMessages()`, `callWebLLMChat()`, `callLLM()` |
| 496-616 | Agentic pipeline | `evaluateRenarration()`, `agenticRenarrateText()` |
| 621-633 | Feedback trends | `checkFeedbackTrends()` |
| 636-1038 | Message handler | Giant `chrome.runtime.onMessage.addListener()` with all action routing |
| 1041-1112 | `renarrateText()` | Core text renarration with prompt template assembly |
| 1114-1291 | VLM + simulators | `describeImage()`, `simulateLocalLLM()`, `simulateLocalVLM()` |
| 1294-1457 | Page pipeline | `describePageScreenshot()`, `renarratePage()` |
| 1459-1562 | Remote VLM calls | `callRemoteVLM()`, `callRemoteVLMWithImages()` |
| 1564-1683 | Pipeline logging | `appendPipelineLog()`, size management, sanitization |
| 1690-1749 | Offscreen document | `ensureOffscreen()`, `postToOffscreen()` |
| 1752-2080 | Screenshots | Full-page capture, slicing, stitching, thumbnails |

### Message Actions

| Action | Handler | Purpose |
|--------|---------|---------|
| `renarrate-text` | Routes to `renarrateText()` or `agenticRenarrateText()` | Text renarration |
| `describe-image` | `describeImage()` | Single image description |
| `get-settings` | `getSettingsWithTaskMigration()` | Load all settings |
| `webllm-init` | `ensureOffscreen()` + init | Initialize WebLLM engine |
| `run-test-cases` | `runTestCases()` | Execute test suite |
| `capture-fullpage` | `captureFullPageScreenshots()` | Screenshot capture |
| `describe-page-screenshot` | `describePageScreenshot()` | VLM page description |
| `renarrate-page` | `renarratePage()` | Full pipeline |
| `chatbot-new-session` | Creates new chat session | Start chatbot |
| `chatbot-send` | Multi-turn chat via `callLLM()` | Send chat message |
| `chatbot-generate-persona` | Persona extraction via LLM | Generate persona from chat |
| `chatbot-apply-persona` | Save persona to storage | Apply generated persona |
| `chatbot-set-reading-goal` | Goal extraction via LLM | Extract reading goal |
| `submit-feedback` | Store in `feedbackEvents` | Save user feedback |
| `check-feedback-trends` | Analyze recent feedback | Detect quality issues |
| `export-research-data` | Read from IndexedDB | Export research data |
| `clear-research-data` | Clear all IndexedDB stores | Reset research data |
| `get-user-id` / `set-user-id` | Participant ID management | Research user tracking |

---

## content.js — Content Script

Injected into every web page. Responsibilities:

1. **Text selection detection** — `mouseup` listener, minimum 10 chars
2. **Trigger button** — Small floating button near selection, auto-removes after 3s
3. **Renarration overlay** — Shows results with close button
4. **Feedback UI** — Thumbs up/down buttons + correction textarea
5. **Settings sync** — Listens for `chrome.storage.onChanged` to update enabled/task state

Key flow: `handleTextSelection()` → `showRenarrationButton()` → `processTextRenarration()` → `showOverlay()` with feedback

---

## sidepanel.js — Chatbot

The side panel chatbot for goal/persona discovery:

1. **Session management** — Creates/restores sessions via background.js
2. **Message rendering** — Bubbles for user/model messages
3. **Quick replies** — Parses `>> Option` lines from model responses into clickable buttons
4. **Action buttons** — "Set Reading Goal" and "Generate Persona" appear after 2+ exchanges
5. **Preview cards** — Goal/persona extraction results shown in preview cards with Apply/Discard
6. **Feedback refinement banner** — Checks `checkFeedbackTrends()` on load

---

## src/offscreen-entry.js — WebLLM Engine

Bundled by Vite, runs in Chrome's offscreen document:

1. **Engine initialization** — Uses `webllm.CreateMLCEngine()` with progress callback
2. **Text renarration** — `webllmRenarrateText()` via chat completions API
3. **Multi-turn chat** — `webllmChat()` for chatbot and agentic pipeline
4. **Message routing** — Listens for `__toOffscreen` messages, responds with `__offscreenResponse`

---

## Prompt Templates

### system.md (Main Renarration Prompt)
- 110 lines defining the renarration assistant's role
- 6 sections: Role, Input Context, Task & Persona, Output Rules, Pipeline, Language
- Key rules: No meta-language, no transcription style, relevance check, maintain factual accuracy
- Placeholders filled by `applyPromptTemplate()`: `{task}`, `{persona}`, `{readingGoal}`

### chatbot-system.md (Chatbot Prompt)
- Goal-oriented reading assistant
- `{preferences}` placeholder for accumulated user preferences
- Question flow: reading goal → desired depth → focus areas → output style
- Quick reply format: `>> Option text`

### evaluation.md (Quality Evaluation)
- 4 criteria scored 1-5: appropriateness, faithfulness, clarity, tone
- Returns JSON with scores + `improvementSuggestion`

### persona-extraction.md
- Extracts: name, description, systemAddendum, interests, expertiseDomains, expertiseLevel
- systemAddendum starts with "Target audience persona:"

### goal-extraction.md
- `{preferences}` placeholder for accumulated preferences
- Extracts: readingGoal, desiredDepth, focusAreas, outputStyle, additionalInstructions

### vlm.md (VLM Screenshot Prompt)
- Transcribe visible text exactly, merge across slices
- Skip ads, browser chrome, utilities
- 8000 character hard cap
- Return structured outline in plain text

---

## IndexedDB Schema

### Database: `renarration-research` (version 2)

| Store | Key | Indexes | Purpose |
|-------|-----|---------|---------|
| `chatSessions` | `sessionId` (UUID) | userId, timestamp | Full conversation history |
| `researchLogs` | `logId` (UUID) | userId, timestamp, category | Categorized event log |
| `feedbackEvents` | `feedbackId` (UUID) | userId, timestamp, runId | User ratings + corrections |
| `experimentRuns` | `experimentId` (UUID) | userId, timestamp | Agentic pipeline attempts |
| `preferenceHistory` | `id` (autoIncrement) | userId, timestamp | Settings change tracking |
| `userPreferences` | `preferenceId` (autoIncrement) | userId, timestamp | Accumulated reading goals |

### Why Two Copies of IndexedDB Code?

- `lib/research-db.js` — Clean API with `ResearchDB` object, used by viewer pages and side panel
- Inline code in `background.js` — Identical logic, because Chrome service workers cannot use ES module imports

Both access the same IndexedDB database, so data written by background.js is visible in viewer pages.

---

## Data Flow Diagram — Text Selection Renarration

```
content.js                    background.js                     offscreen / Gemini API
    |                              |                                 |
    |-- mouseup detected --------->|                                 |
    |   (text > 10 chars)          |                                 |
    |                              |                                 |
    |-- renarrate-text msg ------->|                                 |
    |                              |-- check useAgenticPipeline      |
    |                              |                                 |
    |                              |-- getSettingsWithTaskMigration() |
    |                              |-- load task, persona, goal      |
    |                              |-- build system prompt template   |
    |                              |                                 |
    |                              |-- callLLM() ------------------>|
    |                              |   (routes based on provider)    |
    |                              |                                 |
    |                              |   [if on-device]                |
    |                              |   postToOffscreen() ---------->|-- WebLLM generate
    |                              |                                 |
    |                              |   [if remote]                   |
    |                              |   callGeminiChat() ----------->|-- Gemini API call
    |                              |                                 |
    |                              |<-- result --------------------- |
    |                              |                                 |
    |                              |-- [if agentic] evaluate ------>|
    |                              |<-- scores -------------------- |
    |                              |-- [if score < 3.5] retry       |
    |                              |                                 |
    |<-- sendResponse -------------|                                 |
    |   (result + agenticMeta)     |                                 |
    |                              |-- log to IndexedDB              |
    |-- showOverlay()              |                                 |
    |-- show feedback buttons      |                                 |
```

---

## Chrome Storage Keys

### chrome.storage.sync
| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | true | Extension on/off |
| `currentTask` | string | 'simple' | Active task key |
| `tasks` | object | DEFAULT_TASKS | All task definitions |
| `personas` | object | DEFAULT_PERSONAS | All persona definitions |
| `currentPersona` | string | 'general' | Active persona key |
| `llmProvider` | string | 'remote' | 'remote' or 'on-device' |
| `useWebLLM` | boolean | true | Legacy toggle (backward compat) |
| `webllmModel` | string | 'gemma-2-2b-it-q4f16_1-MLC' | WebLLM model ID |
| `useRemoteVLM` | boolean | true | Enable remote VLM |
| `remoteVLMModel` | string | 'gemini-2.5-flash' | VLM model name |
| `remoteVLMEndpoint` | string | (Gemini URL) | VLM API endpoint |
| `systemPromptTemplate` | string | (built from system.md) | Editable prompt template |
| `readingGoal` | string | '' | Current reading goal text |

### chrome.storage.local
| Key | Type | Description |
|-----|------|-------------|
| `remoteVLMApiKey` | string | Gemini API key (not synced) |
| `useAgenticPipeline` | boolean | Enable evaluate-retry |
| `enableResearchLogging` | boolean | Enable IndexedDB logging |
| `studyUserId` | string | Participant ID |
| `currentChatSessionId` | string | Active chatbot session |
| `pipelineLogs` | array | Pipeline stage logs |
| `testLogs` | array | Test case results |
| `lastScreenshots` | array | Latest screenshot slices |
| `lastDescribeResult` | object | Latest VLM description |
| `lastPageRenarration` | object | Latest page renarration |
