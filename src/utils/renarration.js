import { callLLM } from './llm-dispatch.js';
import { getSettingsWithTaskMigration, DEFAULT_TASKS } from './storage-helpers.js';
import { getSystemBoilerplate, applyPromptTemplate } from './prompt-loader.js';

const ENGLISH_OUTPUT_RULE = 'Output language requirement: Write the final renarration in English, even if the source page, selected text, task, saved reading goal, or user message uses another language.';

export function truncateForContext(text, maxChars = 12000) {
  return text.length > maxChars ? text.slice(0, maxChars) + '...(truncated)' : text;
}

function formatReadingGoal(goal) {
  if (!goal) return '';
  if (typeof goal === 'string') return goal;
  return [
    goal.readingGoal ? `Goal: ${goal.readingGoal}` : '',
    goal.desiredDepth ? `Depth: ${goal.desiredDepth}` : '',
    Array.isArray(goal.focusAreas) && goal.focusAreas.length ? `Focus: ${goal.focusAreas.join(', ')}` : '',
    goal.outputStyle ? `Style: ${goal.outputStyle}` : '',
    goal.additionalInstructions ? `Notes: ${goal.additionalInstructions}` : '',
  ].filter(Boolean).join('\n');
}

export async function buildRenarrationPrompt(taskName, overrideTask, options = {}) {
  const settings = await getSettingsWithTaskMigration([
    'systemPromptTemplate',
  ]);
  const tasks = settings.tasks || DEFAULT_TASKS;
  const task = overrideTask || tasks[taskName || settings.currentTask] || tasks.simple || DEFAULT_TASKS.simple;

  const boilerplate = await getSystemBoilerplate();
  const { readingGoal } = await chrome.storage.sync.get(['readingGoal']);
  const systemPrompt = [
    applyPromptTemplate(
      settings.systemPromptTemplate,
      task?.textPrompt || '',
      boilerplate,
      formatReadingGoal(readingGoal)
    ),
    ENGLISH_OUTPUT_RULE,
  ].filter(Boolean).join('\n\n');

  return { systemPrompt, task, readingGoal: formatReadingGoal(readingGoal) };
}

export async function renarrateText(text, taskName, overrideTask, options = {}) {
  const prompt = await buildRenarrationPrompt(taskName, overrideTask, options);
  const userText = truncateForContext(String(text || ''));
  const result = await callLLM([{ role: 'user', content: userText }], prompt.systemPrompt, {
    temperature: options.temperature ?? 0.3,
    timeoutMs: options.timeoutMs,
  });

  return {
    ...result,
    promptInfo: {
      systemPrompt: prompt.systemPrompt,
      userText,
    },
  };
}

export async function setUserId(userId) {
  const clean = String(userId || '').trim();
  if (!clean) throw new Error('User ID is required');
  await chrome.storage.local.set({ studyUserId: clean });
  return clean;
}
