# OpenAI Renarration Assistant

A Chrome MV3 extension that uses OpenAI to extract visible page knowledge from text and page images, then rewrites the page into a plain-text split panel using the saved reading goal, active task, and active persona.

## Setup

1. Install dependencies:
   ```sh
   npm install
   ```
2. Create `.env` from `.env.example` and set `VITE_OPENAI_API_KEY`.
3. Build the background service worker:
   ```sh
   npm run build
   ```
4. Load the repo root as an unpacked extension in `chrome://extensions`.

## Configuration

`.env.example` documents the supported build-time settings:

- `VITE_OPENAI_API_KEY`
- `VITE_OPENAI_TEXT_MODEL`
- `VITE_OPENAI_VISION_MODEL`
- `VITE_OPENAI_IMAGE_DETAIL`
- `VITE_OPENAI_TIMEOUT_MS`

Tasks, personas, the system prompt template, and research settings are managed in the options page. The chat UI can extract and save a reading goal; saved goals are used by final page renarration.

## Usage

- Select text on a page, click the floating `R` button, and the extension renarrates the selected text.
- Click `Renarrate Page` in the popup to open the split panel, extract page knowledge, and render the final plain-text renarration.
- Open the side panel and click `Extract` to view the latest compact page knowledge.
- Use chat to discuss reading needs, then click `Set Reading Goal` and apply the generated goal.

## Structure

- `src/utils/openai-client.js`: OpenAI Responses API wrapper with `store: false`, text calls, vision calls, and structured JSON helpers.
- `src/page-flow/extract-page.js`: visible text plus direct page-image extraction into compact page knowledge, with screenshot fallback.
- `src/page-flow/renarrate-page.js`: final page renarration using saved reading goal, task, persona, extracted knowledge, and raw page text.
- `src/page-flow/orchestrator.js`: background message handlers, progress updates, storage, and panel rendering.
- `content.js`: selected-text overlay plus the plain split panel. Final page output is rendered with `textContent`.
- `src/handlers/chatbot.js`: chat sessions and reading-goal extraction.

## Verification

Run:

```sh
npm run build
npm run knip
git diff --check
rg "[legacy provider/action terms]" .
```
