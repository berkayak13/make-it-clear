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

export const DEFAULT_PERSONAS = {
  'berat': {
    name: 'Berat (Neighborhood Barber)',
    description: 'Low computer literacy; prefers very plain Turkish/English explanations.',
    systemAddendum: 'Target audience persona: Berat is a neighborhood barber with limited computer experience. Use very plain language and avoid economic jargon.'
  },
  'student': {
    name: 'Undergrad Student',
    description: 'Understands basic academic concepts; wants clear but not oversimplified explanations.',
    systemAddendum: 'Target audience persona: An undergraduate student seeking clear educational explanations with light context.'
  },
  'researcher': {
    name: 'Academic Researcher',
    description: 'Prefers formal, precise, domain-rich terminology.',
    systemAddendum: 'Target audience persona: Academic researcher expecting formal tone with precise terminology.'
  },
  'general': {
    name: 'General Public',
    description: 'Average reader; keep it accessible and neutral.',
    systemAddendum: 'Target audience persona: General public; keep tone neutral and accessible.'
  },
  'gamer_student': {
    name: 'High-School Gamer',
    description: 'High school student, enjoys video games; prefers casual, engaging explanations with relatable metaphors.',
    systemAddendum:
      'Target audience persona: High-school student who enjoys video games. Use casual, energetic language, short sentences, and relatable game-based metaphors when appropriate. Avoid heavy jargon; if technical terms are needed, briefly define them using simple analogies.'
  },
  'smallbiz_owner': {
    name: 'Small Business Owner',
    description: 'Runs a small business and handles basic accounting in Excel; prefers direct, practical, and actionable explanations.',
    systemAddendum:
      'Target audience persona: Small business owner who performs accounting tasks (often in Excel). Provide clear, step-by-step guidance, prioritize practical examples and actionable items, and show short illustrative snippets (e.g., Excel formulas or brief workflow steps) when relevant. Keep language concise and business-focused.'
  },
  'arch_student': {
    name: 'Architecture Student',
    description: 'University architecture student experienced with 3D design tools and technical drawings; prefers precise, design-oriented language.',
    systemAddendum:
      'Target audience persona: University student majoring in architecture who frequently uses 3D design software. Use precise, domain-relevant terminology (but define very specialized terms if they are uncommon), reference spatial concepts and design workflow when useful, and give examples that can map to 3D modeling or drafting steps. Keep explanations structured and include suggested practical next steps for application in design software.'
  }
};

/**
 * Get settings with migration from legacy 'profiles' key to 'tasks'.
 */
export async function getSettingsWithTaskMigration(extraKeys = []) {
  const keys = new Set([
    'tasks',
    'currentTask',
    'profiles',
    'currentProfile',
    ...extraKeys
  ]);
  const settings = await chrome.storage.sync.get([...keys]);
  let tasks = settings.tasks;
  let currentTask = settings.currentTask;
  let shouldWrite = false;

  if ((!tasks || !Object.keys(tasks).length) && settings.profiles && Object.keys(settings.profiles).length) {
    tasks = settings.profiles;
    shouldWrite = true;
  }
  if (!currentTask && settings.currentProfile) {
    currentTask = settings.currentProfile;
    shouldWrite = true;
  }
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
