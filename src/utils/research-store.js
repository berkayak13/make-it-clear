import { generateId } from './id.js';

// On-device research/telemetry store: chat sessions, research logs, feedback
// events, and preference history live in a local IndexedDB database. This
// replaces the previous Cloud Firestore HTTP client — research data now stays
// on the device with no network calls and no API key, and writes never throw
// for an unconfigured user (the old client 401'd / threw without a Firebase
// key, which broke the feedback buttons).

const DB_NAME = 'renarration-research';
const DB_VERSION = 1;

export const RESEARCH_STORES = {
  chatSessions: { keyPath: 'sessionId' },
  researchLogs: { keyPath: 'logId' },
  feedbackEvents: { keyPath: 'feedbackId' },
  userPreferences: { keyPath: 'preferenceId', autoGenerate: true },
};

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const [name, config] of Object.entries(RESEARCH_STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: config.keyPath });
        // Every record carries userId; index it so researchGetByIndex filters
        // per user without scanning the whole store.
        store.createIndex('userId', 'userId', { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Drop the cached handle if another context upgrades the DB later.
      db.onversionchange = () => {
        try {
          db.close();
        } catch {
          /* already closing */
        }
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB open blocked'));
  }).catch(e => {
    dbPromise = null; // allow a retry on transient open failure
    throw e;
  });
  return dbPromise;
}

function objectStore(db, storeName, mode) {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requireStore(storeName) {
  if (!RESEARCH_STORES[storeName]) throw new Error('Unknown store: ' + storeName);
}

export async function researchPut(storeName, record) {
  requireStore(storeName);
  const config = RESEARCH_STORES[storeName];
  const value = { ...record };
  if (!value[config.keyPath] && config.autoGenerate) {
    value[config.keyPath] = generateId();
  }
  if (!value[config.keyPath]) throw new Error('Missing document ID for store: ' + storeName);
  const db = await openDB();
  await promisifyRequest(objectStore(db, storeName, 'readwrite').put(value));
  return value;
}

export async function researchGet(storeName, key) {
  requireStore(storeName);
  const db = await openDB();
  const result = await promisifyRequest(objectStore(db, storeName, 'readonly').get(key));
  return result ?? null;
}

export async function researchGetAll(storeName) {
  requireStore(storeName);
  const db = await openDB();
  const result = await promisifyRequest(objectStore(db, storeName, 'readonly').getAll());
  return Array.isArray(result) ? result : [];
}

export async function researchGetByIndex(storeName, indexField, value) {
  requireStore(storeName);
  const db = await openDB();
  const store = objectStore(db, storeName, 'readonly');
  // One request per call so the transaction stays active across the single await.
  if (store.indexNames.contains(indexField)) {
    const result = await promisifyRequest(store.index(indexField).getAll(value));
    return Array.isArray(result) ? result : [];
  }
  const all = await promisifyRequest(store.getAll());
  return (Array.isArray(all) ? all : []).filter(r => r && r[indexField] === value);
}

export async function researchClearStore(storeName) {
  requireStore(storeName);
  const db = await openDB();
  await promisifyRequest(objectStore(db, storeName, 'readwrite').clear());
  return true;
}

export function researchExportCSV(records = []) {
  if (!records || !records.length) return '';

  const allKeys = new Set();
  records.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
  const keys = [...allKeys];

  const escape = v => {
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  };

  const header = keys.map(escape).join(',');
  const rows = records.map(r => keys.map(k => escape(r[k])).join(','));
  return [header, ...rows].join('\n');
}
