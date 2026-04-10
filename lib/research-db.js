// Firestore REST API wrapper for research data collection
// Database: Cloud Firestore (renarration-research project)
// Collections: chatSessions, researchLogs, feedbackEvents, experimentRuns, preferenceHistory, userPreferences

const FIRESTORE_DEFAULT_PROJECT_ID = 'renarration-research';
// API key must be configured via options page — no hardcoded default
const FIRESTORE_DEFAULT_API_KEY = '';

const STORES = {
  chatSessions: { keyPath: 'sessionId' },
  researchLogs: { keyPath: 'logId' },
  feedbackEvents: { keyPath: 'feedbackId' },
  experimentRuns: { keyPath: 'experimentId' },
  preferenceHistory: { keyPath: 'id', autoGenerate: true },
  userPreferences: { keyPath: 'preferenceId', autoGenerate: true }
};

let _fsConfig = null;

async function getConfig() {
  if (_fsConfig) return _fsConfig;
  const stored = await chrome.storage.local.get(['firebaseProjectId', 'firebaseApiKey']);
  _fsConfig = {
    projectId: stored.firebaseProjectId || FIRESTORE_DEFAULT_PROJECT_ID,
    apiKey: stored.firebaseApiKey || FIRESTORE_DEFAULT_API_KEY
  };
  return _fsConfig;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.firebaseProjectId || changes.firebaseApiKey)) {
    _fsConfig = null;
  }
});

function basePath(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

// Value encoding: JS -> Firestore
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

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// Generic CRUD operations

async function put(storeName, record) {
  const config = await getConfig();
  const base = basePath(config.projectId);
  const storeConfig = STORES[storeName];
  if (!storeConfig) throw new Error('Unknown store: ' + storeName);

  let docId = record[storeConfig.keyPath];
  if (!docId && storeConfig.autoGenerate) {
    docId = generateId();
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
    throw new Error(`Firestore PUT failed (${resp.status}): ${err}`);
  }
  return record;
}

async function get(storeName, key) {
  const config = await getConfig();
  const base = basePath(config.projectId);
  const url = `${base}/${storeName}/${key}?key=${config.apiKey}`;

  const resp = await fetch(url);
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Firestore GET failed (${resp.status}): ${err}`);
  }
  const doc = await resp.json();
  return doc.fields ? fromFirestoreFields(doc.fields) : null;
}

async function getAll(storeName) {
  const config = await getConfig();
  const base = basePath(config.projectId);
  const results = [];
  let pageToken = '';

  do {
    let url = `${base}/${storeName}?key=${config.apiKey}&pageSize=300`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const resp = await fetch(url);
    if (!resp.ok) {
      const err = await resp.text();
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

async function getAllByIndex(storeName, indexName, value) {
  const config = await getConfig();
  const base = basePath(config.projectId);
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
    throw new Error(`Firestore QUERY failed (${resp.status}): ${err}`);
  }
  const results = await resp.json();
  return (results || [])
    .filter(r => r.document && r.document.fields)
    .map(r => fromFirestoreFields(r.document.fields));
}

async function clearStore(storeName) {
  const config = await getConfig();
  const base = basePath(config.projectId);

  let pageToken = '';
  do {
    let url = `${base}/${storeName}?key=${config.apiKey}&pageSize=300`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const resp = await fetch(url);
    if (!resp.ok) break;
    const data = await resp.json();
    if (!data.documents || data.documents.length === 0) break;

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

// Domain-specific helpers

const ResearchDB = {
  // Chat Sessions
  async createChatSession(userId) {
    const session = {
      sessionId: generateId(),
      userId,
      timestamp: Date.now(),
      messages: [],
      extractedProfile: null,
      appliedPersonaKey: null
    };
    return put('chatSessions', session);
  },

  async getChatSession(sessionId) {
    return get('chatSessions', sessionId);
  },

  async updateChatSession(sessionId, updates) {
    const session = await get('chatSessions', sessionId);
    if (!session) throw new Error('Session not found: ' + sessionId);
    Object.assign(session, updates);
    return put('chatSessions', session);
  },

  async appendMessage(sessionId, role, content) {
    const session = await get('chatSessions', sessionId);
    if (!session) throw new Error('Session not found: ' + sessionId);
    session.messages.push({ role, content, timestamp: Date.now() });
    return put('chatSessions', session);
  },

  async getUserSessions(userId) {
    return getAllByIndex('chatSessions', 'userId', userId);
  },

  // Research Logs
  async addLog(entry) {
    const log = {
      logId: generateId(),
      timestamp: Date.now(),
      ...entry
    };
    return put('researchLogs', log);
  },

  async getLogs(userId) {
    if (userId) return getAllByIndex('researchLogs', 'userId', userId);
    return getAll('researchLogs');
  },

  async getLogsByCategory(category) {
    return getAllByIndex('researchLogs', 'category', category);
  },

  // Feedback Events
  async addFeedback(entry) {
    const feedback = {
      feedbackId: generateId(),
      timestamp: Date.now(),
      ...entry
    };
    return put('feedbackEvents', feedback);
  },

  async getFeedback(userId) {
    if (userId) return getAllByIndex('feedbackEvents', 'userId', userId);
    return getAll('feedbackEvents');
  },

  async getFeedbackByRunId(runId) {
    return getAllByIndex('feedbackEvents', 'runId', runId);
  },

  // Experiment Runs
  async addExperiment(entry) {
    const experiment = {
      experimentId: generateId(),
      timestamp: Date.now(),
      ...entry
    };
    return put('experimentRuns', experiment);
  },

  async getExperiments(userId) {
    if (userId) return getAllByIndex('experimentRuns', 'userId', userId);
    return getAll('experimentRuns');
  },

  // Preference History
  async addPreferenceChange(entry) {
    const record = {
      timestamp: Date.now(),
      ...entry
    };
    return put('preferenceHistory', record);
  },

  async getPreferenceHistory(userId) {
    if (userId) return getAllByIndex('preferenceHistory', 'userId', userId);
    return getAll('preferenceHistory');
  },

  // Export
  async exportAllData(userId) {
    const storeNames = Object.keys(STORES);
    const data = {};
    for (const name of storeNames) {
      data[name] = userId ? await getAllByIndex(name, 'userId', userId) : await getAll(name);
    }
    data.exportedAt = new Date().toISOString();
    data.userId = userId || 'all';
    return data;
  },

  exportCSV(storeName, records) {
    if (!records || !records.length) return '';
    const allKeys = new Set();
    records.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
    const keys = [...allKeys];
    const escape = (v) => {
      if (v == null) return '';
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
    };
    const header = keys.map(escape).join(',');
    const rows = records.map(r => keys.map(k => escape(r[k])).join(','));
    return [header, ...rows].join('\n');
  },

  // Clear all research data
  async clearAll() {
    for (const name of Object.keys(STORES)) {
      await clearStore(name);
    }
    return true;
  },

  // Utilities
  generateId
};

// Export for use in different contexts
if (typeof globalThis !== 'undefined') {
  globalThis.ResearchDB = ResearchDB;
}
