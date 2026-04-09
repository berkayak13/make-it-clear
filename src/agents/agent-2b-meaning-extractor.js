import { callLLM } from '../utils/llm-dispatch.js';
import { loadPrompt } from '../utils/prompt-loader.js';

export const name = 'meaning-extractor';
export const phase = 2;
export const requiredFields = ['sectionMap'];
export const optional = true;

export async function run(context) {
  const startTime = Date.now();
  const { sectionMap } = context;

  let promptTemplate = '';
  try {
    promptTemplate = await loadPrompt('meaning-extraction');
  } catch {
    promptTemplate = 'Extract the core meaning, key entities, relationships, and factual claims from each section.';
  }

  const sectionsPayload = sectionMap.map(s => ({
    id: s.id,
    text: (s.text || '').slice(0, 2000)
  }));

  const userContent = [
    promptTemplate,
    '\n## Sections to analyze:\n',
    JSON.stringify(sectionsPayload, null, 2)
  ].join('\n');

  const systemPrompt = 'You are a meaning extraction agent. Extract the essential meaning, core claims, entities, and relationships from text sections. Return valid JSON.';

  try {
    const response = await callLLM(
      [{ role: 'user', content: userContent }],
      systemPrompt,
      { tier: 'quality' }
    );

    if (!response?.success) throw new Error(response?.error || 'LLM call failed');

    const text = response.result || '';
    const jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        context.meaningMap = parsed.map(item => ({
          sectionId: item.sectionId || item.id || '',
          coreThesis: item.coreThesis || item.thesis || '',
          entities: Array.isArray(item.entities) ? item.entities : [],
          relationships: Array.isArray(item.relationships) ? item.relationships : [],
          tone: item.tone || 'neutral',
          facts: Array.isArray(item.facts) ? item.facts : []
        }));
      }
    }
  } catch (err) {
    console.warn('[MeaningExtractor] Failed, using fallback:', err?.message);
  }

  // Fallback: if no meaningMap was extracted, create a basic one from sectionMap
  if (!context.meaningMap || context.meaningMap.length === 0) {
    context.meaningMap = sectionMap.map(s => ({
      sectionId: s.id,
      coreThesis: s.text ? s.text.slice(0, 200) : '',
      entities: [],
      relationships: [],
      tone: 'neutral',
      facts: []
    }));
  }

  context.log = context.log || [];
  context.log.push({
    agent: name,
    phase,
    durationMs: Date.now() - startTime,
    success: context.meaningMap.length > 0,
    detail: `Extracted meaning for ${context.meaningMap.length} sections`
  });

  return context;
}
