// Main entry point for the bundled background service worker.
// This replaces background.js when the agentic pipeline is built via Vite.
// The original background.js remains as the legacy fallback.

import { setupMessageHandler } from './message-handler.js';
import { DEFAULT_TASKS, DEFAULT_PERSONAS } from '../utils/storage-helpers.js';

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({
    enabled: true,
    currentTask: 'simple',
    tasks: DEFAULT_TASKS,
    llmProvider: 'remote',
    useWebLLM: true,
    webllmModel: 'gemma-2-2b-it-q4f16_1-MLC',
    useWebVLM: false,
    webvlmModel: 'Phi-3.5-vision-instruct-q4f16_1-MLC',
    useRemoteVLM: true,
    remoteVLMModel: 'gemini-2.5-flash',
    remoteVLMEndpoint:
      'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    personas: DEFAULT_PERSONAS,
    currentPersona: 'general',
  });
  chrome.storage.local.set({ remoteVLMApiKey: '' });
});

// Set up message handler (must be registered synchronously)
setupMessageHandler();

// Preference tracking — mirror the logic from background.js
const TRACKED_PREF_KEYS = [
  'currentTask', 'currentPersona', 'useWebLLM', 'useRemoteVLM',
  'webllmModel', 'remoteVLMModel', 'enabled',
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
    // Non-critical — preference tracking is best-effort
  }
});

console.log('[ReNarrator] Agentic pipeline v2.0 initialized');
