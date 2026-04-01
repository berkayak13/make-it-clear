// Cached prompt loaders — each fetches a markdown file via chrome.runtime.getURL()
// with lazy caching and a hardcoded fallback string.

const cache = Object.create(null);

const DEFAULT_REMOTE_VLM_PROMPT = [
  'You see screenshot slices of an entire webpage, in order from top to bottom.',
  'Transcribe important textual content exactly as shown (headings, body paragraphs, link/label text).',
  'Keep wording tight and ordered; lightly condense filler/repeated boilerplate.',
  'Include brief notes for meaningful images/graphics and layout cues (sidebars, callouts, tables) only when they convey information.',
  'Do NOT include ads, promo banners, cookie banners, newsletter popups, or other promotional/utility chrome (nav bars, footers, repeated menus); skip them entirely.',
  'If text flows across slices (e.g., an article continues), merge it into a single continuous section.',
  'Hard cap the response at about 8,000 characters (~1,200 words); prioritize main content, merge repeats, and drop filler to stay under the cap.',
  'Prefer concise bullets or short paragraphs; do not repeat headings or navigation items.',
  'Return a single structured outline in plain text. Respect the order of slices as they appear.'
].join(' ');

async function loadCachedPrompt(path, fallback) {
  if (cache[path]) return cache[path];
  try {
    const res = await fetch(chrome.runtime.getURL(path));
    if (!res.ok) throw new Error(`Failed to load ${path}`);
    const txt = (await res.text()).trim();
    cache[path] = txt || fallback;
    return cache[path];
  } catch (e) {
    console.warn(`Prompt fetch failed for ${path}:`, e?.message || e);
    return fallback;
  }
}

export function getChatbotSystemPrompt() {
  return loadCachedPrompt(
    'src/prompts/chatbot-system.md',
    'You are a friendly assistant helping users discover their personalized reading profile. Ask one question at a time about their background, interests, and preferences.'
  );
}

export function getPersonaExtractionPrompt() {
  return loadCachedPrompt(
    'src/prompts/persona-extraction.md',
    'Extract a persona JSON from this conversation. Return only JSON with fields: name, description, systemAddendum, interests, expertiseDomains, expertiseLevel.'
  );
}

export function getEvaluationPrompt() {
  return loadCachedPrompt(
    'src/prompts/evaluation.md',
    'Evaluate this renarration on appropriateness, faithfulness, clarity, tone (1-5 each). Return JSON with scores and improvementSuggestion.'
  );
}

export function getGoalExtractionPrompt() {
  return loadCachedPrompt(
    'src/prompts/goal-extraction.md',
    'Extract a reading goal JSON from this conversation. Return only JSON with fields: readingGoal, desiredDepth, focusAreas, outputStyle, additionalInstructions.'
  );
}

export function getRemoteVlmPrompt() {
  return loadCachedPrompt('src/prompts/vlm.md', DEFAULT_REMOTE_VLM_PROMPT);
}
