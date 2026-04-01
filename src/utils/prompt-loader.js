const promptCache = new Map();

/**
 * Generic cached loader for prompt markdown files.
 * Fetches src/prompts/{name}.md via chrome.runtime.getURL.
 */
export async function loadPrompt(name) {
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
export function buildDefaultPromptTemplate(boilerplate) {
  const parts = [];
  const base = (boilerplate || '').trim();
  if (base) parts.push(base);
  parts.push('Task:\n{task}');
  parts.push('Persona:\n{persona}');
  parts.push('Reading Goal:\n{readingGoal}');
  return parts.join('\n\n');
}

/**
 * Apply a prompt template by replacing {task}, {persona}, {readingGoal} placeholders.
 * Falls back to buildDefaultPromptTemplate if template is empty.
 */
export function applyPromptTemplate(template, taskText, personaText, boilerplate, readingGoalText) {
  const source = (template || '').trim() || buildDefaultPromptTemplate(boilerplate);
  return source
    .replace(/\{task\}/gi, () => taskText || '')
    .replace(/\{persona\}/gi, () => personaText || '')
    .replace(/\{readingGoal\}/gi, () => readingGoalText || '')
    .trim();
}
