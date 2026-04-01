import { callLLM } from '../utils/llm-dispatch.js';
import { loadPrompt } from '../utils/prompt-loader.js';

export const name = 'diagram-generator';
export const phase = 4;
export const optional = true;
export const requiredFields = ['intent'];
export const disabled = true;

const VALID_DIAGRAM_PREFIXES = [
  'graph ', 'graph\n',
  'flowchart ', 'flowchart\n',
  'sequenceDiagram', 'sequence',
  'classDiagram', 'stateDiagram',
  'erDiagram', 'gantt', 'pie',
  'mindmap', 'timeline'
];

/**
 * Determine the suggested diagram type based on the text content.
 * Returns a hint string or null if no diagram is appropriate.
 */
function suggestDiagramType(text) {
  const lower = text.toLowerCase();

  const processWords = ['step', 'process', 'workflow', 'pipeline', 'procedure', 'flow'];
  const sequenceWords = ['then', 'after that', 'next', 'finally', 'first', 'second', 'sequence', 'order'];
  const hierarchyWords = ['hierarchy', 'tree', 'parent', 'child', 'category', 'subcategory'];
  const architectureWords = ['architecture', 'component', 'module', 'service', 'layer', 'system'];

  const processScore = processWords.filter(w => lower.includes(w)).length;
  const sequenceScore = sequenceWords.filter(w => lower.includes(w)).length;
  const hierarchyScore = hierarchyWords.filter(w => lower.includes(w)).length;
  const architectureScore = architectureWords.filter(w => lower.includes(w)).length;

  const maxScore = Math.max(processScore, sequenceScore, hierarchyScore, architectureScore);

  if (maxScore === 0) return null;

  if (sequenceScore === maxScore) return 'sequence diagram';
  if (hierarchyScore === maxScore) return 'graph TD (hierarchy)';
  if (architectureScore === maxScore) return 'flowchart TD (architecture)';
  return 'flowchart (process)';
}

/**
 * Validate that the returned string looks like valid Mermaid syntax.
 */
function isValidMermaid(text) {
  const trimmed = text.trim();
  return VALID_DIAGRAM_PREFIXES.some(prefix => trimmed.startsWith(prefix));
}

/**
 * Strip markdown code fences if present.
 */
function cleanMermaid(raw) {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:mermaid)?\s*/i, '').replace(/\s*```$/i, '');
  return cleaned.trim();
}

/**
 * Agent 5 -- Diagram Generator
 *
 * Called by Agent 4 for sections that may benefit from visualization.
 * Generates a Mermaid diagram representing the key concepts in the text.
 *
 * @param {string} sectionText - The text content to visualize
 * @param {object} context - The pipeline context
 * @returns {{ mermaid: string|null, error: string|null }}
 */
export async function run(sectionText, context) {
  const start = Date.now();
  context.log = context.log || [];

  const diagramType = suggestDiagramType(sectionText);
  if (!diagramType) {
    context.log.push({
      agent: name,
      durationMs: Date.now() - start,
      success: true,
      detail: 'Skipped: content does not benefit from a diagram'
    });
    return { mermaid: null, error: null };
  }

  let template;
  try {
    template = await loadPrompt('diagram-generation');
  } catch {
    template = 'Generate a Mermaid diagram that visualizes the key concepts in this text.\nSuggested diagram type: {{DIAGRAM_TYPE}}\nKeep it simple (max 15 nodes) with clear, short labels.\nReturn ONLY valid Mermaid syntax, no explanations.\n\nText:\n{{SECTION_TEXT}}';
  }

  const prompt = template
    .replace('{{SECTION_TEXT}}', sectionText)
    .replace('{{DIAGRAM_TYPE}}', diagramType);

  try {
    const messages = [{ role: 'user', content: prompt }];
    const response = await callLLM(messages, '', { tier: 'fast' });

    if (!response.success || !response.result) {
      const error = response.error || 'No result from LLM';
      context.log.push({
        agent: name,
        durationMs: Date.now() - start,
        success: false,
        detail: `LLM error: ${error}`
      });
      return { mermaid: null, error };
    }

    const cleaned = cleanMermaid(response.result);

    if (!isValidMermaid(cleaned)) {
      context.log.push({
        agent: name,
        durationMs: Date.now() - start,
        success: false,
        detail: 'LLM returned invalid Mermaid syntax'
      });
      return { mermaid: null, error: 'Invalid Mermaid syntax returned by LLM' };
    }

    context.log.push({
      agent: name,
      durationMs: Date.now() - start,
      success: true,
      detail: `Generated ${diagramType} diagram`
    });

    return { mermaid: cleaned, error: null };
  } catch (err) {
    context.log.push({
      agent: name,
      durationMs: Date.now() - start,
      success: false,
      detail: `Error: ${err.message}`
    });
    return { mermaid: null, error: err.message };
  }
}
