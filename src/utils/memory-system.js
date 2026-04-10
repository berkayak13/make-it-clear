// Three-Layer Memory System
// Layer 1: Semantic — user profile (role, expertise, preferences). Stored in chrome.storage.sync under 'memoryProfile'
// Layer 2: Episodic — past session summaries. Stored in Firestore 'chatSessions' collection
// Layer 3: Procedural — learned agent instructions. Stored in chrome.storage.local under 'proceduralMemory'

const CONFIDENCE_WEIGHTS = { low: 0.3, medium: 0.6, high: 1.0 };
const MAX_EPISODIC_ENTRIES = 50;
const EPISODIC_EXPIRY_DAYS = 90;
const MAX_PROCEDURAL_RULES_PER_AGENT = 10;

// ---------------------------------------------------------------------------
// Firestore helpers (inline subset from lib/research-db.js for module use)
// ---------------------------------------------------------------------------

let _fsConfig = null;

async function getFirestoreConfig() {
  if (_fsConfig) return _fsConfig;
  const stored = await chrome.storage.local.get(['firebaseProjectId', 'firebaseApiKey']);
  _fsConfig = {
    projectId: stored.firebaseProjectId || 'renarration-research',
    apiKey: stored.firebaseApiKey || ''
  };
  return _fsConfig;
}

function firestoreBasePath(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

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
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function firestorePut(collection, docId, record) {
  const config = await getFirestoreConfig();
  const url = `${firestoreBasePath(config.projectId)}/${collection}/${docId}?key=${config.apiKey}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFirestoreFields(record) })
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Firestore PUT failed (${resp.status}): ${err}`);
  }
  return record;
}

async function firestoreQuery(collection, fieldPath, op, value) {
  const config = await getFirestoreConfig();
  const url = `${firestoreBasePath(config.projectId)}:runQuery?key=${config.apiKey}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where: {
        fieldFilter: {
          field: { fieldPath },
          op,
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

async function firestoreDeleteDoc(collection, docId) {
  const config = await getFirestoreConfig();
  const url = `${firestoreBasePath(config.projectId)}/${collection}/${docId}?key=${config.apiKey}`;
  await fetch(url, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Layer 1 — Semantic Memory (chrome.storage.sync)
// ---------------------------------------------------------------------------

function defaultProfile() {
  return {
    role: '',
    expertiseLevel: '',
    preferredTone: '',
    preferredLength: '',
    terminologyPreferences: { preferred: [], avoided: [] },
    languages: [],
    domains: [],
    lastUpdated: new Date().toISOString()
  };
}

async function loadSemantic() {
  const data = await chrome.storage.sync.get('memoryProfile');
  return data.memoryProfile || defaultProfile();
}

async function saveSemantic(profile) {
  profile.lastUpdated = new Date().toISOString();
  await chrome.storage.sync.set({ memoryProfile: profile });
}

// ---------------------------------------------------------------------------
// Layer 2 — Episodic Memory (Firestore chatSessions)
// ---------------------------------------------------------------------------

async function loadEpisodicSessions(userId, limit = 10) {
  const sessions = await firestoreQuery('chatSessions', 'userId', 'EQUAL', userId);
  sessions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return sessions.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Layer 3 — Procedural Memory (chrome.storage.local)
// ---------------------------------------------------------------------------

async function loadProcedural() {
  const data = await chrome.storage.local.get('proceduralMemory');
  return data.proceduralMemory || {};
}

async function saveProcedural(memory) {
  await chrome.storage.local.set({ proceduralMemory: memory });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load all three memory layers for a user.
 * @param {string} userId
 * @returns {Promise<{semantic: object, episodic: object[], procedural: object}>}
 */
export async function loadMemory(userId) {
  const [semantic, episodic, procedural] = await Promise.all([
    loadSemantic(),
    loadEpisodicSessions(userId).catch(() => []),
    loadProcedural()
  ]);
  return { semantic, episodic, procedural };
}

/**
 * Confidence-weighted update to the semantic user profile.
 * @param {string} _userId  — reserved for future per-user partitioning
 * @param {object} updates  — partial profile fields to merge
 * @param {'low'|'medium'|'high'} confidence
 */
export async function updateSemantic(_userId, updates, confidence) {
  const weight = CONFIDENCE_WEIGHTS[confidence] ?? CONFIDENCE_WEIGHTS.medium;
  const profile = await loadSemantic();

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === null) continue;

    const existing = profile[key];

    if (weight <= CONFIDENCE_WEIGHTS.low) {
      // Low confidence: only fill empty fields
      if (!existing || existing === '' || (Array.isArray(existing) && existing.length === 0)) {
        profile[key] = value;
      }
    } else if (weight <= CONFIDENCE_WEIGHTS.medium) {
      // Medium confidence: blend where possible
      if (Array.isArray(existing) && Array.isArray(value)) {
        profile[key] = [...new Set([...existing, ...value])];
      } else if (typeof existing === 'object' && typeof value === 'object' && !Array.isArray(existing)) {
        profile[key] = blendObjects(existing, value);
      } else {
        // For scalar strings, prefer the newer value at medium confidence
        profile[key] = value;
      }
    } else {
      // High confidence: overwrite
      profile[key] = value;
    }
  }

  await saveSemantic(profile);
  return profile;
}

function blendObjects(oldObj, newObj) {
  const merged = { ...oldObj };
  for (const [k, v] of Object.entries(newObj)) {
    if (Array.isArray(merged[k]) && Array.isArray(v)) {
      merged[k] = [...new Set([...merged[k], ...v])];
    } else {
      merged[k] = v;
    }
  }
  return merged;
}

/**
 * Append a session summary to Firestore episodic memory.
 * Auto-expires entries older than 90 days, keeps max 50.
 * @param {string} userId
 * @param {object} sessionSummary — { sessionId, timestamp, url, intent, outcome, duration }
 */
export async function appendEpisodic(userId, sessionSummary) {
  const record = {
    sessionId: sessionSummary.sessionId || generateId(),
    userId,
    timestamp: sessionSummary.timestamp || Date.now(),
    url: sessionSummary.url || '',
    intent: sessionSummary.intent || '',
    outcome: sessionSummary.outcome || '',
    duration: sessionSummary.duration || 0,
    type: 'session-summary'
  };

  await firestorePut('chatSessions', record.sessionId, record);

  // Housekeeping: expire old entries and enforce max count
  try {
    const all = await firestoreQuery('chatSessions', 'userId', 'EQUAL', userId);
    const cutoff = Date.now() - EPISODIC_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

    // Delete expired entries (parallel)
    const expired = all.filter(s => (s.timestamp || 0) < cutoff);
    await Promise.all(expired.map(s => firestoreDeleteDoc('chatSessions', s.sessionId)));

    // If still over limit, remove oldest (parallel)
    const remaining = all.filter(s => (s.timestamp || 0) >= cutoff);
    if (remaining.length > MAX_EPISODIC_ENTRIES) {
      const sorted = remaining.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      const toRemove = sorted.slice(0, remaining.length - MAX_EPISODIC_ENTRIES);
      await Promise.all(toRemove.map(s => firestoreDeleteDoc('chatSessions', s.sessionId)));
    }
  } catch (err) {
    console.warn('[memory-system] Episodic housekeeping failed:', err.message);
  }

  return record;
}

/**
 * Add or update a learned instruction for a specific agent.
 * Max 10 rules per agent; replaces lowest-confidence rule when full.
 * @param {string} _userId
 * @param {string} agentName
 * @param {object} instruction — { rule, confidence, source }
 */
export async function updateProcedural(_userId, agentName, instruction) {
  const memory = await loadProcedural();
  const rules = memory[agentName] || [];

  const entry = {
    rule: instruction.rule,
    confidence: instruction.confidence ?? 0.5,
    source: instruction.source || 'implicit',
    timestamp: new Date().toISOString()
  };

  // Check for duplicate rule text — update in place
  const existingIdx = rules.findIndex(r => r.rule === entry.rule);
  if (existingIdx >= 0) {
    rules[existingIdx] = entry;
  } else if (rules.length < MAX_PROCEDURAL_RULES_PER_AGENT) {
    rules.push(entry);
  } else {
    // Replace the rule with the lowest confidence
    let minIdx = 0;
    for (let i = 1; i < rules.length; i++) {
      if (rules[i].confidence < rules[minIdx].confidence) minIdx = i;
    }
    if (entry.confidence >= rules[minIdx].confidence) {
      rules[minIdx] = entry;
    }
  }

  memory[agentName] = rules;
  await saveProcedural(memory);
  return rules;
}

/**
 * Find past sessions with similar URLs or titles using simple keyword matching.
 * @param {string} userId
 * @param {string} pageUrl
 * @param {string} pageTitle
 * @returns {Promise<object[]>} top 3 most relevant past sessions
 */
export async function getRelevantEpisodic(userId, pageUrl, pageTitle) {
  const sessions = await loadEpisodicSessions(userId, MAX_EPISODIC_ENTRIES);
  if (sessions.length === 0) return [];

  // Extract keywords from URL and title
  const keywords = extractKeywords(`${pageUrl} ${pageTitle}`);
  if (keywords.length === 0) return sessions.slice(0, 3);

  // Score each session by keyword overlap
  const scored = sessions.map(session => {
    const sessionText = `${session.url || ''} ${session.intent || ''} ${session.outcome || ''}`;
    const sessionKeywords = extractKeywords(sessionText);
    const overlap = keywords.filter(kw => sessionKeywords.includes(kw)).length;
    return { session, score: overlap };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map(s => s.session);
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'between',
  'through', 'and', 'or', 'but', 'not', 'no', 'nor', 'so', 'yet',
  'this', 'that', 'these', 'those', 'it', 'its', 'http', 'https', 'www', 'com'
]);

function extractKeywords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Clear a specific memory layer or all layers.
 * @param {string} userId
 * @param {'semantic'|'episodic'|'procedural'|'all'} layer
 */
export async function clearMemory(userId, layer) {
  if (layer === 'semantic' || layer === 'all') {
    await chrome.storage.sync.remove('memoryProfile');
  }
  if (layer === 'episodic' || layer === 'all') {
    try {
      const sessions = await firestoreQuery('chatSessions', 'userId', 'EQUAL', userId);
      await Promise.all(sessions.map(s => firestoreDeleteDoc('chatSessions', s.sessionId)));
    } catch (err) {
      console.warn('[memory-system] Failed to clear episodic memory:', err.message);
    }
  }
  if (layer === 'procedural' || layer === 'all') {
    await chrome.storage.local.remove('proceduralMemory');
  }
}

/**
 * Parse an LLM response string into a JSON object, stripping markdown fences.
 * Returns the fallback value on failure.
 * @param {string|object} response
 * @param {*} fallback
 * @returns {object}
 */
export function parseLLMJson(response, fallback = null) {
  if (!response) return fallback;
  try {
    const text = typeof response === 'string' ? response : (response.result || response.text || response.content || '');
    const cleaned = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return fallback;
  }
}

/**
 * Extract an agent name from an agent trace entry (string or object).
 * @param {string|object} agent
 * @returns {string}
 */
export function resolveAgentName(agent) {
  if (typeof agent === 'string') return agent;
  return (agent && agent.name) || '';
}

/**
 * Export all memory layers as a JSON object for the memory dashboard.
 * @param {string} userId
 * @returns {Promise<object>}
 */
export async function exportMemory(userId) {
  const { semantic, episodic, procedural } = await loadMemory(userId);
  return {
    semantic,
    episodic,
    procedural,
    exportedAt: new Date().toISOString(),
    userId
  };
}
