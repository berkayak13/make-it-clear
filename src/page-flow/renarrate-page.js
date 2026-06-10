import { callOpenAIText, callOpenAIJson, OPENAI_CONFIG, warmUpConnection } from '../utils/openai-client.js';
import { buildRenarrationPrompt } from '../utils/renarration.js';
import { mapWithConcurrency, callWithRetry } from '../utils/agent-pool.js';
import {
  buildFactLines,
  normalizePlan,
  splitOversizedSections,
  planSectionsLocally,
  assembleRenarration,
} from './renarration-plan.js';

// ── Master / sub-narrator hierarchy ─────────────────────────────────────────
// Small fact sets are narrated by the master in ONE call (no planning
// round-trip to amortize). Above this size the master plans an outline and
// parallel sub-narrators each write one section — wall-clock time becomes the
// plan call plus the SLOWEST section instead of one giant serial generation,
// and no call's output can ever approach a truncating token budget.
const SINGLE_CALL_FACTS_CHARS = 9000;
// Per-sub-narrator input cap. Sections whose facts exceed this are SPLIT into
// "(part N)" siblings — input is sharded across agents, never truncated.
const SECTION_MAX_FACT_CHARS = 7000;
// Sub-narrator calls multiplex over the warm HTTP/2 connection.
const NARRATOR_CONCURRENCY = 6;

// Output budgets. Every text call detects a max_output_tokens truncation and
// retries at double budget (openai-client), so these are floors for speed,
// not silent ceilings on content.
const MAX_RENARRATION_OUTPUT_TOKENS = 16000;
const PLAN_MAX_OUTPUT_TOKENS = 4000;
const SECTION_MIN_OUTPUT_TOKENS = 1500;
const SECTION_MAX_OUTPUT_TOKENS = 8000;

// A section's renarration scales with its facts: roughly mirror the input
// size in tokens, doubled for prose expansion, plus headroom.
function sectionOutputTokens(factChars) {
  const estimated = Math.ceil(factChars / 4) * 2 + 500;
  return Math.max(SECTION_MIN_OUTPUT_TOKENS, Math.min(SECTION_MAX_OUTPUT_TOKENS, estimated));
}

const captionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['captions'],
  properties: {
    captions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'caption'],
        properties: {
          id: { type: 'string' },
          caption: { type: 'string' },
        },
      },
    },
  },
};

const planSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sections'],
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'factNumbers'],
        properties: {
          title: { type: 'string' },
          // 'number', not 'integer': maximally compatible with strict-mode
          // json_schema; normalizePlan drops any non-integer values anyway.
          factNumbers: { type: 'array', items: { type: 'number' } },
        },
      },
    },
  },
};

// Renarrates each image caption so figures on the reading page match the body
// renarration's language and reading goal instead of staying in the original
// page language. Uses the explicit languageRule (derived from readingGoal) so
// this can run IN PARALLEL with the body renarration rather than after it.
// Returns { [imageId]: renarratedCaption }; never throws — on failure the
// builder falls back to the original captions.
async function renarrateImageCaptions({ extraction, readingGoal, languageRule }) {
  const images = Array.isArray(extraction?.images) ? extraction.images : [];
  const items = images
    .map((image) => ({
      id: String(image?.id || '').trim(),
      caption: String(image?.caption || image?.alt || '').trim(),
    }))
    .filter((item) => item.id && item.caption);
  if (!items.length) return {};

  const prompt = [
    'Renarrate each webpage image caption below to match the page renarration.',
    languageRule || 'Write each caption in the same language as the saved reading goal.',
    'Keep each caption short. Preserve factual meaning. Do not invent details.',
    'Return exactly one entry per input id, keeping the id unchanged.',
    '',
    'Saved reading goal:',
    readingGoal || 'No saved reading goal.',
    '',
    'Image captions JSON:',
    JSON.stringify(items),
  ].join('\n');

  try {
    const result = await callOpenAIJson({
      schema: captionSchema,
      schemaName: 'renarrated_image_captions',
      prompt,
      model: OPENAI_CONFIG.fastModel,
      maxOutputTokens: 1200,
      reasoningEffort: 'low',
    });
    const map = {};
    for (const entry of result.json?.captions || []) {
      const id = String(entry?.id || '').trim();
      const text = String(entry?.caption || '').trim();
      if (id && text) map[id] = text;
    }
    return map;
  } catch {
    return {};
  }
}

// Core content rules shared by the master narrator and every sub-narrator.
const NARRATION_RULES = [
  'Your input is a structured list of facts and claims extracted from the page — it is your ONLY content source. This is a COMPREHENSIVE renarration, not a summary: cover EVERY item in the list. Do not skip, drop, or compress away substantive facts, and do not invent anything beyond the list. This requirement OVERRIDES any earlier guidance to omit, condense, shorten, or "avoid transcription" — completeness comes first here.',
  'The saved reading goal is your PRIMARY organizing lens. Lead with the facts most relevant to it, give them the most depth and the clearest framing — but still include every other substantive fact (more briefly) so nothing on the page is lost. Emphasis is set by the goal; coverage stays complete.',
  'Write a DIRECT explanation of the subject itself, in clear natural prose, as if you are explaining the topic to the reader.',
  'Do NOT narrate or describe the source. Never use meta-attribution phrasing such as "the article says", "the author claims", "the page states", "according to the article/author", "the post explains", or "this piece argues". State the information directly as facts about the subject.',
  'Only attribute to a specific person or source when an item is a direct quotation, or a genuinely contested or opinionated claim that would mislead if stated as plain fact — and then name the actual person/source, never "the article" or "the author".',
  'Organize everything into coherent, natural prose with clear progression between topics. Return only readable plain text. Do not return HTML or Markdown tables.',
];

function factsBlock(factLines) {
  return factLines.map((fact) => fact.line).join('\n');
}

function goalAndTitleBlock(promptInfo, pageTitle) {
  return [
    'Saved reading goal:',
    promptInfo.readingGoal || 'No saved reading goal.',
    '',
    `Page: ${pageTitle}`,
  ].join('\n');
}

// Master narrating directly — one call covering the whole (small) fact list.
async function narrateSingleCall({ promptInfo, pageTitle, factLines, extraction }) {
  const systemPrompt = [
    promptInfo.systemPrompt,
    'You are renarrating a FULL webpage into a plain-text reading panel.',
    ...NARRATION_RULES,
  ].filter(Boolean).join('\n\n');

  const content = factLines.length
    ? factsBlock(factLines)
    : String(extraction.compactText || '').trim();
  const userText = [
    goalAndTitleBlock(promptInfo, pageTitle),
    '',
    'Structured facts & claims extracted from the page (your only content source):',
    content,
  ].join('\n');

  const result = await callOpenAIText({
    systemPrompt,
    userText,
    model: OPENAI_CONFIG.textModel,
    reasoningEffort: 'low',
    maxOutputTokens: MAX_RENARRATION_OUTPUT_TOKENS,
  });
  return { text: result.text, userText, sectionCount: 1, agentCount: 1, warnings: [] };
}

// Master planner: assigns every fact number to an outline section, ordered
// around the reading goal. Falls back to the rule-based local partition.
async function planRenarrationSections({ promptInfo, pageTitle, factLines, warnings, onProgress }) {
  onProgress?.('Master narrator is planning sections...');
  const prompt = [
    'You are the MASTER PLANNER of a webpage renarration system. Sub-narrators will each write one section of the renarration from the facts you assign them.',
    'Group the numbered facts below into a coherent outline of 3 to 12 sections.',
    'Assign EVERY fact number to EXACTLY ONE section — no fact may be left out and none may repeat.',
    'Order the sections so content most relevant to the saved reading goal comes first. Group related facts so each section reads as one coherent topic.',
    'Write each section title in the same language the renarration will use.',
    promptInfo.languageRule || '',
    '',
    goalAndTitleBlock(promptInfo, pageTitle),
    '',
    'Numbered facts:',
    factsBlock(factLines),
  ].filter(Boolean).join('\n');

  let plan = null;
  try {
    const result = await callWithRetry(() => callOpenAIJson({
      schema: planSchema,
      schemaName: 'renarration_outline',
      prompt,
      model: OPENAI_CONFIG.fastModel,
      maxOutputTokens: PLAN_MAX_OUTPUT_TOKENS,
      reasoningEffort: 'low',
    }), { retries: 1 });
    plan = normalizePlan(result.json?.sections, factLines.length);
  } catch (error) {
    warnings.push(`Renarration planner failed (${error?.message || error}); using rule-based sections.`);
  }
  if (!plan) plan = planSectionsLocally(factLines, SECTION_MAX_FACT_CHARS);
  return splitOversizedSections(plan, factLines, SECTION_MAX_FACT_CHARS);
}

// One sub-narrator: writes its section's prose from its assigned facts, with
// the full outline as shared context so sections flow into each other.
async function narrateSection({ section, index, sections, promptInfo, pageTitle, factLines }) {
  const outline = sections
    .map((entry, i) => `${i + 1}. ${entry.title || `Section ${i + 1}`}${i === index ? '  <- YOUR SECTION' : ''}`)
    .join('\n');
  const sectionFacts = section.factNumbers.map((number) => factLines[number - 1].line);
  const factChars = sectionFacts.reduce((sum, line) => sum + line.length, 0);

  const systemPrompt = [
    promptInfo.systemPrompt,
    `You are sub-narrator ${index + 1} of ${sections.length} in a webpage renarration system. The master planner assigned you ONE section of the full renarration; other sub-narrators are writing the rest in parallel.`,
    ...NARRATION_RULES,
    'Write ONLY your assigned section\'s body text. Do not write an introduction or conclusion for the whole page, do not summarize other sections, and do not repeat their facts. Do not restate the section title — the assembler adds it.',
  ].filter(Boolean).join('\n\n');

  const userText = [
    goalAndTitleBlock(promptInfo, pageTitle),
    '',
    'Full renarration outline:',
    outline,
    '',
    `Your section: ${section.title || `Section ${index + 1}`}`,
    '',
    'Facts assigned to your section (cover EVERY one):',
    sectionFacts.join('\n'),
  ].join('\n');

  const result = await callWithRetry(() => callOpenAIText({
    systemPrompt,
    userText,
    model: OPENAI_CONFIG.textModel,
    reasoningEffort: 'low',
    maxOutputTokens: sectionOutputTokens(factChars),
  }), { retries: 1 });
  return result.text;
}

// Master + sub-narrators: plan, narrate sections in parallel, assemble.
async function narrateHierarchically({ promptInfo, pageTitle, factLines, onProgress }) {
  const warnings = [];
  const sections = await planRenarrationSections({ promptInfo, pageTitle, factLines, warnings, onProgress });

  // Unreachable while factLines is non-empty, but never emit an empty page:
  // fall back to the facts themselves rather than a blank renarration.
  if (!sections.length) {
    warnings.push('Renarration planning produced no sections; showing the extracted facts directly.');
    return {
      text: factLines.map((fact) => fact.line.replace(/^\d+\.\s*/, '')).join('\n'),
      userText: factsBlock(factLines),
      sectionCount: 0,
      agentCount: 1,
      warnings,
    };
  }

  onProgress?.(`Renarrating ${sections.length} sections in parallel...`);
  let completed = 0;
  const parts = await mapWithConcurrency(sections, NARRATOR_CONCURRENCY, async (section, index) => {
    let text;
    try {
      text = await narrateSection({ section, index, sections, promptInfo, pageTitle, factLines });
    } catch (error) {
      // Fallback: render the section's facts verbatim rather than lose them —
      // a degraded section is recoverable, a missing one is not.
      warnings.push(`Section ${index + 1} sub-narrator failed (${error?.message || error}); using its facts directly.`);
      text = section.factNumbers
        .map((number) => factLines[number - 1].line.replace(/^\d+\.\s*/, ''))
        .join('\n');
    }
    completed += 1;
    onProgress?.(`Renarrated section ${completed}/${sections.length}.`);
    return { title: section.title, text };
  });

  onProgress?.('Assembling the renarration...');
  return {
    text: assembleRenarration(parts),
    userText: factsBlock(factLines),
    sectionCount: sections.length,
    agentCount: sections.length + 1,
    warnings,
  };
}

export async function renarratePage({ extraction, taskName, onProgress } = {}) {
  if (!extraction) throw new Error('Missing page extraction');

  // Open the TLS connection while the prompt settings load from storage.
  warmUpConnection();
  const promptInfo = await buildRenarrationPrompt(taskName);
  const facts = extraction.facts || extraction.knowledge?.facts || [];
  const pageTitle = extraction.title || extraction.knowledge?.title || 'Untitled';
  const factLines = buildFactLines(facts);
  const totalFactChars = factLines.reduce((sum, fact) => sum + fact.line.length, 0);

  // Captions run in parallel with the entire body hierarchy: they match the
  // body's output language through promptInfo.languageRule (derived from the
  // reading goal), so they never need the finished body as a sample.
  const captionsPromise = renarrateImageCaptions({
    extraction,
    readingGoal: promptInfo.readingGoal,
    languageRule: promptInfo.languageRule,
  });

  const body = factLines.length && totalFactChars > SINGLE_CALL_FACTS_CHARS
    ? await narrateHierarchically({ promptInfo, pageTitle, factLines, onProgress })
    : await narrateSingleCall({ promptInfo, pageTitle, factLines, extraction });

  const captions = await captionsPromise;

  return {
    text: body.text,
    captions,
    model: OPENAI_CONFIG.textModel,
    sectionCount: body.sectionCount,
    agentCount: body.agentCount,
    warnings: body.warnings,
    promptInfo: {
      systemPrompt: promptInfo.systemPrompt,
      userText: body.userText,
    },
  };
}
