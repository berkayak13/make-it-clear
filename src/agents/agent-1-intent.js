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

/**
 * Keywords that signal the user's literacy level.
 */
const LITERACY_LOW_KEYWORDS = [
  'simple', 'easy', 'basic', 'explain like', "don't understand",
  'confused', 'eli5', 'dumb it down', 'plain english', 'plain language'
];
const LITERACY_HIGH_KEYWORDS = [
  'technical', 'in-depth', 'advanced', 'scholarly', 'academic',
  'rigorous', 'comprehensive analysis', 'peer-reviewed'
];

const VALID_DEPTHS = ['brief', 'moderate', 'detailed'];
const VALID_STYLES = ['summary', 'explanation', 'bullet-points', 'conversational', 'rewrite'];
const VALID_LITERACY_LEVELS = ['low', 'moderate', 'high'];

/**
 * Detect literacy level from the raw request and chat history.
 * Returns 'low', 'moderate', or 'high'.
 */
function detectLiteracyLevel(rawRequest, chatHistory) {
  const lower = (rawRequest || '').toLowerCase();

  // Check keywords in the current request
  if (LITERACY_LOW_KEYWORDS.some(kw => lower.includes(kw))) return 'low';
  if (LITERACY_HIGH_KEYWORDS.some(kw => lower.includes(kw))) return 'high';

  // Analyze chat history: short messages with simple vocabulary bias toward 'low'
  if (Array.isArray(chatHistory) && chatHistory.length > 0) {
    const userMessages = chatHistory.filter(t => t.role === 'user');
    if (userMessages.length >= 2) {
      const avgWords = userMessages.reduce((sum, t) => {
        return sum + (t.content || '').split(/\s+/).filter(Boolean).length;
      }, 0) / userMessages.length;
      if (avgWords < 10) return 'low';
    }
  }

  return 'moderate';
}

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
function extractFallbackIntent(rawRequest, chatHistory) {
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
    literacyLevel: detectLiteracyLevel(rawRequest, chatHistory),
    confidenceScore: matched ? 0.5 : 0.3,
  };
}

/**
 * Validate and normalise an intent object parsed from LLM output,
 * filling in any missing fields with sensible defaults.
 */
function normaliseIntent(parsed, rawRequest, chatHistory, readingGoal) {
  const rg = readingGoal && typeof readingGoal === 'object' ? readingGoal : {};
  return {
    goal: typeof parsed.goal === 'string' ? parsed.goal : (rg.readingGoal || rawRequest),
    depth: VALID_DEPTHS.includes(parsed.depth) ? parsed.depth : (VALID_DEPTHS.includes(rg.desiredDepth) ? rg.desiredDepth : 'moderate'),
    focusAreas: Array.isArray(parsed.focusAreas) && parsed.focusAreas.length > 0 ? parsed.focusAreas : (rg.focusAreas || []),
    outputStyle: VALID_STYLES.includes(parsed.outputStyle) ? parsed.outputStyle : (VALID_STYLES.includes(rg.outputStyle) ? rg.outputStyle : 'rewrite'),
    terminology: {
      preferred: Array.isArray(parsed.terminology?.preferred) ? parsed.terminology.preferred : [],
      avoided: Array.isArray(parsed.terminology?.avoided) ? parsed.terminology.avoided : [],
    },
    targetSections: Array.isArray(parsed.targetSections) ? parsed.targetSections : null,
    language: typeof parsed.language === 'string' ? parsed.language : (rg.language || null),
    isIterative: typeof parsed.isIterative === 'boolean'
      ? parsed.isIterative
      : detectIterative(rawRequest),
    literacyLevel: VALID_LITERACY_LEVELS.includes(parsed.literacyLevel)
      ? parsed.literacyLevel
      : detectLiteracyLevel(rawRequest, chatHistory),
    confidenceScore: typeof parsed.confidenceScore === 'number'
      ? Math.max(0, Math.min(1, parsed.confidenceScore))
      : (rg.readingGoal ? 0.9 : 0.7),
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

    // Enrich rawRequest with reading goal + memory episodes
    let enrichedRequest = context.rawRequest || '';
    const rg = context.readingGoal;
    if (rg) {
      const goalText = typeof rg === 'object' ? rg.readingGoal : rg;
      if (goalText) enrichedRequest += `\n\nUser's reading goal: ${goalText}`;
      if (rg.additionalInstructions) enrichedRequest += `\nAdditional instructions: ${rg.additionalInstructions}`;
      if (rg.language) enrichedRequest += `\nUser's language: ${rg.language}`;
    }
    const episodes = context.memory?.episodic || [];
    if (episodes.length > 0) {
      const history = episodes.slice(0, 3).map(e => `- ${e.intent || e.taskName || 'session'} (${e.outcome || ''})`).join('\n');
      enrichedRequest += `\n\nUser's recent session history:\n${history}`;
    }

    const chatSnippet = (context.chatHistory || [])
      .map(turn => `${turn.role}: ${turn.content}`)
      .join('\n');

    const memorySnippet = context.memory?.semantic
      ? JSON.stringify(context.memory.semantic)
      : 'none';

    const filledPrompt = promptTemplate
      .replace('{rawRequest}', enrichedRequest)
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
    context.intent = normaliseIntent(parsed, context.rawRequest, context.chatHistory, rg);
  } catch (err) {
    // --- Fallback: keyword-based extraction, normalised for consistency ---
    usedFallback = true;
    const fallback = extractFallbackIntent(context.rawRequest, context.chatHistory);
    context.intent = normaliseIntent(fallback, context.rawRequest, context.chatHistory, rg);
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
