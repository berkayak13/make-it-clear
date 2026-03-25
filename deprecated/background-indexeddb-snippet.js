
// =========================================
// Research DB (IndexedDB) — inline for service worker
// =========================================
const RESEARCH_DB_NAME = 'renarration-research';
const RESEARCH_DB_VERSION = 2;
const RESEARCH_STORES = {
  chatSessions: { keyPath: 'sessionId', indexes: ['userId', 'timestamp'] },
  researchLogs: { keyPath: 'logId', indexes: ['userId', 'timestamp', 'category'] },
  feedbackEvents: { keyPath: 'feedbackId', indexes: ['userId', 'timestamp', 'runId'] },
  experimentRuns: { keyPath: 'experimentId', indexes: ['userId', 'timestamp'] },
  preferenceHistory: { keyPath: 'id', autoIncrement: true, indexes: ['userId', 'timestamp'] },
  userPreferences: { keyPath: 'preferenceId', autoIncrement: true, indexes: ['userId', 'timestamp'] }
};
let _researchDb = null;

function openResearchDB() {
  if (_researchDb) return Promise.resolve(_researchDb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(RESEARCH_DB_NAME, RESEARCH_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const [name, config] of Object.entries(RESEARCH_STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          const opts = { keyPath: config.keyPath };
          if (config.autoIncrement) opts.autoIncrement = true;
          const store = db.createObjectStore(name, opts);
          for (const idx of config.indexes) {
            store.createIndex(idx, idx, { unique: false });
          }
        }
      }
    };
    req.onsuccess = (e) => { _researchDb = e.target.result; _researchDb.onclose = () => { _researchDb = null; }; resolve(_researchDb); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function researchGenerateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

async function researchPut(storeName, record) {
  const db = await openResearchDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const r = store.put(record);
    r.onsuccess = () => resolve(record);
    r.onerror = (e) => reject(e.target.error);
  });
}

async function researchGet(storeName, key) {
  const db = await openResearchDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const r = store.get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = (e) => reject(e.target.error);
  });
}

async function researchGetAll(storeName) {
  const db = await openResearchDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const r = store.getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = (e) => reject(e.target.error);
  });
}

async function researchGetByIndex(storeName, indexName, value) {
  const db = await openResearchDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const idx = store.index(indexName);
    const r = idx.getAll(value);
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = (e) => reject(e.target.error);
  });
}

async function researchClearStore(storeName) {
  const db = await openResearchDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const r = store.clear();
    r.onsuccess = () => resolve(true);
    r.onerror = (e) => reject(e.target.error);
  });
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
