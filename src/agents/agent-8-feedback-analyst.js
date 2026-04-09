// Agent 8 — Feedback Analyst
// Called on-demand when user submits feedback (not part of the main pipeline).
// Analyzes feedback to extract preference and procedural updates.

import { callLLM } from '../utils/llm-dispatch.js';
import { loadPrompt } from '../utils/prompt-loader.js';
import { updateSemantic, updateProcedural, parseLLMJson, resolveAgentName } from '../utils/memory-system.js';

export const name = 'feedback-analyst';
export const phase = 6;
export const optional = true;
export const requiredFields = [];

/**
 * Analyze user feedback and extract preference/procedural updates.
 * @param {object} feedbackEvent — { type, originalText, renarratedText, correctedText, sectionId }
 * @param {object} context — pipeline context with userId, agentTrace, etc.
 * @returns {{ preferenceUpdates: object, proceduralUpdates: Array<{agentName:string, rule:string, confidence:number}> }}
 */
export async function run(feedbackEvent, context) {
  const userId = context.userId || 'default';

  if (feedbackEvent.type === 'thumbs-up') {
    return handleThumbsUp(userId, feedbackEvent, context);
  }

  if (feedbackEvent.type === 'thumbs-down' && !feedbackEvent.correctedText) {
    return handleThumbsDown(userId, feedbackEvent, context);
  }

  // Correction feedback — the richest signal
  if (feedbackEvent.type === 'correction' || feedbackEvent.correctedText) {
    return handleCorrection(userId, feedbackEvent, context);
  }

  return { preferenceUpdates: {}, proceduralUpdates: [] };
}

// ---------------------------------------------------------------------------
// Thumbs-up: positive reinforcement
// ---------------------------------------------------------------------------

async function handleThumbsUp(userId, feedbackEvent, context) {
  const result = { preferenceUpdates: {}, proceduralUpdates: [] };
  const agentTrace = context.agentTrace || [];

  // Reinforce the strategies used by each agent
  for (const agent of agentTrace) {
    const agentName = resolveAgentName(agent);
    if (!agentName) continue;

    const rule = {
      rule: `User approved output for section: ${(feedbackEvent.sectionId || 'general').slice(0, 80)}`,
      confidence: 0.7,
      source: 'feedback'
    };
    await updateProcedural(userId, agentName, rule);
    result.proceduralUpdates.push({ agentName, ...rule });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Thumbs-down without correction: negative signal
// ---------------------------------------------------------------------------

async function handleThumbsDown(userId, feedbackEvent, context) {
  const result = { preferenceUpdates: {}, proceduralUpdates: [] };
  const agentTrace = context.agentTrace || [];

  for (const agent of agentTrace) {
    const agentName = resolveAgentName(agent);
    if (!agentName) continue;

    const rule = {
      rule: `User rejected output for section: ${(feedbackEvent.sectionId || 'general').slice(0, 80)}`,
      confidence: 0.5,
      source: 'feedback'
    };
    await updateProcedural(userId, agentName, rule);
    result.proceduralUpdates.push({ agentName, ...rule });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Correction: diff original vs corrected and extract preferences via LLM
// ---------------------------------------------------------------------------

async function handleCorrection(userId, feedbackEvent, context) {
  const result = { preferenceUpdates: {}, proceduralUpdates: [] };

  const original = feedbackEvent.renarratedText || feedbackEvent.originalText || '';
  const corrected = feedbackEvent.correctedText || '';

  if (!original || !corrected) return result;

  // Load the feedback-analysis prompt template
  let promptTemplate;
  try {
    promptTemplate = await loadPrompt('feedback-analysis');
  } catch {
    // Fallback inline prompt if the template file is not available
    promptTemplate = FALLBACK_PROMPT;
  }

  const prompt = promptTemplate
    .replace('{{originalText}}', original.slice(0, 1000))
    .replace('{{correctedText}}', corrected.slice(0, 1000));

  let analysis;
  try {
    const response = await callLLM(
      [{ role: 'user', content: prompt }],
      '',
      { maxTokens: 500, temperature: 0.2 }
    );
    if (!response.success) throw new Error(response.error || 'LLM call failed');
    analysis = parseFeedbackResponse(response.result);
  } catch (err) {
    console.warn('[feedback-analyst] LLM analysis failed:', err.message);
    return result;
  }

  // Apply preference updates to semantic memory
  for (const pref of analysis.preferences) {
    const update = {};
    const field = mapPreferenceTypeToField(pref.type);
    if (!field) continue;

    if (field === 'terminologyPreferences') {
      update.terminologyPreferences = {
        preferred: pref.type === 'terminology' && pref.value ? [pref.value] : [],
        avoided: []
      };
    } else {
      update[field] = pref.value;
    }

    const confidence = pref.confidence || 'medium';
    await updateSemantic(userId, update, confidence);
    result.preferenceUpdates[field] = pref.value;
  }

  // Apply procedural updates
  for (const rule of analysis.rules) {
    const agentName = rule.agent || 'general';
    const entry = {
      rule: rule.rule,
      confidence: rule.confidence || 0.6,
      source: 'feedback'
    };
    await updateProcedural(userId, agentName, entry);
    result.proceduralUpdates.push({ agentName, ...entry });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapPreferenceTypeToField(type) {
  const map = {
    tone: 'preferredTone',
    length: 'preferredLength',
    vocabulary: 'expertiseLevel',
    structure: 'preferredLength',
    terminology: 'terminologyPreferences',
    style: 'preferredTone'
  };
  return map[type] || null;
}

function parseFeedbackResponse(response) {
  const empty = { preferences: [], rules: [] };
  const parsed = parseLLMJson(response, empty);
  return {
    preferences: Array.isArray(parsed.preferences) ? parsed.preferences : [],
    rules: Array.isArray(parsed.rules) ? parsed.rules : []
  };
}

const FALLBACK_PROMPT = `You are analyzing a user's edit to a renarrated text to understand their preferences.

Original renarration:
{{originalText}}

User's corrected version:
{{correctedText}}

Identify what the user changed and why. Return ONLY valid JSON (no markdown fences):
{
  "preferences": [
    { "type": "tone|length|vocabulary|structure|terminology|style", "value": "inferred value", "confidence": "low|medium|high" }
  ],
  "rules": [
    { "agent": "agent name or general", "rule": "what to do or avoid", "confidence": 0.6 }
  ]
}

Patterns to look for:
- Shortening text -> "prefers punchy, concise text"
- Replacing jargon with simpler words -> "lower technicality"
- Adding specific phrases -> "wants this terminology included"
- Restructuring into bullets -> "prefers bullet-point format"
- Changing tone from formal to casual -> "prefers casual tone"
If no clear pattern, return empty arrays.`;
