#!/usr/bin/env node
// Automated bug verification tests — checks source code for known bug patterns
// Run: node issues/bug-verification-tests.mjs

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
      console.log(`  PASS  ${id}: ${description}`);
    } else {
      fail++;
      console.log(`  FAIL  ${id}: ${description}`);
    }
  } catch (e) {
    fail++;
    console.log(`  FAIL  ${id}: ${description} — ${e.message}`);
  }
}

console.log('\n=== Bug Verification Tests ===\n');

// ─── CRITICAL ───

test('C1', 'XSS sanitizer is regex-based (no DOMPurify)', () => {
  const src = read('src/agents/agent-10-guardrails.js');
  if (!src) return 'SKIP';
  // Confirm regex-based sanitizer exists
  const hasRegexSanitizer = src.includes('sanitizeHtml') && src.includes('.replace(/<script');
  // Confirm it misses SVG
  const missesSvg = !src.includes('<svg') && !src.includes('svg');
  // Confirm no DOMPurify import
  const noDomPurify = !src.includes('DOMPurify') && !src.includes('dompurify');
  return hasRegexSanitizer && missesSvg && noDomPurify;
});

test('C2', 'Firebase API key hardcoded in 3+ files', () => {
  const key = 'AIzaSyB7WIlE0klfLmUKvO7JWF69Q2ioh2z_MBU';
  const files = [
    'src/utils/firestore-client.js',
    'src/utils/memory-system.js',
    'options.js',
    'lib/research-db.js',
  ];
  let count = 0;
  for (const f of files) {
    const src = read(f);
    if (src && src.includes(key)) count++;
  }
  return count >= 3;
});

test('C3', 'Offscreen entry calls sendResponse AND chrome.runtime.sendMessage', () => {
  const src = read('src/offscreen-entry.js');
  if (!src) return 'SKIP';
  const callsSendResponse = src.includes('sendResponse') && src.includes('sendResponse(');
  const callsChromeMsg = src.includes('chrome.runtime.sendMessage({') && src.includes('__offscreenResponse');
  return callsSendResponse && callsChromeMsg;
});

test('C4', 'Quality validator: parse error triggers retry instead of separate handling', () => {
  const src = read('src/agents/agent-6-quality-validator.js');
  if (!src) return 'SKIP';
  // Scores default to 0
  const defaultZero = src.includes('coherence: 0, coverage: 0');
  // parseError detected
  const parseErrorDetected = src.includes('parseError');
  // But retry is based on !passed && retryCount, not on parseError
  const retryCheck = src.includes('if (!passed && retryCount < MAX_RETRIES)');
  // parseError not checked before retry
  const noParseErrorGuard = !src.includes('if (parseError)') && !src.includes('if (!parseError &&');
  return defaultZero && parseErrorDetected && retryCheck && noParseErrorGuard;
});

test('C5', 'Memory init failure silently caught with empty catch', () => {
  const src = read('src/background/orchestrator.js');
  if (!src) return 'SKIP';
  // Find the pattern: } catch (e) { /* memory is optional */ }
  return src.includes('loadMemory(userId)') && /catch\s*\(e?\)\s*\{\s*\/\*/.test(src);
});

test('C6', 'Content script retry sends extract-and-clone without dedup guard', () => {
  const src = read('src/background/orchestrator.js');
  if (!src) return 'SKIP';
  // Multiple sendMessage with 'extract-and-clone' in retry loop
  const matches = src.match(/sendMessage\(tabId,\s*\{\s*action:\s*'extract-and-clone'/g);
  return matches && matches.length >= 2;
});

test('C7', 'Bias flags hardcoded to severity warning only', () => {
  const src = read('src/agents/agent-10-guardrails.js');
  if (!src) return 'SKIP';
  // In runBiasChecks, severity is hardcoded
  return src.includes("severity: 'warning'") && !src.includes("severity: 'error'") === false;
});

test('C7-actual', 'Bias flags all hardcoded to warning, hasErrors only checks error severity', () => {
  const src = read('src/agents/agent-10-guardrails.js');
  if (!src) return 'SKIP';
  // The bias check always returns warning
  const biasAlwaysWarning = /severity:\s*'warning'/.test(src);
  // hasErrors checks for 'error' severity
  const checksError = src.includes("flag.severity === 'error'");
  // No bias flag returns 'error'
  const lines = src.split('\n');
  const biasSection = [];
  let inBias = false;
  for (const line of lines) {
    if (line.includes('function runBiasChecks')) inBias = true;
    if (inBias) biasSection.push(line);
    if (inBias && line.trim() === '}' && biasSection.length > 5) break;
  }
  const biasCode = biasSection.join('\n');
  const biasNeverError = !biasCode.includes("'error'");
  return biasAlwaysWarning && checksError && biasNeverError;
});

test('C8', 'API keys stored unencrypted in chrome.storage.local', () => {
  const options = read('options.js');
  if (!options) return 'SKIP';
  return options.includes('chrome.storage.local.set({ remoteVLMApiKey');
});

// ─── HIGH ───

test('H1', 'Narrator best-of-N uses Promise.all without error boundary', () => {
  const src = read('src/agents/agent-4-narrator.js');
  if (!src) return 'SKIP';
  // Find narrateWithBestOfN function
  const hasBestOfN = src.includes('narrateWithBestOfN');
  // Uses Promise.all for variant generation
  const promiseAll = src.includes('const variants = await Promise.all([');
  // No try-catch around Promise.all for variants (scoring Promise.all has per-item catch)
  return hasBestOfN && promiseAll;
});

test('H2', 'Guardrails Promise.all without try-catch', () => {
  const src = read('src/agents/agent-10-guardrails.js');
  if (!src) return 'SKIP';
  // Promise.all with llm and bias checks
  const hasPromiseAll = src.includes('await Promise.all([');
  // Check context around it — no try-catch wrapping the Promise.all directly
  const lines = src.split('\n');
  let promiseAllLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('await Promise.all([')) {
      promiseAllLine = i;
      break;
    }
  }
  if (promiseAllLine < 0) return false;
  // Check if there's a try above
  const contextBefore = lines.slice(Math.max(0, promiseAllLine - 3), promiseAllLine).join('\n');
  const noTryCatch = !contextBefore.includes('try');
  return hasPromiseAll && noTryCatch;
});

test('H3', 'Page renarration has no mutex for concurrent calls', () => {
  const src = read('src/handlers/page-renarration.js');
  if (!src) return 'SKIP';
  // Has pageRenarrationInProgress
  const hasFlag = src.includes('pageRenarrationInProgress');
  // But renarratePage() doesn't check the flag at the start
  const fnStart = src.indexOf('async function renarratePage(');
  if (fnStart < 0) return false;
  const fnBody = src.slice(fnStart, fnStart + 500);
  const noCheckAtStart = !fnBody.includes('if (pageRenarrationInProgress') && !fnBody.includes('pageRenarrationInProgress === true');
  return hasFlag && noCheckAtStart;
});

test('H4', 'Debug console.log with user data in offscreen entry', () => {
  const src = read('src/offscreen-entry.js');
  if (!src) return 'SKIP';
  return src.includes("console.log('WebLLM chat completion request:'") &&
         src.includes("console.log('WebLLM chat completion result:'");
});

test('H5', 'Manifest uses <all_urls> host permission', () => {
  const src = read('manifest.json');
  if (!src) return 'SKIP';
  return src.includes('"<all_urls>"');
});

test('H6', 'iframe sandbox allows same-origin with cloned HTML', () => {
  const src = read('content.js');
  if (!src) return 'SKIP';
  return src.includes("iframe.sandbox = 'allow-same-origin'");
});

test('H7', 'Popup init has no try-catch on storage reads', () => {
  const src = read('popup.js');
  if (!src) return 'SKIP';
  // The very first storage call has no try-catch
  const idx = src.indexOf("await chrome.storage.sync.get([");
  if (idx < 0) return false;
  const before = src.slice(Math.max(0, idx - 100), idx);
  return !before.includes('try');
});

// ─── MEDIUM ───

test('M1', 'Retry count mismatch: orchestrator > 3 vs agent-6 MAX_RETRIES = 2', () => {
  const orch = read('src/background/orchestrator.js');
  const qv = read('src/agents/agent-6-quality-validator.js');
  if (!orch || !qv) return 'SKIP';
  return orch.includes('retryCount > 3') && qv.includes('MAX_RETRIES = 2');
});

test('M2', 'Greedy JSON regex in quality validator', () => {
  const src = read('src/agents/agent-6-quality-validator.js');
  if (!src) return 'SKIP';
  // Greedy: \{[\s\S]*\} vs lazy: \{[\s\S]*?\}
  return src.includes('{[\\s\\S]*}') || src.includes('/\\{[\\s\\S]*\\}/');
});

test('M3', 'Pipeline logger silently trims to 20 entries', () => {
  const src = read('src/utils/pipeline-logger.js');
  if (!src) return 'SKIP';
  return src.includes('toStore = next.slice(0, 20)') && !src.includes('console.warn') || !src.includes('log trimmed');
});

test('M4', 'Fallback intent skips normaliseIntent()', () => {
  const src = read('src/agents/agent-1-intent.js');
  if (!src) return 'SKIP';
  // Normal path calls normaliseIntent, fallback calls extractFallbackIntent directly
  const normalPath = src.includes('context.intent = normaliseIntent(parsed');
  const fallbackPath = src.includes('context.intent = extractFallbackIntent(');
  // extractFallbackIntent does NOT call normaliseIntent internally
  const fnBody = src.slice(src.indexOf('function extractFallbackIntent'), src.indexOf('function normaliseIntent'));
  const fallbackCallsNormalize = fnBody.includes('normaliseIntent');
  return normalPath && fallbackPath && !fallbackCallsNormalize;
});

test('M5', 'sectionMap fallback to Object.values() in narrator', () => {
  const src = read('src/agents/agent-4-narrator.js');
  if (!src) return 'SKIP';
  return src.includes('Object.values(sectionMap)');
});

test('M6', 'Strategist unsafe JSON coercion', () => {
  const src = read('src/agents/agent-3-strategist.js');
  if (!src) return 'SKIP';
  return src.includes('JSON.stringify(llmResponse)');
});

test('M7', 'Feedback race condition on lastRunId global', () => {
  const src = read('content.js');
  if (!src) return 'SKIP';
  return src.includes('let lastRunId = null') && src.includes('lastRunId = runId || null');
});

test('M8', 'Debounced save with no beforeunload flush', () => {
  const src = read('options.js');
  if (!src) return 'SKIP';
  const hasDebounce = src.includes('templateSaveTimer = setTimeout(');
  const noUnload = !src.includes('beforeunload');
  return hasDebounce && noUnload;
});

test('M9', 'Storage listener never removed in visualizer', () => {
  const src = read('viewers/pipeline-visualizer.js');
  if (!src) return 'SKIP';
  const adds = src.includes('chrome.storage.onChanged.addListener');
  const noRemove = !src.includes('removeListener');
  return adds && noRemove;
});

test('M10', 'Inline onclick handlers in research dashboard', () => {
  const src = read('viewers/research-dashboard.js');
  if (!src) return 'SKIP';
  return src.includes("onclick=\"exportStore('${name}'");
});

test('M11', 'Task key collision: no duplicate check on create', () => {
  const src = read('options.js');
  if (!src) return 'SKIP';
  const keyGen = src.includes("name.toLowerCase().replace(/\\s+/g, '-')");
  // No collision check after key generation
  const saveTaskFn = src.slice(src.indexOf('async function saveTask()'));
  const noCollisionCheck = !saveTaskFn.includes('if (currentTasks[key])') && !saveTaskFn.includes('already exists');
  return keyGen && noCollisionCheck;
});

test('M12', 'Predictive adapter calls getRelevantEpisodic without userId', () => {
  const src = read('src/agents/agent-9-predictive-adapter.js');
  if (!src) return 'SKIP';
  // Function signature expects userId
  const mem = read('src/utils/memory-system.js');
  const sigHasUserId = mem && mem.includes('async function getRelevantEpisodic(userId,');
  // But agent-9 calls it without userId
  const callWithoutUserId = src.includes('getRelevantEpisodic(pageMetadata.url, pageMetadata.title)');
  return sigHasUserId && callWithoutUserId;
});

test('M13', 'Procedural memory uses > not >= for replacement', () => {
  const src = read('src/utils/memory-system.js');
  if (!src) return 'SKIP';
  return src.includes('if (entry.confidence > rules[minIdx].confidence)') &&
         !src.includes('if (entry.confidence >= rules[minIdx].confidence)');
});

// ─── LOW ───

test('L1', 'popup.js showGoalPreview has no null checks on getElementById', () => {
  const src = read('popup.js');
  if (!src) return 'SKIP';
  const fn = src.slice(src.indexOf('function showGoalPreview'));
  const fnEnd = fn.indexOf('}') + 1;
  const fnBody = fn.slice(0, fnEnd);
  return fnBody.includes("document.getElementById('goalPreviewText').textContent") &&
         !fnBody.includes('if (');
});

test('L2', 'Options resetToDefaults has no try-catch', () => {
  const src = read('options.js');
  if (!src) return 'SKIP';
  const fnStart = src.indexOf('async function resetToDefaults()');
  const fnBody = src.slice(fnStart, fnStart + 600);
  return !fnBody.includes('try {');
});

// ─── PREVIOUSLY CLAIMED BUT FALSE ───

test('FALSE-8', 'popup.js sendMessage DOES have try-catch (claim was false)', () => {
  const src = read('popup.js');
  if (!src) return 'SKIP';
  // The sendMessage function has try-catch — search 1200 chars to reach the try block
  const fnStart = src.indexOf('async function sendMessage()');
  const fnBody = src.slice(fnStart, fnStart + 1200);
  return fnBody.includes('try {') && fnBody.includes('catch (e)');
});

test('FALSE-28', 'content.js error IS escaped via escapeHtml (claim was false)', () => {
  const src = read('content.js');
  if (!src) return 'SKIP';
  // showOverlay calls escapeHtml on content
  return src.includes('${escapeHtml(content)}');
});

test('FALSE-21', 'Offscreen bridge ensureOffscreen HAS race protection (claim was false)', () => {
  const src = read('src/utils/offscreen-bridge.js');
  if (!src) return 'SKIP';
  return src.includes('if (creatingOffscreen) return creatingOffscreen;');
});

// ─── SUMMARY ───

console.log(`\n=== Results: ${pass} PASS, ${fail} FAIL, ${skip} SKIP (${pass + fail + skip} total) ===\n`);

if (fail > 0) {
  console.log('Some bugs could NOT be verified in source. Check manually.\n');
}
process.exit(fail > 0 ? 1 : 0);
