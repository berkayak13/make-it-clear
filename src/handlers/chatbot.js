import { researchGet, researchPut, researchGetByIndex } from '../utils/firestore-client.js';
import { getOrCreateUserId } from '../utils/storage-helpers.js';
import { generateId } from '../utils/id.js';
import { callLLM } from '../utils/llm-dispatch.js';
import { getChatbotSystemPrompt, getPersonaExtractionPrompt, getGoalExtractionPrompt } from '../utils/cached-prompts.js';

async function getRecentPrefSummary(userId) {
  const prefHistory = await researchGetByIndex('userPreferences', 'userId', userId);
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
  const { enableResearchLogging } = await chrome.storage.local.get(['enableResearchLogging']);
  if (enableResearchLogging === false) return;
  await researchPut('researchLogs', { logId: generateId(), timestamp: Date.now(), ...data });
}

async function getSessionOrThrow(sessionId) {
  const session = await researchGet('chatSessions', sessionId);
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
        extractedProfile: null,
        appliedPersonaKey: null
      };
      await researchPut('chatSessions', session);
      await chrome.storage.local.set({ currentChatSessionId: session.sessionId });
      return { success: true, sessionId: session.sessionId };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  'chatbot-get-session': async (request, sender) => {
    try {
      const session = await researchGet('chatSessions', request.sessionId);
      return { success: !!session, session };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  'chatbot-send': async (request, sender) => {
    try {
      const session = await getSessionOrThrow(request.sessionId);
      session.messages.push({ role: 'user', content: request.message, timestamp: Date.now() });
      await researchPut('chatSessions', session);

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
      await researchPut('chatSessions', session);
      await logResearch({
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

  'chatbot-generate-persona': async (request, sender) => {
    try {
      const session = await getSessionOrThrow(request.sessionId);
      const extractionPrompt = await getPersonaExtractionPrompt();
      const transcript = buildTranscript(session.messages);
      const messages = [{ role: 'user', content: 'Conversation transcript:\n\n' + transcript }];
      const result = await callLLM(messages, extractionPrompt);
      if (!result.success) { return { success: false, error: result.error }; }

      const persona = parseJsonResponse(result.result, 'persona');
      session.extractedProfile = persona;
      await researchPut('chatSessions', session);
      return { success: true, persona };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  'chatbot-apply-persona': async (request, sender) => {
    try {
      const persona = request.persona;
      if (!persona || !persona.name) { return { success: false, error: 'Invalid persona' }; }
      const slug = persona.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
      const key = 'chatbot-' + slug + '-' + generateId().slice(0, 8);
      const personaObj = {
        name: persona.name,
        description: persona.description || '',
        systemAddendum: persona.systemAddendum || persona.description || '',
        interests: persona.interests,
        expertiseDomains: persona.expertiseDomains,
        expertiseLevel: persona.expertiseLevel,
        source: 'chatbot'
      };
      const { personas = {} } = await chrome.storage.sync.get(['personas']);
      personas[key] = personaObj;
      await chrome.storage.sync.set({ personas, currentPersona: key });

      if (request.sessionId) {
        const session = await researchGet('chatSessions', request.sessionId);
        if (session) {
          session.appliedPersonaKey = key;
          await researchPut('chatSessions', session);
        }
      }
      const userId = await getOrCreateUserId();
      await logResearch({
        userId,
        category: 'persona-change',
        personaKey: key,
        personaName: persona.name,
        source: 'chatbot'
      });
      return { success: true, personaKey: key };
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
      await researchPut('userPreferences', {
        userId,
        timestamp: Date.now(),
        sessionId: request.sessionId,
        preferences: goal
      });
      session.extractedGoal = goal;
      await researchPut('chatSessions', session);
      await logResearch({
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
