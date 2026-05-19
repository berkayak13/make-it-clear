import { generateId } from './id.js';

const FIRESTORE_DEFAULT_PROJECT_ID = 'renarration-research';
// API key must be configured via options page — no hardcoded default
const FIRESTORE_DEFAULT_API_KEY = '';

export const RESEARCH_STORES = {
  chatSessions: { keyPath: 'sessionId' },
  researchLogs: { keyPath: 'logId' },
  feedbackEvents: { keyPath: 'feedbackId' },
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

// Invalidate cached config when storage changes
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.firebaseProjectId || changes.firebaseApiKey)) {
      _firestoreConfig = null;
    }
  });
}

function firestoreBasePath(projectId) {
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

// Value decoding: Firestore -> JS
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

export async function researchPut(storeName, record) {
  const config = await getFirestoreConfig();
  const base = firestoreBasePath(config.projectId);
  const storeConfig = RESEARCH_STORES[storeName];
  if (!storeConfig) throw new Error('Unknown store: ' + storeName);

  let docId = record[storeConfig.keyPath];
  if (!docId && storeConfig.autoGenerate) {
    docId = generateId();
    record[storeConfig.keyPath] = docId;
  }
  if (!docId) throw new Error('Missing document ID for store: ' + storeName);

  const url = `${base}/${storeName}/${docId}?key=${config.apiKey}`;
  const body = { fields: toFirestoreFields(record) };

  let resp;
  try {
    resp = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (networkErr) {
    throw new Error(`Firestore PUT network error: ${networkErr?.message || networkErr}`);
  }
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Firestore PUT failed (${resp.status}): ${err}`);
  }
  return record;
}

export async function researchGet(storeName, key) {
  const config = await getFirestoreConfig();
  const base = firestoreBasePath(config.projectId);
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

export async function researchGetAll(storeName, options = {}) {
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

export async function researchGetByIndex(storeName, indexField, value) {
  const config = await getFirestoreConfig();
  const base = firestoreBasePath(config.projectId);
  const url = `${base}:runQuery?key=${config.apiKey}`;

  const body = {
    structuredQuery: {
      from: [{ collectionId: storeName }],
      where: {
        fieldFilter: {
          field: { fieldPath: indexField },
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

export async function researchClearStore(storeName) {
  const config = await getFirestoreConfig();
  const base = firestoreBasePath(config.projectId);

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

export function researchExportCSV(records = []) {
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
}
