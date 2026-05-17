import { callOpenAIText, OPENAI_CONFIG } from '../utils/openai-client.js';
import { buildRenarrationPrompt, truncateForContext } from '../utils/renarration.js';

const MAX_EXTRACTED_NOTES_CHARS = 30000;
const MAX_RAW_TEXT_CHARS = 30000;

function formatReadingGoal(goal) {
  if (!goal) return 'No saved reading goal.';
  if (typeof goal === 'string') return goal || 'No saved reading goal.';
  return [
    goal.readingGoal ? `Goal: ${goal.readingGoal}` : '',
    goal.desiredDepth ? `Depth: ${goal.desiredDepth}` : '',
    Array.isArray(goal.focusAreas) && goal.focusAreas.length ? `Focus: ${goal.focusAreas.join(', ')}` : '',
    goal.outputStyle ? `Style: ${goal.outputStyle}` : '',
    goal.additionalInstructions ? `Notes: ${goal.additionalInstructions}` : '',
  ].filter(Boolean).join('\n') || 'No saved reading goal.';
}

function formatKnowledge(knowledge = {}) {
  return [
    knowledge.title ? `Title: ${knowledge.title}` : '',
    knowledge.topic ? `Topic: ${knowledge.topic}` : '',
    knowledge.summary ? `Summary: ${knowledge.summary}` : '',
    Array.isArray(knowledge.facts) && knowledge.facts.length ? `Facts:\n- ${knowledge.facts.join('\n- ')}` : '',
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
    formatReadingGoal(promptInfo.readingGoal),
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
