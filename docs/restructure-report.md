# OpenAI-Only Restructure Report

## Removed

- Multi-agent page modules under `src/agents/`.
- Legacy background page orchestrator and page handler.
- Local model worker code and alternate hosted vision helpers.
- DOM clone replacement flow from `content.js`.
- Old visualizer files and popup links.
- Unused prompt files tied to the old page flow.

## Added

- `.env.example` with `VITE_OPENAI_*` settings.
- `src/utils/openai-client.js` for OpenAI Responses API calls with `store: false`.
- `src/page-flow/extract-page.js` for visible text plus screenshot knowledge extraction.
- `src/page-flow/renarrate-page.js` for final plain-text page renarration.
- `src/page-flow/orchestrator.js` for progress, storage, and content panel rendering.
- `knip.json` and `npm run knip`.

## Active Message Contracts

- Popup: `run-page-renarration`.
- Side panel: `extract-page-knowledge`, `get-last-extraction`.
- Chat: `chatbot-new-session`, `chatbot-get-session`, `chatbot-send`, `chatbot-set-reading-goal`.
- Selected text: `renarrate-text`.
- Content page panel: `extract-visible-page-text`, `show-renarration-panel`, `update-renarration-progress`, `render-renarration-text`, `hide-renarration-panel`.

## Verification

Target checks:

- `npm run build`
- `npm run knip`
- `git diff --check`
- legacy provider/action reference search

Manual smoke checks:

- Popup page renarration opens the split panel and renders plain text.
- Saved reading goal is included in final renarration prompts.
- Chat can save/apply reading goals.
- Selected-text overlay still renarrates selected text.
- Missing OpenAI key returns a visible error in the split panel.
