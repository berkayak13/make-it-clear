import { callLLM } from '../utils/llm-dispatch.js';
import { loadPrompt } from '../utils/prompt-loader.js';

export const name = 'pipeline-router';
export const phase = 0;
export const optional = false;
export const requiredFields = [];

const PIPELINE_CONFIGS = {
  full: ['pipeline-router', 'intent-analyst', 'visual-cartographer', 'content-strategist', 'narrator', 'diagram-generator', 'guardrails', 'quality-validator'],
  lite: ['pipeline-router', 'intent-analyst', 'content-strategist', 'narrator', 'guardrails', 'quality-validator'],
  translate: ['pipeline-router', 'intent-analyst', 'narrator', 'quality-validator'],
  annotate: ['pipeline-router', 'intent-analyst', 'narrator']
};

function classifyByRules(rawRequest, pageMetadata) {
  const req = (rawRequest || '').toLowerCase();

  if (req.includes('translate') || req.includes('translation')) {
    return 'translate';
  }
  if (req.includes('annotate') || req.includes('tooltip')) {
    return 'annotate';
  }

  if (pageMetadata) {
    const { contentLength, hasImages, language } = pageMetadata;

    if (language && language !== 'en' && !language.startsWith('en-')) {
      return 'translate';
    }

    if (hasImages) {
      return 'full';
    }

    if (typeof contentLength === 'number') {
      return contentLength < 500 ? 'annotate' : 'lite';
    }
  }

  // Ambiguous — caller should fall back to LLM
  return null;
}

async function classifyByLLM(rawRequest, pageMetadata) {
  const promptTemplate = await loadPrompt('router-classification');
  const prompt = promptTemplate
    .replace('{{RAW_REQUEST}}', rawRequest || '')
    .replace('{{PAGE_METADATA}}', JSON.stringify(pageMetadata || {}));

  const messages = [{ role: 'user', content: prompt }];
  const response = await callLLM(messages, '', { tier: 'fast' });

  if (!response.success) return 'full';

  try {
    const parsed = JSON.parse(response.result);
    if (parsed.pipelineType && parsed.pipelineType in PIPELINE_CONFIGS) {
      return parsed.pipelineType;
    }
  } catch {
    // LLM returned non-JSON or invalid type — fall through to default
  }

  return 'full';
}

export async function run(context) {
  const start = Date.now();
  let pipelineType = null;
  let detail = '';

  try {
    pipelineType = classifyByRules(context.rawRequest, context.pageMetadata);

    if (pipelineType) {
      detail = `rule-based classification: ${pipelineType}`;
    } else {
      pipelineType = await classifyByLLM(context.rawRequest, context.pageMetadata);
      detail = `llm-based classification: ${pipelineType}`;
    }

    context.pipelineType = pipelineType;
    context.agentPlan = PIPELINE_CONFIGS[pipelineType];

    context.log.push({
      agent: name,
      durationMs: Date.now() - start,
      success: true,
      detail
    });

    return context;
  } catch (err) {
    // On any failure, default to full pipeline so processing continues
    context.pipelineType = 'full';
    context.agentPlan = PIPELINE_CONFIGS.full;

    context.log.push({
      agent: name,
      durationMs: Date.now() - start,
      success: false,
      detail: `error during classification, defaulting to full: ${err.message}`
    });

    return context;
  }
}
