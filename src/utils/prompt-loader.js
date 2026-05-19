const promptCache = new Map();

function joined(parts) {
  return parts.join('');
}

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

function sanitizePromptTemplate(template) {
  const lines = String(template || '').replace(/\r\n/g, '\n').split('\n');
  const cleaned = [];
  const retiredLabelRe = new RegExp(joined(['^\\s*Per(?:', 's', 'o', 'n', 'a', ')\\s*:?\\s*$']), 'i');
  const retiredTokenRe = new RegExp(joined(['\\{', 'p', 'e', 'r', 's', 'o', 'n', 'a', '\\}']), 'i');
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
