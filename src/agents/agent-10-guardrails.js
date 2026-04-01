import { callLLM } from '../utils/llm-dispatch.js';
import { loadPrompt } from '../utils/prompt-loader.js';

export const name = 'guardrails';
export const phase = 5;
export const optional = false;
export const requiredFields = ['renarrations'];

function sanitizeHtml(text) {
  return text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^>]*>.*?<\/iframe>/gi, '')
    .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/<\/?(?:script|iframe|object|embed|form|input|button)\b[^>]*>/gi, '');
}

/** Sanitizes renarrated text in-place and returns flags for any stripped XSS content. */
function runXssSanitization(renarrations) {
  const flags = [];

  for (const section of renarrations) {
    const original = section.text || '';
    const sanitized = sanitizeHtml(original);

    if (sanitized !== original) {
      flags.push({
        sectionId: section.sectionId,
        type: 'xss',
        severity: 'error',
        detail: 'Potentially dangerous HTML content was detected and removed',
        suggestion: 'Review the source content for embedded scripts or unsafe markup'
      });
      section.text = sanitized;
    }
  }

  return flags;
}

function buildComparisonPayload(renarrations, sectionMap) {
  const pairs = renarrations.map(section => {
    const originalSection = sectionMap?.[section.sectionId];
    const originalText = originalSection?.text || originalSection?.content || '';
    return `--- Section: ${section.sectionId} ---\nORIGINAL:\n${originalText}\n\nRENARRATED:\n${section.text || ''}`;
  });
  return pairs.join('\n\n');
}

async function runLlmChecks(renarrations, sectionMap, promptTemplate) {
  const comparisonPayload = buildComparisonPayload(renarrations, sectionMap);

  const response = await callLLM(
    [{ role: 'user', content: `${promptTemplate}\n\n## Content to Check\n\n${comparisonPayload}` }],
    'You are a guardrails agent. Check for hallucinations, bias, and safety issues. Return a JSON array of flags.',
    { tier: 'fast' }
  );

  try {
    if (!response?.success) throw new Error(response?.error || 'LLM call failed');
    const text = response.result || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.warn('Guardrails: failed to parse LLM response:', err?.message);
    return [];
  }
}

export async function run(context) {
  const startTime = Date.now();

  const renarrations = context.renarrations || [];
  const sectionMap = context.sectionMap || {};

  const promptTemplate = await loadPrompt('guardrails-check');

  // XSS sanitization runs synchronously first (mutates renarrations in-place),
  // then LLM checks run on the already-sanitized text
  const xssFlags = runXssSanitization(renarrations);
  const llmFlags = await runLlmChecks(renarrations, sectionMap, promptTemplate);

  const allFlags = [...xssFlags, ...llmFlags];

  const hasErrors = allFlags.some(flag => flag.severity === 'error');

  context.guardrails = {
    passed: !hasErrors,
    flags: allFlags
  };

  context.log = context.log || [];
  context.log.push({
    agent: name,
    phase,
    durationMs: Date.now() - startTime,
    flagCount: allFlags.length,
    passed: !hasErrors
  });

  return context;
}
