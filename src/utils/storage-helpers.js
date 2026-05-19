export const DEFAULT_TASKS = {
  'simple': {
    name: 'Simple Language',
    textPrompt:
      'You are performing a re-narration task. Express the given text in simple, easy-to-understand language with short sentences and plain vocabulary suitable for a general audience.',
    imagePrompt:
      'You are describing an image in plain, accessible language. Keep sentences short and avoid technical terms.',
    maxLength: 150
  },
  'detailed': {
    name: 'Detailed Explanation',
    textPrompt:
      'You are performing a re-narration task. Produce a detailed and comprehensive version of the given text that adds clarity, elaboration, and logical flow while remaining faithful to the original meaning.',
    imagePrompt:
      'You are describing an image in a detailed way. Cover all visible elements, relationships, and contextual features.',
    maxLength: 300
  },
  'academic': {
    name: 'Academic Style',
    textPrompt:
      'You are performing a re-narration task. Render the given text in formal academic language, using precise terminology and structured phrasing consistent with scholarly writing.',
    imagePrompt:
      'You are describing an image in an academic tone, focusing on analytical, objective, and domain-appropriate terminology.',
    maxLength: 250
  },
  'summary': {
    name: 'Summary',
    textPrompt:
      'You are performing a re-narration task. Summarize the given text concisely, keeping only the essential ideas and expressing them clearly and neutrally.',
    imagePrompt:
      'You are summarizing the content of an image briefly, noting only the key elements or actions depicted.',
    maxLength: 100
  }
};

/**
 * Get task settings, filling missing values with defaults.
 */
export async function getSettingsWithTaskMigration(extraKeys = []) {
  const keys = new Set([
    'tasks',
    'currentTask',
    ...extraKeys
  ]);
  const settings = await chrome.storage.sync.get([...keys]);
  let tasks = settings.tasks;
  let currentTask = settings.currentTask;
  let shouldWrite = false;

  if (!tasks || !Object.keys(tasks).length) {
    tasks = DEFAULT_TASKS;
    shouldWrite = true;
  }
  if (!currentTask) {
    currentTask = Object.keys(tasks)[0] || 'simple';
    shouldWrite = true;
  }

  if (shouldWrite) {
    await chrome.storage.sync.set({ tasks, currentTask });
  }

  return { ...settings, tasks, currentTask };
}

/**
 * Get or create a stable user ID for research tracking.
 */
export async function getOrCreateUserId() {
  const { studyUserId } = await chrome.storage.local.get(['studyUserId']);
  if (studyUserId) return studyUserId;
  const newId = 'P' + String(Date.now()).slice(-4);
  await chrome.storage.local.set({ studyUserId: newId });
  return newId;
}
