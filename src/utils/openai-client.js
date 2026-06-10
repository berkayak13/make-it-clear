const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const OPENAI_TEXT_MODEL = import.meta.env.VITE_OPENAI_TEXT_MODEL || 'gpt-5.5';
const OPENAI_VISION_MODEL = import.meta.env.VITE_OPENAI_VISION_MODEL || OPENAI_TEXT_MODEL;
// Lower-latency model for the many parallel "bulk" calls (per-segment text
// extraction, fact-merge, image captions). The strong text model is reserved
// for the single final synthesis + the main renarration. Defaults to the text
// model, so behavior is unchanged until a faster model is configured.
const OPENAI_FAST_MODEL = import.meta.env.VITE_OPENAI_FAST_MODEL || OPENAI_TEXT_MODEL;
const OPENAI_IMAGE_DETAIL = import.meta.env.VITE_OPENAI_IMAGE_DETAIL || 'high';
const OPENAI_TIMEOUT_MS = Number(import.meta.env.VITE_OPENAI_TIMEOUT_MS || 120000);

function requireApiKey() {
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key is missing. Set VITE_OPENAI_API_KEY in .env and rebuild the extension.');
  }
}

function getResponseText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const chunks = [];
  for (const item of data?.output || []) {
    if (item?.type !== 'message') continue;
    for (const part of item.content || []) {
      if (part?.type === 'output_text' && part.text) chunks.push(part.text);
    }
  }
  return chunks.join('').trim();
}

function supportsTemperature(model) {
  const normalized = String(model || '').toLowerCase();
  return !(
    normalized.startsWith('gpt-5') ||
    normalized.startsWith('gpt-oss') ||
    /^o\d/.test(normalized)
  );
}

// Reasoning models (gpt-5+, gpt-oss, o-series) accept `reasoning` but reject
// `temperature`; classic models are the reverse. They are exact opposites.
function isReasoningModel(model) {
  return !supportsTemperature(model);
}

function buildResponseBody(payload) {
  const body = {
    store: false,
    ...payload,
  };

  if (body.temperature !== undefined && !supportsTemperature(body.model)) {
    delete body.temperature;
  }
  // `reasoning` is only valid for reasoning models — classic models reject it.
  if (body.reasoning !== undefined && !isReasoningModel(body.model)) {
    delete body.reasoning;
  }

  return body;
}

async function createResponse(payload, timeoutMs = OPENAI_TIMEOUT_MS) {
  requireApiKey();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const body = buildResponseBody(payload);

  const post = (requestBody) => fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(requestBody),
    signal: controller.signal,
  });

  try {
    let res = await post(body);

    // Some models reject optional tuning params outright — drop whichever the
    // API names as unsupported and retry once.
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const unsupported = ['temperature', 'reasoning'].filter(
        (param) => body[param] !== undefined && errText.includes(`Unsupported parameter: '${param}'`),
      );
      if (!unsupported.length) {
        throw new Error(`OpenAI API error ${res.status}: ${errText || res.statusText}`);
      }
      const retryBody = { ...body };
      for (const param of unsupported) delete retryBody[param];
      res = await post(retryBody);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenAI API error ${res.status}: ${errText || res.statusText}`);
    }

    const data = await res.json();
    if (data?.error) {
      throw new Error(data.error.message || 'OpenAI returned an error');
    }
    return data;
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new Error(`OpenAI request timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function callOpenAIText({ systemPrompt = '', userText = '', model, temperature, maxOutputTokens, timeoutMs, reasoningEffort } = {}) {
  const data = await createResponse({
    model: model || OPENAI_TEXT_MODEL,
    instructions: systemPrompt || undefined,
    input: String(userText || ''),
    temperature,
    reasoning: reasoningEffort ? { effort: reasoningEffort } : undefined,
    max_output_tokens: maxOutputTokens,
    text: { format: { type: 'text' } },
  }, timeoutMs);

  const text = getResponseText(data);
  if (!text) throw new Error('OpenAI returned no text output');
  return { text, response: data };
}

// A response that hits `max_output_tokens` comes back with status "incomplete"
// and truncated (invalid) JSON — parsing it would throw a cryptic SyntaxError.
function isResponseTruncated(data) {
  return data?.status === 'incomplete'
    && data?.incomplete_details?.reason === 'max_output_tokens';
}

export async function callOpenAIJson({ prompt = '', images = [], imageDetail, schema, schemaName = 'structured_output', model, maxOutputTokens, timeoutMs, reasoningEffort } = {}) {
  const content = [{ type: 'input_text', text: String(prompt || '') }];
  let hasImageInputs = false;
  for (const image of images) {
    const imageUrl = typeof image === 'string' ? image : (image?.dataUrl || image?.url || image?.imageUrl);
    if (!imageUrl) continue;
    hasImageInputs = true;
    content.push({
      type: 'input_image',
      image_url: imageUrl,
      detail: (typeof image === 'object' && image?.detail) || imageDetail || OPENAI_IMAGE_DETAIL,
    });
  }

  const resolvedModel = model || (hasImageInputs ? OPENAI_VISION_MODEL : OPENAI_TEXT_MODEL);
  const requestJson = (tokenLimit) => createResponse({
    model: resolvedModel,
    input: [{ role: 'user', content }],
    max_output_tokens: tokenLimit,
    reasoning: reasoningEffort ? { effort: reasoningEffort } : undefined,
    text: {
      format: {
        type: 'json_schema',
        name: schemaName,
        strict: true,
        schema,
      },
    },
  }, timeoutMs);

  let data = await requestJson(maxOutputTokens);

  // Long/complex pages can overflow the token budget and truncate the JSON.
  // Retry once with double the budget before treating it as a failure.
  if (isResponseTruncated(data) && Number(maxOutputTokens) > 0) {
    data = await requestJson(Number(maxOutputTokens) * 2);
  }

  if (isResponseTruncated(data)) {
    throw new Error('OpenAI response exceeded the output token limit before completing the JSON. Try a smaller page section.');
  }

  const text = getResponseText(data);
  if (!text) throw new Error('OpenAI returned no JSON output');

  try {
    return { json: JSON.parse(text), text, response: data };
  } catch (e) {
    throw new Error(`OpenAI returned malformed JSON output: ${e?.message || e}`);
  }
}

export const OPENAI_CONFIG = {
  textModel: OPENAI_TEXT_MODEL,
  visionModel: OPENAI_VISION_MODEL,
  fastModel: OPENAI_FAST_MODEL,
  timeoutMs: OPENAI_TIMEOUT_MS,
};
