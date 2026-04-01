import { captureFullPageSlices } from '../utils/screenshot-capture.js';
import { callRemoteVLMWithImages } from '../utils/vlm-client.js';
import { renarrateText, agenticRenarrateText } from '../utils/renarration.js';
import { getRemoteVlmPrompt } from '../utils/cached-prompts.js';
import { appendPipelineLog } from '../utils/pipeline-logger.js';
import { callLLM } from '../utils/llm-dispatch.js';
import { getSettingsWithTaskMigration, DEFAULT_TASKS } from '../utils/storage-helpers.js';
import { getSystemBoilerplate, applyPromptTemplate } from '../utils/prompt-loader.js';
import { createThumbnail } from '../utils/image-processing.js';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * Capture full-page screenshots, store them, and open the screenshot viewer.
 */
async function captureFullPageScreenshots(tabId) {
  try {
    const { images, meta, partial } = await captureFullPageSlices(tabId);
    const totalSize = images.reduce((sum, img) => sum + (img.dataUrl?.length || 0), 0);
    console.log(
      `[captureFullPageScreenshots] ${images.length} slices, total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`
    );

    try {
      await chrome.storage.local.set({
        lastScreenshots: images,
        lastScreenshotMeta: meta,
      });
      console.log('[captureFullPageScreenshots] Screenshots stored successfully');
    } catch (e) {
      console.error('[captureFullPageScreenshots] Storage failed:', e.message);
      await chrome.storage.local.set({
        lastScreenshots: [],
        lastScreenshotMeta: { ...meta, error: 'Screenshots too large to store' },
      });
    }

    await chrome.tabs.create({ url: chrome.runtime.getURL('viewers/screenshot-viewer.html') });
    return { success: true, count: images.length, partial };
  } catch (e) {
    console.error('[captureFullPageScreenshots] Error:', e.message);
    return { success: false, error: e?.message || String(e) };
  }
}

/**
 * Capture the page, send screenshots to a remote VLM, and store the result.
 */
async function describePageScreenshot(tabId) {
  try {
    const settings = await chrome.storage.sync.get([
      'useRemoteVLM',
      'remoteVLMModel',
      'remoteVLMEndpoint',
    ]);
    if (!settings.useRemoteVLM) return { success: false, error: 'Remote VLM is disabled in settings.' };

    const runId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    const logBase = { runId, timestampIso: new Date().toISOString() };
    const captureStarted = Date.now();

    const tab = tabId ? await chrome.tabs.get(tabId) : await getActiveTab();
    const pageTitle = tab?.title || '';
    const { images } = await captureFullPageSlices(tab?.id);
    if (!images || !images.length) return { success: false, error: 'Failed to capture page.' };

    await appendPipelineLog({
      ...logBase,
      stage: 'capture',
      success: true,
      sliceCount: images.length,
      url: tab?.url,
      title: pageTitle,
      durationMs: Date.now() - captureStarted,
      content: `Screenshots captured (${images.length})`,
    });

    const prompt = await getRemoteVlmPrompt();

    const vlmStart = Date.now();
    const remote = await callRemoteVLMWithImages({
      images,
      prompt,
      model: settings.remoteVLMModel,
      endpoint: settings.remoteVLMEndpoint,
      apiKey: GEMINI_API_KEY,
    });

    if (!remote?.success) {
      await appendPipelineLog({
        ...logBase,
        stage: 'vlm',
        success: false,
        error: remote?.error || 'Remote VLM failed',
        model: settings.remoteVLMModel,
        url: tab?.url,
        title: pageTitle,
        durationMs: Date.now() - vlmStart,
      });
      return { success: false, error: remote?.error || 'Remote VLM failed.' };
    }

    await appendPipelineLog({
      ...logBase,
      stage: 'vlm',
      success: true,
      model: settings.remoteVLMModel,
      content: remote.result,
      input: { prompt, imageCount: images.length },
      url: tab?.url,
      title: pageTitle,
      durationMs: Date.now() - vlmStart,
    });

    const combined = remote.result;
    const previewThumb = images[0]?.dataUrl ? await createThumbnail(images[0].dataUrl, 240, 240) : '';

    console.log(`[describePageScreenshot] previewThumb size: ${(previewThumb?.length || 0) / 1024} KB`);
    console.log(`[describePageScreenshot] combined content size: ${(combined?.length || 0) / 1024} KB`);

    try {
      await chrome.storage.local.set({
        lastDescribeImage: previewThumb || '',
        lastDescribeResult: {
          content: combined,
          model: settings.remoteVLMModel,
          at: new Date().toISOString(),
          runId,
        },
      });
      console.log('[describePageScreenshot] Stored lastDescribeResult successfully');
    } catch (e) {
      console.error('[describePageScreenshot] Storage failed:', e.message);
      await chrome.storage.local.set({
        lastDescribeImage: '',
        lastDescribeResult: {
          content: combined?.slice(0, 10000) || '',
          model: settings.remoteVLMModel,
          at: new Date().toISOString(),
          runId,
        },
      });
    }

    return { success: true, result: combined, runId, url: tab?.url, title: pageTitle };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
}

/**
 * Full pipeline: capture -> remote VLM -> LLM renarration.
 */
async function renarratePage(tabId) {
  try {
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { action: 'show-split-loading' }).catch(() => {});
    }

    const describe = await describePageScreenshot(tabId);
    if (!describe?.success) {
      await chrome.storage.local.set({ pageRenarrationInProgress: false });
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { action: 'hide-split-renarration' }).catch(() => {});
      }
      return describe;
    }

    const vlmContent = describe.result || '';
    const llmStart = Date.now();
    const [{ useAgenticPipeline }, { webllmModel }] = await Promise.all([
      chrome.storage.local.get(['useAgenticPipeline']),
      chrome.storage.sync.get(['webllmModel']),
    ]);
    const renarrateFunc = useAgenticPipeline ? agenticRenarrateText : renarrateText;
    const renarrated = await renarrateFunc(vlmContent, null, null, { runId: describe.runId });
    const logRunId = describe.runId || Math.random().toString(36).slice(2);

    if (!renarrated?.success) {
      await appendPipelineLog({
        runId: logRunId,
        timestampIso: new Date().toISOString(),
        stage: 'llm',
        success: false,
        error: renarrated.error || 'LLM renarration failed',
        model: webllmModel,
        url: describe.url,
        title: describe.title,
        durationMs: Date.now() - llmStart,
      });
      await chrome.storage.local.set({ pageRenarrationInProgress: false });
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { action: 'hide-split-renarration' }).catch(() => {});
      }
      return renarrated;
    }

    await appendPipelineLog({
      runId: logRunId,
      timestampIso: new Date().toISOString(),
      stage: 'llm',
      success: true,
      content: renarrated.result,
      input: renarrated.promptInfo,
      model: webllmModel,
      url: describe.url,
      title: describe.title,
      durationMs: Date.now() - llmStart,
    });

    const vlmSize = (vlmContent?.length || 0) / 1024;
    const renSize = (renarrated.result?.length || 0) / 1024;
    console.log(`[renarratePage] vlmContent: ${vlmSize.toFixed(2)} KB, renarration: ${renSize.toFixed(2)} KB`);

    try {
      await chrome.storage.local.set({
        lastPageRenarration: {
          vlmContent: vlmContent?.slice(0, 20000) || '',
          renarration: renarrated.result?.slice(0, 20000) || '',
          at: new Date().toISOString(),
        },
        pageRenarrationInProgress: false,
      });
      console.log('[renarratePage] Stored lastPageRenarration successfully');
    } catch (e) {
      console.error('[renarratePage] Storage failed:', e.message);
    }

    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        action: 'show-split-renarration',
        renarration: renarrated.result || '',
        vlmContent: vlmContent || '',
      }).catch(() => {});
    }

    return { success: true, vlmContent, renarration: renarrated.result, runId: describe.runId };
  } catch (error) {
    await chrome.storage.local.set({ pageRenarrationInProgress: false }).catch(() => {});
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { action: 'hide-split-renarration' }).catch(() => {});
    }
    return { success: false, error: error?.message || String(error) };
  }
}

/**
 * Renarrate an array of DOM text segments via the LLM, batching as needed.
 */
async function renarrateDomSegments(segments) {
  const settings = await getSettingsWithTaskMigration([
    'webllmModel',
    'personas',
    'currentPersona',
    'systemPromptTemplate',
  ]);
  const tasks = settings.tasks || DEFAULT_TASKS;
  const task = tasks[settings.currentTask] || tasks.simple || DEFAULT_TASKS.simple;
  const persona = settings.personas?.[settings.currentPersona];

  const basePrompt = task?.textPrompt || '';
  const personaText = persona ? (persona.systemAddendum || persona.description || '') : '';
  const boilerplate = await getSystemBoilerplate();
  const { readingGoal } = await chrome.storage.sync.get(['readingGoal']);
  let systemPrompt = applyPromptTemplate(
    settings.systemPromptTemplate,
    basePrompt,
    personaText,
    boilerplate,
    readingGoal || ''
  );

  systemPrompt +=
    '\n\nIMPORTANT: You will receive a JSON array of numbered text segments from a webpage. ' +
    'Renarrate each segment according to your instructions above. ' +
    'Return ONLY a valid JSON array where each element has "id" (matching the input id) and "text" (the renarrated version). ' +
    'If a segment is short navigation text, a button label, or boilerplate, return it unchanged. ' +
    'Do NOT wrap the response in markdown code fences. Return raw JSON only.';

  // Batch segments so each batch stays under a character limit.
  const MAX_CHARS_PER_BATCH = 4000;
  const batches = [];
  let currentBatch = [];
  let currentLen = 0;
  for (const seg of segments) {
    const segLen = seg.text.length;
    if (currentBatch.length > 0 && currentLen + segLen > MAX_CHARS_PER_BATCH) {
      batches.push(currentBatch);
      currentBatch = [];
      currentLen = 0;
    }
    currentBatch.push(seg);
    currentLen += segLen;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  console.log(`[renarrateDomSegments] Processing ${batches.length} batch(es) for ${segments.length} segments`);

  const allReplacements = [];
  for (const batch of batches) {
    const userMessage = JSON.stringify(batch.map((s) => ({ id: s.id, text: s.text })));
    const messages = [{ role: 'user', content: userMessage }];

    let result;
    try {
      result = await callLLM(messages, systemPrompt, { temperature: 0.3 });
    } catch (e) {
      console.warn('[renarrateDomSegments] LLM call failed:', e?.message);
      return { success: false, error: 'LLM call failed: ' + (e?.message || 'unknown') };
    }

    if (!result?.success) {
      return { success: false, error: result?.error || 'LLM returned no result' };
    }

    // Parse JSON response
    let parsed;
    try {
      const cleaned = result.result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (_e) {
      // Retry once asking for valid JSON
      console.warn('[renarrateDomSegments] JSON parse failed, retrying...');
      try {
        const retryMessages = [
          { role: 'user', content: userMessage },
          { role: 'assistant', content: result.result },
          {
            role: 'user',
            content:
              'Your response was not valid JSON. Please return ONLY a valid JSON array with objects having "id" and "text" fields. No markdown, no explanation.',
          },
        ];
        const retry = await callLLM(retryMessages, systemPrompt, { temperature: 0.1 });
        if (retry?.success) {
          const cleaned2 = retry.result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
          parsed = JSON.parse(cleaned2);
        }
      } catch (_e2) {
        return { success: false, error: 'Failed to parse LLM response as JSON after retry' };
      }
    }

    if (!Array.isArray(parsed)) {
      return { success: false, error: 'LLM did not return a JSON array' };
    }

    allReplacements.push(...parsed);
  }

  return { success: true, replacements: allReplacements };
}

/**
 * DOM-based page renarration: extract text segments, renarrate via LLM,
 * and apply replacements back into the page.
 */
async function renarratePageDom(tabId) {
  try {
    if (!tabId) return { success: false, error: 'No active tab' };

    let extractResult;
    try {
      extractResult = await chrome.tabs.sendMessage(tabId, { action: 'extract-and-clone' });
    } catch (_e) {
      return { success: false, error: 'Could not communicate with page. Try refreshing.' };
    }

    if (!extractResult?.success || !extractResult.segments?.length) {
      chrome.tabs.sendMessage(tabId, { action: 'hide-dom-renarration' }).catch(() => {});
      return renarratePage(tabId);
    }

    const segments = extractResult.segments;
    console.log(`[renarratePageDom] Extracted ${segments.length} text segments`);

    chrome.tabs
      .sendMessage(tabId, {
        action: 'update-clone-progress',
        text: `Renarrating ${segments.length} text segments...`,
      })
      .catch(() => {});

    const result = await renarrateDomSegments(segments);
    if (!result.success) {
      chrome.tabs.sendMessage(tabId, { action: 'hide-dom-renarration' }).catch(() => {});
      return result;
    }

    chrome.tabs
      .sendMessage(tabId, { action: 'apply-dom-renarration', replacements: result.replacements })
      .catch(() => {});

    try {
      const renarrationText = result.replacements.map((r) => r.text).join('\n\n');
      const originalText = segments.map((s) => s.text).join('\n\n');
      await chrome.storage.local.set({
        lastPageRenarration: {
          vlmContent: originalText.slice(0, 20000),
          renarration: renarrationText.slice(0, 20000),
          at: new Date().toISOString(),
        },
      });
    } catch (e) {
      console.warn('[renarratePageDom] Storage failed:', e?.message);
    }

    return { success: true, segmentCount: segments.length, replacementCount: result.replacements.length };
  } catch (error) {
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { action: 'hide-dom-renarration' }).catch(() => {});
    }
    return { success: false, error: error?.message || String(error) };
  }
}

// ---------------------------------------------------------------------------
// Exported handler map
// ---------------------------------------------------------------------------

export const pageHandlers = {
  'capture-fullpage': async (request, sender) => {
    return captureFullPageScreenshots(sender?.tab?.id);
  },

  'describe-page-screenshot': async (request, sender) => {
    return describePageScreenshot(sender?.tab?.id);
  },

  'renarrate-page': async (request, sender) => {
    const tabId = sender?.tab?.id ?? request.tabId;
    return renarratePage(tabId);
  },

  'renarrate-page-dom': async (request, sender) => {
    const tabId = sender?.tab?.id ?? request.tabId;
    return renarratePageDom(tabId);
  },
};
