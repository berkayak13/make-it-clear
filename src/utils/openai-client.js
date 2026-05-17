const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const OPENAI_TEXT_MODEL = import.meta.env.VITE_OPENAI_TEXT_MODEL || 'gpt-5.5';
const OPENAI_VISION_MODEL = import.meta.env.VITE_OPENAI_VISION_MODEL || OPENAI_TEXT_MODEL;
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

function buildResponseBody(payload) {
  const body = {
    store: false,
    ...payload,
  };

  if (body.temperature !== undefined && !supportsTemperature(body.model)) {
    delete body.temperature;
  }

  return body;
}

async function createResponse(payload, timeoutMs = OPENAI_TIMEOUT_MS) {
  requireApiKey();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const body = buildResponseBody(payload);

  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      if (body.temperature !== undefined && errText.includes("Unsupported parameter: 'temperature'")) {
        const retryBody = { ...body };
        delete retryBody.temperature;
        const retryRes = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify(retryBody),
          signal: controller.signal,
        });

        if (retryRes.ok) {
          const retryData = await retryRes.json();
          if (retryData?.error) {
            throw new Error(retryData.error.message || 'OpenAI returned an error');
          }
          return retryData;
        }

        const retryErrText = await retryRes.text().catch(() => '');
        throw new Error(`OpenAI API error ${retryRes.status}: ${retryErrText || retryRes.statusText}`);
      }
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

export async function callOpenAIText({ systemPrompt = '', userText = '', model, temperature, maxOutputTokens, timeoutMs } = {}) {
  const data = await createResponse({
    model: model || OPENAI_TEXT_MODEL,
    instructions: systemPrompt || undefined,
    input: String(userText || ''),
    temperature,
    max_output_tokens: maxOutputTokens,
    text: { format: { type: 'text' } },
  }, timeoutMs);

  const text = getResponseText(data);
  if (!text) throw new Error('OpenAI returned no text output');
  return { text, response: data };
}

export async function callOpenAIJson({ systemPrompt = '', prompt = '', images = [], imageDetail, schema, schemaName = 'structured_output', model, maxOutputTokens, timeoutMs } = {}) {
  const content = [{ type: 'input_text', text: String(prompt || '') }];
  for (const image of images) {
    const imageUrl = typeof image === 'string' ? image : (image?.dataUrl || image?.url || image?.imageUrl);
    if (!imageUrl) continue;
    content.push({
      type: 'input_image',
      image_url: imageUrl,
      detail: image?.detail || image?.imageDetail || imageDetail || OPENAI_IMAGE_DETAIL,
    });
  }
  const hasImageInputs = content.some((item) => item.type === 'input_image');

  const data = await createResponse({
    model: model || (hasImageInputs ? OPENAI_VISION_MODEL : OPENAI_TEXT_MODEL),
    instructions: systemPrompt || undefined,
    input: [{ role: 'user', content }],
    max_output_tokens: maxOutputTokens,
    text: {
      format: {
        type: 'json_schema',
        name: schemaName,
        strict: true,
        schema,
      },
    },
  }, timeoutMs);

  const text = getResponseText(data);
  if (!text) throw new Error('OpenAI returned no JSON output');
  return { json: JSON.parse(text), text, response: data };
}

export const OPENAI_CONFIG = {
  textModel: OPENAI_TEXT_MODEL,
  visionModel: OPENAI_VISION_MODEL,
  imageDetail: OPENAI_IMAGE_DETAIL,
  timeoutMs: OPENAI_TIMEOUT_MS,
};
