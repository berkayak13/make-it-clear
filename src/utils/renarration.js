import { callLLM } from './llm-dispatch.js';
import { getSettingsWithTaskMigration, DEFAULT_TASKS, getOrCreateUserId } from './storage-helpers.js';
import { researchGetByIndex } from './firestore-client.js';
import { getSystemBoilerplate, applyPromptTemplate } from './prompt-loader.js';

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
    'personas',
    'currentPersona',
    'systemPromptTemplate',
  ]);
  const tasks = settings.tasks || DEFAULT_TASKS;
  const task = overrideTask || tasks[taskName || settings.currentTask] || tasks.simple || DEFAULT_TASKS.simple;

  let persona = null;
  if (options?.personaKey && settings.personas?.[options.personaKey]) {
    persona = settings.personas[options.personaKey];
  } else if (typeof options?.personaText === 'string' && options.personaText.trim()) {
    persona = {
      name: options.personaKey || 'Custom Persona',
      description: options.personaText.trim(),
      systemAddendum: options.personaText.trim(),
    };
  } else {
    persona = settings.personas?.[settings.currentPersona];
  }

  const boilerplate = await getSystemBoilerplate();
  const { readingGoal } = await chrome.storage.sync.get(['readingGoal']);
  const systemPrompt = applyPromptTemplate(
    settings.systemPromptTemplate,
    task?.textPrompt || '',
    persona ? (persona.systemAddendum || persona.description || '') : '',
    boilerplate,
    formatReadingGoal(readingGoal)
  );

  return { systemPrompt, task, persona, readingGoal: formatReadingGoal(readingGoal) };
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

export async function checkFeedbackTrends() {
  try {
    const userId = await getOrCreateUserId();
    const allFeedback = await researchGetByIndex('feedbackEvents', 'userId', userId);
    const recent = allFeedback
      .filter((f) => f.feedbackType === 'thumbs-down')
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 3);

    return {
      success: true,
      shouldRefine: recent.length >= 3,
      recentNegativeCount: recent.length,
    };
  } catch (e) {
    return { success: false, shouldRefine: false, error: e?.message || String(e) };
  }
}
