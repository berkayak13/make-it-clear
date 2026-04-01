// Agent 7 — Memory Manager
// Runs post-pipeline to update all three memory layers based on session results.

import {
  loadMemory,
  updateSemantic,
  appendEpisodic,
  updateProcedural,
  parseLLMJson,
  resolveAgentName
} from '../utils/memory-system.js';
import { callLLM } from '../utils/llm-dispatch.js';

export const name = 'memory-manager';
export const phase = 6;
export const optional = true;
export const requiredFields = ['renarrations'];

const PREFERENCE_EXTRACTION_PROMPT = `You are a preference-extraction assistant. Given the following renarration session data, identify any durable user preferences that can be inferred.

Session data:
- User request: {{rawRequest}}
- Detected intent: {{intent}}
- Renarration output (first 500 chars): {{renarrationPreview}}
{{#validationNote}}- Validation feedback: {{validationNote}}{{/validationNote}}

Respond with ONLY valid JSON (no markdown fences). Use this schema:
{
  "preferences": [
    {
      "field": "preferredTone|preferredLength|expertiseLevel|role|domains|languages",
      "value": "the inferred value",
      "confidence": "low|medium|high"
    }
  ]
}

Rules:
- Only include preferences you can confidently infer from the data.
- If the user explicitly states a preference, mark confidence as "high".
- If it is implied by repeated patterns, use "medium".
- If it is a weak signal from a single request, use "low".
- If no preferences can be inferred, return {"preferences":[]}.`;

/**
 * Run the memory manager agent after a successful renarration pipeline.
 * @param {object} context — pipeline context with renarrations, intent, validation, rawRequest, userId
 * @returns {object} mutated context with context.memory updated
 */
export async function run(context) {
  const userId = context.userId || 'default';
  const startTime = Date.now();

  // Load current memory state
  const memory = await loadMemory(userId);
  context.memory = memory;

  // 1. Update Episodic — save session summary
  const sessionSummary = {
    sessionId: context.sessionId || undefined,
    timestamp: Date.now(),
    url: context.pageUrl || context.url || '',
    intent: summarizeIntent(context.intent),
    outcome: summarizeOutcome(context),
    duration: context.pipelineDuration || 0
  };
  await appendEpisodic(userId, sessionSummary);

  // 2. Update Semantic — extract durable preferences via LLM
  try {
    const preferences = await extractPreferences(context);
    for (const pref of preferences) {
      const update = {};
      if (pref.field === 'domains' || pref.field === 'languages') {
        update[pref.field] = Array.isArray(pref.value) ? pref.value : [pref.value];
      } else {
        update[pref.field] = pref.value;
      }
      await updateSemantic(userId, update, pref.confidence);
    }
  } catch (err) {
    console.warn('[memory-manager] Preference extraction failed:', err.message);
  }

  // 3. Update Procedural — record what worked or failed based on validation
  try {
    await updateProceduralFromValidation(userId, context);
  } catch (err) {
    console.warn('[memory-manager] Procedural update failed:', err.message);
  }

  // Reload memory after updates
  context.memory = await loadMemory(userId);
  context.memory.lastUpdated = new Date().toISOString();
  context.memory.updateDuration = Date.now() - startTime;

  return context;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarizeIntent(intent) {
  if (!intent) return '';
  if (typeof intent === 'string') return intent;
  return intent.summary || intent.goal || JSON.stringify(intent).slice(0, 200);
}

function summarizeOutcome(context) {
  if (context.validation && context.validation.overallScore) {
    return `score:${context.validation.overallScore}`;
  }
  if (context.renarrations && context.renarrations.length > 0) {
    return 'completed';
  }
  return 'unknown';
}

async function extractPreferences(context) {
  const renarrationPreview = getRenarrationPreview(context.renarrations);
  const rawRequest = context.rawRequest || context.selectedText || '';
  const intent = summarizeIntent(context.intent);
  const validationNote = context.validation
    ? (context.validation.feedback || context.validation.notes || '')
    : '';

  const prompt = PREFERENCE_EXTRACTION_PROMPT
    .replace('{{rawRequest}}', rawRequest.slice(0, 300))
    .replace('{{intent}}', intent.slice(0, 200))
    .replace('{{renarrationPreview}}', renarrationPreview)
    .replace(/\{\{#validationNote\}\}(.*?)\{\{\/validationNote\}\}/s,
      validationNote ? `$1`.replace('{{validationNote}}', validationNote.slice(0, 200)) : ''
    );

  const response = await callLLM(prompt, { maxTokens: 300, temperature: 0.2 });
  return parsePreferenceResponse(response);
}

function getRenarrationPreview(renarrations) {
  if (!renarrations || renarrations.length === 0) return '(none)';
  const first = renarrations[0];
  const text = typeof first === 'string' ? first : (first.text || first.content || JSON.stringify(first));
  return text.slice(0, 500);
}

const VALID_PREF_FIELDS = new Set([
  'preferredTone', 'preferredLength', 'expertiseLevel',
  'role', 'domains', 'languages'
]);
const VALID_CONFIDENCES = new Set(['low', 'medium', 'high']);

function parsePreferenceResponse(response) {
  const parsed = parseLLMJson(response, { preferences: [] });
  const prefs = parsed.preferences || [];
  return prefs.filter(p =>
    p.field && VALID_PREF_FIELDS.has(p.field) &&
    p.value !== undefined &&
    VALID_CONFIDENCES.has(p.confidence)
  );
}

async function updateProceduralFromValidation(userId, context) {
  const validation = context.validation;
  if (!validation || typeof validation.overallScore !== 'number') return;

  const score = validation.overallScore;
  const agentTrace = context.agentTrace || [];

  if (score >= 4.0) {
    // High quality — record positive signals
    for (const agent of agentTrace) {
      const agentName = resolveAgentName(agent);
      if (!agentName) continue;
      await updateProcedural(userId, agentName, {
        rule: `Strategy effective for intent: ${summarizeIntent(context.intent).slice(0, 100)}`,
        confidence: Math.min(score / 5, 1),
        source: 'implicit'
      });
    }
  } else if (score <= 2.5) {
    // Low quality — record negative signals
    const feedback = validation.feedback || validation.notes || 'low quality output';
    for (const agent of agentTrace) {
      const agentName = resolveAgentName(agent);
      if (!agentName) continue;
      await updateProcedural(userId, agentName, {
        rule: `Avoid: ${feedback.slice(0, 100)}`,
        confidence: 0.4,
        source: 'implicit'
      });
    }
  }
}
