import { generateId } from './id.js';

const FIRESTORE_DEFAULT_PROJECT_ID = 'renarration-research';
// API key must be configured via options page — no hardcoded default
const FIRESTORE_DEFAULT_API_KEY = '';

// Stored under chrome.storage.local so the UI can surface a configuration
// problem instead of research data failing silently.
const FIRESTORE_STATUS_KEY = 'firestoreStatus';

// HTTP statuses worth retrying — rate limiting and transient server errors.
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 400;

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

async function setFirestoreStatus(status) {
  try {
    await chrome.storage.local.set({ [FIRESTORE_STATUS_KEY]: { ...status, at: new Date().toISOString() } });
  } catch {
    // A status write failure must never mask the real operation result.
  }
}

// Fails fast with a clear, user-actionable error when no API key is set —
// otherwise every request 401s with an opaque message and data is lost.
async function ensureConfigured(config) {
  if (!config.apiKey) {
    const message =
      'Firestore API key is not configured — research data will not be saved. ' +
      'Set the Firebase API key in the extension options.';
    console.error('[Firestore]', message);
    await setFirestoreStatus({ ok: false, error: 'missing-api-key' });
    throw new Error(message);
  }
}

function isTransient(err) {
  return Boolean(err && err.transient);
}

// Retries a request-producing function on transient failures with exponential
// backoff. Non-transient errors (and the final attempt) are rethrown as-is.
async function withRetry(fn, { attempts = RETRY_ATTEMPTS, baseDelay = RETRY_BASE_DELAY_MS } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === attempts - 1) throw err;
      const delay = baseDelay * 2 ** attempt;
      console.warn(`[Firestore] transient error, retrying in ${delay}ms:`, err?.message || err);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

// Performs one fetch, classifying failures so withRetry knows what is transient.
async function firestoreFetch(operation, url, init) {
  let resp;
  try {
    resp = await fetch(url, init);
  } catch (networkErr) {
    const err = new Error(`Firestore ${operation} network error: ${networkErr?.message || networkErr}`);
    err.transient = true;
    throw err;
  }
  if (!resp.ok && resp.status !== 404) {
    const detail = await resp.text();
    const err = new Error(`Firestore ${operation} failed (${resp.status}): ${detail}`);
    err.status = resp.status;
    err.transient = TRANSIENT_STATUS.has(resp.status);
    throw err;
  }
  return resp;
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
  await ensureConfigured(config);
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

  // PATCH by document ID is idempotent, so retrying it is safe.
  await withRetry(() =>
    firestoreFetch('PUT', url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  );
  return record;
}

export async function researchGet(storeName, key) {
  const config = await getFirestoreConfig();
  await ensureConfigured(config);
  const base = firestoreBasePath(config.projectId);
  const url = `${base}/${storeName}/${key}?key=${config.apiKey}`;

  const resp = await withRetry(() => firestoreFetch('GET', url));
  if (resp.status === 404) return null;
  const doc = await resp.json();
  return doc.fields ? fromFirestoreFields(doc.fields) : null;
}

export async function researchGetAll(storeName, options = {}) {
  const config = await getFirestoreConfig();
  await ensureConfigured(config);
  const base = firestoreBasePath(config.projectId);
  const results = [];
  let pageToken = '';

  do {
    let url = `${base}/${storeName}?key=${config.apiKey}&pageSize=300`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const resp = await withRetry(() => firestoreFetch('LIST', url));
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
  await ensureConfigured(config);
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

  const resp = await withRetry(() =>
    firestoreFetch('QUERY', url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  );
  const results = await resp.json();
  return (results || [])
    .filter(r => r.document && r.document.fields)
    .map(r => fromFirestoreFields(r.document.fields));
}

export async function researchClearStore(storeName) {
  const config = await getFirestoreConfig();
  await ensureConfigured(config);
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
