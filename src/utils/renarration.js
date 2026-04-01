// Core renarration functions ported from background.js to ES modules.

import { callLLM } from './llm-dispatch.js';
import { getSettingsWithTaskMigration, DEFAULT_TASKS } from './storage-helpers.js';
import { getEvaluationPrompt } from './cached-prompts.js';
import { generateId } from './id.js';
import { researchPut, researchGetByIndex } from './firestore-client.js';
import { getSystemBoilerplate, applyPromptTemplate } from './prompt-loader.js';

const AGENTIC_MAX_ATTEMPTS = 3;
const AGENTIC_SCORE_THRESHOLD = 3.5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getOrCreateUserId() {
  const { studyUserId } = await chrome.storage.local.get(['studyUserId']);
  if (studyUserId) return studyUserId;
  const newId = 'P' + String(Date.now()).slice(-4);
  await chrome.storage.local.set({ studyUserId: newId });
  return newId;
}

export function truncateForContext(text, maxChars = 12000) {
  return text.length > maxChars ? text.slice(0, maxChars) + '...(truncated)' : text;
}

// ---------------------------------------------------------------------------
// Simulate local LLM processing
// ---------------------------------------------------------------------------

export async function simulateLocalLLM(text, task) {
  await new Promise(resolve => setTimeout(resolve, 500));

  const originalLength = text.length;
  const words = text.split(/\s+/);
  const fallbackMaxLength = Math.min(200, originalLength);
  const maxLength = Number.isFinite(task?.maxLength) && task.maxLength > 0
    ? task.maxLength
    : fallbackMaxLength;

  switch (task.name) {
    case 'Simple Language':
      return `Simplified version: ${text.substring(0, Math.min(maxLength, originalLength))}. This means the content is about ${words.length} key ideas presented in an easier way.`;

    case 'Detailed Explanation':
      return `Detailed analysis: ${text}\n\nThis text contains ${words.length} words and covers several important points. The main ideas are interconnected and provide comprehensive information about the topic.`;

    case 'Academic Style':
      return `In scholarly terms, the aforementioned content posits: ${text.substring(0, Math.min(maxLength, originalLength))}. This represents a formal interpretation of the source material.`;

    case 'Summary':
      return `Brief summary: ${text.substring(0, Math.min(100, originalLength))}...`;

    default:
      return text;
  }
}

// ---------------------------------------------------------------------------
// Simulate local VLM processing
// ---------------------------------------------------------------------------

export async function simulateLocalVLM(imageUrl, task) {
  await new Promise(resolve => setTimeout(resolve, 800));

  const imageName = imageUrl.split('/').pop().split('?')[0];

  switch (task.name) {
    case 'Simple Language':
      return `This is an image showing visual content. The image appears to be "${imageName}". It contains various elements arranged on the page.`;

    case 'Detailed Explanation':
      return `Comprehensive image analysis: This image (${imageName}) contains multiple visual elements. The composition includes foreground and background elements with specific positioning. Colors, shapes, and textures contribute to the overall visual message. The image serves a specific purpose within the context of the page.`;

    case 'Academic Style':
      return `Visual analysis: The image denoted as "${imageName}" presents a structured composition wherein various elements are arranged according to design principles. The visual hierarchy and spatial relationships suggest intentional placement for communicative purposes.`;

    case 'Summary':
      return `Image: ${imageName} - Contains visual elements relevant to the page content.`;

    default:
      return `Image description: ${imageName}`;
  }
}

// ---------------------------------------------------------------------------
// renarrateText
// ---------------------------------------------------------------------------

export async function renarrateText(text, taskName, overrideTask, options = {}) {
  const settings = await getSettingsWithTaskMigration([
    'webllmModel',
    'personas',
    'currentPersona',
    'systemPromptTemplate'
  ]);
  const tasks = settings.tasks || DEFAULT_TASKS;
  const baseTask = tasks[taskName || settings.currentTask] || tasks.simple || DEFAULT_TASKS.simple;
  const task = overrideTask || baseTask;
  const effectiveModelId = options?.modelId || settings.webllmModel;

  // Determine persona to apply (test case override > explicit text > global selection)
  let persona = null;
  if (options?.personaKey && settings.personas?.[options.personaKey]) {
    persona = settings.personas[options.personaKey];
  } else if (typeof options?.personaText === 'string' && options.personaText.trim()) {
    const addendum = options.personaText.trim();
    persona = {
      name: options.personaKey || 'Custom Persona',
      description: options.personaText.trim(),
      systemAddendum: addendum
    };
  } else {
    persona = settings.personas?.[settings.currentPersona];
  }

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
  // Agentic pipeline: append evaluator improvement suggestion
  if (options.promptAugmentation) {
    systemPrompt += '\n\n' + options.promptAugmentation;
  }
  const personaAugmentedTask = { ...task, textPrompt: systemPrompt };

  const maxOutputTokens = personaAugmentedTask?.maxLength
    ? Math.max(64, Math.min(512, Math.ceil(personaAugmentedTask.maxLength * 1.5)))
    : 256;
  const offscreenTimeoutMs = Math.max(90000, Math.min(240000, maxOutputTokens * 400));
  const promptInfo = {
    systemPrompt: personaAugmentedTask?.textPrompt || '',
    userText: truncateForContext(text)
  };

  // Route through unified LLM dispatch
  try {
    const messages = [{ role: 'user', content: promptInfo.userText }];
    const result = await callLLM(messages, promptInfo.systemPrompt, {
      modelId: effectiveModelId,
      timeoutMs: offscreenTimeoutMs,
      temperature: 0.3
    });
    if (result && result.success) return { ...result, promptInfo };
    console.warn('LLM call failed, falling back to simulator:', result && result.error);
  } catch (e) {
    console.warn('LLM unavailable, falling back:', e && e.message);
  }
  // Fallback: simulate processing with local model
  const renarrated = await simulateLocalLLM(text, personaAugmentedTask);
  return { success: true, result: renarrated, promptInfo };
}

// ---------------------------------------------------------------------------
// evaluateRenarration
// ---------------------------------------------------------------------------

export async function evaluateRenarration(originalText, renarrationOutput, taskInfo, personaInfo, readingGoalText) {
  if (!originalText || !renarrationOutput) {
    return { success: false, error: 'Missing original text or renarration output for evaluation' };
  }
  const evalPrompt = await getEvaluationPrompt();
  const userContent = [
    'Original text:', String(originalText).slice(0, 3000),
    '\nRenarrated output:', String(renarrationOutput).slice(0, 3000),
    '\nTask:', taskInfo || 'N/A',
    '\nPersona:', personaInfo || 'N/A',
    '\nReading Goal:', readingGoalText || 'N/A'
  ].join('\n');

  const messages = [{ role: 'user', content: userContent }];
  const result = await callLLM(messages, evalPrompt);
  if (!result.success) return { success: false, error: result.error };

  try {
    const jsonStr = result.result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const scores = JSON.parse(jsonStr);
    const appropriateness = Number(scores.appropriateness) || 0;
    const faithfulness = Number(scores.faithfulness) || 0;
    const clarity = Number(scores.clarity) || 0;
    const tone = Number(scores.tone) || 0;
    scores.averageScore = scores.averageScore ?? ((appropriateness + faithfulness + clarity + tone) / 4);
    return { success: true, scores };
  } catch (e) {
    return { success: false, error: 'Failed to parse evaluation JSON: ' + e.message, raw: result.result };
  }
}

// ---------------------------------------------------------------------------
// agenticRenarrateText
// ---------------------------------------------------------------------------

export async function agenticRenarrateText(text, taskName, overrideTask, options = {}) {
  const userId = await getOrCreateUserId();
  const experimentId = generateId();
  const attempts = [];
  const maxAttempts = AGENTIC_MAX_ATTEMPTS;
  const threshold = AGENTIC_SCORE_THRESHOLD;
  let bestResult = null;
  let bestScore = 0;
  let promptAugmentation = '';

  const settings = await getSettingsWithTaskMigration(['personas', 'currentPersona']);
  const tasks = settings.tasks || DEFAULT_TASKS;
  const task = overrideTask || tasks[taskName || settings.currentTask] || tasks.simple || DEFAULT_TASKS.simple;
  const persona = settings.personas?.[settings.currentPersona];
  const taskInfo = task?.textPrompt || '';
  const personaInfo = persona?.systemAddendum || persona?.description || '';
  const { readingGoal } = await chrome.storage.sync.get(['readingGoal']);

  for (let i = 0; i < maxAttempts; i++) {
    const attemptOpts = { ...options };
    if (promptAugmentation) attemptOpts.promptAugmentation = promptAugmentation;

    const result = await renarrateText(text, taskName, overrideTask, attemptOpts);
    if (!result?.success) {
      attempts.push({ attempt: i + 1, success: false, error: result?.error });
      continue;
    }

    let evalResult;
    try {
      evalResult = await Promise.race([
        evaluateRenarration(text, result.result, taskInfo, personaInfo, readingGoal || ''),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Evaluation timed out')), 30000))
      ]);
    } catch (e) {
      evalResult = { success: false, error: e.message };
    }
    const score = evalResult?.success ? evalResult.scores.averageScore : 0;
    const attemptData = {
      attempt: i + 1,
      success: true,
      output: result.result,
      scores: evalResult?.success ? evalResult.scores : null,
      averageScore: score
    };
    attempts.push(attemptData);

    if (score > bestScore) {
      bestScore = score;
      bestResult = result;
    }

    if (score >= threshold || i === maxAttempts - 1) break;

    // Use improvement suggestion for next attempt
    const suggestion = evalResult?.scores?.improvementSuggestion;
    if (suggestion && suggestion !== 'None') {
      promptAugmentation = 'Improvement instruction from evaluator: ' + suggestion;
    }
  }

  const agenticMeta = {
    experimentId,
    attemptCount: attempts.length,
    bestScore,
    attempts
  };

  // Log to experimentRuns
  try {
    const { enableResearchLogging } = await chrome.storage.local.get(['enableResearchLogging']);
    if (enableResearchLogging !== false) {
      await Promise.all([
        researchPut('experimentRuns', {
          experimentId,
          userId,
          timestamp: Date.now(),
          taskName: task?.name || taskName,
          personaName: persona?.name || settings.currentPersona,
          inputTextSample: text.slice(0, 500),
          attempts,
          bestScore,
          bestOutput: bestResult?.result?.slice(0, 2000) || ''
        }),
        researchPut('researchLogs', {
          logId: generateId(),
          userId,
          timestamp: Date.now(),
          category: 'renarration',
          subcategory: 'agentic-run',
          experimentId,
          attemptCount: attempts.length,
          bestScore,
          taskName: task?.name || taskName,
          personaName: persona?.name || settings.currentPersona
        })
      ]);
    }
  } catch (e) {
    console.warn('Failed to log agentic experiment:', e);
  }

  if (bestResult) {
    return { ...bestResult, agenticMeta };
  }
  return { success: false, error: 'All agentic attempts failed', agenticMeta };
}

// ---------------------------------------------------------------------------
// checkFeedbackTrends
// ---------------------------------------------------------------------------

export async function checkFeedbackTrends() {
  try {
    const userId = await getOrCreateUserId();
    const allFeedback = await researchGetByIndex('feedbackEvents', 'userId', userId);
    const recent = allFeedback
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);
    const negativeCount = recent.filter(f => f.feedbackType === 'thumbs-down').length;
    return { shouldRefine: negativeCount >= 3, negativeCount, recentCount: recent.length };
  } catch (e) {
    return { shouldRefine: false };
  }
}

// ---------------------------------------------------------------------------
// setUserId
// ---------------------------------------------------------------------------

export async function setUserId(newUserId) {
  const oldId = await getOrCreateUserId();
  await chrome.storage.local.set({ studyUserId: newUserId });
  try {
    await researchPut('preferenceHistory', {
      timestamp: Date.now(),
      userId: newUserId,
      field: 'userId',
      oldValue: oldId,
      newValue: newUserId
    });
  } catch (e) {
    console.warn('Failed to log userId change:', e);
  }
  return newUserId;
}
