# How to Run — Setup & Usage Guide

## Prerequisites

- **Google Chrome** (version 116+ recommended for WebGPU support)
- **Node.js** (v18+ for building the offscreen bundle)
- **Gemini API Key** (required for remote LLM/VLM — free tier available at [Google AI Studio](https://aistudio.google.com/))

---

## Step 1: Install & Build

```bash
cd on-device-renarration-main
npm install          # Install dependencies (web-llm, vite, rimraf)
npm run build        # Build offscreen bundle → build/offscreen-entry.js
```

The build only bundles `src/offscreen-entry.js` (the WebLLM engine). All other files are loaded directly by Chrome as static extension files.

## Step 2: Load the Extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer Mode** (toggle in top-right)
3. Click **"Load unpacked"**
4. Select the repo root directory (`on-device-renarration-main/`)
5. The extension icon should appear in your toolbar

## Step 3: Configure API Key

1. Click the extension icon → **"Open Settings"** (or right-click → Options)
2. Scroll to **Advanced Settings / Remote VLM**
3. Check **"Use Remote VLM"**
4. Set Model to `gemini-2.5-flash`
5. Paste your **Gemini API Key**
6. Settings save automatically

## Step 4: Choose Your LLM Provider

In the popup or options page, select the **LLM Provider**:

| Provider | When to Use |
|----------|------------|
| **Remote (Gemini)** | Recommended for most users. Better quality, faster, requires API key |
| **On-Device (WebLLM)** | Privacy-first. Runs entirely in browser. Needs WebGPU. Slower, lower quality |

If using On-Device: click **"Initialize Model"** in the popup to download and warm up the WebLLM model (this takes a few minutes on first run).

---

## Using the Extension

### Text Selection Renarration

1. Navigate to any webpage
2. Select text (minimum ~10 characters)
3. A small trigger button appears near the selection
4. Click it → the text is renarrated based on your active Task + Persona
5. Results appear in a floating overlay with feedback buttons

### Full Page Renarration

1. Click the extension icon (popup)
2. Choose your **Task** and **Persona** from the dropdowns
3. Click **"Renarrate Full Page"**
4. Wait for the 3-stage pipeline: Capture → VLM → LLM
5. Results open in a new viewer tab

### Page Description (VLM Only)

1. Click popup → **"Describe Page"**
2. Screenshots are sent to VLM for content extraction (no LLM renarration)
3. Results open in the describe viewer

### Chatbot — Goal & Persona Discovery

1. Click popup → **"Open Chat"** (opens side panel)
2. Chat with the assistant about what you want from web content
3. After 2-3 exchanges, buttons appear:
   - **"Set Reading Goal"** — Extracts a structured reading goal from the conversation
   - **"Generate Persona"** — Creates a custom persona based on the conversation
4. Review the extracted goal/persona and click **"Apply"** or **"Discard"**

### Providing Feedback

After any text renarration, the overlay shows:
- **Thumbs Up** — Good renarration
- **Thumbs Down** — Needs improvement
- **Pencil icon** — Opens a text area to suggest a correction

All feedback is stored in IndexedDB for research analysis.

---

## Enabling the Agentic Pipeline

The agentic evaluate-retry loop is **off by default**. To enable:

1. **Quick toggle**: In the popup, check **"Agentic Pipeline"**
2. **Options page**: Under Research Settings, check **"Use Agentic Pipeline"**

When enabled:
- Every renarration is automatically scored (1-5) on appropriateness, faithfulness, clarity, and tone
- If average score < 3.5, the system retries with the evaluator's improvement suggestion (up to 3 attempts)
- All attempts are logged in the Research Dashboard under "Experiments"

Note: This doubles or triples LLM calls per renarration (1 generation + 1 evaluation per attempt).

---

## Research Dashboard

Access: Options page → **"Open Research Dashboard"**, or navigate to `viewers/research-dashboard.html`

### Tabs

| Tab | Contents |
|-----|----------|
| **Conversations** | All chatbot sessions with full message transcripts |
| **Experiments** | Agentic pipeline runs with attempt details and scores |
| **Feedback** | All thumbs up/down/correction events |
| **Preferences** | Tracked changes to tasks, personas, models |
| **Logs** | All research log entries, filterable by category |
| **Export** | Download any store as JSON or CSV |

### Filters
- **User filter** — Filter by participant ID (useful for multi-user studies)
- **Search** — Full-text search across all fields
- **Category filter** — Filter logs by category (renarration, chatbot, feedback, etc.)

---

## Testing Dashboard

Access: Popup → **"Testing Dashboard"**, or navigate to `viewers/testing-dashboard.html`

- Runs test cases defined in `config/test-cases.json` through the renarration pipeline
- Shows input, output, and model info for each test
- Allows manual evaluation notes
- Export results as JSON

---

## Key Settings Reference

| Setting | Location | Purpose |
|---------|----------|---------|
| LLM Provider | Popup / Options | Switch between on-device and remote |
| Active Task | Popup / Options | Which renarration style to use |
| Active Persona | Popup / Options | Who the output is written for |
| Remote VLM toggle | Options | Enable/disable Gemini VLM |
| API Key | Options | Gemini API authentication |
| Agentic Pipeline | Popup / Options | Enable evaluate-retry loop |
| Research Logging | Options | Enable/disable IndexedDB logging |
| Participant ID | Options | Set user ID for research |
| System Prompt Template | Options | Customize the full system prompt |

---

## Troubleshooting

| Issue | Solution |
|-------|---------|
| "API key not configured" | Set the Gemini API key in Options → Advanced Settings |
| WebLLM initialization fails | Ensure Chrome supports WebGPU (`chrome://gpu`). Try refreshing. |
| "Remote VLM error: 429" | Rate limit hit. Wait a moment and retry. |
| Screenshots don't capture | Ensure the tab is active and visible. Some pages block `captureVisibleTab`. |
| Pipeline logs too large | Dashboard → clear pipeline logs, or they auto-trim to 100 entries |
| Side panel won't open | Ensure `sidePanel` permission is in manifest (it is by default) |
| Offscreen document errors | Try disabling and re-enabling the extension |
