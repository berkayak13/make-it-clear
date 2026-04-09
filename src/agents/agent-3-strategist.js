import { callLLM } from '../utils/llm-dispatch.js';
import { loadPrompt } from '../utils/prompt-loader.js';
import { fleschKincaidGradeLevel } from '../utils/readability.js';

export const name = 'content-strategist';
export const phase = 3;
export const optional = true; // skipped in 'translate' pipeline
export const requiredFields = ['intent', 'sectionMap'];

/**
 * Roles that should be marked for best-of-N generation.
 */
const BEST_OF_N_ROLES = new Set(['headline', 'hero-banner', 'cta']);

/**
 * Roles that should be skipped entirely.
 */
const SKIP_ROLES = new Set(['nav', 'footer']);

/**
 * Map intent depth to Flesch-Kincaid grade-level target range.
 */
const DEPTH_GRADE_RANGES = {
  brief: [6, 8],
  moderate: [8, 10],
  detailed: [12, 14],
};

/**
 * Strip ```json fences and parse JSON from an LLM response string.
 */
function parseJSON(raw) {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(cleaned);
}

/**
 * Determine the Flesch-Kincaid grade-level target for a section based on
 * intent depth and optional persona hints.
 */
function resolveFleschTarget(intent, memory) {
  // Literacy level takes precedence over depth-based logic
  const literacyLevel = intent?.literacyLevel || 'moderate';
  if (literacyLevel === 'low') return 5;   // midpoint of grade 4-6
  if (literacyLevel === 'high') return 13;  // midpoint of grade 12-14

  const persona = memory?.semantic?.personaType || memory?.personaType || null;

  if (persona) {
    const lower = persona.toLowerCase();
    if (lower.includes('beginner') || lower.includes('child') || lower.includes('kid')) {
      return 7; // midpoint of 6-8
    }
    if (lower.includes('expert') || lower.includes('researcher') || lower.includes('academic')) {
      return 13; // midpoint of 12-14
    }
  }

  const range = DEPTH_GRADE_RANGES[intent.depth] || DEPTH_GRADE_RANGES.moderate;
  return Math.round((range[0] + range[1]) / 2);
}

/**
 * Build a compact preview of a section for inclusion in the LLM prompt.
 * Truncates text to keep token usage manageable.
 */
function sectionPreview(section) {
  const text = section.text || section.textContent || '';
  const preview = text.length > 300 ? text.slice(0, 300) + '...' : text;
  return {
    id: section.id,
    role: section.role || 'body',
    importance: section.importance ?? 'normal',
    excluded: section.excluded || false,
    textPreview: preview,
  };
}

/**
 * Generate a simple fallback plan when the LLM call fails.
 * Every non-excluded, non-skip section gets strategy "rewrite" with defaults.
 */
function buildFallbackPlan(sectionMap, fleschTarget, literacyLevel) {
  const plan = [];
  for (const section of sectionMap) {
    const role = section.role || 'body';

    if (section.excluded || SKIP_ROLES.has(role)) {
      plan.push({
        sectionId: section.id,
        strategy: 'skip',
        fleschTarget: null,
        wordCountTarget: null,
        bestOfN: false,
        terminology: { use: [], avoid: [] },
        priority: 0,
      });
      continue;
    }

    // For low literacy, use "simplify vocabulary" strategy and shorter word count
    const strategy = literacyLevel === 'low' ? 'simplify vocabulary' : 'rewrite';

    plan.push({
      sectionId: section.id,
      strategy,
      fleschTarget,
      wordCountTarget: null,
      bestOfN: BEST_OF_N_ROLES.has(role),
      terminology: { use: [], avoid: [] },
      priority: BEST_OF_N_ROLES.has(role) ? 10 : 5,
    });
  }
  return plan;
}

/**
 * Validate and normalise a single plan entry parsed from LLM output.
 */
function normalisePlanEntry(entry, fleschTarget) {
  return {
    sectionId: String(entry.sectionId || ''),
    strategy: typeof entry.strategy === 'string' ? entry.strategy : 'rewrite',
    fleschTarget: typeof entry.fleschTarget === 'number' ? entry.fleschTarget : fleschTarget,
    wordCountTarget: typeof entry.wordCountTarget === 'number' ? entry.wordCountTarget : null,
    bestOfN: typeof entry.bestOfN === 'boolean' ? entry.bestOfN : false,
    terminology: {
      use: Array.isArray(entry.terminology?.use) ? entry.terminology.use : [],
      avoid: Array.isArray(entry.terminology?.avoid) ? entry.terminology.avoid : [],
    },
    priority: typeof entry.priority === 'number' ? entry.priority : 5,
  };
}

/**
 * Merge a replan signal into an existing plan. Sections flagged in the
 * replan signal get their strategies adjusted; others stay unchanged.
 */
function applyReplanSignal(plan, replanSignal) {
  if (!replanSignal || !Array.isArray(replanSignal.flaggedSections)) return plan;

  const flaggedMap = new Map(replanSignal.flaggedSections.map(f => [f.sectionId, f]));

  return plan.map(entry => {
    const flag = flaggedMap.get(entry.sectionId);
    if (!flag) return entry;
    return {
      ...entry,
      strategy: flag.suggestedStrategy || entry.strategy,
      fleschTarget: flag.suggestedFleschTarget ?? entry.fleschTarget,
      bestOfN: true, // always retry with best-of-N on replanned sections
      priority: Math.max(entry.priority, 15), // boost priority
    };
  });
}

/**
 * Agent 3 -- Content Strategist
 *
 * Creates a section-by-section renarration plan that downstream agents
 * (narrator, quality validator) consume. Ensures cross-section coherence,
 * consistent terminology, and measurable quality targets.
 */
export async function run(context) {
  const start = Date.now();
  let usedFallback = false;

  const { intent, sectionMap, memory } = context;
  const fleschTarget = resolveFleschTarget(intent, memory);
  const isIterative = intent.isIterative && Array.isArray(intent.targetSections);
  const targetSet = isIterative ? new Set(intent.targetSections) : null;

  try {
    // --- Build LLM input ------------------------------------------------
    const promptTemplate = await loadPrompt('content-strategy');

    const sectionPreviews = sectionMap.map(sectionPreview);

    // Measure original readability for each section so the LLM can compare
    const sectionReadability = sectionMap.map(s => {
      const text = s.text || s.textContent || '';
      if (text.split(/\s+/).length < 30) return null; // too short to measure
      try { return fleschKincaidGradeLevel(text); } catch { return null; }
    });

    const readabilityInfo = sectionPreviews.map((sp, i) => ({
      ...sp,
      currentGradeLevel: sectionReadability[i],
    }));

    const memoryPrefs = memory?.semantic
      ? JSON.stringify(memory.semantic)
      : 'none';

    // Handle iterative mode: only include target sections in the prompt
    let sectionsForPrompt = readabilityInfo;
    if (isIterative) {
      sectionsForPrompt = readabilityInfo.map(s => ({
        ...s,
        iterativeSkip: !targetSet.has(s.id),
      }));
    }

    const literacyLevel = intent.literacyLevel || 'moderate';

    const filledPrompt = promptTemplate
      .replace('{intent}', JSON.stringify({
        goal: intent.goal,
        depth: intent.depth,
        outputStyle: intent.outputStyle,
        focusAreas: intent.focusAreas,
        isIterative: intent.isIterative || false,
        literacyLevel,
      }))
      .replace('{sectionMap}', JSON.stringify(sectionsForPrompt))
      .replace('{memoryPreferences}', memoryPrefs)
      .replace('{fleschTarget}', String(fleschTarget));

    // --- Call LLM (quality tier) ----------------------------------------
    const llmResponse = await callLLM(
      [{ role: 'user', content: filledPrompt }],
      'You are a content strategist planning a page renarration. Return ONLY valid JSON.',
      { tier: 'quality' }
    );

    const responseText = typeof llmResponse === 'string'
      ? llmResponse
      : llmResponse?.result || JSON.stringify(llmResponse);

    const parsed = parseJSON(responseText);

    // --- Process LLM response -------------------------------------------
    let plan = Array.isArray(parsed.plan) ? parsed.plan : (Array.isArray(parsed) ? parsed : []);
    plan = plan.map(entry => normalisePlanEntry(entry, fleschTarget));

    // Ensure best-of-N is set for critical roles even if LLM missed it
    const sectionRoleMap = new Map(sectionMap.map(s => [s.id, s.role || 'body']));
    for (const entry of plan) {
      const role = sectionRoleMap.get(entry.sectionId);
      if (role && BEST_OF_N_ROLES.has(role)) {
        entry.bestOfN = true;
      }
    }

    // Extract global terminology
    context.globalTerminology = {
      use: Array.isArray(parsed.globalTerminology?.use) ? parsed.globalTerminology.use : [],
      avoid: Array.isArray(parsed.globalTerminology?.avoid) ? parsed.globalTerminology.avoid : [],
    };

    // Apply replan signal if present (from quality validator feedback loop)
    if (context.replanSignal) {
      plan = applyReplanSignal(plan, context.replanSignal);
    }

    // Handle iterative mode: reuse existing plan entries for non-target sections
    if (isIterative && context.renarrationPlan) {
      const newPlanMap = new Map(plan.map(e => [e.sectionId, e]));

      plan = context.renarrationPlan.map(existing => {
        if (targetSet.has(existing.sectionId) && newPlanMap.has(existing.sectionId)) {
          return newPlanMap.get(existing.sectionId);
        }
        return existing;
      });
    }

    context.renarrationPlan = plan;
  } catch (err) {
    // --- Fallback: simple rule-based plan --------------------------------
    usedFallback = true;
    context.renarrationPlan = buildFallbackPlan(sectionMap, fleschTarget, intent.literacyLevel || 'moderate');
    context.globalTerminology = { use: [], avoid: [] };

    // Still apply replan signal to fallback plan
    if (context.replanSignal) {
      context.renarrationPlan = applyReplanSignal(context.renarrationPlan, context.replanSignal);
    }
  }

  // --- Logging ----------------------------------------------------------
  const durationMs = Date.now() - start;
  context.log = context.log || [];
  context.log.push({
    agent: name,
    durationMs,
    success: true,
    detail: usedFallback
      ? 'Used rule-based fallback plan generation'
      : `LLM strategy plan created (${context.renarrationPlan.length} sections)`,
  });

  return context;
}
