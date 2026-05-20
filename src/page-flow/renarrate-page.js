import { callOpenAIText, OPENAI_CONFIG } from '../utils/openai-client.js';
import { buildRenarrationPrompt, truncateForContext } from '../utils/renarration.js';

const MAX_EXTRACTED_NOTES_CHARS = 30000;
const MAX_RAW_TEXT_CHARS = 30000;

function formatFact(fact) {
  if (typeof fact === 'string') return fact;
  return String(fact?.text || fact?.content || '').trim();
}

function formatKnowledge(knowledge = {}) {
  const facts = Array.isArray(knowledge.facts)
    ? knowledge.facts.map(formatFact).filter(Boolean)
    : [];
  return [
    knowledge.title ? `Title: ${knowledge.title}` : '',
    knowledge.topic ? `Topic: ${knowledge.topic}` : '',
    knowledge.summary ? `Summary: ${knowledge.summary}` : '',
    facts.length ? `Facts:\n- ${facts.join('\n- ')}` : '',
    Array.isArray(knowledge.entities) && knowledge.entities.length ? `Entities: ${knowledge.entities.join(', ')}` : '',
    Array.isArray(knowledge.keyTerms) && knowledge.keyTerms.length ? `Key terms: ${knowledge.keyTerms.join(', ')}` : '',
  ].filter(Boolean).join('\n\n');
}

export async function renarratePage({ extraction, taskName } = {}) {
  if (!extraction) throw new Error('Missing page extraction');

  const promptInfo = await buildRenarrationPrompt(taskName);
  const systemPrompt = [
    promptInfo.systemPrompt,
    'You are renarrating a full webpage into a plain-text reading panel.',
    'Use the saved reading goal as important context when present.',
    'Preserve factual meaning. Do not invent page content.',
    'Return only readable plain text. Do not return HTML or Markdown tables.',
  ].filter(Boolean).join('\n\n');

  const userText = [
    'Saved reading goal:',
    promptInfo.readingGoal || 'No saved reading goal.',
    '',
    'Compact page source extracted from visible text and page images:',
    truncateForContext(extraction.compactText || formatKnowledge(extraction.knowledge), MAX_EXTRACTED_NOTES_CHARS),
    '',
    'Captured visible page text fallback:',
    truncateForContext(extraction.rawText || '', MAX_RAW_TEXT_CHARS),
  ].join('\n');

  const result = await callOpenAIText({
    systemPrompt,
    userText,
    model: OPENAI_CONFIG.textModel,
    temperature: 0.3,
  });

  return {
    text: result.text,
    model: OPENAI_CONFIG.textModel,
    promptInfo: {
      systemPrompt,
      userText: truncateForContext(userText, MAX_EXTRACTED_NOTES_CHARS + MAX_RAW_TEXT_CHARS),
    },
  };
}
