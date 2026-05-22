import { researchGet, researchPut, researchGetByIndex } from '../utils/firestore-client.js';
import { getOrCreateUserId } from '../utils/storage-helpers.js';
import { generateId } from '../utils/id.js';
import { callLLM } from '../utils/llm-dispatch.js';
import { getChatbotSystemPrompt, getGoalExtractionPrompt } from '../utils/prompt-loader.js';

const LOCAL_CHAT_SESSIONS_KEY = 'chatSessions';
const LOCAL_USER_PREFERENCES_KEY = 'userPreferences';

function cloneRecord(record) {
  return JSON.parse(JSON.stringify(record));
}

async function getLocalChatSessions() {
  const data = await chrome.storage.local.get([LOCAL_CHAT_SESSIONS_KEY]);
  const sessions = data[LOCAL_CHAT_SESSIONS_KEY];
  return sessions && typeof sessions === 'object' && !Array.isArray(sessions) ? sessions : {};
}

async function getLocalSession(sessionId) {
  if (!sessionId) return null;
  const sessions = await getLocalChatSessions();
  return sessions[sessionId] || null;
}

async function saveLocalSession(session, { makeCurrent = false } = {}) {
  const sessions = await getLocalChatSessions();
  sessions[session.sessionId] = session;
  const update = { [LOCAL_CHAT_SESSIONS_KEY]: sessions };
  if (makeCurrent) update.currentChatSessionId = session.sessionId;
  await chrome.storage.local.set(update);
  return session;
}

async function getResearchSession(sessionId) {
  try {
    return await researchGet('chatSessions', sessionId);
  } catch (e) {
    console.warn('[Chatbot] Firestore session lookup skipped:', e?.message || e);
    return null;
  }
}

async function saveSession(session, options) {
  await saveLocalSession(session, options);
  void bestEffortResearchPut('chatSessions', session);
}

async function bestEffortResearchPut(storeName, record) {
  try {
    await researchPut(storeName, cloneRecord(record));
  } catch (e) {
    console.warn(`[Chatbot] Firestore ${storeName} write skipped:`, e?.message || e);
  }
}

async function getLocalUserPreferences(userId) {
  const data = await chrome.storage.local.get([LOCAL_USER_PREFERENCES_KEY]);
  const prefs = Array.isArray(data[LOCAL_USER_PREFERENCES_KEY]) ? data[LOCAL_USER_PREFERENCES_KEY] : [];
  // Guard individual entries: a malformed (null/non-object) element from
  // corrupted storage would otherwise throw when reading `.userId`.
  return prefs.filter(pref => pref && typeof pref === 'object' && pref.userId === userId);
}

async function saveLocalUserPreference(record) {
  const data = await chrome.storage.local.get([LOCAL_USER_PREFERENCES_KEY]);
  const prefs = Array.isArray(data[LOCAL_USER_PREFERENCES_KEY]) ? data[LOCAL_USER_PREFERENCES_KEY] : [];
  const preference = { ...record, preferenceId: record.preferenceId || generateId() };
  await chrome.storage.local.set({ [LOCAL_USER_PREFERENCES_KEY]: [...prefs, preference] });
  return preference;
}

async function getRecentPrefSummary(userId) {
  let prefHistory = await getLocalUserPreferences(userId);
  if (!prefHistory.length) {
    try {
      prefHistory = await researchGetByIndex('userPreferences', 'userId', userId);
    } catch (e) {
      console.warn('[Chatbot] Firestore preference lookup skipped:', e?.message || e);
      prefHistory = [];
    }
  }
  const recentPrefs = prefHistory.sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);
  return recentPrefs.length
    ? recentPrefs.map(p => JSON.stringify(p.preferences)).join('\n')
    : 'No previous preferences recorded.';
}

function buildTranscript(messages) {
  return messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
}

function parseJsonResponse(raw, errorLabel) {
  const jsonStr = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    return JSON.parse(jsonStr);
  } catch {
    throw new Error(`Could not extract ${errorLabel}. The AI returned an unexpected format. Please try again.`);
  }
}

async function logResearch(data) {
  try {
    const { enableResearchLogging } = await chrome.storage.local.get(['enableResearchLogging']);
    if (enableResearchLogging === false) return;
    await bestEffortResearchPut('researchLogs', { logId: generateId(), timestamp: Date.now(), ...data });
  } catch (e) {
    console.warn('[Chatbot] Research logging skipped:', e?.message || e);
  }
}

async function getSessionOrThrow(sessionId) {
  let session = await getLocalSession(sessionId);
  if (!session) {
    session = await getResearchSession(sessionId);
    if (session) await saveLocalSession(session);
  }
  if (!session) throw new Error('Session not found');
  return session;
}

export const chatbotHandlers = {
  'chatbot-new-session': async (request, sender) => {
    try {
      const userId = await getOrCreateUserId();
      const session = {
        sessionId: generateId(),
        userId,
        timestamp: Date.now(),
        messages: [],
      };
      await saveSession(session, { makeCurrent: true });
      return { success: true, sessionId: session.sessionId };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  'chatbot-get-session': async (request, sender) => {
    try {
      let session = await getLocalSession(request.sessionId);
      if (!session) {
        session = await getResearchSession(request.sessionId);
        if (session) await saveLocalSession(session);
      }
      return { success: !!session, session };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  'chatbot-delete-session': async (request, sender) => {
    try {
      const sessions = await getLocalChatSessions();
      delete sessions[request.sessionId];
      const update = { [LOCAL_CHAT_SESSIONS_KEY]: sessions };
      const { currentChatSessionId } = await chrome.storage.local.get(['currentChatSessionId']);
      if (currentChatSessionId === request.sessionId) update.currentChatSessionId = null;
      await chrome.storage.local.set(update);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  'chatbot-send': async (request, sender) => {
    try {
      const session = await getSessionOrThrow(request.sessionId);
      session.messages = Array.isArray(session.messages) ? session.messages : [];
      session.messages.push({ role: 'user', content: request.message, timestamp: Date.now() });
      await saveSession(session);

      const userId = await getOrCreateUserId();
      const prefSummary = await getRecentPrefSummary(userId);
      const systemPromptTemplate = await getChatbotSystemPrompt();
      const systemPrompt = systemPromptTemplate.replace('{preferences}', prefSummary);
      const llmMessages = session.messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      }));
      const result = await callLLM(llmMessages, systemPrompt);
      if (!result.success) { return { success: false, error: result.error }; }

      session.messages.push({ role: 'model', content: result.result, timestamp: Date.now() });
      await saveSession(session);
      void logResearch({
        userId,
        category: 'chatbot',
        sessionId: request.sessionId,
        userMessage: request.message.slice(0, 500),
        modelReply: result.result.slice(0, 500)
      });
      return { success: true, reply: result.result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  'chatbot-set-reading-goal': async (request, sender) => {
    try {
      const session = await getSessionOrThrow(request.sessionId);
      const userId = await getOrCreateUserId();
      const prefSummary = await getRecentPrefSummary(userId);

      const extractionTemplate = await getGoalExtractionPrompt();
      const extractionPrompt = extractionTemplate.replace('{preferences}', prefSummary);
      const transcript = buildTranscript(session.messages);
      const messages = [{ role: 'user', content: 'Conversation transcript:\n\n' + transcript }];
      const result = await callLLM(messages, extractionPrompt);
      if (!result.success) { return { success: false, error: result.error }; }

      const goal = parseJsonResponse(result.result, 'reading goal');
      const preference = await saveLocalUserPreference({
        userId,
        timestamp: Date.now(),
        sessionId: request.sessionId,
        preferences: goal
      });
      await chrome.storage.sync.set({ readingGoal: goal });
      void bestEffortResearchPut('userPreferences', preference);
      session.extractedGoal = goal;
      await saveSession(session);
      void logResearch({
        userId,
        category: 'reading-goal',
        sessionId: request.sessionId,
        goal
      });
      return { success: true, goal };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
};
