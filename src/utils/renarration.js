import { callLLM } from './llm-dispatch.js';
import { getSettingsWithTaskMigration, DEFAULT_TASKS } from './storage-helpers.js';
import { getSystemBoilerplate, applyPromptTemplate } from './prompt-loader.js';

// ISO 639-1 → display name for the common chat languages, so the output-language
// instruction can name the language explicitly (more reliable than a bare code).
const LANGUAGE_NAMES = {
  en: 'English', tr: 'Turkish', de: 'German', fr: 'French', es: 'Spanish',
  it: 'Italian', pt: 'Portuguese', nl: 'Dutch', ru: 'Russian', ar: 'Arabic',
  zh: 'Chinese', ja: 'Japanese', ko: 'Korean', hi: 'Hindi', pl: 'Polish',
  sv: 'Swedish', uk: 'Ukrainian', el: 'Greek', he: 'Hebrew', fa: 'Persian',
  id: 'Indonesian', vi: 'Vietnamese', th: 'Thai', cs: 'Czech', ro: 'Romanian',
  hu: 'Hungarian', fi: 'Finnish', da: 'Danish', no: 'Norwegian', az: 'Azerbaijani',
};

// The renarration is written in the language the user used in the chat. The goal
// extractor records that as readingGoal.language (ISO 639-1). When it is missing
// (e.g. an older goal, or no goal), mirror whatever language the reading goal /
// user instructions are written in rather than forcing a fixed language.
function outputLanguageRule(readingGoal) {
  const code = (readingGoal && typeof readingGoal === 'object' && readingGoal.language)
    ? String(readingGoal.language).toLowerCase().trim().slice(0, 5)
    : '';
  if (code) {
    if (code === 'en') {
      return 'Output language requirement: Write the renarration in clear, natural English.';
    }
    const name = LANGUAGE_NAMES[code] || `the language with ISO 639-1 code "${code}"`;
    return `Output language requirement: Write the ENTIRE renarration in ${name} — the language the user used in the conversation — even if the source page, task, or extracted facts are in a different language. Do not mix languages.`;
  }
  return 'Output language requirement: Write the renarration in the SAME language the user is using in the saved reading goal and instructions. Mirror the user\'s language; do not translate the content into a different language.';
}

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

export async function buildRenarrationPrompt(taskName, overrideTask) {
  const settings = await getSettingsWithTaskMigration([
    'systemPromptTemplate',
  ]);
  const tasks = settings.tasks || DEFAULT_TASKS;
  const task = overrideTask || tasks[taskName || settings.currentTask] || tasks.simple || DEFAULT_TASKS.simple;

  const boilerplate = await getSystemBoilerplate();
  const { readingGoal } = await chrome.storage.sync.get(['readingGoal']);
  const languageRule = outputLanguageRule(readingGoal);
  const systemPrompt = [
    applyPromptTemplate(
      settings.systemPromptTemplate,
      task?.textPrompt || '',
      boilerplate,
      formatReadingGoal(readingGoal)
    ),
    languageRule,
  ].filter(Boolean).join('\n\n');

  // languageRule is returned so callers (e.g. caption renarration) can match the
  // output language WITHOUT waiting on the body renarration as a sample.
  return { systemPrompt, task, readingGoal: formatReadingGoal(readingGoal), languageRule };
}

export async function renarrateText(text, taskName, overrideTask, options = {}) {
  const prompt = await buildRenarrationPrompt(taskName, overrideTask);
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
