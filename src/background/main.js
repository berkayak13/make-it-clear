import { setupMessageHandler } from './message-handler.js';
import { DEFAULT_TASKS } from '../utils/storage-helpers.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({
    enabled: true,
    currentTask: 'simple',
    tasks: DEFAULT_TASKS,
  });
  // Drop storage keys left by the removed persona/profile feature.
  chrome.storage.sync.remove(['personas', 'currentPersona', 'profiles', 'currentProfile']);
});

setupMessageHandler();

const TRACKED_PREF_KEYS = [
  'currentTask',
  'enabled',
  'readingGoal',
];

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync') return;
  try {
    const { enableResearchLogging } = await chrome.storage.local.get(['enableResearchLogging']);
    if (enableResearchLogging === false) return;
    for (const key of TRACKED_PREF_KEYS) {
      if (changes[key]) {
        console.log(`[ReNarrator] Preference changed: ${key}`, changes[key]);
      }
    }
  } catch {
    // Preference tracking is best-effort.
  }
});

console.log('[ReNarrator] OpenAI page-flow initialized');
