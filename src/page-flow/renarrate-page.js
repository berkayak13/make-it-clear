import { callOpenAIText, callOpenAIJson, OPENAI_CONFIG } from '../utils/openai-client.js';
import { buildRenarrationPrompt, truncateForContext } from '../utils/renarration.js';

const MAX_EXTRACTED_NOTES_CHARS = 30000;

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
      model: OPENAI_CONFIG.textModel,
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

const FACT_KIND_LABEL = {
  FACT: 'Fact',
  CLAIM: 'Claim',
  QUOTE: 'Quote',
  FIGURE: 'Figure',
  COUNTER: 'Counterpoint',
  VISUAL: 'Visual',
};

// Renders the extraction's structured facts & claims into a readable numbered
// plain-text list — the sole content source the page renarration works from.
// Internal plumbing (id, confidence, sectionIds, imageIds) is intentionally
// omitted; evidence is appended only when it adds information.
function formatFactsForRenarration(facts) {
  const list = Array.isArray(facts) ? facts : [];
  const lines = [];
  for (const fact of list) {
    const text = typeof fact === 'string' ? fact : String(fact?.text || fact?.content || '').trim();
    if (!text) continue;
    const kind = typeof fact === 'object' ? String(fact?.kind || '').toUpperCase() : '';
    const label = FACT_KIND_LABEL[kind] || 'Point';
    const evidence = typeof fact === 'object' ? String(fact?.evidence || '').trim() : '';
    let line = `${lines.length + 1}. ${label}: ${text}`;
    if (evidence && evidence.toLowerCase() !== text.toLowerCase()) {
      line += ` (Evidence: ${evidence})`;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

export async function renarratePage({ extraction, taskName } = {}) {
  if (!extraction) throw new Error('Missing page extraction');

  const promptInfo = await buildRenarrationPrompt(taskName);
  const systemPrompt = [
    promptInfo.systemPrompt,
    'You are renarrating a full webpage into a plain-text reading panel.',
    'Your input is a structured list of facts and claims extracted from the page. It is your only content source — cover every item and do not invent anything beyond the list.',
    'Write a DIRECT explanation of the subject itself, in clear natural prose, as if you are explaining the topic to the reader.',
    'Do NOT narrate or describe the source. Never use meta-attribution phrasing such as "the article says", "the author claims", "the page states", "according to the article/author", "the post explains", or "this piece argues". State the information directly as facts about the subject.',
    'Only attribute to a specific person or source when an item is a direct quotation, or a genuinely contested or opinionated claim that would mislead if stated as plain fact — and then name the actual person/source, never "the article" or "the author".',
    'Use the saved reading goal as important context when present.',
    'Organize everything into coherent, natural prose. Return only readable plain text. Do not return HTML or Markdown tables.',
  ].filter(Boolean).join('\n\n');

  const facts = extraction.facts || extraction.knowledge?.facts || [];
  const pageTitle = extraction.title || extraction.knowledge?.title || 'Untitled';
  const userText = [
    'Saved reading goal:',
    promptInfo.readingGoal || 'No saved reading goal.',
    '',
    `Page: ${pageTitle}`,
    '',
    'Structured facts & claims extracted from the page (your only content source):',
    truncateForContext(formatFactsForRenarration(facts), MAX_EXTRACTED_NOTES_CHARS),
  ].join('\n');

  // Body and captions run in parallel: captions match the body's output language
  // through promptInfo.languageRule (derived from the reading goal), so they no
  // longer need the finished body as a sample. Low reasoning effort keeps the
  // call fast — renarration is prose generation, not multi-step reasoning.
  const [result, captions] = await Promise.all([
    callOpenAIText({
      systemPrompt,
      userText,
      model: OPENAI_CONFIG.textModel,
      reasoningEffort: 'low',
    }),
    renarrateImageCaptions({
      extraction,
      readingGoal: promptInfo.readingGoal,
      languageRule: promptInfo.languageRule,
    }),
  ]);

  return {
    text: result.text,
    captions,
    model: OPENAI_CONFIG.textModel,
    promptInfo: {
      systemPrompt,
      userText: truncateForContext(userText, MAX_EXTRACTED_NOTES_CHARS),
    },
  };
}
