import { callLLM } from '../utils/llm-dispatch.js';
import { loadPrompt } from '../utils/prompt-loader.js';

export const name = 'quality-validator';
export const phase = 5;
export const optional = false;
export const requiredFields = ['renarrations', 'intent'];

const PASS_THRESHOLD = 3.5;
const MAX_RETRIES = 2;

function buildRenarrationPayload(renarrations) {
  return renarrations.map(section =>
    `--- Section: ${section.sectionId} ---\n${section.text || ''}`
  ).join('\n\n');
}

function buildOriginalPayload(sectionMap) {
  return Object.entries(sectionMap).map(([id, section]) =>
    `--- Section: ${id} ---\n${section.text || section.content || ''}`
  ).join('\n\n');
}

function formatFailureMemory(failureMemory) {
  if (!failureMemory || failureMemory.length === 0) {
    return 'No previous attempts.';
  }
  return `Previous attempts tried: [${failureMemory.join(' — ')}]. Do NOT repeat these approaches.`;
}

export async function run(context) {
  const startTime = Date.now();

  const renarrations = context.renarrations || [];
  const sectionMap = context.sectionMap || {};
  const intent = context.intent || {};
  const renarrationPlan = context.renarrationPlan || {};

  // Carry over failure memory from previous validation attempts
  const previousValidation = context.validation || {};
  const retryCount = previousValidation.retryCount || 0;
  const failureMemory = previousValidation.failureMemory || [];

  const promptTemplate = await loadPrompt('quality-validation');

  // Replace the failure memory placeholder in the prompt
  const failureMemoryText = formatFailureMemory(failureMemory);
  const prompt = promptTemplate.replace('{{failureMemory}}', failureMemoryText);

  const renarrationPayload = buildRenarrationPayload(renarrations);
  const originalPayload = buildOriginalPayload(sectionMap);

  const fullPrompt = [
    prompt,
    '\n## User Intent\n',
    `Goal: ${intent.goal || 'Not specified'}`,
    `Task: ${intent.task || 'Not specified'}`,
    `Persona: ${intent.persona || 'Not specified'}`,
    intent.confidenceScore != null ? `Confidence: ${intent.confidenceScore}` : '',
    '\n## Renarration Plan\n',
    JSON.stringify(renarrationPlan, null, 2),
    '\n## Original Content\n',
    originalPayload,
    '\n## Renarrated Content\n',
    renarrationPayload
  ].filter(Boolean).join('\n');

  const response = await callLLM(
    [{ role: 'user', content: fullPrompt }],
    'You are a quality validation agent. Evaluate the renarration and return JSON with scores and flagged sections.',
    { tier: 'quality' }
  );

  let scores = { coherence: 0, coverage: 0, intentAlignment: 0, toneConsistency: 0 };
  let flaggedSections = [];

  try {
    if (!response?.success) throw new Error(response?.error || 'LLM call failed');
    const text = response.result || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.scores) {
        scores = {
          coherence: parsed.scores.coherence || 0,
          coverage: parsed.scores.coverage || 0,
          intentAlignment: parsed.scores.intentAlignment || 0,
          toneConsistency: parsed.scores.toneConsistency || 0
        };
      }
      if (Array.isArray(parsed.flaggedSections)) {
        flaggedSections = parsed.flaggedSections;
      }
    }
  } catch (err) {
    console.warn('Quality validator: failed to parse LLM response:', err?.message);
  }

  const averageScore = (
    scores.coherence + scores.coverage +
    scores.intentAlignment + scores.toneConsistency
  ) / 4;

  const passed = averageScore >= PASS_THRESHOLD;
  const parseError = scores.coherence === 0 && scores.coverage === 0;

  // Build updated failure memory if validation failed
  const updatedFailureMemory = [...failureMemory];
  if (!passed && flaggedSections.length > 0) {
    const summary = flaggedSections
      .map(f => f.suggestion || f.issue)
      .filter(Boolean)
      .join('; ');
    if (summary) {
      updatedFailureMemory.push(summary);
    }
  }

  context.validation = {
    scores: { ...scores, averageScore },
    passed,
    parseError,
    retryCount,
    failureMemory: updatedFailureMemory,
    flaggedSections
  };

  // Retry signal: if failed and under retry limit, signal orchestrator to re-plan
  if (!passed && retryCount < MAX_RETRIES) {
    context.validation.retryCount = retryCount + 1;
    context.needsRetry = true;
    context.replanSignal = {
      flaggedSections: flaggedSections.map(f => ({
        sectionId: f.sectionId,
        suggestedStrategy: f.suggestion || null,
        suggestedFleschTarget: null,
        issue: f.issue
      })),
      failureMemory: updatedFailureMemory
    };
  }

  // Human-in-the-loop: if intent confidence is low, request user confirmation
  if (intent.confidenceScore != null && intent.confidenceScore < 0.5) {
    context.needsUserConfirmation = true;
  }

  context.log = context.log || [];
  context.log.push({
    agent: name,
    phase,
    durationMs: Date.now() - startTime,
    averageScore,
    passed,
    retryCount: context.validation.retryCount || retryCount,
    flaggedSectionCount: flaggedSections.length
  });

  return context;
}
