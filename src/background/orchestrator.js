// Dynamic Orchestrator — coordinates all 11 agents in the agentic pipeline.
// Uses static imports to avoid Vite's preload polyfill (incompatible with service workers).

import { generateId } from '../utils/id.js';
import { appendPipelineLog } from '../utils/pipeline-logger.js';
import { loadMemory } from '../utils/memory-system.js';
import { getOrCreateUserId, getSettingsWithTaskMigration, DEFAULT_TASKS } from '../utils/storage-helpers.js';
import { getSystemBoilerplate, applyPromptTemplate } from '../utils/prompt-loader.js';
import { callLLM } from '../utils/llm-dispatch.js';

import * as routerAgent from '../agents/agent-0-router.js';
import * as intentAgent from '../agents/agent-1-intent.js';
import * as cartographerAgent from '../agents/agent-2-visual-cartographer.js';
import * as narratorAgent from '../agents/agent-4-narrator.js';
import * as qualityAgent from '../agents/agent-6-quality-validator.js';
import * as memoryAgent from '../agents/agent-7-memory-manager.js';
import * as feedbackAgent from '../agents/agent-8-feedback-analyst.js';
import * as predictiveAgent from '../agents/agent-9-predictive-adapter.js';
import * as guardrailsAgent from '../agents/agent-10-guardrails.js';

const ALL_AGENTS = [
  routerAgent, intentAgent, cartographerAgent, narratorAgent,
  guardrailsAgent, qualityAgent, memoryAgent, feedbackAgent, predictiveAgent
].filter(a => a && a.name && !a.disabled);

// Send progress text to the clone sidebar's loading spinner
function sendProgress(tabId, text) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, { action: 'update-clone-progress', text }).catch(() => {});
}

export async function runPipeline(request) {
  console.log('[Pipeline] ▶ Starting pipeline run');
  console.log('[Pipeline] Request:', { text: (request.text || request.message || '').slice(0, 100), tabId: request.tabId, hasMetadata: !!request.pageMetadata });
  const context = {
    runId: generateId(),
    timestamp: Date.now(),
    tabId: request.tabId || null,
    userId: null,
    rawRequest: request.text || request.message || '',
    chatHistory: request.chatHistory || [],
    pageMetadata: request.pageMetadata || {},
    pipelineType: null,
    agentPlan: [],
    intent: null,
    memory: { semantic: {}, episodic: [], procedural: {} },
    sectionMap: [],
    readingGoal: null,
    screenshots: [],
    renarrationPlan: [],
    renarrations: [],
    guardrails: { passed: true, flags: [] },
    validation: { scores: {}, passed: true, retryCount: 0, failureMemory: [] },
    log: [],
    needsRetry: false,
    replanSignal: null,
    needsUserConfirmation: false,
  };

  const tabId = context.tabId;

  // Step 1: Open the clone sidebar immediately (shows loading spinner)
  let segments = [];
  let sidebarOpen = false;
  if (tabId) {
    // Check the tab is a real web page (not chrome://, extension, etc.)
    let tab;
    try { tab = await chrome.tabs.get(tabId); } catch {}
    const url = tab?.url || '';
    const isWebPage = url.startsWith('http://') || url.startsWith('https://');

    if (isWebPage) {
      console.log('[Pipeline] Tab URL:', url);
      // Try to open sidebar via content script
      try {
        const extractResult = await chrome.tabs.sendMessage(tabId, { action: 'extract-and-clone' });
        if (extractResult?.success && extractResult.segments?.length) {
          sidebarOpen = true;
          segments = extractResult.segments;
          console.log('[Pipeline] Extracted', segments.length, 'segments from page');
          context.sectionMap = segments.map(s => ({
            id: s.id, role: 'body', text: s.text,
            importance: 3, excluded: false, visualContext: ''
          }));
          sendProgress(tabId, 'Starting agentic pipeline...');
        }
      } catch (e1) {
        // Content script might not be injected — try injecting it first
        console.warn('[Orchestrator] Content script not responding, injecting...', e1.message);
        try {
          await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
          await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
          // Retry with backoff until content script responds (deduplication: stop on first success)
          let extractResult = null;
          for (const delay of [300, 800]) {
            await new Promise(r => setTimeout(r, delay));
            try {
              extractResult = await chrome.tabs.sendMessage(tabId, { action: 'extract-and-clone' });
              if (extractResult?.success) break;
            } catch {
              extractResult = null;
            }
          }
          if (extractResult?.success && extractResult.segments?.length) {
            sidebarOpen = true;
            segments = extractResult.segments;
            context.sectionMap = segments.map(s => ({
              id: s.id, role: 'body', text: s.text,
              importance: 3, excluded: false, visualContext: ''
            }));
            sendProgress(tabId, 'Starting agentic pipeline...');
          }
        } catch (e2) {
          console.warn('[Orchestrator] Could not inject content script:', e2.message);
        }
      }
    } else {
      console.warn('[Orchestrator] Tab is not a web page:', url);
    }
  }

  // Step 2: Load memory
  sendProgress(tabId, 'Loading user memory...');
  try {
    const userId = await getOrCreateUserId();
    context.userId = userId;
    try {
      context.memory = await loadMemory(userId);
    } catch (memErr) {
      console.warn('[Orchestrator] Memory load failed, using defaults:', memErr?.message);
      // Keep the default stub: { semantic: {}, episodic: [], procedural: {} }
    }
  } catch (e) {
    console.warn('[Orchestrator] User ID retrieval failed:', e?.message);
  }

  // Step 2b: Load reading goal
  try {
    const { readingGoal } = await chrome.storage.sync.get(['readingGoal']);
    if (readingGoal) {
      context.readingGoal = typeof readingGoal === 'object' ? readingGoal : { readingGoal };
      const goalText = context.readingGoal.readingGoal || '';
      console.log('[Pipeline] Reading goal:', goalText.slice(0, 80) || 'none', '| lang:', context.readingGoal.language || 'none');
    }
  } catch (e) {
    console.warn('[Orchestrator] Reading goal load failed:', e?.message);
  }

  // Step 3: Run pipeline router
  sendProgress(tabId, 'Phase 0: Routing pipeline...');
  if (routerAgent?.run) {
    await executeAgent(routerAgent, context);
  } else {
    context.pipelineType = 'full';
    context.agentPlan = ALL_AGENTS.map(a => a.name).filter(Boolean);
  }

  console.log('[Pipeline] Route:', context.pipelineType, '| Agents:', context.agentPlan.join(' → '));
  sendProgress(tabId, `Pipeline: ${context.pipelineType} — running ${context.agentPlan.length} agents...`);

  // Step 4: Execute agents in order, showing progress for each
  const agentMap = new Map(ALL_AGENTS.map(a => [a.name, a]));
  const agentLabels = Object.fromEntries(AGENTS_META.map(a => [a.id, a.label]));
  let agentIndex = 0;

  for (const agentName of context.agentPlan) {
    if (agentName === 'pipeline-router') continue;
    const agent = agentMap.get(agentName);
    if (!agent || agent.disabled) continue;

    agentIndex++;
    const label = agentLabels[agentName] || agentName;
    if (sidebarOpen) sendProgress(tabId, `Agent ${agentIndex}/${context.agentPlan.length}: ${label}...`);

    if (agent.requiredFields?.length) {
      const missing = agent.requiredFields.filter(f => !context[f]);
      if (missing.length) {
        console.log(`[Pipeline] ⏭ Skipping ${agentName} — missing: ${missing.join(', ')}`);
        context.log.push({ agent: agentName, durationMs: 0, success: false, detail: `Missing fields: ${missing.join(', ')}` });
        if (!agent.optional) break;
        continue;
      }
    }

    await executeAgent(agent, context);

    // Log guardrails flags but continue — XSS content was already sanitized in-place
    if (agentName === 'guardrails' && !context.guardrails?.passed) {
      console.log('[Pipeline] Guardrails flagged', context.guardrails?.flags?.length, 'issues (sanitized in-place)');
      context.log.push({ agent: 'orchestrator', success: true, detail: 'Guardrails flagged issues (XSS sanitized in-place)', flags: context.guardrails?.flags });
    }

  }

  // Step 5: Display results in the sidebar
  const totalDur = Date.now() - context.timestamp;
  console.log(`[Pipeline] ■ Pipeline complete in ${totalDur}ms | sections: ${context.sectionMap?.length || 0} | renarrations: ${context.renarrations?.length || 0} | validation: ${context.validation?.passed ? 'PASS' : 'FAIL'} (avg ${context.validation?.scores?.averageScore?.toFixed?.(1) || '?'}) | guardrails: ${context.guardrails?.flags?.length || 0} flags`);
  if (sidebarOpen) sendProgress(tabId, 'Applying renarration to page...');

  if (sidebarOpen && tabId) {
    if (context.renarrations?.length > 0) {
      console.log('[Pipeline] Applying', context.renarrations.length, 'renarrations to DOM');
      // Map sectionIds back to DOM data-renarration-id attributes.
      // VLM uses "section-0" format, DOM uses numeric "0" — build a lookup from sectionMap to segments.
      const idMap = new Map();
      if (segments.length > 0) {
        const sectionMap = context.sectionMap || [];
        for (let i = 0; i < sectionMap.length; i++) {
          const seg = segments[i];
          if (seg) idMap.set(String(sectionMap[i].id), String(seg.id));
        }
      }
      const replacements = context.renarrations.map(r => {
        const domId = idMap.get(String(r.sectionId)) ?? String(r.sectionId);
        return { id: domId, text: r.text };
      });
      try {
        await chrome.tabs.sendMessage(tabId, { action: 'apply-dom-renarration', replacements });
      } catch (e) {
        console.warn('[Orchestrator] Could not apply renarrations:', e.message);
      }
    } else if (segments.length > 0) {
      // Agents didn't produce renarrations — fall back to legacy DOM renarration
      sendProgress(tabId, 'Falling back to direct renarration...');
      try {
        // Batch renarrate segments (same as renarrateDomSegments in page-renarration.js)
        const settings = await getSettingsWithTaskMigration(['personas', 'currentPersona', 'systemPromptTemplate']);
        const tasks = settings.tasks || DEFAULT_TASKS;
        const task = tasks[settings.currentTask] || tasks.simple || DEFAULT_TASKS.simple;
        const persona = settings.personas?.[settings.currentPersona];
        const basePrompt = task?.textPrompt || '';
        const personaText = persona ? (persona.systemAddendum || persona.description || '') : '';
        const boilerplate = await getSystemBoilerplate();
        const { readingGoal } = await chrome.storage.sync.get(['readingGoal']);
        let systemPrompt = applyPromptTemplate(settings.systemPromptTemplate, basePrompt, personaText, boilerplate, readingGoal || '');
        systemPrompt += '\n\nIMPORTANT: You will receive a JSON array of numbered text segments from a webpage. Renarrate each segment. Return ONLY a valid JSON array where each element has "id" and "text" fields. No markdown, no explanation.';

        const MAX_CHARS = 4000;
        const batches = [];
        let batch = [], batchLen = 0;
        for (const seg of segments) {
          if (batch.length > 0 && batchLen + seg.text.length > MAX_CHARS) {
            batches.push(batch);
            batch = [];
            batchLen = 0;
          }
          batch.push(seg);
          batchLen += seg.text.length;
        }
        if (batch.length) batches.push(batch);

        const allReplacements = [];
        for (let i = 0; i < batches.length; i++) {
          sendProgress(tabId, `Renarrating batch ${i + 1}/${batches.length}...`);
          const userMsg = JSON.stringify(batches[i].map(s => ({ id: s.id, text: s.text })));
          const result = await callLLM([{ role: 'user', content: userMsg }], systemPrompt, { temperature: 0.3 });
          if (result?.success) {
            try {
              const cleaned = result.result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
              const parsed = JSON.parse(cleaned);
              if (Array.isArray(parsed)) allReplacements.push(...parsed);
            } catch { /* parse failed, skip batch */ }
          }
        }

        if (allReplacements.length > 0) {
          await chrome.tabs.sendMessage(tabId, { action: 'apply-dom-renarration', replacements: allReplacements });
        }
      } catch (e) {
        console.warn('[Orchestrator] Fallback renarration failed:', e.message);
        sendProgress(tabId, `\u26A0 Renarration failed: ${e.message}`);
      }
    } else {
      // No segments at all — show error in sidebar
      sendProgress(tabId, '\u26A0 No content segments found on this page.');
    }
  }

  // Step 6: Background tasks and logging — all wrapped so nothing can crash the return
  try {
    await updateVisualizerState(context);
  } catch (e) {
    console.warn('[Orchestrator] Visualizer state update failed:', e.message);
  }

  try {
    await appendPipelineLog({
      runId: context.runId,
      stage: 'pipeline-complete',
      timestampIso: new Date().toISOString(),
      success: context.validation.passed,
      pipelineType: context.pipelineType,
      duration: Date.now() - context.timestamp,
      agentCount: context.log.length,
      detail: JSON.stringify(context.validation.scores)
    });
  } catch (e) {
    console.warn('[Orchestrator] Pipeline log failed:', e.message);
  }

  // Background learning agents — truly fire-and-forget, fully guarded
  try {
    runBackgroundAgents(context).catch(e =>
      console.warn('[Orchestrator] Background agent failed:', e.message)
    );
  } catch (e) {
    console.warn('[Orchestrator] Background agents could not start:', e.message);
  }

  // Store for viewer access
  if (context.renarrations?.length > 0 || segments.length > 0) {
    const renarrationText = context.renarrations?.length > 0
      ? context.renarrations.map(r => r.text).join('\n\n')
      : '';
    const originalText = (context.sectionMap || segments).map(s => s.text || '').join('\n\n');
    try {
      await chrome.storage.local.set({
        lastPageRenarration: {
          vlmContent: originalText.slice(0, 20000),
          renarration: renarrationText.slice(0, 20000),
          at: new Date().toISOString()
        }
      });
    } catch {}
  }

  return context;
}

// Agent display names for progress messages
const AGENTS_META = [
  { id: 'pipeline-router', label: 'Pipeline Router' },
  { id: 'intent-analyst', label: 'Intent Analyst' },
  { id: 'visual-cartographer', label: 'Visual Cartographer' },
  { id: 'narrator', label: 'Narrator' },
  { id: 'guardrails', label: 'Guardrails' },
  { id: 'quality-validator', label: 'Quality Validator' },
  { id: 'memory-manager', label: 'Memory Manager' },
  { id: 'feedback-analyst', label: 'Feedback Analyst' },
  { id: 'predictive-adapter', label: 'Predictive Adapter' },
];

// Define which context fields each agent reads (input) and writes (output)
const AGENT_IO = {
  'pipeline-router':     { in: ['rawRequest', 'pageMetadata'], out: ['pipelineType', 'agentPlan'] },
  'intent-analyst':      { in: ['rawRequest', 'chatHistory', 'readingGoal', 'memory'], out: ['intent'] },
  'visual-cartographer': { in: ['tabId'], out: ['sectionMap', 'screenshots'] },
  'narrator':            { in: ['intent', 'sectionMap', 'renarrationPlan'], out: ['renarrations'] },
  'guardrails':          { in: ['renarrations', 'sectionMap'], out: ['guardrails'] },
  'quality-validator':   { in: ['renarrations', 'intent', 'guardrails', 'validation'], out: ['validation', 'needsRetry', 'replanSignal'] },
  'memory-manager':      { in: ['renarrations', 'intent', 'validation'], out: ['memory'] },
  'feedback-analyst':    { in: [], out: [] },
  'predictive-adapter':  { in: ['pageMetadata', 'memory'], out: [] },
};

function snapshotValue(val, depth) {
  if (val == null) return null;
  if (typeof val === 'string') return val.length > 200 ? val.slice(0, 200) + '...' : val;
  if (typeof val !== 'object') return val;
  if (Array.isArray(val)) {
    if (val.length === 0) return [];
    if (depth > 1) return `[${val.length} items]`;
    return val.slice(0, 5).map(v => snapshotValue(v, depth + 1));
  }
  const keys = Object.keys(val);
  if (depth > 1 && keys.length > 5) return `{${keys.length} fields}`;
  const summary = {};
  for (const k of keys) {
    summary[k] = snapshotValue(val[k], depth + 1);
  }
  return summary;
}

function snapshotField(context, key) {
  return snapshotValue(context[key], 0);
}

function captureSnapshot(context, fields) {
  const snap = {};
  for (const f of fields) {
    snap[f] = snapshotField(context, f);
  }
  return snap;
}

async function executeAgent(agent, context) {
  const start = Date.now();
  const label = AGENTS_META.find(a => a.id === agent.name)?.label || agent.name;
  const io = AGENT_IO[agent.name] || { in: [], out: [] };

  // Capture input snapshot before running
  const inputSnap = captureSnapshot(context, io.in);

  console.log(`[Pipeline] ▶ ${label} starting | input:`, inputSnap);

  // Mark as running BEFORE execution so visualizer shows blue
  await updateVisualizerAgentStatus(agent.name, 'running', 0, context, { input: inputSnap });

  try {
    await agent.run(context);
    const dur = Date.now() - start;
    const outputSnap = captureSnapshot(context, io.out);
    context.agentSnapshots = context.agentSnapshots || {};
    context.agentSnapshots[agent.name] = { input: inputSnap, output: outputSnap };
    context.log.push({ agent: agent.name, durationMs: dur, success: true, detail: '' });
    console.log(`[Pipeline] ✓ ${label} done (${dur}ms) | output:`, outputSnap);
    await updateVisualizerAgentStatus(agent.name, 'success', dur, context, { input: inputSnap, output: outputSnap });
  } catch (e) {
    const dur = Date.now() - start;
    const snapshot = { input: inputSnap, output: null, error: e.message };
    context.agentSnapshots = context.agentSnapshots || {};
    context.agentSnapshots[agent.name] = snapshot;
    context.log.push({ agent: agent.name, durationMs: dur, success: false, detail: e.message });
    console.error(`[Pipeline] ✗ ${label} failed (${dur}ms):`, e.message);
    await updateVisualizerAgentStatus(agent.name, 'failed', dur, context, snapshot);
    sendProgress(context.tabId, `\u26A0 ${label} failed: ${e.message}`);
    if (!agent.optional) throw e;
  }
}

async function runBackgroundAgents(context) {
  for (const agentName of ['quality-validator', 'memory-manager', 'feedback-analyst']) {
    const agent = ALL_AGENTS.find(a => a.name === agentName);
    if (agent) {
      try {
        await executeAgent(agent, context);
      } catch (e) {
        console.warn(`[Orchestrator] Background agent ${agentName} failed:`, e.message);
      }
    }
  }
}

async function updateVisualizerState(context) {
  // Strip large text from renarrations but keep mermaid diagrams + sectionId
  const renarrationsSummary = (context.renarrations || []).map(r => ({
    sectionId: r.sectionId,
    ...(r.mermaid ? { mermaid: r.mermaid } : {}),
  }));

  const state = {
    runId: context.runId, timestamp: context.timestamp,
    pipelineType: context.pipelineType, agentPlan: context.agentPlan,
    log: context.log, validation: context.validation, guardrails: context.guardrails,
    intent: context.intent || null,
    memory: context.memory ? {
      semantic: context.memory.semantic || {},
      episodic: (context.memory.episodic || []).slice(0, 10),
      procedural: context.memory.procedural || {},
    } : null,
    renarrations: renarrationsSummary,
    sectionCount: (context.sectionMap || []).length,
    renarrationCount: (context.renarrations || []).length,
    agentSnapshots: context.agentSnapshots || {},
    completed: true,
  };

  await chrome.storage.local.set({ pipelineVisualizer: state });

  // Also persist per-run state so historical runs retain full detail
  try {
    const { pipelineRunHistory = {} } = await chrome.storage.local.get('pipelineRunHistory');
    pipelineRunHistory[context.runId] = state;
    // Keep only last 20 runs to avoid storage bloat
    const keys = Object.keys(pipelineRunHistory);
    if (keys.length > 20) {
      const sorted = keys.sort((a, b) =>
        (pipelineRunHistory[a].timestamp || 0) - (pipelineRunHistory[b].timestamp || 0)
      );
      for (const k of sorted.slice(0, keys.length - 20)) delete pipelineRunHistory[k];
    }
    await chrome.storage.local.set({ pipelineRunHistory });
  } catch (e) { console.warn('[Orchestrator] Run history save failed:', e.message); }
}

async function updateVisualizerAgentStatus(agentName, status, durationMs, context, snapshot) {
  try {
    const data = await chrome.storage.local.get('pipelineVisualizerLive');
    const current = data?.pipelineVisualizerLive || {};
    current[agentName] = { status, durationMs, timestamp: Date.now() };
    if (snapshot) current[agentName].snapshot = snapshot;
    current._runId = context.runId;
    current._pipelineType = context.pipelineType;
    await chrome.storage.local.set({ pipelineVisualizerLive: current });
  } catch (e) { /* best-effort */ }
}

export async function runPredictiveAdapter(tabId, pageMetadata) {
  if (!predictiveAgent?.run) return { suggestions: [], greeting: '' };
  const context = { tabId, pageMetadata, memory: { semantic: {}, episodic: [], procedural: {} }, log: [] };
  try {
    const userId = await getOrCreateUserId();
    context.memory = await loadMemory(userId);
  } catch (e) {
    console.warn('[runPredictiveAdapter] Memory load failed:', e?.message);
  }
  const result = await predictiveAgent.run(context);
  return { suggestions: result?.suggestions || [], greeting: result?.greeting || '' };
}
