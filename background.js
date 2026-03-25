// Background service worker for the extension
// Handles message passing and model management (WebLLM via offscreen document)

// =========================================
// Constants
// =========================================
const CAPTURE_MAX_RETRIES = 6;
const CAPTURE_BASE_DELAY_MS = 900;
const CAPTURE_MAX_SLICES = 50;
const CAPTURE_SETTLE_DELAY_MS = 350;
const CAPTURE_SLICE_OVERLAP_PX = 200;
const OFFSCREEN_DEFAULT_TIMEOUT_MS = 120000;
const GEMINI_TIMEOUT_MS = 60000;
const VLM_TIMEOUT_MS = 120000;
const PIPELINE_LOG_MAX_ENTRIES = 100;
const PIPELINE_LOG_MAX_SIZE_BYTES = 2 * 1024 * 1024;
const AGENTIC_MAX_ATTEMPTS = 3;
const AGENTIC_SCORE_THRESHOLD = 3.5;

// Default user tasks
const DEFAULT_TASKS = {
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

// Add default personas
const DEFAULT_PERSONAS = {
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

async function getSettingsWithTaskMigration(extraKeys = []) {
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

// Track pending requests routed through the offscreen document
const pendingOffscreenResponses = new Map();
const PIPELINE_LOG_KEY = 'pipelineLogs';

// Initialize default settings
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
    remoteVLMEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    personas: DEFAULT_PERSONAS,
    currentPersona: 'general'
  });
  chrome.storage.local.set({ remoteVLMApiKey: '' });
});

// =========================================
// Research DB (Firestore REST API) — inline for service worker
// =========================================
const FIRESTORE_DEFAULT_PROJECT_ID = 'renarration-research';
const FIRESTORE_DEFAULT_API_KEY = 'AIzaSyB7WIlE0klfLmUKvO7JWF69Q2ioh2z_MBU';

const RESEARCH_STORES = {
  chatSessions: { keyPath: 'sessionId' },
  researchLogs: { keyPath: 'logId' },
  feedbackEvents: { keyPath: 'feedbackId' },
  experimentRuns: { keyPath: 'experimentId' },
  preferenceHistory: { keyPath: 'id', autoGenerate: true },
  userPreferences: { keyPath: 'preferenceId', autoGenerate: true }
};

let _firestoreConfig = null;

async function getFirestoreConfig() {
  if (_firestoreConfig) return _firestoreConfig;
  const stored = await chrome.storage.local.get(['firebaseProjectId', 'firebaseApiKey']);
  _firestoreConfig = {
    projectId: stored.firebaseProjectId || FIRESTORE_DEFAULT_PROJECT_ID,
    apiKey: stored.firebaseApiKey || FIRESTORE_DEFAULT_API_KEY
  };
  return _firestoreConfig;
}

// Listen for config changes to invalidate cache
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.firebaseProjectId || changes.firebaseApiKey)) {
    _firestoreConfig = null;
  }
});

function firestoreBasePath(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

// Value encoding: JS → Firestore
function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

// Value decoding: Firestore → JS
function fromFirestoreValue(val) {
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return val.doubleValue;
  if ('stringValue' in val) return val.stringValue;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map(fromFirestoreValue);
  }
  if ('mapValue' in val) {
    return fromFirestoreFields(val.mapValue.fields || {});
  }
  return null;
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = toFirestoreValue(v);
  }
  return fields;
}

function fromFirestoreFields(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields)) {
    obj[k] = fromFirestoreValue(v);
  }
  return obj;
}

function researchGenerateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

async function researchPut(storeName, record) {
  const config = await getFirestoreConfig();
  const base = firestoreBasePath(config.projectId);
  const storeConfig = RESEARCH_STORES[storeName];
  if (!storeConfig) throw new Error('Unknown store: ' + storeName);

  // Determine document ID
  let docId = record[storeConfig.keyPath];
  if (!docId && storeConfig.autoGenerate) {
    docId = researchGenerateId();
    record[storeConfig.keyPath] = docId;
  }
  if (!docId) throw new Error('Missing document ID for store: ' + storeName);

  const url = `${base}/${storeName}/${docId}?key=${config.apiKey}`;
  const body = { fields: toFirestoreFields(record) };

  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const err = await resp.text();
    console.error('Firestore PUT error:', resp.status, err);
    throw new Error(`Firestore PUT failed (${resp.status}): ${err}`);
  }
  return record;
}

async function researchGet(storeName, key) {
  const config = await getFirestoreConfig();
  const base = firestoreBasePath(config.projectId);
  const url = `${base}/${storeName}/${key}?key=${config.apiKey}`;

  const resp = await fetch(url);
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const err = await resp.text();
    console.error('Firestore GET error:', resp.status, err);
    throw new Error(`Firestore GET failed (${resp.status}): ${err}`);
  }
  const doc = await resp.json();
  return doc.fields ? fromFirestoreFields(doc.fields) : null;
}

async function researchGetAll(storeName) {
  const config = await getFirestoreConfig();
  const base = firestoreBasePath(config.projectId);
  const results = [];
  let pageToken = '';

  do {
    let url = `${base}/${storeName}?key=${config.apiKey}&pageSize=300`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const resp = await fetch(url);
    if (!resp.ok) {
      const err = await resp.text();
      console.error('Firestore LIST error:', resp.status, err);
      throw new Error(`Firestore LIST failed (${resp.status}): ${err}`);
    }
    const data = await resp.json();
    if (data.documents) {
      for (const doc of data.documents) {
        if (doc.fields) results.push(fromFirestoreFields(doc.fields));
      }
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return results;
}

async function researchGetByIndex(storeName, indexName, value) {
  const config = await getFirestoreConfig();
  const base = firestoreBasePath(config.projectId);
  const url = `${base}:runQuery?key=${config.apiKey}`;

  const body = {
    structuredQuery: {
      from: [{ collectionId: storeName }],
      where: {
        fieldFilter: {
          field: { fieldPath: indexName },
          op: 'EQUAL',
          value: toFirestoreValue(value)
        }
      }
    }
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const err = await resp.text();
    console.error('Firestore QUERY error:', resp.status, err);
    throw new Error(`Firestore QUERY failed (${resp.status}): ${err}`);
  }
  const results = await resp.json();
  return (results || [])
    .filter(r => r.document && r.document.fields)
    .map(r => fromFirestoreFields(r.document.fields));
}

async function researchClearStore(storeName) {
  const config = await getFirestoreConfig();
  const base = firestoreBasePath(config.projectId);

  // List all documents then batch delete
  let pageToken = '';
  do {
    let url = `${base}/${storeName}?key=${config.apiKey}&pageSize=300`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const resp = await fetch(url);
    if (!resp.ok) break;
    const data = await resp.json();
    if (!data.documents || data.documents.length === 0) break;

    // Batch delete (max 500 per batch)
    const writes = data.documents.map(doc => ({ delete: doc.name }));
    const batchUrl = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents:batchWrite?key=${config.apiKey}`;
    await fetch(batchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes })
    });

    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return true;
}

function researchExportCSV(records) {
  if (!records || !records.length) return '';
  const allKeys = new Set();
  records.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
  const keys = [...allKeys];
  const escape = (v) => {
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = keys.map(escape).join(',');
  const rows = records.map(r => keys.map(k => escape(r[k])).join(','));
  return [header, ...rows].join('\n');
}

// =========================================
// Session / User ID management
// =========================================
async function getOrCreateUserId() {
  const { studyUserId } = await chrome.storage.local.get(['studyUserId']);
  if (studyUserId) return studyUserId;
  const newId = 'P' + String(Date.now()).slice(-4);
  await chrome.storage.local.set({ studyUserId: newId });
  return newId;
}

async function setUserId(newId) {
  const oldId = await getOrCreateUserId();
  await chrome.storage.local.set({ studyUserId: newId });
  try {
    await researchPut('preferenceHistory', {
      timestamp: Date.now(),
      userId: newId,
      field: 'userId',
      oldValue: oldId,
      newValue: newId
    });
  } catch (e) {
    console.warn('Failed to log userId change:', e);
  }
  return newId;
}

// =========================================
// Preference tracking — log changes to Firestore
// =========================================
const TRACKED_PREF_KEYS = ['currentTask', 'currentPersona', 'webllmModel', 'systemPromptTemplate', 'readingGoal'];

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync') return;
  const { enableResearchLogging } = await chrome.storage.local.get(['enableResearchLogging']);
  if (enableResearchLogging === false) return;
  const userId = await getOrCreateUserId();
  for (const key of TRACKED_PREF_KEYS) {
    if (changes[key]) {
      try {
        await researchPut('preferenceHistory', {
          timestamp: Date.now(),
          userId,
          field: key,
          oldValue: changes[key].oldValue,
          newValue: changes[key].newValue
        });
      } catch (e) {
        console.warn('Preference tracking error:', e);
      }
    }
  }
});

// =========================================
// Cached prompt loaders for chatbot & evaluation
// =========================================
let cachedChatbotSystemPrompt = null;
let cachedPersonaExtractionPrompt = null;
let cachedEvaluationPrompt = null;
let cachedGoalExtractionPrompt = null;

async function getChatbotSystemPrompt() {
  if (cachedChatbotSystemPrompt) return cachedChatbotSystemPrompt;
  try {
    const res = await fetch(chrome.runtime.getURL('src/prompts/chatbot-system.md'));
    if (!res.ok) throw new Error('Failed to load chatbot system prompt');
    cachedChatbotSystemPrompt = (await res.text()).trim();
    return cachedChatbotSystemPrompt;
  } catch (e) {
    console.warn('Chatbot system prompt fetch failed:', e?.message);
    return 'You are a friendly assistant helping users discover their personalized reading profile. Ask one question at a time about their background, interests, and preferences.';
  }
}

async function getPersonaExtractionPrompt() {
  if (cachedPersonaExtractionPrompt) return cachedPersonaExtractionPrompt;
  try {
    const res = await fetch(chrome.runtime.getURL('src/prompts/persona-extraction.md'));
    if (!res.ok) throw new Error('Failed to load persona extraction prompt');
    cachedPersonaExtractionPrompt = (await res.text()).trim();
    return cachedPersonaExtractionPrompt;
  } catch (e) {
    console.warn('Persona extraction prompt fetch failed:', e?.message);
    return 'Extract a persona JSON from this conversation. Return only JSON with fields: name, description, systemAddendum, interests, expertiseDomains, expertiseLevel.';
  }
}

async function getEvaluationPrompt() {
  if (cachedEvaluationPrompt) return cachedEvaluationPrompt;
  try {
    const res = await fetch(chrome.runtime.getURL('src/prompts/evaluation.md'));
    if (!res.ok) throw new Error('Failed to load evaluation prompt');
    cachedEvaluationPrompt = (await res.text()).trim();
    return cachedEvaluationPrompt;
  } catch (e) {
    console.warn('Evaluation prompt fetch failed:', e?.message);
    return 'Evaluate this renarration on appropriateness, faithfulness, clarity, tone (1-5 each). Return JSON with scores and improvementSuggestion.';
  }
}

async function getGoalExtractionPrompt() {
  if (cachedGoalExtractionPrompt) return cachedGoalExtractionPrompt;
  try {
    const res = await fetch(chrome.runtime.getURL('src/prompts/goal-extraction.md'));
    if (!res.ok) throw new Error('Failed to load goal extraction prompt');
    cachedGoalExtractionPrompt = (await res.text()).trim();
    return cachedGoalExtractionPrompt;
  } catch (e) {
    console.warn('Goal extraction prompt fetch failed:', e?.message);
    return 'Extract a reading goal JSON from this conversation. Return only JSON with fields: readingGoal, desiredDepth, focusAreas, outputStyle, additionalInstructions.';
  }
}

// =========================================
// LLM Provider routing
// =========================================
async function getEffectiveLLMProvider() {
  const { llmProvider, useWebLLM } = await chrome.storage.sync.get(['llmProvider', 'useWebLLM']);
  if (llmProvider) return llmProvider;
  // Backward compat: fall back to useWebLLM boolean
  return useWebLLM ? 'on-device' : 'remote';
}

// =========================================
// Gemini Chat API (multi-turn)
// =========================================
async function callGeminiChat(conversationContents, systemInstruction) {
  const settings = await chrome.storage.sync.get(['remoteVLMModel', 'remoteVLMEndpoint']);
  const { remoteVLMApiKey } = await chrome.storage.local.get(['remoteVLMApiKey']);
  const model = settings.remoteVLMModel || 'gemini-2.5-flash';
  const endpoint = settings.remoteVLMEndpoint || 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent';
  if (!remoteVLMApiKey) return { success: false, error: 'API key not configured. Set it in Advanced Settings.' };

  const url = endpoint.replace('{model}', model).includes('key=')
    ? endpoint.replace('{model}', model)
    : `${endpoint.replace('{model}', model)}${endpoint.includes('?') ? '&' : '?'}key=${encodeURIComponent(remoteVLMApiKey)}`;

  const body = {
    contents: conversationContents,
    generationConfig: { temperature: 0.7 }
  };
  if (systemInstruction) {
    body.system_instruction = { parts: [{ text: systemInstruction }] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { success: false, error: `Gemini API error: ${res.status} ${errText}` };
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n').trim();
    if (!text) return { success: false, error: 'No content returned from Gemini' };
    return { success: true, result: text };
  } catch (err) {
    clearTimeout(timer);
    return { success: false, error: err?.message || String(err) };
  }
}

// =========================================
// Unified LLM dispatch helpers
// =========================================

/**
 * Convert OpenAI-format messages to Gemini format and call callGeminiChat.
 * Filters out system messages (handled via systemInstruction param).
 */
async function callGeminiChatFromMessages(messages, systemPrompt) {
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
  return callGeminiChat(contents, systemPrompt);
}

/**
 * Send messages to WebLLM via offscreen document.
 * Prepends system prompt as a system message.
 */
async function callWebLLMChat(messages, systemPrompt, options = {}) {
  const llmMessages = [];
  if (systemPrompt) {
    llmMessages.push({ role: 'system', content: systemPrompt });
  }
  llmMessages.push(...messages);

  try {
    await ensureOffscreen();
    const { webllmModel } = await chrome.storage.sync.get(['webllmModel']);
    const response = await postToOffscreen({
      type: 'webllm-chat',
      payload: {
        messages: llmMessages,
        modelId: options.modelId || webllmModel,
        temperature: options.temperature
      }
    }, { timeoutMs: options.timeoutMs || 120000 });
    return response;
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

/**
 * Unified LLM dispatch: routes to remote (Gemini) or on-device (WebLLM)
 * based on global llmProvider setting.
 * @param {Array} messages - OpenAI-format [{role, content}]
 * @param {string} systemPrompt - System instruction text
 * @param {object} options - { forceProvider, temperature, modelId, timeoutMs }
 */
async function callLLM(messages, systemPrompt, options = {}) {
  const provider = options.forceProvider || await getEffectiveLLMProvider();
  if (provider === 'on-device') {
    return callWebLLMChat(messages, systemPrompt, options);
  }
  return callGeminiChatFromMessages(messages, systemPrompt);
}

// =========================================
// Agentic pipeline functions
// =========================================
async function evaluateRenarration(originalText, renarrationOutput, taskInfo, personaInfo, readingGoalText) {
  if (!originalText || !renarrationOutput) {
    return { success: false, error: 'Missing original text or renarration output for evaluation' };
  }
  const evalPrompt = await getEvaluationPrompt();
  const userContent = [
    'Original text:', String(originalText).slice(0, 3000),
    '\nRenarrated output:', String(renarrationOutput).slice(0, 3000),
    '\nTask:', taskInfo || 'N/A',
    '\nPersona:', personaInfo || 'N/A',
    '\nReading Goal:', readingGoalText || 'N/A'
  ].join('\n');

  const messages = [{ role: 'user', content: userContent }];
  const result = await callLLM(messages, evalPrompt);
  if (!result.success) return { success: false, error: result.error };

  try {
    const jsonStr = result.result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const scores = JSON.parse(jsonStr);
    const appropriateness = Number(scores.appropriateness) || 0;
    const faithfulness = Number(scores.faithfulness) || 0;
    const clarity = Number(scores.clarity) || 0;
    const tone = Number(scores.tone) || 0;
    scores.averageScore = scores.averageScore ?? ((appropriateness + faithfulness + clarity + tone) / 4);
    return { success: true, scores };
  } catch (e) {
    return { success: false, error: 'Failed to parse evaluation JSON: ' + e.message, raw: result.result };
  }
}

async function agenticRenarrateText(text, taskName, overrideTask, options = {}) {
  const userId = await getOrCreateUserId();
  const experimentId = researchGenerateId();
  const attempts = [];
  const maxAttempts = AGENTIC_MAX_ATTEMPTS;
  const threshold = AGENTIC_SCORE_THRESHOLD;
  let bestResult = null;
  let bestScore = 0;
  let promptAugmentation = '';

  const settings = await getSettingsWithTaskMigration(['personas', 'currentPersona']);
  const tasks = settings.tasks || DEFAULT_TASKS;
  const task = overrideTask || tasks[taskName || settings.currentTask] || tasks.simple || DEFAULT_TASKS.simple;
  const persona = settings.personas?.[settings.currentPersona];
  const taskInfo = task?.textPrompt || '';
  const personaInfo = persona?.systemAddendum || persona?.description || '';
  const { readingGoal } = await chrome.storage.sync.get(['readingGoal']);

  for (let i = 0; i < maxAttempts; i++) {
    const attemptOpts = { ...options };
    if (promptAugmentation) attemptOpts.promptAugmentation = promptAugmentation;

    const result = await renarrateText(text, taskName, overrideTask, attemptOpts);
    if (!result?.success) {
      attempts.push({ attempt: i + 1, success: false, error: result?.error });
      continue;
    }

    const evalResult = await evaluateRenarration(text, result.result, taskInfo, personaInfo, readingGoal || '');
    const score = evalResult?.success ? evalResult.scores.averageScore : 0;
    const attemptData = {
      attempt: i + 1,
      success: true,
      output: result.result,
      scores: evalResult?.success ? evalResult.scores : null,
      averageScore: score
    };
    attempts.push(attemptData);

    if (score > bestScore) {
      bestScore = score;
      bestResult = result;
    }

    if (score >= threshold || i === maxAttempts - 1) break;

    // Use improvement suggestion for next attempt
    const suggestion = evalResult?.scores?.improvementSuggestion;
    if (suggestion && suggestion !== 'None') {
      promptAugmentation = 'Improvement instruction from evaluator: ' + suggestion;
    }
  }

  const agenticMeta = {
    experimentId,
    attemptCount: attempts.length,
    bestScore,
    attempts
  };

  // Log to experimentRuns
  try {
    const { enableResearchLogging } = await chrome.storage.local.get(['enableResearchLogging']);
    if (enableResearchLogging !== false) {
      await researchPut('experimentRuns', {
        experimentId,
        userId,
        timestamp: Date.now(),
        taskName: task?.name || taskName,
        personaName: persona?.name || settings.currentPersona,
        inputTextSample: text.slice(0, 500),
        attempts,
        bestScore,
        bestOutput: bestResult?.result?.slice(0, 2000) || ''
      });
      await researchPut('researchLogs', {
        logId: researchGenerateId(),
        userId,
        timestamp: Date.now(),
        category: 'renarration',
        subcategory: 'agentic-run',
        experimentId,
        attemptCount: attempts.length,
        bestScore,
        taskName: task?.name || taskName,
        personaName: persona?.name || settings.currentPersona
      });
    }
  } catch (e) {
    console.warn('Failed to log agentic experiment:', e);
  }

  if (bestResult) {
    return { ...bestResult, agenticMeta };
  }
  return { success: false, error: 'All agentic attempts failed', agenticMeta };
}

// =========================================
// Feedback trend checking
// =========================================
async function checkFeedbackTrends() {
  try {
    const userId = await getOrCreateUserId();
    const allFeedback = await researchGetByIndex('feedbackEvents', 'userId', userId);
    const recent = allFeedback
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);
    const negativeCount = recent.filter(f => f.feedbackType === 'thumbs-down').length;
    return { shouldRefine: negativeCount >= 3, negativeCount, recentCount: recent.length };
  } catch (e) {
    return { shouldRefine: false };
  }
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.__offscreenResponse) {
    const pending = pendingOffscreenResponses.get(request.requestId);
    if (pending) {
      clearTimeout(pending.timeoutId);
      pendingOffscreenResponses.delete(request.requestId);
      pending.resolve(request.payload);
    }
    return;
  }

  if (request.action === 'renarrate-text') {
    (async () => {
      try {
        const { useAgenticPipeline } = await chrome.storage.local.get(['useAgenticPipeline']);
        const renarrateFunc = useAgenticPipeline ? agenticRenarrateText : renarrateText;
        const result = await renarrateFunc(request.text, request.task);
        // Persist for side panel display
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
            console.warn('[renarrate-text] Failed to persist for side panel:', e.message);
          }
        }
        sendResponse(result);
      } catch (e) {
        console.error('[renarrate-text] Unhandled error:', e);
        sendResponse({ success: false, error: e?.message || 'Internal error' });
      }
    })();
    return true; // Keep message channel open for async response
  } else if (request.action === 'describe-image') {
    describeImage(request.imageUrl, request.task).then(sendResponse);
    return true;
  } else if (request.action === 'get-settings') {
    getSettingsWithTaskMigration([
      'enabled',
      'llmProvider',
      'useWebLLM',
      'webllmModel',
      'useWebVLM',
      'webvlmModel',
      'useRemoteVLM',
      'remoteVLMModel',
      'remoteVLMEndpoint',
      'personas',
      'currentPersona'
    ]).then(sendResponse);
    return true;
  } else if (request.action === 'webllm-init') {
    // Allow UI to explicitly initialize engine
    ensureOffscreen()
      .then(async () => {
        const { webllmModel } = await chrome.storage.sync.get(['webllmModel']);
        return postToOffscreen({ type: 'webllm-init', payload: { modelId: webllmModel } });
      })
      .then(sendResponse);
    return true;
  } else if (request.action === 'run-test-cases') {
    runTestCases().then(sendResponse);
    return true;
  } else if (request.action === 'get-logs') {
    chrome.storage.local.get(['testLogs']).then(data => sendResponse({ success: true, logs: data.testLogs || [] }));
    return true;
  } else if (request.action === 'evaluate-log-entry') {
    evaluateLog(request.testId, request.evaluation).then(sendResponse);
    return true;
  } else if (request.action === 'export-logs') {
    exportLogs().then(sendResponse);
    return true;
  } else if (request.action === 'clear-logs') {
    chrome.storage.local.set({ testLogs: [], completedTestIds: [] }).then(() => sendResponse({ success: true }));
    return true;
  } else if (request.action === 'capture-fullpage') {
    // Trigger full-page screenshot capture and open viewer
    captureFullPageScreenshots(sender?.tab?.id).then(sendResponse);
    return true;
  } else if (request.action === 'describe-page-screenshot') {
    describePageScreenshot(sender?.tab?.id).then(sendResponse);
    return true;
  } else if (request.action === 'renarrate-page') {
    renarratePage(sender?.tab?.id ?? request.tabId).then(sendResponse);
    return true;
  } else if (request.action === 'renarrate-page-dom') {
    renarratePageDom(sender?.tab?.id ?? request.tabId).then(sendResponse);
    return true;
  } else if (request.action === 'get-pipeline-logs') {
    getPipelineLogs().then(sendResponse);
    return true;
  } else if (request.action === 'clear-pipeline-logs') {
    clearPipelineLogs().then(sendResponse);
    return true;
  } else if (request.action === 'delete-pipeline-entry') {
    deletePipelineEntry(request.runId, request.stage).then(sendResponse);
    return true;
  } else if (request.action === 'toggle-pipeline-star') {
    togglePipelineStar(request.runId, request.stage).then(sendResponse);
    return true;
  }

  // ---- Chatbot handlers ----
  else if (request.action === 'chatbot-new-session') {
    (async () => {
      try {
        const userId = await getOrCreateUserId();
        const session = {
          sessionId: researchGenerateId(),
          userId,
          timestamp: Date.now(),
          messages: [],
          extractedProfile: null,
          appliedPersonaKey: null
        };
        await researchPut('chatSessions', session);
        await chrome.storage.local.set({ currentChatSessionId: session.sessionId });
        sendResponse({ success: true, sessionId: session.sessionId });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  } else if (request.action === 'chatbot-get-session') {
    (async () => {
      try {
        const session = await researchGet('chatSessions', request.sessionId);
        sendResponse({ success: !!session, session });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  } else if (request.action === 'chatbot-send') {
    (async () => {
      try {
        const session = await researchGet('chatSessions', request.sessionId);
        if (!session) { sendResponse({ success: false, error: 'Session not found' }); return; }
        // Append user message
        session.messages.push({ role: 'user', content: request.message, timestamp: Date.now() });
        await researchPut('chatSessions', session);
        // Load accumulated preferences and inject into system prompt
        const userId = await getOrCreateUserId();
        const prefHistory = await researchGetByIndex('userPreferences', 'userId', userId);
        const recentPrefs = prefHistory.sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);
        const prefSummary = recentPrefs.length
          ? recentPrefs.map(p => JSON.stringify(p.preferences)).join('\n')
          : 'No previous preferences recorded.';
        const systemPromptTemplate = await getChatbotSystemPrompt();
        const systemPrompt = systemPromptTemplate.replace('{preferences}', prefSummary);
        const llmMessages = session.messages.map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content
        }));
        const result = await callLLM(llmMessages, systemPrompt);
        if (result.success) {
          session.messages.push({ role: 'model', content: result.result, timestamp: Date.now() });
          await researchPut('chatSessions', session);
          // Log to researchLogs
          const { enableResearchLogging } = await chrome.storage.local.get(['enableResearchLogging']);
          if (enableResearchLogging !== false) {
            await researchPut('researchLogs', {
              logId: researchGenerateId(),
              userId,
              timestamp: Date.now(),
              category: 'chatbot',
              sessionId: request.sessionId,
              userMessage: request.message.slice(0, 500),
              modelReply: result.result.slice(0, 500)
            });
          }
          sendResponse({ success: true, reply: result.result });
        } else {
          sendResponse({ success: false, error: result.error });
        }
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  } else if (request.action === 'chatbot-generate-persona') {
    (async () => {
      try {
        const session = await researchGet('chatSessions', request.sessionId);
        if (!session) { sendResponse({ success: false, error: 'Session not found' }); return; }
        const extractionPrompt = await getPersonaExtractionPrompt();
        const transcript = session.messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
        const messages = [{ role: 'user', content: 'Conversation transcript:\n\n' + transcript }];
        const result = await callLLM(messages, extractionPrompt);
        if (!result.success) { sendResponse({ success: false, error: result.error }); return; }
        const jsonStr = result.result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        let persona;
        try {
          persona = JSON.parse(jsonStr);
        } catch (parseErr) {
          sendResponse({ success: false, error: 'Could not extract persona. The AI returned an unexpected format. Please try again.' });
          return;
        }
        session.extractedProfile = persona;
        await researchPut('chatSessions', session);
        sendResponse({ success: true, persona });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  } else if (request.action === 'chatbot-apply-persona') {
    (async () => {
      try {
        const persona = request.persona;
        if (!persona || !persona.name) { sendResponse({ success: false, error: 'Invalid persona' }); return; }
        const slug = persona.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
        const key = 'chatbot-' + slug + '-' + researchGenerateId().slice(0, 8);
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
        // Update session
        if (request.sessionId) {
          const session = await researchGet('chatSessions', request.sessionId);
          if (session) {
            session.appliedPersonaKey = key;
            await researchPut('chatSessions', session);
          }
        }
        // Log
        const { enableResearchLogging } = await chrome.storage.local.get(['enableResearchLogging']);
        if (enableResearchLogging !== false) {
          const userId = await getOrCreateUserId();
          await researchPut('researchLogs', {
            logId: researchGenerateId(),
            userId,
            timestamp: Date.now(),
            category: 'persona-change',
            personaKey: key,
            personaName: persona.name,
            source: 'chatbot'
          });
        }
        sendResponse({ success: true, personaKey: key });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  } else if (request.action === 'chatbot-set-reading-goal') {
    (async () => {
      try {
        const session = await researchGet('chatSessions', request.sessionId);
        if (!session) { sendResponse({ success: false, error: 'Session not found' }); return; }
        // Load accumulated preferences
        const userId = await getOrCreateUserId();
        const prefHistory = await researchGetByIndex('userPreferences', 'userId', userId);
        const recentPrefs = prefHistory.sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);
        const prefSummary = recentPrefs.length
          ? recentPrefs.map(p => JSON.stringify(p.preferences)).join('\n')
          : 'No previous preferences recorded.';
        // Load goal extraction prompt and inject preferences
        const extractionTemplate = await getGoalExtractionPrompt();
        const extractionPrompt = extractionTemplate.replace('{preferences}', prefSummary);
        // Build transcript
        const transcript = session.messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
        const messages = [{ role: 'user', content: 'Conversation transcript:\n\n' + transcript }];
        const result = await callLLM(messages, extractionPrompt);
        if (!result.success) { sendResponse({ success: false, error: result.error }); return; }
        const jsonStr = result.result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        let goal;
        try {
          goal = JSON.parse(jsonStr);
        } catch (parseErr) {
          sendResponse({ success: false, error: 'Could not extract reading goal. The AI returned an unexpected format. Please try again.' });
          return;
        }
        // Store full goal as preference for accumulation
        await researchPut('userPreferences', {
          userId,
          timestamp: Date.now(),
          sessionId: request.sessionId,
          preferences: goal
        });
        // Update session
        session.extractedGoal = goal;
        await researchPut('chatSessions', session);
        // Log
        const { enableResearchLogging } = await chrome.storage.local.get(['enableResearchLogging']);
        if (enableResearchLogging !== false) {
          await researchPut('researchLogs', {
            logId: researchGenerateId(),
            userId,
            timestamp: Date.now(),
            category: 'reading-goal',
            sessionId: request.sessionId,
            goal
          });
        }
        sendResponse({ success: true, goal });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  // ---- User ID handlers ----
  else if (request.action === 'get-user-id') {
    getOrCreateUserId().then(userId => sendResponse({ success: true, userId }));
    return true;
  } else if (request.action === 'set-user-id') {
    setUserId(request.userId).then(userId => sendResponse({ success: true, userId }));
    return true;
  }

  // ---- Feedback handler ----
  else if (request.action === 'submit-feedback') {
    (async () => {
      try {
        const userId = await getOrCreateUserId();
        const feedback = {
          feedbackId: researchGenerateId(),
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
        // Log negative feedback
        if (request.feedbackType === 'thumbs-down') {
          const { enableResearchLogging } = await chrome.storage.local.get(['enableResearchLogging']);
          if (enableResearchLogging !== false) {
            await researchPut('researchLogs', {
              logId: researchGenerateId(),
              userId,
              timestamp: Date.now(),
              category: 'feedback',
              feedbackType: request.feedbackType,
              runId: request.runId || '',
              correctedText: request.correctedText?.slice(0, 500) || null
            });
          }
        }
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  // ---- Feedback trends ----
  else if (request.action === 'check-feedback-trends') {
    checkFeedbackTrends().then(sendResponse);
    return true;
  }

  // ---- Research data export ----
  else if (request.action === 'export-research-data') {
    (async () => {
      try {
        const userId = request.userId || null;
        const format = request.format || 'json';
        const storeName = request.storeName;

        if (storeName) {
          const records = userId ? await researchGetByIndex(storeName, 'userId', userId) : await researchGetAll(storeName);
          if (format === 'csv') {
            const csv = researchExportCSV(records);
            sendResponse({ success: true, data: csv, format: 'csv', storeName });
          } else {
            sendResponse({ success: true, data: records, format: 'json', storeName });
          }
        } else {
          // Export all stores
          const allData = {};
          for (const name of Object.keys(RESEARCH_STORES)) {
            allData[name] = userId ? await researchGetByIndex(name, 'userId', userId) : await researchGetAll(name);
          }
          allData.exportedAt = new Date().toISOString();
          allData.userId = userId || 'all';
          sendResponse({ success: true, data: allData, format: 'json' });
        }
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  // ---- Clear research data ----
  else if (request.action === 'clear-research-data') {
    (async () => {
      try {
        for (const name of Object.keys(RESEARCH_STORES)) {
          await researchClearStore(name);
        }
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  // ---- Agentic toggle check ----
  else if (request.action === 'get-research-settings') {
    chrome.storage.local.get(['useAgenticPipeline', 'enableResearchLogging', 'studyUserId']).then(sendResponse);
    return true;
  }
});

// Simulate text renarration with local LLM
// In a production version, this would use Web LLM or similar on-device model
async function renarrateText(text, taskName, overrideTask, options = {}) {
  const settings = await getSettingsWithTaskMigration([
    'webllmModel',
    'personas',
    'currentPersona',
    'systemPromptTemplate'
  ]);
  const tasks = settings.tasks || DEFAULT_TASKS;
  const baseTask = tasks[taskName || settings.currentTask] || tasks.simple || DEFAULT_TASKS.simple;
  const task = overrideTask || baseTask;
  const effectiveModelId = options?.modelId || settings.webllmModel;

  // Determine persona to apply (test case override > explicit text > global selection)
  let persona = null;
  if (options?.personaKey && settings.personas?.[options.personaKey]) {
    persona = settings.personas[options.personaKey];
  } else if (typeof options?.personaText === 'string' && options.personaText.trim()) {
    const addendum = options.personaText.trim();
    persona = {
      name: options.personaKey || 'Custom Persona',
      description: options.personaText.trim(),
      systemAddendum: addendum
    };
  } else {
    persona = settings.personas?.[settings.currentPersona];
  }

  const basePrompt = task?.textPrompt || '';
  const personaText = persona ? (persona.systemAddendum || persona.description || '') : '';
  const boilerplate = await getSystemBoilerplate();
  const { readingGoal } = await chrome.storage.sync.get(['readingGoal']);
  let systemPrompt = applyPromptTemplate(
    settings.systemPromptTemplate,
    basePrompt,
    personaText,
    boilerplate,
    readingGoal || ''
  );
  // Agentic pipeline: append evaluator improvement suggestion
  if (options.promptAugmentation) {
    systemPrompt += '\n\n' + options.promptAugmentation;
  }
  const personaAugmentedTask = { ...task, textPrompt: systemPrompt };

  const maxOutputTokens = personaAugmentedTask?.maxLength
    ? Math.max(64, Math.min(512, Math.ceil(personaAugmentedTask.maxLength * 1.5)))
    : 256;
  const offscreenTimeoutMs = Math.max(90000, Math.min(240000, maxOutputTokens * 400));
  const promptInfo = {
    systemPrompt: personaAugmentedTask?.textPrompt || '',
    userText: truncateForContext(text)
  };

  // Route through unified LLM dispatch
  try {
    const messages = [{ role: 'user', content: promptInfo.userText }];
    const result = await callLLM(messages, promptInfo.systemPrompt, {
      modelId: effectiveModelId,
      timeoutMs: offscreenTimeoutMs,
      temperature: 0.3
    });
    if (result && result.success) return { ...result, promptInfo };
    console.warn('LLM call failed, falling back to simulator:', result && result.error);
  } catch (e) {
    console.warn('LLM unavailable, falling back:', e && e.message);
  }
  // Fallback: simulate processing with local model
  const renarrated = await simulateLocalLLM(text, personaAugmentedTask);
  return { success: true, result: renarrated, promptInfo };
}

const DEFAULT_REMOTE_VLM_PROMPT = [
  'You see screenshot slices of an entire webpage, in order from top to bottom.',
  'Transcribe important textual content exactly as shown (headings, body paragraphs, link/label text).',
  'Keep wording tight and ordered; lightly condense filler/repeated boilerplate.',
  'Include brief notes for meaningful images/graphics and layout cues (sidebars, callouts, tables) only when they convey information.',
  'Do NOT include ads, promo banners, cookie banners, newsletter popups, or other promotional/utility chrome (nav bars, footers, repeated menus); skip them entirely.',
  'If text flows across slices (e.g., an article continues), merge it into a single continuous section.',
  'Hard cap the response at about 8,000 characters (~1,200 words); prioritize main content, merge repeats, and drop filler to stay under the cap.',
  'Prefer concise bullets or short paragraphs; do not repeat headings or navigation items.',
  'Return a single structured outline in plain text. Respect the order of slices as they appear.'
].join(' ');

let cachedSystemBoilerplate = null;
let cachedRemoteVlmPrompt = null;
function buildDefaultPromptTemplate(boilerplate) {
  const parts = [];
  const base = (boilerplate || '').trim();
  if (base) parts.push(base);
  parts.push('Task:\n{task}');
  parts.push('Persona:\n{persona}');
  parts.push('Reading Goal:\n{readingGoal}');
  return parts.join('\n\n');
}

function applyPromptTemplate(template, taskText, personaText, boilerplate, readingGoalText) {
  const source = (template || '').trim() || buildDefaultPromptTemplate(boilerplate);
  return source
    .replace(/\{task\}/gi, () => taskText || '')
    .replace(/\{persona\}/gi, () => personaText || '')
    .replace(/\{readingGoal\}/gi, () => readingGoalText || '')
    .trim();
}
async function getSystemBoilerplate() {
  if (cachedSystemBoilerplate) return cachedSystemBoilerplate;
  try {
    const res = await fetch(chrome.runtime.getURL('src/prompts/system.md'));
    if (!res.ok) throw new Error('Failed to load system prompt');
    const txt = await res.text();
    cachedSystemBoilerplate = txt.trim();
    return cachedSystemBoilerplate;
  } catch (e) {
    console.warn('System prompt fetch failed, using fallback:', e?.message || e);
    cachedSystemBoilerplate = '';
    return '';
  }
}

async function getRemoteVlmPrompt() {
  if (cachedRemoteVlmPrompt) return cachedRemoteVlmPrompt;
  try {
    const res = await fetch(chrome.runtime.getURL('src/prompts/vlm.md'));
    if (!res.ok) throw new Error('Failed to load VLM prompt');
    const txt = (await res.text()).trim();
    cachedRemoteVlmPrompt = txt || DEFAULT_REMOTE_VLM_PROMPT;
    return cachedRemoteVlmPrompt;
  } catch (e) {
    console.warn('VLM prompt fetch failed, using fallback:', e?.message || e);
    cachedRemoteVlmPrompt = DEFAULT_REMOTE_VLM_PROMPT;
    return cachedRemoteVlmPrompt;
  }
}

// Simulate image description with local VLM
// In a production version, this would use Web VLM or similar on-device model
async function describeImage(imageUrl, taskName) {
  try {
    const settings = await getSettingsWithTaskMigration([
      'useWebLLM',
      'useWebVLM',
      'webvlmModel',
      'useRemoteVLM',
      'remoteVLMModel',
      'remoteVLMEndpoint'
    ]);
    const { remoteVLMApiKey } = await chrome.storage.local.get(['remoteVLMApiKey']);
    const tasks = settings.tasks || DEFAULT_TASKS;
    const task = tasks[taskName || settings.currentTask] || tasks.simple || DEFAULT_TASKS.simple;
    // Placeholder for future on-device VLM
    if (settings.useWebVLM) {
      console.warn('WebVLM placeholder enabled but not implemented; using remote/simulator.');
    }
    // Try remote VLM first if configured
    if (settings.useRemoteVLM && remoteVLMApiKey) {
      try {
        const imageDataUrl = await toDataUrl(imageUrl);
        const remote = await callRemoteVLM({
          imageDataUrl,
          prompt: task?.imagePrompt || 'Describe this image accurately. Transcribe any visible text exactly.',
          model: settings.remoteVLMModel,
          endpoint: settings.remoteVLMEndpoint,
          apiKey: remoteVLMApiKey,
          mode: 'describe'
        });
        if (remote?.success) return remote;
      } catch (err) {
        console.warn('Remote VLM failed, falling back:', err && err.message);
      }
    }
    // For now, image description remains simulated unless WebLLM VLM is integrated
    if (settings.useWebLLM) {
      try {
        await ensureOffscreen();
        const response = await postToOffscreen({
          type: 'webllm-describe-image',
          payload: { imageUrl, task, modelId: settings.webllmModel }
        }, { timeoutMs: 90000 });
        if (response && response.success) return response;
      } catch (e) {
        // ignore, fall back
      }
    }
    const description = await simulateLocalVLM(imageUrl, task);
    return { success: true, result: description };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Simulate local LLM processing
// In production, replace with actual Web LLM implementation
async function simulateLocalLLM(text, task) {
  // Simulate processing delay
  await new Promise(resolve => setTimeout(resolve, 500));
  
  const originalLength = text.length;
  const words = text.split(/\s+/);
  const fallbackMaxLength = Math.min(200, originalLength);
  const maxLength = Number.isFinite(task?.maxLength) && task.maxLength > 0
    ? task.maxLength
    : fallbackMaxLength;
  
  // Simple simulation based on task
  switch (task.name) {
    case 'Simple Language':
      // Simplify by using shorter sentences
      return `Simplified version: ${text.substring(0, Math.min(maxLength, originalLength))}. This means the content is about ${words.length} key ideas presented in an easier way.`;
    
    case 'Detailed Explanation':
      return `Detailed analysis: ${text}\n\nThis text contains ${words.length} words and covers several important points. The main ideas are interconnected and provide comprehensive information about the topic.`;
    
    case 'Academic Style':
      return `In scholarly terms, the aforementioned content posits: ${text.substring(0, Math.min(maxLength, originalLength))}. This represents a formal interpretation of the source material.`;
    
    case 'Summary':
      return `Brief summary: ${text.substring(0, Math.min(100, originalLength))}...`;
    
    default:
      return text;
  }
}

// Simulate local VLM processing
// In production, replace with actual Web VLM implementation
async function simulateLocalVLM(imageUrl, task) {
  // Simulate processing delay
  await new Promise(resolve => setTimeout(resolve, 800));
  
  // Extract image characteristics from URL or filename
  const imageName = imageUrl.split('/').pop().split('?')[0];
  
  // Simple simulation based on task
  switch (task.name) {
    case 'Simple Language':
      return `This is an image showing visual content. The image appears to be "${imageName}". It contains various elements arranged on the page.`;
    
    case 'Detailed Explanation':
      return `Comprehensive image analysis: This image (${imageName}) contains multiple visual elements. The composition includes foreground and background elements with specific positioning. Colors, shapes, and textures contribute to the overall visual message. The image serves a specific purpose within the context of the page.`;
    
    case 'Academic Style':
      return `Visual analysis: The image denoted as "${imageName}" presents a structured composition wherein various elements are arranged according to design principles. The visual hierarchy and spatial relationships suggest intentional placement for communicative purposes.`;
    
    case 'Summary':
      return `Image: ${imageName} - Contains visual elements relevant to the page content.`;
    
    default:
      return `Image description: ${imageName}`;
  }
}

// Capture current viewport and send to remote VLM for full-page content extraction
async function describePageScreenshot(tabId) {
  try {
    const settings = await chrome.storage.sync.get([
      'useRemoteVLM',
      'remoteVLMModel',
      'remoteVLMEndpoint'
    ]);
    const { remoteVLMApiKey } = await chrome.storage.local.get(['remoteVLMApiKey']);
    if (!settings.useRemoteVLM) return { success: false, error: 'Remote VLM is disabled in settings.' };
    if (!remoteVLMApiKey) return { success: false, error: 'Remote VLM API key is missing.' };

    const runId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    const logBase = { runId, timestampIso: new Date().toISOString() };
    const captureStarted = Date.now();

    const tab = tabId ? await chrome.tabs.get(tabId) : await getActiveTab();
    const pageTitle = tab?.title || '';
    const { images } = await captureFullPageSlices(tab?.id);
    if (!images || !images.length) return { success: false, error: 'Failed to capture page.' };
    await appendPipelineLog({
      ...logBase,
      stage: 'capture',
      success: true,
      sliceCount: images.length,
      url: tab?.url,
      title: pageTitle,
      durationMs: Date.now() - captureStarted,
      content: `Screenshots captured (${images.length})`
    });

    const prompt = await getRemoteVlmPrompt();

    const vlmStart = Date.now();
    const remote = await callRemoteVLMWithImages({
      images,
      prompt,
      model: settings.remoteVLMModel,
      endpoint: settings.remoteVLMEndpoint,
      apiKey: remoteVLMApiKey
    });
    if (!remote?.success) {
      await appendPipelineLog({
        ...logBase,
        stage: 'vlm',
        success: false,
        error: remote?.error || 'Remote VLM failed',
        model: settings.remoteVLMModel,
        url: tab?.url,
        title: pageTitle,
        durationMs: Date.now() - vlmStart
      });
      return { success: false, error: remote?.error || 'Remote VLM failed.' };
    }
    await appendPipelineLog({
      ...logBase,
      stage: 'vlm',
      success: true,
      model: settings.remoteVLMModel,
      content: remote.result,
      input: {
        prompt,
        imageCount: images.length
      },
      url: tab?.url,
      title: pageTitle,
      durationMs: Date.now() - vlmStart
    });

    const combined = remote.result;
    const previewThumb = images[0]?.dataUrl ? await createThumbnail(images[0].dataUrl, 240, 240) : '';
    
    // Debug: log sizes before storing
    console.log(`[describePageScreenshot] previewThumb size: ${(previewThumb?.length || 0)/1024} KB`);
    console.log(`[describePageScreenshot] combined content size: ${(combined?.length || 0)/1024} KB`);
    
    try {
      await chrome.storage.local.set({
        lastDescribeImage: previewThumb || '',
        lastDescribeResult: {
          content: combined,
          model: settings.remoteVLMModel,
          at: new Date().toISOString(),
          runId
        }
      });
      console.log(`[describePageScreenshot] Stored lastDescribeResult successfully`);
    } catch (e) {
      console.error(`[describePageScreenshot] Storage failed:`, e.message);
      // Store without thumbnail
      await chrome.storage.local.set({
        lastDescribeImage: '',
        lastDescribeResult: {
          content: combined?.slice(0, 10000) || '',
          model: settings.remoteVLMModel,
          at: new Date().toISOString(),
          runId
        }
      });
    }
    return { success: true, result: combined, runId, url: tab?.url, title: pageTitle };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
}

// Full pipeline: capture -> remote VLM -> LLM renarration
async function renarratePage(tabId) {
  try {
    // Notify content script to show loading split-view
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { action: 'show-split-loading' }).catch(() => {});
    }

    const describe = await describePageScreenshot(tabId);
    if (!describe?.success) {
      await chrome.storage.local.set({ pageRenarrationInProgress: false });
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { action: 'hide-split-renarration' }).catch(() => {});
      }
      return describe;
    }
    const vlmContent = describe.result || '';
    const llmStart = Date.now();
    const { useAgenticPipeline } = await chrome.storage.local.get(['useAgenticPipeline']);
    const renarrateFunc = useAgenticPipeline ? agenticRenarrateText : renarrateText;
    const renarrated = await renarrateFunc(vlmContent, null, null, { runId: describe.runId });
    if (!renarrated?.success) {
      await appendPipelineLog({
        runId: describe.runId || (Math.random().toString(36).slice(2)),
        timestampIso: new Date().toISOString(),
        stage: 'llm',
        success: false,
        error: renarrated.error || 'LLM renarration failed',
        model: (await chrome.storage.sync.get(['webllmModel'])).webllmModel,
        url: describe.url,
        title: describe.title,
        durationMs: Date.now() - llmStart
      });
      await chrome.storage.local.set({ pageRenarrationInProgress: false });
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { action: 'hide-split-renarration' }).catch(() => {});
      }
      return renarrated;
    }
    await appendPipelineLog({
      runId: describe.runId || (Math.random().toString(36).slice(2)),
      timestampIso: new Date().toISOString(),
      stage: 'llm',
      success: true,
      content: renarrated.result,
      input: renarrated.promptInfo,
      model: (await chrome.storage.sync.get(['webllmModel'])).webllmModel,
      url: describe.url,
      title: describe.title,
      durationMs: Date.now() - llmStart
    });
    
    // Debug: log sizes
    const vlmSize = (vlmContent?.length || 0) / 1024;
    const renSize = (renarrated.result?.length || 0) / 1024;
    console.log(`[renarratePage] vlmContent: ${vlmSize.toFixed(2)} KB, renarration: ${renSize.toFixed(2)} KB`);
    
    try {
      await chrome.storage.local.set({
        lastPageRenarration: {
          vlmContent: vlmContent?.slice(0, 20000) || '',
          renarration: renarrated.result?.slice(0, 20000) || '',
          at: new Date().toISOString()
        },
        pageRenarrationInProgress: false
      });
      console.log(`[renarratePage] Stored lastPageRenarration successfully`);
    } catch (e) {
      console.error(`[renarratePage] Storage failed:`, e.message);
    }

    // Send renarrated content to content script split-view
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        action: 'show-split-renarration',
        renarration: renarrated.result || '',
        vlmContent: vlmContent || ''
      }).catch(() => {});
    }

    return { success: true, vlmContent, renarration: renarrated.result, runId: describe.runId };
  } catch (error) {
    await chrome.storage.local.set({ pageRenarrationInProgress: false }).catch(() => {});
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { action: 'hide-split-renarration' }).catch(() => {});
    }
    return { success: false, error: error?.message || String(error) };
  }
}

// ---- DOM-based page renarration (clone sidebar) ----

async function renarratePageDom(tabId) {
  try {
    if (!tabId) return { success: false, error: 'No active tab' };

    // Step 1: Ask content script to extract text segments and build clone sidebar
    let extractResult;
    try {
      extractResult = await chrome.tabs.sendMessage(tabId, { action: 'extract-and-clone' });
    } catch (e) {
      return { success: false, error: 'Could not communicate with page. Try refreshing.' };
    }

    if (!extractResult?.success || !extractResult.segments?.length) {
      // Fall back to old VLM pipeline if too few text segments
      chrome.tabs.sendMessage(tabId, { action: 'hide-dom-renarration' }).catch(() => {});
      return renarratePage(tabId);
    }

    const segments = extractResult.segments;
    console.log(`[renarratePageDom] Extracted ${segments.length} text segments`);

    // Step 2: Send segments to LLM for renarration
    chrome.tabs.sendMessage(tabId, { action: 'update-clone-progress', text: `Renarrating ${segments.length} text segments...` }).catch(() => {});

    const result = await renarrateDomSegments(segments);
    if (!result.success) {
      chrome.tabs.sendMessage(tabId, { action: 'hide-dom-renarration' }).catch(() => {});
      return result;
    }

    // Step 3: Send replacements to content script to apply
    chrome.tabs.sendMessage(tabId, { action: 'apply-dom-renarration', replacements: result.replacements }).catch(() => {});

    // Store for viewer access
    try {
      const renarrationText = result.replacements.map(r => r.text).join('\n\n');
      const originalText = segments.map(s => s.text).join('\n\n');
      await chrome.storage.local.set({
        lastPageRenarration: {
          vlmContent: originalText.slice(0, 20000),
          renarration: renarrationText.slice(0, 20000),
          at: new Date().toISOString()
        }
      });
    } catch (e) {
      console.warn('[renarratePageDom] Storage failed:', e?.message);
    }

    return { success: true, segmentCount: segments.length, replacementCount: result.replacements.length };
  } catch (error) {
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { action: 'hide-dom-renarration' }).catch(() => {});
    }
    return { success: false, error: error?.message || String(error) };
  }
}

async function renarrateDomSegments(segments) {
  // Build system prompt using current task/persona (same as renarrateText)
  const settings = await getSettingsWithTaskMigration([
    'webllmModel',
    'personas',
    'currentPersona',
    'systemPromptTemplate'
  ]);
  const tasks = settings.tasks || DEFAULT_TASKS;
  const task = tasks[settings.currentTask] || tasks.simple || DEFAULT_TASKS.simple;
  const persona = settings.personas?.[settings.currentPersona];

  const basePrompt = task?.textPrompt || '';
  const personaText = persona ? (persona.systemAddendum || persona.description || '') : '';
  const boilerplate = await getSystemBoilerplate();
  const { readingGoal } = await chrome.storage.sync.get(['readingGoal']);
  let systemPrompt = applyPromptTemplate(
    settings.systemPromptTemplate,
    basePrompt,
    personaText,
    boilerplate,
    readingGoal || ''
  );

  systemPrompt += '\n\nIMPORTANT: You will receive a JSON array of numbered text segments from a webpage. ' +
    'Renarrate each segment according to your instructions above. ' +
    'Return ONLY a valid JSON array where each element has "id" (matching the input id) and "text" (the renarrated version). ' +
    'If a segment is short navigation text, a button label, or boilerplate, return it unchanged. ' +
    'Do NOT wrap the response in markdown code fences. Return raw JSON only.';

  // Batch segments if too large
  const MAX_CHARS_PER_BATCH = 4000;
  const batches = [];
  let currentBatch = [];
  let currentLen = 0;
  for (const seg of segments) {
    const segLen = seg.text.length;
    if (currentBatch.length > 0 && currentLen + segLen > MAX_CHARS_PER_BATCH) {
      batches.push(currentBatch);
      currentBatch = [];
      currentLen = 0;
    }
    currentBatch.push(seg);
    currentLen += segLen;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  console.log(`[renarrateDomSegments] Processing ${batches.length} batch(es) for ${segments.length} segments`);

  const allReplacements = [];
  for (const batch of batches) {
    const userMessage = JSON.stringify(batch.map(s => ({ id: s.id, text: s.text })));
    const messages = [{ role: 'user', content: userMessage }];

    let result;
    try {
      result = await callLLM(messages, systemPrompt, { temperature: 0.3 });
    } catch (e) {
      console.warn('[renarrateDomSegments] LLM call failed:', e?.message);
      return { success: false, error: 'LLM call failed: ' + (e?.message || 'unknown') };
    }

    if (!result?.success) {
      return { success: false, error: result?.error || 'LLM returned no result' };
    }

    // Parse JSON response
    let parsed;
    try {
      const cleaned = result.result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      // Retry once asking for valid JSON
      console.warn('[renarrateDomSegments] JSON parse failed, retrying...');
      try {
        const retryMessages = [
          { role: 'user', content: userMessage },
          { role: 'model', content: result.result },
          { role: 'user', content: 'Your response was not valid JSON. Please return ONLY a valid JSON array with objects having "id" and "text" fields. No markdown, no explanation.' }
        ];
        const retry = await callLLM(retryMessages, systemPrompt, { temperature: 0.1 });
        if (retry?.success) {
          const cleaned2 = retry.result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
          parsed = JSON.parse(cleaned2);
        }
      } catch (e2) {
        return { success: false, error: 'Failed to parse LLM response as JSON after retry' };
      }
    }

    if (!Array.isArray(parsed)) {
      return { success: false, error: 'LLM did not return a JSON array' };
    }

    allReplacements.push(...parsed);
  }

  return { success: true, replacements: allReplacements };
}

// Utilities for remote VLM (hosted) calls
async function toDataUrl(imageUrl) {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function callRemoteVLM({ imageDataUrl, prompt, model, endpoint, apiKey, mode }) {
  if (!endpoint || !model || !apiKey) return { success: false, error: 'Missing remote VLM configuration' };
  const url = endpoint.replace('{model}', model).includes('key=')
    ? endpoint.replace('{model}', model)
    : `${endpoint.replace('{model}', model)}${endpoint.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}`;
  const base64 = imageDataUrl.split(',')[1];
  const body = {
    contents: [
      {
        parts: [
          { text: prompt || 'Describe this image.' },
          { inline_data: { mime_type: 'image/png', data: base64 } }
        ]
      }
    ],
    generationConfig: {
      temperature: mode === 'describe' ? 0.2 : 0
    }
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VLM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Remote VLM error: ${res.status} ${text}`);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n').trim();
    if (!text) return { success: false, error: 'No content returned from remote VLM' };
    return { success: true, result: text, source: 'remote-vlm' };
  } catch (err) {
    clearTimeout(timer);
    return { success: false, error: err?.message || String(err) };
  }
}

async function callRemoteVLMWithImages({ images, prompt, model, endpoint, apiKey }) {
  if (!Array.isArray(images) || images.length === 0) return { success: false, error: 'No images provided' };
  if (!endpoint || !model || !apiKey) return { success: false, error: 'Missing remote VLM configuration' };
  const url = endpoint.replace('{model}', model).includes('key=')
    ? endpoint.replace('{model}', model)
    : `${endpoint.replace('{model}', model)}${endpoint.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}`;

  const parts = [{ text: prompt || 'Describe these images.' }];
  images.forEach((img, idx) => {
    if (!img?.dataUrl) return;
    const base64 = img.dataUrl.split(',')[1];
    parts.push({ inline_data: { mime_type: 'image/png', data: base64 } });
    parts.push({ text: `Slice ${idx + 1} of ${images.length}` });
  });

  const body = {
    contents: [
      {
        parts
      }
    ],
    generationConfig: {
      temperature: 0.2
    }
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VLM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Remote VLM error: ${res.status} ${text}`);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n').trim();
    if (!text) return { success: false, error: 'No content returned from remote VLM' };
    return { success: true, result: text, source: 'remote-vlm' };
  } catch (err) {
    clearTimeout(timer);
    return { success: false, error: err?.message || String(err) };
  }
}

async function getPipelineLogs() {
  const { pipelineLogs = [] } = await chrome.storage.local.get([PIPELINE_LOG_KEY]);
  return { success: true, logs: pipelineLogs };
}

async function clearPipelineLogs() {
  await chrome.storage.local.set({ [PIPELINE_LOG_KEY]: [] });
  return { success: true };
}

async function appendPipelineLog(entry) {
  let { pipelineLogs = [] } = await chrome.storage.local.get([PIPELINE_LOG_KEY]);
  
  // Clean old logs that might have images (migration cleanup)
  pipelineLogs = pipelineLogs.map(log => {
    if (log.input?.images) {
      const cleaned = { ...log, input: { ...log.input, imageCount: log.input.images.length } };
      delete cleaned.input.images;
      return cleaned;
    }
    return log;
  });
  
  const enriched = { starred: false, ...entry };
  const cleaned = await sanitizeLogEntry(enriched);
  
  // Debug: log sizes
  const cleanedSize = JSON.stringify(cleaned).length;
  const existingSize = JSON.stringify(pipelineLogs).length;
  console.log(`[appendPipelineLog] Entry size: ${(cleanedSize/1024).toFixed(2)} KB, Existing logs size: ${(existingSize/1024).toFixed(2)} KB, Entry count: ${pipelineLogs.length}`);
  
  const next = [cleaned, ...pipelineLogs].slice(0, PIPELINE_LOG_MAX_ENTRIES);
  const nextSize = JSON.stringify(next).length;
  console.log(`[appendPipelineLog] Total size to store: ${(nextSize/1024).toFixed(2)} KB`);
  
  // If still too large (> 2MB), aggressively trim
  let toStore = next;
  if (nextSize > PIPELINE_LOG_MAX_SIZE_BYTES) {
    console.warn(`[appendPipelineLog] Size too large, trimming to 20 entries`);
    toStore = next.slice(0, 20);
  }
  
  try {
    await chrome.storage.local.set({ [PIPELINE_LOG_KEY]: toStore });
    console.log(`[appendPipelineLog] Success storing ${toStore.length} entries`);
    // Mirror to Firestore for research
    try {
      const { enableResearchLogging } = await chrome.storage.local.get(['enableResearchLogging']);
      if (enableResearchLogging !== false) {
        const userId = await getOrCreateUserId();
        await researchPut('researchLogs', {
          logId: researchGenerateId(),
          userId,
          timestamp: Date.now(),
          category: 'renarration',
          subcategory: 'pipeline-' + (cleaned.stage || 'unknown'),
          runId: cleaned.runId,
          stage: cleaned.stage,
          success: cleaned.success,
          model: cleaned.model,
          url: cleaned.url,
          title: cleaned.title,
          durationMs: cleaned.durationMs,
          contentSample: cleaned.content?.slice(0, 500) || ''
        });
      }
    } catch (idbErr) {
      console.warn('Research log mirror failed:', idbErr);
    }
  } catch (e) {
    console.error(`[appendPipelineLog] Storage failed:`, e.message);
    // Aggressive retry: keep only 10 most recent, truncate content
    const minimal = toStore.slice(0, 10).map(log => ({
      ...log,
      content: log.content?.slice(0, 1000) || '',
      input: log.input ? { imageCount: log.input.imageCount, prompt: log.input.prompt?.slice(0, 500) } : undefined
    }));
    const minimalSize = JSON.stringify(minimal).length;
    console.log(`[appendPipelineLog] Minimal retry size: ${(minimalSize/1024).toFixed(2)} KB with ${minimal.length} entries`);
    try {
      await chrome.storage.local.set({ [PIPELINE_LOG_KEY]: minimal });
      console.log(`[appendPipelineLog] Minimal retry success`);
    } catch (e2) {
      console.error(`[appendPipelineLog] Minimal retry also failed, clearing logs:`, e2.message);
      await chrome.storage.local.set({ [PIPELINE_LOG_KEY]: [] });
    }
  }
}

async function deletePipelineEntry(runId, stage) {
  const { pipelineLogs = [] } = await chrome.storage.local.get([PIPELINE_LOG_KEY]);
  const filtered = pipelineLogs.filter(l => !(l.runId === runId && l.stage === stage));
  await chrome.storage.local.set({ [PIPELINE_LOG_KEY]: filtered });
  return { success: true };
}

async function togglePipelineStar(runId, stage) {
  const { pipelineLogs = [] } = await chrome.storage.local.get([PIPELINE_LOG_KEY]);
  const next = pipelineLogs.map(l => {
    if (l.runId === runId && l.stage === stage) {
      return { ...l, starred: !l.starred };
    }
    return l;
  });
  await chrome.storage.local.set({ [PIPELINE_LOG_KEY]: next });
  return { success: true };
}

async function sanitizeLogEntry(entry) {
  const clone = { ...entry };
  if (clone.content && clone.content.length > 8000) {
    clone.content = clone.content.slice(0, 8000) + '...';
  }
  // Images are no longer stored in logs to save memory
  if (clone.input?.images) {
    clone.input = { ...clone.input, imageCount: clone.input.images.length };
    delete clone.input.images;
  }
  return clone;
}

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  // Popup will handle the UI
});

// -----------------
// Offscreen document
// -----------------
let creatingOffscreen = null;

async function hasOffscreenDocument() {
  const matched = await chrome.offscreen.hasDocument?.();
  // Older Chrome versions don't have hasDocument; try getting clients
  if (typeof matched === 'boolean') return matched;
  try {
    const clients = await chrome.runtime.getContexts?.({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL('offscreen.html')]
    });
    return (clients && clients.length > 0) || false;
  } catch (e) {
    return false;
  }
}

async function ensureOffscreen() {
  if (await hasOffscreenDocument()) return;
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['IFRAME_SCRIPTING'],
        justification: 'Run WebLLM with WebGPU in an offscreen document for on-device inference.'
      });
    } catch (e) {
      // If creation failed because one already exists, that's fine
      if (await hasOffscreenDocument()) return;
      console.error('Failed to create offscreen document:', e);
      throw e;
    } finally {
      creatingOffscreen = null;
    }
  })();
  return creatingOffscreen;
}

function postToOffscreen(message, options = {}) {
  const timeoutMs = options.timeoutMs ?? OFFSCREEN_DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    const requestId = Math.random().toString(36).slice(2);
    const timeoutId = setTimeout(() => {
      if (!pendingOffscreenResponses.has(requestId)) return;
      pendingOffscreenResponses.delete(requestId);
      resolve({ success: false, error: 'Offscreen timeout' });
    }, timeoutMs);

    pendingOffscreenResponses.set(requestId, { resolve, timeoutId });

    chrome.runtime.sendMessage({ __toOffscreen: true, requestId, ...message }, () => {
      const sendError = chrome.runtime.lastError;
      if (sendError) {
        const pending = pendingOffscreenResponses.get(requestId);
        if (pending) {
          clearTimeout(pending.timeoutId);
          pendingOffscreenResponses.delete(requestId);
          resolve({ success: false, error: sendError.message });
        }
      }
    });
  });
}

function truncateForContext(text, maxChars = 20000) {
  if (!text || text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

async function createThumbnail(dataUrl, maxW = 240, maxH = 240) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const ratio = Math.min(maxW / bmp.width, maxH / bmp.height, 1);
  const w = Math.max(1, Math.round(bmp.width * ratio));
  const h = Math.max(1, Math.round(bmp.height * ratio));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close && bmp.close();
  const thumbBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  return await blobToDataUrl(thumbBlob);
}

// In-memory cache of logs (persisted in storage.local)
async function appendLog(entry) {
  const existing = await chrome.storage.local.get(['testLogs']);
  const logs = existing.testLogs || [];
  logs.push(entry);
  await chrome.storage.local.set({ testLogs: logs });
  return entry;
}

// Fetch test cases config
async function loadTestCases() {
  const url = chrome.runtime.getURL('config/test-cases.json');
  const res = await fetch(url);
  return res.json();
}

// Run all test cases sequentially
async function runTestCases() {
  const cases = await loadTestCases();
  // Load tasks/personas plus any existing logs and completed ids
  const settings = await getSettingsWithTaskMigration([
    'webllmModel',
    'useWebLLM',
    'personas',
    'currentPersona'
  ]);
  const { testLogs: existingLogs = [], completedTestIds = [] } = await chrome.storage.local.get(['testLogs','completedTestIds']);
  const completed = new Set(completedTestIds.length ? completedTestIds : existingLogs.map(l => l.testId));
  const globalPersona = settings.personas?.[settings.currentPersona];
  const tasks = settings.tasks || DEFAULT_TASKS;
  const allLogs = [...existingLogs];
  for (const tc of cases) {
    // Skip if already completed
    if (completed.has(tc.id)) {
      continue;
    }
    const task = tasks[tc.taskKey] || tasks.simple || DEFAULT_TASKS.simple;
    // Persona precedence: test case personaKey/persona text > global selected persona
    const testPersona = tc.personaKey
      ? settings.personas?.[tc.personaKey]
      : (tc.persona ? { name: 'Custom Persona', description: tc.persona } : globalPersona);
    let result;
    try {
      const ren = await renarrateText(
        tc.content,
        tc.taskKey,
        task,
        { personaKey: tc.personaKey, personaText: tc.persona, modelId: tc.modelId }
      );
      result = ren;
    } catch (e) {
      result = { success: false, error: e.message };
    }
    const now = new Date();
    const iso = now.toISOString();
    const human = now.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const logEntry = await appendLog({
      testId: tc.id,
      timestampIso: iso,
      timestampHuman: human,
      modelId: tc.modelId,
      persona: tc.persona ?? testPersona?.name ?? testPersona?.description ?? '',
      taskKey: tc.taskKey,
      taskName: task.name,
      contentSample: tc.content.slice(0, 400),
      success: result.success,
      output: result.result || null,
      error: result.error || null,
      evaluation: "" // user fills later
    });
    allLogs.push(logEntry);
    completed.add(tc.id);
  }
  // Persist completed set for future runs
  await chrome.storage.local.set({ completedTestIds: Array.from(completed) });
  return { success: true, logs: allLogs };
}

// Update evaluation field
async function evaluateLog(testId, evaluation) {
  const existing = await chrome.storage.local.get(['testLogs']);
  const logs = existing.testLogs || [];
  const idx = logs.findIndex(l => l.testId === testId);
  if (idx >= 0) {
    logs[idx].evaluation = evaluation;
    await chrome.storage.local.set({ testLogs: logs });
    return { success: true };
  }
  return { success: false, error: 'Log not found' };
}

// Export logs as downloadable JSON
async function exportLogs() {
  const existing = await chrome.storage.local.get(['testLogs']);
  const logs = existing.testLogs || [];
  const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(logs, null, 2));
  await chrome.downloads.download({
    url: dataUrl,
    filename: `renarration-logs-${new Date().toISOString().slice(0,10)}.json`,
    saveAs: true
  });
  return { success: true };
}

// -----------------
// Screenshot capture
// -----------------

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function evalInTab(tabId, func, args = []) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args
  });
  return result;
}

async function getPageMetrics(tabId) {
  return await evalInTab(tabId, () => {
    const d = document;
    const body = d.body;
    const de = d.documentElement;
    const scrollHeight = Math.max(
      body ? body.scrollHeight : 0,
      de ? de.scrollHeight : 0
    );
    const clientHeight = window.innerHeight || (de && de.clientHeight) || 0;
    const dpr = window.devicePixelRatio || 1;
    const y = window.scrollY || window.pageYOffset || 0;
    return { scrollHeight, clientHeight, dpr, y };
  });
}

async function scrollToY(tabId, y) {
  await evalInTab(tabId, (yy) => {
    window.scrollTo(0, yy);
  }, [y]);
}

async function captureViewport(windowId, format = 'png', quality = 100) {
  // Quota-aware wrapper around captureVisibleTab.
  // Retries if hitting MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND.
  const MAX_RETRIES = CAPTURE_MAX_RETRIES;
  const BASE_DELAY = CAPTURE_BASE_DELAY_MS;
  let attempt = 0;
  while (true) {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format, quality });
      return dataUrl;
    } catch (e) {
      const msg = e?.message || String(e);
      if (/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(msg) && attempt < MAX_RETRIES) {
        const backoff = BASE_DELAY + attempt * 400; // linear backoff
        await new Promise(r => setTimeout(r, backoff));
        attempt++;
        continue;
      }
      throw e;
    }
  }
}

async function captureFullPageScreenshots(tabId) {
  try {
    const { images, meta, partial } = await captureFullPageSlices(tabId);
    // Debug: log screenshot sizes
    const totalSize = images.reduce((sum, img) => sum + (img.dataUrl?.length || 0), 0);
    console.log(`[captureFullPageScreenshots] ${images.length} slices, total size: ${(totalSize/1024/1024).toFixed(2)} MB`);
    
    // Persist slices for viewer
    try {
      await chrome.storage.local.set({
        lastScreenshots: images,
        lastScreenshotMeta: meta
      });
      console.log(`[captureFullPageScreenshots] Screenshots stored successfully`);
    } catch (e) {
      console.error(`[captureFullPageScreenshots] Storage failed:`, e.message);
      // Try storing without images - just metadata
      await chrome.storage.local.set({
        lastScreenshots: [],
        lastScreenshotMeta: { ...meta, error: 'Screenshots too large to store' }
      });
    }
    await chrome.tabs.create({ url: chrome.runtime.getURL('viewers/screenshot-viewer.html') });
    return { success: true, count: images.length, partial };
  } catch (e) {
    console.error(`[captureFullPageScreenshots] Error:`, e.message);
    return { success: false, error: e?.message || String(e) };
  }
}

async function captureFullPageSlices(tabId) {
  let tab = tabId ? await chrome.tabs.get(tabId) : await getActiveTab();
  if (!tab) throw new Error('No active tab found');
  try { await chrome.tabs.update(tab.id, { active: true }); } catch {}

  const startMetrics = await getPageMetrics(tab.id);
  let total = startMetrics.scrollHeight;
  const originalY = startMetrics.y || 0;

  const images = [];
  const maxSlices = CAPTURE_MAX_SLICES;
  const settleDelayMs = CAPTURE_SETTLE_DELAY_MS;
  const sliceOverlapPx = CAPTURE_SLICE_OVERLAP_PX;
  let y = 0;
  let sliceIndex = 0;

  while (y < total && sliceIndex < maxSlices) {
    await scrollToY(tab.id, y);
    await new Promise(r => setTimeout(r, settleDelayMs));
    let dataUrl;
    try {
      dataUrl = await captureViewport(tab.windowId, 'png', 95);
    } catch (e) {
      if (/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(e?.message || '')) {
        break;
      }
      throw e;
    }
    images.push({ y, dataUrl });
    sliceIndex++;

    if (sliceIndex % 5 === 0) {
      const m = await getPageMetrics(tab.id);
      if (m.scrollHeight > total) total = m.scrollHeight;
    }

    const step = Math.max(1, startMetrics.clientHeight - sliceOverlapPx);
    y += step;
    if (y >= total - 1) break;
  }

  await scrollToY(tab.id, originalY);

  const partial = images.length < Math.ceil(total / Math.max(1, startMetrics.clientHeight));
  const meta = {
    overlapPx: sliceOverlapPx,
    clientHeight: startMetrics.clientHeight,
    dpr: startMetrics.dpr || 1
  };
  return { images, meta, partial };
}

async function stitchSlicesToDataUrl(slices, { maxWidth = null, maxHeight = null, format = 'image/png' } = {}) {
  if (!slices || !slices.length) return null;
  try {
    const first = slices[0];
    const { width, height } = await getImageDimensions(first.dataUrl);
    const totalHeight = slices.reduce((max, s) => Math.max(max, s.y + height), 0);
    const baseCanvas = new OffscreenCanvas(width, totalHeight);
    const ctx = baseCanvas.getContext('2d');
    for (const slice of slices) {
      const bmp = await dataUrlToBitmap(slice.dataUrl);
      ctx.drawImage(bmp, 0, slice.y);
      bmp.close && bmp.close();
    }

    let finalCanvas = baseCanvas;
    // Optional downscale to stay within size limits (if provided)
    if (typeof maxWidth === 'number' && typeof maxHeight === 'number') {
      const scale = Math.min(1, maxWidth / width, maxHeight / totalHeight);
      if (scale < 1) {
        const scaled = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(totalHeight * scale)));
        const sctx = scaled.getContext('2d');
        sctx.drawImage(baseCanvas, 0, 0, scaled.width, scaled.height);
        finalCanvas = scaled;
      }
    }

    const blob = await finalCanvas.convertToBlob({ type: format, quality: format === 'image/jpeg' ? 0.9 : undefined });
    const dataUrl = await blobToDataUrl(blob);
    return dataUrl;
  } catch (e) {
    console.warn('Stitch failed, falling back to first slice:', e?.message || e);
    return slices[0].dataUrl || null;
  }
}

async function getImageDimensions(dataUrl) {
  const bmp = await dataUrlToBitmap(dataUrl);
  const dims = { width: bmp.width, height: bmp.height };
  bmp.close && bmp.close();
  return dims;
}

async function dataUrlToBitmap(dataUrl) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return await createImageBitmap(blob);
}

async function blobToDataUrl(blob) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
