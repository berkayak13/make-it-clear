import { getSettingsWithTaskMigration, getOrCreateUserId } from '../utils/storage-helpers.js';
import { generateId } from '../utils/id.js';
import { researchPut, researchGetByIndex, researchGetAll, researchClearStore, researchExportCSV, RESEARCH_STORES } from '../utils/firestore-client.js';
import { renarrateText, checkFeedbackTrends, setUserId } from '../utils/renarration.js';

const RESEARCH_STORES_KEYS = ['chatSessions', 'researchLogs', 'feedbackEvents', 'experimentRuns', 'preferenceHistory', 'userPreferences'];

function getResearchStoreNames() {
  if (RESEARCH_STORES && typeof RESEARCH_STORES === 'object') {
    return Object.keys(RESEARCH_STORES);
  }
  return RESEARCH_STORES_KEYS;
}

export const simpleHandlers = {
  'renarrate-text': async (request, _sender) => {
    const result = await renarrateText(request.text, request.task);
    if (result?.success) {
      try {
        await chrome.storage.local.set({
          lastTextRenarration: {
            originalText: (request.text || '').slice(0, 10000),
            renarration: (result.result || '').slice(0, 10000),
            at: new Date().toISOString(),
            task: request.task || ''
          }
        });
      } catch (e) {
        // Ignore persistence failures
      }
    }
    return result;
  },

  'get-settings': async (_request, _sender) => {
    return getSettingsWithTaskMigration([
      'enabled',
      'personas',
      'currentPersona',
      'currentTask',
      'tasks',
      'systemPromptTemplate'
    ]);
  },

  'get-logs': async (_request, _sender) => {
    const data = await chrome.storage.local.get(['testLogs']);
    return { success: true, logs: data.testLogs || [] };
  },

  'clear-logs': async (_request, _sender) => {
    await chrome.storage.local.set({ testLogs: [], completedTestIds: [] });
    return { success: true };
  },

  'get-user-id': async (_request, _sender) => {
    const userId = await getOrCreateUserId();
    return { success: true, userId };
  },

  'open-extracted-content-viewer': async (_request, sender) => {
    const sourceTabId = sender?.tab?.id ? `?tabId=${encodeURIComponent(sender.tab.id)}` : '';
    await chrome.tabs.create({ url: chrome.runtime.getURL(`viewers/extracted-content.html${sourceTabId}`) });
    return { success: true };
  },

  'set-user-id': async (request, _sender) => {
    const userId = await setUserId(request.userId);
    return { success: true, userId };
  },

  'submit-feedback': async (request, _sender) => {
    const userId = await getOrCreateUserId();
    const feedback = {
      feedbackId: generateId(),
      userId,
      timestamp: Date.now(),
      runId: request.runId || '',
      feedbackType: request.feedbackType,
      correctedText: request.correctedText || null,
      rating: request.rating || null,
      taskName: request.taskName || '',
      personaName: request.personaName || ''
    };
    await researchPut('feedbackEvents', feedback);
    if (request.feedbackType === 'thumbs-down') {
      const { enableResearchLogging } = await chrome.storage.local.get(['enableResearchLogging']);
      if (enableResearchLogging !== false) {
        await researchPut('researchLogs', {
          logId: generateId(),
          userId,
          timestamp: Date.now(),
          category: 'feedback',
          feedbackType: request.feedbackType,
          runId: request.runId || '',
          correctedText: request.correctedText?.slice(0, 500) || null
        });
      }
    }
    return { success: true };
  },

  'check-feedback-trends': async (_request, _sender) => {
    return checkFeedbackTrends();
  },

  'export-research-data': async (request, _sender) => {
    const userId = request.userId || null;
    const format = request.format || 'json';
    const storeName = request.storeName;

    if (storeName) {
      const records = userId
        ? await researchGetByIndex(storeName, 'userId', userId)
        : await researchGetAll(storeName);
      if (format === 'csv') {
        const csv = researchExportCSV(records);
        return { success: true, data: csv, format: 'csv', storeName };
      }
      return { success: true, data: records, format: 'json', storeName };
    }

    const storeNames = getResearchStoreNames();
    const entries = await Promise.all(
      storeNames.map(async name => [
        name,
        userId ? await researchGetByIndex(name, 'userId', userId) : await researchGetAll(name)
      ])
    );
    const allData = Object.fromEntries(entries);
    allData.exportedAt = new Date().toISOString();
    allData.userId = userId || 'all';
    return { success: true, data: allData, format: 'json' };
  },

  'clear-research-data': async (_request, _sender) => {
    const storeNames = getResearchStoreNames();
    await Promise.all(storeNames.map(name => researchClearStore(name)));
    return { success: true };
  },

  'get-research-settings': async (_request, _sender) => {
    return chrome.storage.local.get(['enableResearchLogging', 'studyUserId']);
  },

};
