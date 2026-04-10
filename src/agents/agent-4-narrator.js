import { callLLM } from '../utils/llm-dispatch.js';
import { loadPrompt } from '../utils/prompt-loader.js';

export const name = 'narrator';
export const phase = 4;
export const optional = false;
export const requiredFields = ['intent', 'sectionMap'];

const CONCURRENCY = 8;

/**
 * Map literacy level to a concrete writing instruction for the narrator.
 */
function getLiteracyInstruction(literacyLevel) {
  if (literacyLevel === 'low') {
    return 'IMPORTANT: Write for a reader with low literacy. Use very short sentences (max 10 words). Use only common everyday words. No jargon, no complex grammar. Explain any concept as if to someone unfamiliar with the topic.';
  }
  if (literacyLevel === 'high') {
    return 'Write for an advanced reader. Use precise technical vocabulary where appropriate. Maintain academic rigor and nuanced analysis.';
  }
  return 'Write for a general audience with moderate literacy. Use clear, straightforward language.';
}

/**
 * Build the per-section prompt by filling in the narrator-section template.
 */
function buildSectionPrompt(template, section, context) {
  const intent = context.intent || {};
  const literacyLevel = intent.literacyLevel || 'moderate';

  return template
    .replace('{{SECTION_TEXT}}', section.text || '')
    .replace('{{SECTION_ROLE}}', section.role || 'paragraph')
    .replace('{{STRATEGY}}', 'rewrite')
    .replace('{{GOAL}}', intent.goal || 'rewrite for clarity')
    .replace('{{DEPTH}}', intent.depth || 'moderate')
    .replace('{{OUTPUT_STYLE}}', intent.outputStyle || 'rewrite')
    .replace('{{LITERACY_LEVEL}}', literacyLevel)
    .replace('{{LITERACY_INSTRUCTION}}', getLiteracyInstruction(literacyLevel));
}

/**
 * Narrate a single section by calling the LLM.
 */
async function narrateSection(section, context, template) {
  const prompt = buildSectionPrompt(template, section, context);
  const messages = [{ role: 'user', content: prompt }];
  const lang = context.intent?.language;
  const systemPrompt = lang && lang !== 'en'
    ? `IMPORTANT: Write the renarration in ${lang}.`
    : '';

  const response = await callLLM(messages, systemPrompt, { tier: 'quality' });

  if (response.success && response.result) {
    return response.result.trim();
  }

  throw new Error(response.error || 'LLM returned no result');
}

/**
 * Agent 4 -- Narrator
 *
 * Takes each non-excluded section from the section map and produces
 * renarrated text, processing sections in parallel batches.
 */
export async function run(context) {
  const start = Date.now();
  context.log = context.log || [];

  let template;
  try {
    template = await loadPrompt('narrator-section');
  } catch {
    template = 'Rewrite the following section.\n\nSection role: {{SECTION_ROLE}}\nStrategy: {{STRATEGY}}\nGoal: {{GOAL}}\nDepth: {{DEPTH}}\nOutput style: {{OUTPUT_STYLE}}\nLiteracy level: {{LITERACY_LEVEL}}\n{{LITERACY_INSTRUCTION}}\n\nText:\n{{SECTION_TEXT}}';
  }

  // Filter out excluded sections (nav, footer, cookie banners, etc.)
  const allSections = context.sectionMap || [];
  const sections = allSections.filter(s => !s.excluded);

  const renarrations = [];

  for (let i = 0; i < sections.length; i += CONCURRENCY) {
    const batch = sections.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (section) => {
        try {
          const text = await narrateSection(section, context, template);
          return {
            sectionId: section.id,
            originalText: section.text || '',
            text,
          };
        } catch {
          return {
            sectionId: section.id,
            originalText: section.text || '',
            text: `[Renarration unavailable] ${section.text || ''}`,
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
    detail: `Narrated ${renarrations.length}/${allSections.length} sections (${allSections.length - sections.length} excluded, concurrency=${CONCURRENCY})`
  });

  return context;
}
