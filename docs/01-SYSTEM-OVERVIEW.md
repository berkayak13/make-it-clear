# System Overview — On-Device Renarration Assistant

## What Is This?

A Chrome Extension (Manifest V3) that **renarrates** web content — transforming text and images to match a specific user's background, reading goals, and preferences. Unlike simple summarization or translation, renarration preserves the original meaning while reshaping tone, complexity, vocabulary, and structure for a target audience.

## Core Concept: Renarration

Renarration = taking web content and rewriting it so it reads as if it were *originally written for a specific person*.

Example: A financial news article about GDP growth can be renarrated as:
- **For a neighborhood barber**: plain language, no jargon, practical implications only
- **For an academic researcher**: formal tone, precise terminology, contextual analysis
- **For a high-school gamer**: casual language, relatable metaphors, short punchy sentences

The system achieves this through a **Task + Persona + Reading Goal** triad that shapes every LLM call.

## System Components at a Glance

```
+------------------+     +------------------+     +--------------------+
|   Content Script  |<--->|  Background SW   |<--->|  Offscreen Doc     |
|   (content.js)    |     |  (background.js) |     |  (WebLLM engine)   |
|                   |     |                  |     |  on-device LLM     |
| - Text selection  |     | - Message hub    |     +--------------------+
| - Trigger button  |     | - LLM routing    |
| - Result overlay  |     | - VLM calls      |     +--------------------+
| - Feedback UI     |     | - Agentic pipe   |     |  Gemini API        |
+------------------+     | - Research DB    |<--->|  (remote LLM/VLM)  |
                          | - Screenshot cap |     +--------------------+
+------------------+     | - Pipeline logs  |
|   Popup (popup)   |<--->|                  |     +--------------------+
| - Quick controls  |     +------------------+     |  Side Panel Chat   |
| - Task/Persona    |                              |  (sidepanel.js)    |
| - Page actions    |     +------------------+     | - Goal discovery   |
+------------------+     | Options Page     |     | - Persona gen      |
                          | - Task editor    |     | - Quick replies    |
+------------------+     | - Persona editor |     +--------------------+
| Viewer Pages      |     | - Prompt template|
| - Renarration     |     | - Research cfg   |     +--------------------+
| - Describe        |     +------------------+     |  Research Dashboard|
| - Screenshot      |                              |  (viewer page)     |
| - Testing         |                              | - Conversations    |
| - Research Dash   |                              | - Experiments      |
+------------------+                              | - Feedback         |
                                                   | - Export CSV/JSON  |
                                                   +--------------------+
```

## The Three Pillars: Task + Persona + Reading Goal

### Tasks (What to do)
Define *how* content should be transformed:
- **Simple Language** — plain vocabulary, short sentences
- **Detailed Explanation** — comprehensive, adds clarity
- **Academic Style** — formal, domain-rich terminology
- **Summary** — concise essential ideas only
- Users can create custom tasks with their own prompts

### Personas (Who to write for)
Define the *target audience*:
- **Berat (Neighborhood Barber)** — low computer literacy, very plain language
- **Undergrad Student** — basic academic concepts, not oversimplified
- **Academic Researcher** — formal, precise, domain-rich
- **General Public** — neutral, accessible
- **High-School Gamer** — casual, game-based metaphors
- **Small Business Owner** — practical, actionable, Excel-focused
- **Architecture Student** — design-oriented, spatial concepts
- Users can create custom personas or generate them via the chatbot

### Reading Goals (Why reading this)
Define *what the user wants from this specific content*:
- Set through a conversational chatbot in the side panel
- Extracted as structured JSON: goal, depth, focus areas, output style
- Accumulates across sessions to build preference history

## Dual LLM Architecture

The system supports two LLM backends, switchable at runtime:

| Feature | On-Device (WebLLM) | Remote (Gemini API) |
|---------|-------------------|-------------------|
| Model | gemma-2-2b-it (default) | gemini-2.5-flash |
| Privacy | Full — no data leaves browser | Data sent to Google |
| Speed | Slower (depends on GPU) | Faster |
| Quality | Limited by model size | Higher quality |
| Cost | Free | API key required |
| Setup | Needs WebGPU support | Needs API key |

Both backends are accessed through a **unified `callLLM()` dispatcher** that routes based on the `llmProvider` setting.

## Storage Architecture

| Store | Technology | Purpose |
|-------|-----------|---------|
| `chrome.storage.sync` | Chrome Sync | Tasks, personas, settings, current selections |
| `chrome.storage.local` | Chrome Local | API keys, pipeline logs, agentic toggle |
| IndexedDB (`renarration-research`) | Browser DB | Chat sessions, research logs, feedback, experiments, preferences |

## Key Capabilities Summary

1. **Text Selection Renarration** — Select text on any page, click the trigger button, get renarrated text in an overlay
2. **Full-Page Renarration** — Capture screenshots, extract content via VLM, renarrate via LLM
3. **Page Description** — Screenshot + VLM extraction without LLM renarration
4. **Agentic Pipeline** — Evaluate-retry loop for quality-controlled output
5. **Side Panel Chatbot** — Conversational goal/persona discovery
6. **Feedback Collection** — Thumbs up/down + text corrections on every renarration
7. **Research Dashboard** — View all collected data, filter by user, export CSV/JSON
8. **Configurable Prompts** — Editable system prompt template with {task}/{persona}/{readingGoal} placeholders
9. **Test Suite** — JSON-defined test cases run through the pipeline with logging
