import { callLLM } from '../utils/llm-dispatch.js';
import { loadPrompt } from '../utils/prompt-loader.js';
import { run as generateDiagram, disabled as diagramDisabled } from './agent-5-diagram-generator.js';

export const name = 'narrator';
export const phase = 4;
export const optional = false;
export const requiredFields = ['intent', 'sectionMap'];

const CONCURRENCY = 5;

const DIAGRAM_ROLES = ['code-block', 'data-table', 'feature-list'];

/**
 * Build the per-section prompt by filling in the narrator-section template.
 */
function buildSectionPrompt(template, section, sectionPlan, context) {
  const strategy = sectionPlan?.strategy || 'rewrite';
  const intent = context.intent || {};
  const terminology = context.globalTerminology || { preferred: [], avoided: [] };

  return template
    .replace('{{SECTION_TEXT}}', section.text || '')
    .replace('{{SECTION_ROLE}}', section.role || 'paragraph')
    .replace('{{STRATEGY}}', strategy)
    .replace('{{GOAL}}', intent.goal || 'rewrite for clarity')
    .replace('{{DEPTH}}', intent.depth || 'moderate')
    .replace('{{OUTPUT_STYLE}}', intent.outputStyle || 'rewrite')
    .replace('{{PREFERRED_TERMS}}', terminology.preferred?.join(', ') || 'none')
    .replace('{{AVOIDED_TERMS}}', terminology.avoided?.join(', ') || 'none');
}

/**
 * Narrate a single section by calling the LLM.
 * Returns the renarrated text string.
 */
async function narrateSection(section, sectionPlan, context, template) {
  const prompt = buildSectionPrompt(template, section, sectionPlan, context);
  const messages = [{ role: 'user', content: prompt }];
  const systemPrompt = context.persona?.systemAddendum || '';

  const response = await callLLM(messages, systemPrompt, { tier: 'quality' });

  if (response.success && response.result) {
    return response.result.trim();
  }

  throw new Error(response.error || 'LLM returned no result');
}

/**
 * Generate N variants, self-score each, and return the best.
 */
async function narrateWithBestOfN(section, sectionPlan, context, template) {
  const variants = await Promise.all([
    narrateSection(section, sectionPlan, context, template),
    narrateSection(section, sectionPlan, context, template),
    narrateSection(section, sectionPlan, context, template)
  ]);

  // Self-score each variant
  const scorePrompt = `Rate the following renarration on a scale of 1-5 for clarity, faithfulness, and style. Return ONLY a number.\n\nOriginal: ${section.text}\n\nRenarration: `;
  const scores = await Promise.all(
    variants.map(async (variant) => {
      try {
        const messages = [{ role: 'user', content: scorePrompt + variant }];
        const res = await callLLM(messages, '', { tier: 'fast' });
        if (res.success && res.result) {
          const score = parseFloat(res.result.trim());
          return Number.isFinite(score) ? score : 3;
        }
        return 3;
      } catch {
        return 3;
      }
    })
  );

  let bestIdx = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] > scores[bestIdx]) bestIdx = i;
  }

  return { text: variants[bestIdx], variants, selectedVariant: bestIdx };
}

/**
 * Process a single section: narrate it, optionally generate a diagram.
 */
async function processSection(section, context, template) {
  const plan = context.renarrationPlan;
  const sectionPlan = plan ? plan.find(p => p.sectionId === section.id) : null;

  let text;
  let variants = null;
  let selectedVariant = null;

  if (sectionPlan?.bestOfN) {
    const best = await narrateWithBestOfN(section, sectionPlan, context, template);
    text = best.text;
    variants = best.variants;
    selectedVariant = best.selectedVariant;
  } else {
    text = await narrateSection(section, sectionPlan, context, template);
  }

  // Check if this section benefits from a diagram (skipped when disabled)
  let mermaid = null;
  if (!diagramDisabled && DIAGRAM_ROLES.includes(section.role)) {
    try {
      const diagramResult = await generateDiagram(section.text, context);
      mermaid = diagramResult.mermaid || null;
    } catch {
      // Diagram generation is optional; skip on failure
    }
  }

  return {
    sectionId: section.id,
    originalText: section.text || '',
    text,
    mermaid,
    variants,
    selectedVariant
  };
}

/**
 * Agent 4 -- Narrator
 *
 * Takes each section from the section map and produces renarrated text,
 * processing sections in parallel batches. For eligible sections, also
 * triggers Agent 5 (Diagram Generator).
 */
export async function run(context) {
  const start = Date.now();
  context.log = context.log || [];

  let template;
  try {
    template = await loadPrompt('narrator-section');
  } catch {
    template = 'Rewrite the following section.\n\nSection role: {{SECTION_ROLE}}\nStrategy: {{STRATEGY}}\nGoal: {{GOAL}}\nDepth: {{DEPTH}}\nOutput style: {{OUTPUT_STYLE}}\nPreferred terms: {{PREFERRED_TERMS}}\nAvoided terms: {{AVOIDED_TERMS}}\n\nText:\n{{SECTION_TEXT}}';
  }

  const sectionMap = context.sectionMap || [];
  const sections = Array.isArray(sectionMap) ? sectionMap : Object.values(sectionMap);

  const renarrations = [];

  for (let i = 0; i < sections.length; i += CONCURRENCY) {
    const batch = sections.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (section) => {
        try {
          return await processSection(section, context, template);
        } catch {
          // Fallback: return original text with a note
          return {
            sectionId: section.id,
            originalText: section.text || '',
            text: `[Renarration unavailable] ${section.text || ''}`,
            mermaid: null,
            variants: null,
            selectedVariant: null
          };
        }
      })
    );

    // Progressive streaming: send each completed section to content script
    for (const result of results) {
      renarrations.push(result);

      if (context.tabId) {
        try {
          chrome.tabs.sendMessage(context.tabId, {
            action: 'section-renarrated',
            sectionId: result.sectionId,
            text: result.text,
            mermaid: result.mermaid
          });
        } catch {
          // Tab may have been closed; ignore
        }
      }
    }
  }

  context.renarrations = renarrations;

  context.log.push({
    agent: name,
    durationMs: Date.now() - start,
    success: true,
    detail: `Narrated ${renarrations.length} sections (concurrency=${CONCURRENCY})`
  });

  return context;
}
