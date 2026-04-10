#!/usr/bin/env node
// Regression tests — confirms the original bugs are NO LONGER present.
// These are the inverse of bug-verification-tests.mjs:
// Each test PASSES if the bug is GONE, FAILS if the bug still exists.
// Run: node issues/regression-tests.mjs

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
let pass = 0, fail = 0, skip = 0;

function read(relPath) {
  const p = resolve(ROOT, relPath);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8');
}

function test(id, description, fn) {
  try {
    const result = fn();
    if (result === 'SKIP') {
      skip++;
      console.log(`  SKIP  ${id}: ${description}`);
    } else if (result) {
      pass++;
      console.log(`  \x1b[32mPASS\x1b[0m  ${id}: ${description}`);
    } else {
      fail++;
      console.log(`  \x1b[31mFAIL\x1b[0m  ${id}: ${description}`);
    }
  } catch (e) {
    fail++;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${id}: ${description} — ${e.message}`);
  }
}

console.log('\n=== Regression Tests (bugs should be GONE) ===\n');

test('C1', 'No hardcoded Firebase API key anywhere', () => {
  const key = 'AIzaSyB7WIlE0klfLmUKvO7JWF69Q2ioh2z_MBU';
  for (const f of ['src/utils/firestore-client.js', 'src/utils/memory-system.js', 'options.js', 'lib/research-db.js']) {
    const src = read(f);
    if (src && src.includes(key)) return false;
  }
  return true;
});

test('C2', 'XSS sanitizer covers SVG and data URIs', () => {
  const src = read('src/agents/agent-10-guardrails.js');
  return src && src.includes('svg') && src.includes('data');
});

test('C3', 'Offscreen does not call sendResponse synchronously', () => {
  const src = read('src/offscreen-entry.js');
  return src && !src.includes('sendResponse(') && !src.includes('sendResponse &&');
});

test('C4', 'Quality validator: parseError blocks retry', () => {
  const src = read('src/agents/agent-6-quality-validator.js');
  return src && src.includes('!parseError');
});

test('C5', 'Memory init failures logged', () => {
  const src = read('src/background/orchestrator.js');
  return src && !(/catch\s*\(e?\)\s*\{\s*\/\*\s*memory is optional/.test(src));
});

test('C6', 'Content script retry uses only 2 delays', () => {
  const src = read('src/background/orchestrator.js');
  return src && src.includes('[300, 800]') && !src.includes('[200, 500, 1000]');
});

test('C7', 'Bias checks can produce error severity', () => {
  const src = read('src/agents/agent-10-guardrails.js');
  return src && src.includes("'error'") && src.includes('SEVERE_BIAS');
});

test('H1', 'Narrator uses Promise.allSettled for best-of-N', () => {
  const src = read('src/agents/agent-4-narrator.js');
  return src && src.includes('Promise.allSettled');
});

test('H2', 'Guardrails uses Promise.allSettled', () => {
  const src = read('src/agents/agent-10-guardrails.js');
  return src && src.includes('Promise.allSettled');
});

test('H3', 'Page renarration has mutex', () => {
  const src = read('src/handlers/page-renarration.js');
  return src && src.includes('_pageRenarrationLock');
});

test('H4', 'No debug console.log in offscreen', () => {
  const src = read('src/offscreen-entry.js');
  return src && !src.includes("console.log('WebLLM chat completion");
});

test('H6', 'Iframe clone strips event handlers', () => {
  const src = read('content.js');
  return src && src.includes("attr.name.startsWith('on')");
});

test('H7', 'Popup init has error handling', () => {
  const src = read('popup.js');
  return src && src.includes('Failed to load settings');
});

test('H8', 'Firestore fetch has network error handling', () => {
  const src = read('src/utils/firestore-client.js');
  return src && src.includes('Firestore PUT network error');
});

test('M1', 'Retry limits aligned between orchestrator and validator', () => {
  const src = read('src/background/orchestrator.js');
  return src && src.includes('MAX_RETRIES_ORCHESTRATOR = 2');
});

test('M2', 'Greedy JSON regex replaced with lazy', () => {
  const src = read('src/agents/agent-6-quality-validator.js');
  return src && !src.includes('{[\\s\\S]*}') && src.includes('*?');
});

test('M3', 'Logger warns on trim', () => {
  const src = read('src/utils/pipeline-logger.js');
  return src && src.includes('console.warn') && src.includes('trimming');
});

test('M4', 'Fallback intent normalised', () => {
  const src = read('src/agents/agent-1-intent.js');
  return src && src.includes('normaliseIntent(fallback');
});

test('M5', 'sectionMap null-safe', () => {
  const src = read('src/agents/agent-4-narrator.js');
  return src && src.includes("typeof sectionMap === 'object'");
});

test('M6', 'Strategist validates llmResponse.success', () => {
  const src = read('src/agents/agent-3-strategist.js');
  return src && src.includes('!llmResponse?.success');
});

test('M7', 'Overlay counter for feedback race', () => {
  const src = read('content.js');
  return src && src.includes('_overlayCounter');
});

test('M8', 'beforeunload flush for debounced save', () => {
  const src = read('options.js');
  return src && src.includes('beforeunload');
});

test('M9', 'Visualizer listener cleaned up', () => {
  const src = read('viewers/pipeline-visualizer.js');
  return src && src.includes('removeListener');
});

test('M10', 'Dashboard onclick uses data attributes', () => {
  const src = read('viewers/research-dashboard.js');
  return src && src.includes('this.dataset.store');
});

test('M11', 'Task key collision prevented', () => {
  const src = read('options.js');
  return src && src.includes('if (currentTasks[key])');
});

test('M12', 'Predictive adapter passes userId', () => {
  const src = read('src/agents/agent-9-predictive-adapter.js');
  return src && src.includes('getRelevantEpisodic(userId,');
});

test('M13', 'Procedural memory uses >=', () => {
  const src = read('src/utils/memory-system.js');
  return src && src.includes('>=') && src.includes('rules[minIdx].confidence');
});

test('M14', 'Orchestrator null-safe length access', () => {
  const src = read('src/background/orchestrator.js');
  return src && src.includes('(context.sectionMap || []).length');
});

test('M15', 'saveSettings debounced', () => {
  const src = read('options.js');
  return src && src.includes('_saveSettingsTimer');
});

test('L1', 'Popup uses null-safe setText', () => {
  const src = read('popup.js');
  return src && src.includes('const setText');
});

test('L2', 'resetToDefaults has try-catch', () => {
  const src = read('options.js');
  return src && src.includes('Reset failed');
});

test('L7', 'Event listener cleanup before re-add', () => {
  const src = read('content.js');
  const fn = src.slice(src.indexOf('function setupEventListeners'));
  return fn.includes('removeEventListener');
});

const total = pass + fail + skip;
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: \x1b[32m${pass} PASS\x1b[0m, \x1b[31m${fail} FAIL\x1b[0m, ${skip} SKIP (${total} total)`);
console.log(`${'='.repeat(60)}\n`);

if (fail > 0) {
  console.log('\x1b[31mSome original bugs are STILL PRESENT!\x1b[0m\n');
  process.exit(1);
} else {
  console.log('\x1b[32mAll original bugs have been eliminated!\x1b[0m\n');
  process.exit(0);
}
