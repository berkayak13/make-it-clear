const promptCache = new Map();

/**
 * Generic cached loader for prompt markdown files.
 * Fetches src/prompts/{name}.md via chrome.runtime.getURL.
 */
async function loadPrompt(name) {
  if (promptCache.has(name)) return promptCache.get(name);
  try {
    const url = chrome.runtime.getURL(`src/prompts/${name}.md`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load prompt: ${name}`);
    const text = (await res.text()).trim();
    promptCache.set(name, text);
    return text;
  } catch (e) {
    console.warn(`Prompt fetch failed for "${name}":`, e?.message);
    return null;
  }
}

/**
 * Load the system boilerplate (system.md).
 */
export async function getSystemBoilerplate() {
  return await loadPrompt('system') || '';
}

/**
 * Build the default prompt template combining boilerplate with placeholders.
 */
function buildDefaultPromptTemplate(boilerplate) {
  const parts = [];
  const base = (boilerplate || '').trim();
  if (base) parts.push(base);
  parts.push('Task:\n{task}');
  parts.push('Reading Goal:\n{readingGoal}');
  return parts.join('\n\n');
}

// Strips the retired "Persona:" section and {persona} token from saved
// prompt templates created before that feature was removed.
function sanitizePromptTemplate(template) {
  const lines = String(template || '').replace(/\r\n/g, '\n').split('\n');
  const cleaned = [];
  const retiredLabelRe = /^\s*Persona\s*:?\s*$/i;
  const retiredTokenRe = /\{persona\}/i;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (retiredLabelRe.test(line)) {
      while (
        i + 1 < lines.length &&
        !/^\s*(Task|Reading Goal)\s*:?\s*$/i.test(lines[i + 1])
      ) {
        i += 1;
      }
      continue;
    }
    if (retiredTokenRe.test(line)) continue;
    cleaned.push(line);
  }
  return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Apply a prompt template by replacing {task} and {readingGoal} placeholders.
 * Falls back to buildDefaultPromptTemplate if template is empty.
 */
export function applyPromptTemplate(template, taskText, boilerplate, readingGoalText) {
  const source = sanitizePromptTemplate(template || '') || buildDefaultPromptTemplate(boilerplate);
  return source
    .replace(/\{task\}/gi, () => taskText || '')
    .replace(/\{readingGoal\}/gi, () => readingGoalText || '')
    .trim();
}

export async function getChatbotSystemPrompt() {
  return (await loadPrompt('chatbot-system'))
    || 'You are a friendly assistant helping users define their reading goals. Ask one question at a time about what they want from web content.';
}

export async function getGoalExtractionPrompt() {
  return (await loadPrompt('goal-extraction'))
    || 'Extract a reading goal JSON from this conversation. Return only JSON with fields: readingGoal, desiredDepth, focusAreas, outputStyle, additionalInstructions.';
}
