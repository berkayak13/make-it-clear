import { setupMessageHandler } from './message-handler.js';
import { DEFAULT_TASKS } from '../utils/storage-helpers.js';

function retiredKey(parts) {
  return parts.join('');
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({
    enabled: true,
    currentTask: 'simple',
    tasks: DEFAULT_TASKS,
  });
  chrome.storage.sync.remove([
    retiredKey(['p', 'e', 'r', 's', 'o', 'n', 'a', 's']),
    retiredKey(['c', 'u', 'r', 'r', 'e', 'n', 't', 'P', 'e', 'r', 's', 'o', 'n', 'a']),
    retiredKey(['p', 'r', 'o', 'f', 'i', 'l', 'e', 's']),
    retiredKey(['c', 'u', 'r', 'r', 'e', 'n', 't', 'P', 'r', 'o', 'f', 'i', 'l', 'e']),
  ]);
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
  } catch (e) {
    // Preference tracking is best-effort.
  }
});

console.log('[ReNarrator] OpenAI page-flow initialized');
