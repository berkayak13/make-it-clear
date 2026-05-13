import { callOpenAIText } from './openai-client.js';

export async function callLLM(messages, systemPrompt, options = {}) {
  const userText = (messages || [])
    .map((message) => {
      const role = message.role === 'assistant' ? 'assistant' : 'user';
      return `${role}: ${message.content || ''}`;
    })
    .join('\n\n');

  try {
    const result = await callOpenAIText({
      systemPrompt,
      userText,
      model: options.model,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
      timeoutMs: options.timeoutMs,
    });
    return { success: true, result: result.text, response: result.response };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}
