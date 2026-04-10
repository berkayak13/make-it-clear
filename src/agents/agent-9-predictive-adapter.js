import { callLLM } from '../utils/llm-dispatch.js';
import { loadPrompt } from '../utils/prompt-loader.js';
import { loadMemory, getRelevantEpisodic } from '../utils/memory-system.js';

export const name = 'predictive-adapter';
export const phase = 6;
export const optional = true;
export const requiredFields = [];

function detectPageType(url, title) {
  const lowerUrl = (url || '').toLowerCase();
  const lowerTitle = (title || '').toLowerCase();

  if (lowerUrl.includes('/docs/') || lowerUrl.includes('/api/') || lowerUrl.includes('/reference/')) {
    return 'documentation';
  }
  if (lowerUrl.includes('/wiki/') || lowerUrl.includes('wikipedia.org')) {
    return 'wiki';
  }
  if (lowerUrl.includes('/blog/') || lowerUrl.includes('/post/') || lowerUrl.includes('/article/')) {
    return 'article';
  }
  if (lowerUrl.includes('arxiv.org') || lowerUrl.includes('/paper/') || lowerTitle.includes('abstract')) {
    return 'research';
  }
  if (lowerUrl.includes('/news/') || lowerUrl.includes('news.') || lowerTitle.includes('breaking')) {
    return 'news';
  }
  return 'general';
}

function looksNonEnglish(contentPreview) {
  if (!contentPreview || contentPreview.length < 20) return false;
  const sample = contentPreview.slice(0, 200);
  // Simple heuristic: high ratio of non-ASCII characters suggests non-English
  const nonAscii = sample.replace(/[\x00-\x7F]/g, '').length;
  return nonAscii / sample.length > 0.3;
}

function buildIntent(taskName, options = {}) {
  return {
    task: taskName,
    depth: options.depth || 'moderate',
    focusAreas: options.focusAreas || [],
    outputStyle: options.outputStyle || 'summary',
    ...options.extra,
  };
}

function generateRuleSuggestions(pageMetadata, memory, pageType) {
  const suggestions = [];
  const { contentPreview } = pageMetadata;
  const userLevel = memory?.semantic?.expertiseLevel || 'intermediate';

  // Documentation pages
  if (pageType === 'documentation') {
    if (userLevel === 'beginner') {
      suggestions.push({
        label: 'Simplify this documentation',
        description: 'Rewrite the technical docs in plain language with examples.',
        intent: buildIntent('Simple', { depth: 'moderate', outputStyle: 'explanation' }),
        confidence: 0.85,
      });
    } else {
      suggestions.push({
        label: 'Summarize the API reference',
        description: 'Extract the key endpoints, parameters, and usage patterns.',
        intent: buildIntent('Summary', { depth: 'brief', outputStyle: 'bullet-points' }),
        confidence: 0.8,
      });
    }
  }

  // Research / academic pages
  if (pageType === 'research') {
    suggestions.push({
      label: 'Explain this paper in plain language',
      description: 'Break down the abstract and findings for a general audience.',
      intent: buildIntent('Simple', { depth: 'detailed', outputStyle: 'explanation' }),
      confidence: 0.8,
    });
  }

  // Long content
  if (contentPreview && contentPreview.length > 5000) {
    suggestions.push({
      label: 'Summarize key points',
      description: 'Condense this long page into the most important takeaways.',
      intent: buildIntent('Summary', { depth: 'brief', outputStyle: 'bullet-points' }),
      confidence: 0.75,
    });
  }

  // Non-English content
  if (looksNonEnglish(contentPreview)) {
    suggestions.push({
      label: 'Translate to English',
      description: 'This page appears to be in another language. Translate and simplify.',
      intent: buildIntent('Simple', {
        depth: 'moderate',
        outputStyle: 'explanation',
        extra: { translateTo: 'English' },
      }),
      confidence: 0.9,
    });
  }

  // News pages
  if (pageType === 'news') {
    suggestions.push({
      label: 'Get the key facts',
      description: 'Extract the who, what, when, where, and why from this article.',
      intent: buildIntent('Summary', { depth: 'brief', outputStyle: 'bullet-points' }),
      confidence: 0.7,
    });
  }

  // Beginner on any technical-looking page
  if (userLevel === 'beginner' && pageType === 'general' && suggestions.length === 0) {
    suggestions.push({
      label: 'Simplify this page',
      description: 'Rewrite the content using everyday language.',
      intent: buildIntent('Simple', { depth: 'moderate', outputStyle: 'explanation' }),
      confidence: 0.6,
    });
  }

  return suggestions;
}

function suggestionsFromHistory(episodes, pageType) {
  if (!episodes || episodes.length === 0) return [];

  const suggestions = [];
  for (const episode of episodes.slice(0, 2)) {
    const taskUsed = episode.taskName || episode.task || 'Simple';

    suggestions.push({
      label: `${taskUsed} renarration (like last time)`,
      description: `You used "${taskUsed}" on a similar ${pageType} page previously.`,
      intent: buildIntent(taskUsed, {
        depth: episode.depth || 'moderate',
        outputStyle: episode.outputStyle || 'summary',
        focusAreas: episode.focusAreas || [],
      }),
      confidence: 0.9,
    });
  }

  return suggestions;
}

function buildGreeting(pageType, memory) {
  const userName = memory?.semantic?.name || '';
  const prefix = userName ? `Hi ${userName}! ` : '';
  const typeLabels = {
    documentation: 'technical documentation',
    wiki: 'a wiki article',
    article: 'an article',
    research: 'a research paper',
    news: 'a news piece',
    general: 'a web page',
  };
  const label = typeLabels[pageType] || 'a web page';
  return `${prefix}This looks like ${label}. Here are some suggestions based on your preferences.`;
}

async function generateLLMSuggestions(pageMetadata, memory, context) {
  const promptTemplate = await loadPrompt('predictive-suggestions');

  const userProfile = memory?.semantic
    ? JSON.stringify(memory.semantic, null, 2)
    : 'No profile available';

  const pastSummaries = memory?.recentEpisodes
    ? memory.recentEpisodes.map((e) => `- ${e.summary || e.taskName || 'session'}`).join('\n')
    : 'No past sessions';

  const preview = (pageMetadata.contentPreview || '').slice(0, 500);

  const filledPrompt = promptTemplate
    .replace('{url}', pageMetadata.url || '')
    .replace('{title}', pageMetadata.title || '')
    .replace('{contentPreview}', preview)
    .replace('{userProfile}', userProfile)
    .replace('{pastSessions}', pastSummaries);

  const raw = await callLLM(
    [{ role: 'user', content: filledPrompt }],
    '',
    { tier: 'fast' }
  );

  try {
    if (!raw.success) return [];
    const parsed = JSON.parse(raw.result);
    if (Array.isArray(parsed)) {
      return parsed.map((s) => ({
        label: s.label || 'Suggestion',
        description: s.description || '',
        intent: s.intent || buildIntent('Simple'),
        confidence: typeof s.confidence === 'number' ? s.confidence : 0.5,
      }));
    }
  } catch {
    // LLM response was not valid JSON — fall back gracefully
  }

  return [];
}

export async function run(context) {
  const start = Date.now();

  const pageMetadata = context.pageMetadata || { url: '', title: '', contentPreview: '' };
  const memory = context.memory || (await loadMemory());
  const pageType = detectPageType(pageMetadata.url, pageMetadata.title);

  let episodes = [];
  try {
    const userId = context.memory?.semantic?.userId || context.userId || '';
    episodes = await getRelevantEpisodic(userId, pageMetadata.url, pageMetadata.title);
  } catch {
    // episodic memory unavailable
  }

  let suggestions = suggestionsFromHistory(episodes, pageType);

  const ruleSuggestions = generateRuleSuggestions(pageMetadata, memory, pageType);
  const existingLabels = new Set(suggestions.map((s) => s.label));
  for (const rs of ruleSuggestions) {
    if (!existingLabels.has(rs.label)) {
      suggestions.push(rs);
      existingLabels.add(rs.label);
    }
  }

  if (suggestions.length < 2) {
    try {
      const llmSuggestions = await generateLLMSuggestions(pageMetadata, memory, context);
      for (const ls of llmSuggestions) {
        if (!existingLabels.has(ls.label)) {
          suggestions.push(ls);
          existingLabels.add(ls.label);
        }
      }
    } catch {
      // LLM unavailable
    }
  }

  suggestions.sort((a, b) => b.confidence - a.confidence);
  suggestions = suggestions.slice(0, 3);

  const greeting = buildGreeting(pageType, memory);

  const elapsed = Date.now() - start;
  if (context.log) {
    context.log.push({ agent: name, phase, durationMs: elapsed, success: true, detail: `${suggestions.length} suggestions` });
  }

  return { suggestions, greeting };
}
