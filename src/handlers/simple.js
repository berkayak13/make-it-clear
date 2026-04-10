import { getSettingsWithTaskMigration, getOrCreateUserId } from '../utils/storage-helpers.js';
import { generateId } from '../utils/id.js';
import { ensureOffscreen, postToOffscreen } from '../utils/offscreen-bridge.js';
import { getPipelineLogs, clearPipelineLogs } from '../utils/pipeline-logger.js';
import { researchPut, researchGetByIndex, researchGetAll, researchClearStore, researchExportCSV, RESEARCH_STORES } from '../utils/firestore-client.js';
import { renarrateText, agenticRenarrateText, checkFeedbackTrends, setUserId } from '../utils/renarration.js';
import { describeImage } from '../utils/vlm-client.js';

const PIPELINE_LOG_KEY = 'pipelineLogs';

const RESEARCH_STORES_KEYS = ['chatSessions', 'researchLogs', 'feedbackEvents', 'experimentRuns', 'preferenceHistory', 'userPreferences'];

function getResearchStoreNames() {
  if (RESEARCH_STORES && typeof RESEARCH_STORES === 'object') {
    return Object.keys(RESEARCH_STORES);
  }
  return RESEARCH_STORES_KEYS;
}

export const simpleHandlers = {
  'renarrate-text': async (request, _sender) => {
    const { useAgenticPipeline } = await chrome.storage.local.get(['useAgenticPipeline']);
    const renarrateFunc = useAgenticPipeline ? agenticRenarrateText : renarrateText;
    const result = await renarrateFunc(request.text, request.task);
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

  'describe-image': async (request, _sender) => {
    return describeImage(request.imageUrl, request.task);
  },

  'get-settings': async (_request, _sender) => {
    return getSettingsWithTaskMigration([
      'enabled',
      'llmProvider',
      'useWebLLM',
      'webllmModel',
      'useRemoteVLM',
      'remoteVLMModel',
      'remoteVLMEndpoint',
      'personas',
      'currentPersona',
      'currentTask',
      'tasks',
      'systemPromptTemplate'
    ]);
  },

  'webllm-init': async (_request, _sender) => {
    await ensureOffscreen();
    const { webllmModel } = await chrome.storage.sync.get(['webllmModel']);
    return postToOffscreen({ type: 'webllm-init', payload: { modelId: webllmModel } });
  },

  'get-logs': async (_request, _sender) => {
    const data = await chrome.storage.local.get(['testLogs']);
    return { success: true, logs: data.testLogs || [] };
  },

  'clear-logs': async (_request, _sender) => {
    await chrome.storage.local.set({ testLogs: [], completedTestIds: [] });
    return { success: true };
  },

  'get-pipeline-logs': async (_request, _sender) => {
    return getPipelineLogs();
  },

  'clear-pipeline-logs': async (_request, _sender) => {
    return clearPipelineLogs();
  },

  'delete-pipeline-entry': async (request, _sender) => {
    const { pipelineLogs = [] } = await chrome.storage.local.get([PIPELINE_LOG_KEY]);
    const filtered = pipelineLogs.filter(l => !(l.runId === request.runId && l.stage === request.stage));
    await chrome.storage.local.set({ [PIPELINE_LOG_KEY]: filtered });
    return { success: true };
  },

  'toggle-pipeline-star': async (request, _sender) => {
    const { pipelineLogs = [] } = await chrome.storage.local.get([PIPELINE_LOG_KEY]);
    const next = pipelineLogs.map(l => {
      if (l.runId === request.runId && l.stage === request.stage) {
        return { ...l, starred: !l.starred };
      }
      return l;
    });
    await chrome.storage.local.set({ [PIPELINE_LOG_KEY]: next });
    return { success: true };
  },

  'get-user-id': async (_request, _sender) => {
    const userId = await getOrCreateUserId();
    return { success: true, userId };
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
    return chrome.storage.local.get(['useAgenticPipeline', 'enableResearchLogging', 'studyUserId']);
  },

};
