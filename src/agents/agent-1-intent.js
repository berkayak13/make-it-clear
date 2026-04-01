import { callLLM } from '../utils/llm-dispatch.js';
import { loadPrompt } from '../utils/prompt-loader.js';

export const name = 'intent-analyst';
export const phase = 1;
export const optional = false;
export const requiredFields = [];

/**
 * Iterative-refinement keywords that signal the user is refining
 * a previous renarration rather than starting fresh.
 */
const ITERATIVE_KEYWORDS = [
  'make it', 'change the', 'shorter', 'longer', 'more formal',
  'more casual', 'less technical', 'simpler', 'try again',
  'redo', 'update', 'revise', 'tweak', 'adjust', 'modify',
  'rewrite the', 'fix the', 'improve the'
];

/**
 * Simple keyword map used as a fallback when LLM parsing fails.
 * Each entry maps a keyword to partial intent overrides.
 */
const KEYWORD_MAP = {
  simplify:    { goal: 'simplify for easier understanding', depth: 'moderate', outputStyle: 'rewrite' },
  summarize:   { goal: 'summarize key points', depth: 'brief', outputStyle: 'summary' },
  summary:     { goal: 'summarize key points', depth: 'brief', outputStyle: 'summary' },
  translate:   { goal: 'translate content', depth: 'moderate', outputStyle: 'rewrite' },
  explain:     { goal: 'explain in detail', depth: 'detailed', outputStyle: 'explanation' },
  shorter:     { goal: 'make content shorter', depth: 'brief', outputStyle: 'summary' },
  formal:      { goal: 'rewrite in formal tone', depth: 'moderate', outputStyle: 'rewrite' },
  casual:      { goal: 'rewrite in casual tone', depth: 'moderate', outputStyle: 'conversational' },
  bullets:     { goal: 'convert to bullet points', depth: 'moderate', outputStyle: 'bullet-points' },
  'bullet-points': { goal: 'convert to bullet points', depth: 'moderate', outputStyle: 'bullet-points' },
  detailed:    { goal: 'provide detailed explanation', depth: 'detailed', outputStyle: 'explanation' },
  academic:    { goal: 'rewrite in academic style', depth: 'detailed', outputStyle: 'rewrite' },
};

const VALID_DEPTHS = ['brief', 'moderate', 'detailed'];
const VALID_STYLES = ['summary', 'explanation', 'bullet-points', 'conversational', 'rewrite'];

/**
 * Strip ```json fences and parse JSON from an LLM response string.
 */
function parseJSON(raw) {
  let cleaned = raw.trim();
  // Remove ```json ... ``` wrappers
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(cleaned);
}

/**
 * Detect whether the raw request references a previous renarration,
 * indicating an iterative refinement rather than a fresh request.
 */
function detectIterative(rawRequest) {
  const lower = (rawRequest || '').toLowerCase();
  return ITERATIVE_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Keyword-based fallback intent extraction — used when the LLM call
 * fails or returns unparseable output.
 */
function extractFallbackIntent(rawRequest) {
  const lower = (rawRequest || '').toLowerCase();

  let matched = null;
  for (const [keyword, partial] of Object.entries(KEYWORD_MAP)) {
    if (lower.includes(keyword)) {
      matched = partial;
      break;
    }
  }

  return {
    goal: matched ? matched.goal : rawRequest,
    depth: matched ? matched.depth : 'moderate',
    focusAreas: [],
    outputStyle: matched ? matched.outputStyle : 'rewrite',
    terminology: { preferred: [], avoided: [] },
    targetSections: null,
    language: null,
    isIterative: detectIterative(rawRequest),
    confidenceScore: matched ? 0.5 : 0.3,
  };
}

/**
 * Validate and normalise an intent object parsed from LLM output,
 * filling in any missing fields with sensible defaults.
 */
function normaliseIntent(parsed, rawRequest) {
  return {
    goal: typeof parsed.goal === 'string' ? parsed.goal : rawRequest,
    depth: VALID_DEPTHS.includes(parsed.depth) ? parsed.depth : 'moderate',
    focusAreas: Array.isArray(parsed.focusAreas) ? parsed.focusAreas : [],
    outputStyle: VALID_STYLES.includes(parsed.outputStyle) ? parsed.outputStyle : 'rewrite',
    terminology: {
      preferred: Array.isArray(parsed.terminology?.preferred) ? parsed.terminology.preferred : [],
      avoided: Array.isArray(parsed.terminology?.avoided) ? parsed.terminology.avoided : [],
    },
    targetSections: Array.isArray(parsed.targetSections) ? parsed.targetSections : null,
    language: typeof parsed.language === 'string' ? parsed.language : null,
    isIterative: typeof parsed.isIterative === 'boolean'
      ? parsed.isIterative
      : detectIterative(rawRequest),
    confidenceScore: typeof parsed.confidenceScore === 'number'
      ? Math.max(0, Math.min(1, parsed.confidenceScore))
      : 0.7,
  };
}

/**
 * Agent 1 — Intent Analyst
 *
 * Parses the user's chat history and current request into a structured
 * intent specification that downstream agents consume.
 */
export async function run(context) {
  const start = Date.now();
  let usedFallback = false;

  try {
    // --- Build LLM input ------------------------------------------------
    const promptTemplate = await loadPrompt('intent-analysis');

    const chatSnippet = (context.chatHistory || [])
      .map(turn => `${turn.role}: ${turn.content}`)
      .join('\n');

    const memorySnippet = context.memory?.semantic
      ? JSON.stringify(context.memory.semantic)
      : 'none';

    const filledPrompt = promptTemplate
      .replace('{rawRequest}', context.rawRequest || '')
      .replace('{chatHistory}', chatSnippet || 'none')
      .replace('{memoryProfile}', memorySnippet);

    // --- Call LLM (quality tier) ----------------------------------------
    const llmResponse = await callLLM(
      [{ role: 'user', content: filledPrompt }],
      'You are an intent analysis agent. Parse the user request into a structured intent specification.',
      { tier: 'quality' }
    );

    if (!llmResponse.success) throw new Error(llmResponse.error);
    const parsed = parseJSON(llmResponse.result);
    context.intent = normaliseIntent(parsed, context.rawRequest);
  } catch (err) {
    // --- Fallback: keyword-based extraction ------------------------------
    usedFallback = true;
    context.intent = extractFallbackIntent(context.rawRequest);
  }

  // --- Logging ----------------------------------------------------------
  const durationMs = Date.now() - start;
  context.log = context.log || [];
  context.log.push({
    agent: name,
    durationMs,
    success: true,
    detail: usedFallback
      ? 'Used keyword-based fallback intent extraction'
      : `LLM intent parsed (confidence ${context.intent.confidenceScore})`,
  });

  return context;
}
