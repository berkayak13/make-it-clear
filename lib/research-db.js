// IndexedDB wrapper for research data collection
// Database: renarration-research
// Stores: chatSessions, researchLogs, feedbackEvents, experimentRuns, preferenceHistory

const DB_NAME = 'renarration-research';
const DB_VERSION = 2;

const STORES = {
  chatSessions: { keyPath: 'sessionId', indexes: ['userId', 'timestamp'] },
  researchLogs: { keyPath: 'logId', indexes: ['userId', 'timestamp', 'category'] },
  feedbackEvents: { keyPath: 'feedbackId', indexes: ['userId', 'timestamp', 'runId'] },
  experimentRuns: { keyPath: 'experimentId', indexes: ['userId', 'timestamp'] },
  preferenceHistory: { keyPath: 'id', autoIncrement: true, indexes: ['userId', 'timestamp'] },
  userPreferences: { keyPath: 'preferenceId', autoIncrement: true, indexes: ['userId', 'timestamp'] }
};

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const [name, config] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          const storeOpts = { keyPath: config.keyPath };
          if (config.autoIncrement) storeOpts.autoIncrement = true;
          const store = db.createObjectStore(name, storeOpts);
          for (const idx of config.indexes) {
            store.createIndex(idx, idx, { unique: false });
          }
        }
      }
    };
    request.onsuccess = (e) => {
      _db = e.target.result;
      _db.onclose = () => { _db = null; };
      resolve(_db);
    };
    request.onerror = (e) => reject(e.target.error);
  });
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
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function get(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function getAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function getAllByIndex(storeName, indexName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const req = index.getAll(value);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function remove(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve(true);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function clearStore(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.clear();
    req.onsuccess = () => resolve(true);
    req.onerror = (e) => reject(e.target.error);
  });
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
  generateId,
  openDB
};

// Export for use in different contexts
if (typeof globalThis !== 'undefined') {
  globalThis.ResearchDB = ResearchDB;
}
