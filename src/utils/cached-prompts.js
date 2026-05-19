// Cached prompt loaders — each fetches a markdown file via chrome.runtime.getURL()
// with lazy caching and a hardcoded fallback string.

const cache = Object.create(null);

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
    'You are a friendly assistant helping users define their reading goals. Ask one question at a time about what they want from web content.'
  );
}

export function getGoalExtractionPrompt() {
  return loadCachedPrompt(
    'src/prompts/goal-extraction.md',
    'Extract a reading goal JSON from this conversation. Return only JSON with fields: readingGoal, desiredDepth, focusAreas, outputStyle, additionalInstructions.'
  );
}
