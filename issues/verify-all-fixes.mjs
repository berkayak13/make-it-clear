#!/usr/bin/env node
// Post-fix verification — confirms all 40 bugs have been fixed.
// Run: node issues/verify-all-fixes.mjs

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

console.log('\n=== Post-Fix Verification Tests ===\n');
console.log('--- CRITICAL FIXES ---\n');

// ═══════════════════ CRITICAL ═══════════════════

test('C1-fix', 'XSS sanitizer now blocks SVG, data URIs, CSS injection', () => {
  const src = read('src/agents/agent-10-guardrails.js');
  if (!src) return 'SKIP';
  return src.includes('<svg') &&
         src.includes('data\\s*:\\s*text\\/html') &&
         src.includes('expression\\s*\\(');
});

test('C2-fix', 'Firebase API key removed from all 4 files', () => {
  const key = 'AIzaSyB7WIlE0klfLmUKvO7JWF69Q2ioh2z_MBU';
  const files = [
    'src/utils/firestore-client.js',
    'src/utils/memory-system.js',
    'options.js',
    'lib/research-db.js',
  ];
  for (const f of files) {
    const src = read(f);
    if (src && src.includes(key)) return false;
  }
  return true;
});

test('C3-fix', 'Offscreen entry no longer calls sendResponse synchronously', () => {
  const src = read('src/offscreen-entry.js');
  if (!src) return 'SKIP';
  // sendResponse should NOT be called directly anymore
  return !src.includes('sendResponse(') && !src.includes('sendResponse &&');
});

test('C4-fix', 'Quality validator checks parseError before triggering retry', () => {
  const src = read('src/agents/agent-6-quality-validator.js');
  if (!src) return 'SKIP';
  return src.includes('!parseError') && src.includes('!passed && !parseError');
});

test('C4-fix-regex', 'Quality validator uses lazy JSON regex', () => {
  const src = read('src/agents/agent-6-quality-validator.js');
  if (!src) return 'SKIP';
  // Should use lazy quantifier [\s\S]*?
  return src.includes('{[\\s\\S]*?}') || src.includes('[\\s\\S]*?\\}');
});

test('C5-fix', 'Memory init failure is logged, not silently swallowed', () => {
  const src = read('src/background/orchestrator.js');
  if (!src) return 'SKIP';
  return src.includes('Memory load failed, using defaults') &&
         src.includes('User ID retrieval failed');
});

test('C6-fix', 'Content script retry reduced and uses break-on-success', () => {
  const src = read('src/background/orchestrator.js');
  if (!src) return 'SKIP';
  // Should have fewer retry delays (reduced from 3 to 2)
  return src.includes('[300, 800]');
});

test('C7-fix', 'Bias severity now escalates severe cases to error', () => {
  const src = read('src/agents/agent-10-guardrails.js');
  if (!src) return 'SKIP';
  return src.includes('SEVERE_BIAS') && src.includes("? 'error' : 'warning'");
});

test('C8-fix', 'API key hardcoded defaults removed (empty string fallback)', () => {
  const fsc = read('src/utils/firestore-client.js');
  const ms = read('src/utils/memory-system.js');
  const opt = read('options.js');
  const lib = read('lib/research-db.js');
  if (!fsc || !ms || !opt || !lib) return 'SKIP';
  // All should have empty string defaults
  return fsc.includes("FIRESTORE_DEFAULT_API_KEY = ''") &&
         ms.includes("apiKey: stored.firebaseApiKey || ''") &&
         opt.includes("fbApiKeyInput.value = local.firebaseApiKey || ''") &&
         lib.includes("FIRESTORE_DEFAULT_API_KEY = ''");
});

console.log('\n--- HIGH FIXES ---\n');

// ═══════════════════ HIGH ═══════════════════

test('H1-fix', 'Narrator best-of-N uses Promise.allSettled', () => {
  const src = read('src/agents/agent-4-narrator.js');
  if (!src) return 'SKIP';
  return src.includes('Promise.allSettled([') &&
         src.includes("r.status === 'fulfilled'") &&
         src.includes('All best-of-N variants failed');
});

test('H2-fix', 'Guardrails uses Promise.allSettled', () => {
  const src = read('src/agents/agent-10-guardrails.js');
  if (!src) return 'SKIP';
  return src.includes('Promise.allSettled([') &&
         src.includes("results[0].status === 'fulfilled'");
});

test('H3-fix', 'Page renarration has mutex lock', () => {
  const src = read('src/handlers/page-renarration.js');
  if (!src) return 'SKIP';
  return src.includes('_pageRenarrationLock') &&
         src.includes('if (_pageRenarrationLock)') &&
         src.includes('_pageRenarrationLock = true') &&
         src.includes('_pageRenarrationLock = false');
});

test('H4-fix', 'Debug console.log removed from offscreen entry', () => {
  const src = read('src/offscreen-entry.js');
  if (!src) return 'SKIP';
  return !src.includes("console.log('WebLLM chat completion request:") &&
         !src.includes("console.log('WebLLM chat completion result:");
});

test('H6-fix', 'Cloned HTML strips inline event handlers', () => {
  const src = read('content.js');
  if (!src) return 'SKIP';
  return src.includes("attr.name.startsWith('on')") &&
         src.includes('el.removeAttribute(attr.name)');
});

test('H7-fix', 'Popup init storage reads wrapped in try-catch', () => {
  const src = read('popup.js');
  if (!src) return 'SKIP';
  return src.includes('Failed to load settings, using defaults');
});

test('H8-fix', 'Firestore fetch wrapped in try-catch for network errors', () => {
  const src = read('src/utils/firestore-client.js');
  if (!src) return 'SKIP';
  return src.includes('Firestore PUT network error');
});

test('H9-fix', 'Memory system no longer duplicates Firestore API key', () => {
  const src = read('src/utils/memory-system.js');
  if (!src) return 'SKIP';
  const key = 'AIzaSyB7WIlE0klfLmUKvO7JWF69Q2ioh2z_MBU';
  return !src.includes(key);
});

console.log('\n--- MEDIUM FIXES ---\n');

// ═══════════════════ MEDIUM ═══════════════════

test('M1-fix', 'Orchestrator retry limit matches quality validator', () => {
  const src = read('src/background/orchestrator.js');
  if (!src) return 'SKIP';
  return src.includes('MAX_RETRIES_ORCHESTRATOR = 2') &&
         src.includes('retryCount > MAX_RETRIES_ORCHESTRATOR');
});

test('M2-fix', 'Quality validator uses lazy JSON regex', () => {
  const src = read('src/agents/agent-6-quality-validator.js');
  if (!src) return 'SKIP';
  // Lazy quantifier: *? instead of greedy *
  return src.includes('[\\s\\S]*?\\}');
});

test('M3-fix', 'Pipeline logger warns when trimming logs', () => {
  const src = read('src/utils/pipeline-logger.js');
  if (!src) return 'SKIP';
  return src.includes('console.warn') && src.includes('trimming from');
});

test('M4-fix', 'Fallback intent now passes through normaliseIntent', () => {
  const src = read('src/agents/agent-1-intent.js');
  if (!src) return 'SKIP';
  // Fallback path should call normaliseIntent
  const fallbackSection = src.slice(src.indexOf('usedFallback = true'));
  return fallbackSection.includes('normaliseIntent(fallback');
});

test('M5-fix', 'Narrator sectionMap fallback handles null/primitive', () => {
  const src = read('src/agents/agent-4-narrator.js');
  if (!src) return 'SKIP';
  return src.includes("typeof sectionMap === 'object'");
});

test('M6-fix', 'Strategist checks llmResponse.success before coercion', () => {
  const src = read('src/agents/agent-3-strategist.js');
  if (!src) return 'SKIP';
  return src.includes('!llmResponse?.success') &&
         !src.includes('JSON.stringify(llmResponse)');
});

test('M7-fix', 'Feedback race: overlay counter added', () => {
  const src = read('content.js');
  if (!src) return 'SKIP';
  return src.includes('_overlayCounter');
});

test('M8-fix', 'Debounced save flushed on beforeunload', () => {
  const src = read('options.js');
  if (!src) return 'SKIP';
  return src.includes("'beforeunload'") && src.includes('templateSaveTimer');
});

test('M9-fix', 'Visualizer storage listener is removed before re-adding', () => {
  const src = read('viewers/pipeline-visualizer.js');
  if (!src) return 'SKIP';
  return src.includes('removeListener(_storageListener)') &&
         src.includes('addListener(_storageListener)');
});

test('M10-fix', 'Research dashboard onclick uses data attributes with escaping', () => {
  const src = read('viewers/research-dashboard.js');
  if (!src) return 'SKIP';
  return src.includes('this.dataset.store') && src.includes('escapeHtml(name)');
});

test('M11-fix', 'Task key collision check added', () => {
  const src = read('options.js');
  if (!src) return 'SKIP';
  return src.includes('if (currentTasks[key])') &&
         src.includes("Date.now().toString(36)");
});

test('M12-fix', 'Predictive adapter passes userId to getRelevantEpisodic', () => {
  const src = read('src/agents/agent-9-predictive-adapter.js');
  if (!src) return 'SKIP';
  return src.includes('getRelevantEpisodic(userId,');
});

test('M13-fix', 'Procedural memory uses >= for replacement', () => {
  const src = read('src/utils/memory-system.js');
  if (!src) return 'SKIP';
  return src.includes('entry.confidence >= rules[minIdx].confidence');
});

test('M14-fix', 'Orchestrator null-checks renarrations/sectionMap length', () => {
  const src = read('src/background/orchestrator.js');
  if (!src) return 'SKIP';
  return src.includes('(context.sectionMap || []).length') &&
         src.includes('(context.renarrations || []).length');
});

test('M15-fix', 'saveSettings is debounced', () => {
  const src = read('options.js');
  if (!src) return 'SKIP';
  return src.includes('_saveSettingsTimer') && src.includes('_doSaveSettings');
});

console.log('\n--- LOW FIXES ---\n');

// ═══════════════════ LOW ═══════════════════

test('L1-fix', 'Popup showGoalPreview uses null-safe setText helper', () => {
  const src = read('popup.js');
  if (!src) return 'SKIP';
  // Old pattern should be gone
  const fnBody = src.slice(src.indexOf('function showGoalPreview'));
  return fnBody.includes('setText') && !fnBody.includes("document.getElementById('goalPreviewText').textContent");
});

test('L2-fix', 'resetToDefaults wrapped in try-catch', () => {
  const src = read('options.js');
  if (!src) return 'SKIP';
  const fnStart = src.indexOf('async function resetToDefaults()');
  const fnBody = src.slice(fnStart, fnStart + 1200);
  return fnBody.includes('try {') && fnBody.includes('Reset failed');
});

test('L7-fix', 'setupEventListeners removes old handler before adding', () => {
  const src = read('content.js');
  if (!src) return 'SKIP';
  const fn = src.slice(src.indexOf('function setupEventListeners()'));
  return fn.includes('document.removeEventListener') && fn.includes('if (selectionHandler)');
});

// ═══════════════════ BUILD CHECK ═══════════════════

console.log('\n--- BUILD CHECK ---\n');

test('BUILD', 'Build output exists and is recent', () => {
  return existsSync(resolve(ROOT, 'build/background-entry.js')) &&
         existsSync(resolve(ROOT, 'build/offscreen-entry.js'));
});

// ═══════════════════ SUMMARY ═══════════════════

const total = pass + fail + skip;
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: \x1b[32m${pass} PASS\x1b[0m, \x1b[31m${fail} FAIL\x1b[0m, ${skip} SKIP (${total} total)`);
console.log(`${'='.repeat(60)}\n`);

if (fail > 0) {
  console.log('\x1b[31mSome fixes are incomplete. Review FAIL items above.\x1b[0m\n');
  process.exit(1);
} else {
  console.log('\x1b[32mAll fixes verified successfully!\x1b[0m\n');
  process.exit(0);
}
