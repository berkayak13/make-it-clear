# On-Device Renarration — Outline

Berkay · May 11, 2026 · snapshot of where we are and what's next

---

## 1. Where we are right now

- Chrome extension (MV3) that rewrites web pages for the actual reader
- Text → remote LLM today, moving on-device (WebLLM) next iteration
- Images / screenshots → remote VLM
- Chat-driven: user talks, extension figures out the rest

## 2. Architecture, in one breath

- `content.js` in the page — overlay UI, message bridge
- background service worker — orchestrator + agents
- offscreen document — hosts WebLLM (service worker can't run WebGPU)
- `chrome.storage` — tasks, personas, settings, chat memory

## 3. What's working today

- **Dual-model meaning extraction**
  - VLM reads screenshots, figures, layout
  - LLM reads the page's text content
  - `agent-2b-meaning-extractor.js` fuses both into one knowledge map
  - Downstream agents only see the map → DOM mess stops mattering
- **Chat-history-driven renarration**
  - `agent-4-narrator.js` reads knowledge map + compacted chat history
  - History carries the conversation; no persona / task inside it
  - `agent-7-memory-manager.js` + `src/utils/memory-system.js` handle compaction
  - Personas / tasks live in the system prompt (`src/prompts/system.md`), separate path
- **Plumbing**
  - Tasks: Simple / Detailed / Academic / Summary
  - Personas: Berat, Student, Researcher, General, Gamer, Business Owner, Architecture Student
  - Quality validator with retry loop (max 3)
  - Guardrails check
  - Viewer pages that read straight from `chrome.storage`

## 4. What we're building next — rebuild the page from its own pieces

- Goal: output a redesigned *page*, not just rewritten text
- Constraint: no image generation — reuse what's already on the original page
- New parts:
  - **Element Extractor** — pull images, figures, captions, code blocks, tables out of the page, keep their source for attribution
  - **Layout Planner agent** — input: knowledge map + extracted elements + chat history; output: a JSON plan for the new page
  - **Renderer** — upgrade `renarration-viewer.html` (or a new viewer) to render the plan with rewritten text + reused elements
  - **Element-fit scoring** — extend the quality validator so it also judges whether a reused element belongs where the planner put it

## 5. Order of work

- M1 — Element Extractor (~1 week)
- M2 — Layout Planner producing JSON (~1 week)
- M3 — Viewer renders the plan (~1 week)
- M4 — Element-fit scoring (~3–5 days)
- M5 — End-to-end demo on 3 pages: medical article, research paper, architecture blog (~3–5 days)

## 6. Things to watch out for

- **Latency** — VLM + LLM + renarration is a long chain; first section should stream so it doesn't feel broken
- **Element fit** — reused images won't always match; planner has to be willing to drop one rather than force it
- **Attribution** — captions and credits travel with their element
- **Privacy** — on-device-first is the whole pitch; remote calls need to be obvious and opt-in

## 7. Decisions still open

- Where the redesigned page lives — overlay inside the original tab vs. dedicated viewer
- Whether the Layout Planner runs on-device (WebLLM) or remote
- Cache strategy for extracted elements when the user re-opens the same page
- How aggressively to compact chat history — too aggressive and follow-ups lose context; too soft and the context window blows out

## 8. One-line status

Knowledge extraction and chat-aware renarration work end to end. Next is making the *layout* re-author itself, using the page's own pieces.
