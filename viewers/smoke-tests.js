/* Smoke tests for the Renarration Extension */

const TESTS = [
  {
    name: 'get-settings returns expected fields',
    run: async () => {
      const result = await chrome.runtime.sendMessage({ action: 'get-settings' });
      if (!result) throw new Error('No response from get-settings');
      if (typeof result !== 'object') throw new Error('Response is not an object');
      const required = ['personas', 'currentTask'];
      for (const key of required) {
        if (!(key in result)) throw new Error(`Missing field: ${key}`);
      }
      return `OK — ${Object.keys(result).length} fields returned`;
    }
  },
  {
    name: 'get-user-id returns a string',
    run: async () => {
      const result = await chrome.runtime.sendMessage({ action: 'get-user-id' });
      if (!result?.userId) throw new Error('Expected userId in response');
      return `OK — userId: ${result.userId.slice(0, 8)}...`;
    }
  },
  {
    name: 'chatbot-new-session returns sessionId',
    run: async () => {
      const result = await chrome.runtime.sendMessage({ action: 'chatbot-new-session' });
      if (!result || !result.sessionId) throw new Error('No sessionId in response');
      return `OK — sessionId: ${result.sessionId.slice(0, 8)}...`;
    }
  },
  {
    name: 'chatbot-get-session returns session data',
    run: async () => {
      const session = await chrome.runtime.sendMessage({ action: 'chatbot-new-session' });
      const result = await chrome.runtime.sendMessage({ action: 'chatbot-get-session', sessionId: session.sessionId });
      if (!result?.session) throw new Error('No session response');
      return `OK — session has ${result.session.messages?.length || 0} messages`;
    }
  },
  {
    name: 'export-research-data returns expected structure',
    run: async () => {
      const result = await chrome.runtime.sendMessage({ action: 'export-research-data' });
      if (!result || typeof result !== 'object') throw new Error('No response or not an object');
      const data = result.data || {};
      const expectedKeys = ['chatSessions', 'researchLogs', 'feedbackEvents'];
      for (const key of expectedKeys) {
        if (!(key in data)) throw new Error(`Missing key: ${key}`);
      }
      return `OK — ${Object.keys(data).length} data collections`;
    }
  },
  {
    name: 'storage.sync is accessible',
    run: async () => {
      const data = await chrome.storage.sync.get(null);
      return `OK — ${Object.keys(data).length} keys in sync storage`;
    }
  },
  {
    name: 'storage.local is accessible',
    run: async () => {
      const data = await chrome.storage.local.get(null);
      return `OK — ${Object.keys(data).length} keys in local storage`;
    }
  },
  {
    name: 'check-feedback-trends handler responds',
    run: async () => {
      const result = await chrome.runtime.sendMessage({ action: 'check-feedback-trends' });
      // May return null/undefined if no feedback — that's fine
      return `OK — response: ${JSON.stringify(result).slice(0, 100)}`;
    }
  },
  {
    name: 'last extraction storage is accessible',
    run: async () => {
      const result = await chrome.runtime.sendMessage({ action: 'get-last-extraction' });
      if (!result || result.success !== true) throw new Error('No extraction response');
      return `OK — ${result.extraction ? 'has extraction' : 'empty'}`;
    }
  }
];

// --- UI Rendering ---

const testsContainer = document.getElementById('tests');
const summaryEl = document.getElementById('summary');
const runAllBtn = document.getElementById('runAllBtn');
const clearBtn = document.getElementById('clearBtn');

function renderTests() {
  testsContainer.innerHTML = TESTS.map((test, i) => `
    <div class="test" id="test-${i}">
      <div>
        <strong>${test.name}</strong>
        <div class="error-detail" id="detail-${i}"></div>
      </div>
      <span class="badge pending" id="badge-${i}">pending</span>
    </div>
  `).join('');
}

function updateTest(index, status, detail) {
  const testEl = document.getElementById(`test-${index}`);
  const badgeEl = document.getElementById(`badge-${index}`);
  const detailEl = document.getElementById(`detail-${index}`);
  if (!testEl || !badgeEl) return;

  testEl.className = `test ${status}`;
  badgeEl.className = `badge ${status}`;
  badgeEl.textContent = status;
  if (detail) detailEl.textContent = detail;
}

async function runAll() {
  runAllBtn.disabled = true;
  summaryEl.style.display = 'none';
  let passed = 0;
  let failed = 0;

  for (let i = 0; i < TESTS.length; i++) {
    updateTest(i, 'running', '');
    try {
      const detail = await TESTS[i].run();
      updateTest(i, 'pass', detail || '');
      passed++;
    } catch (err) {
      updateTest(i, 'fail', err.message);
      failed++;
    }
  }

  summaryEl.style.display = 'block';
  if (failed === 0) {
    summaryEl.className = 'all-pass';
    summaryEl.textContent = `All ${passed} tests passed!`;
  } else {
    summaryEl.className = 'some-fail';
    summaryEl.textContent = `${passed} passed, ${failed} failed`;
  }
  runAllBtn.disabled = false;
}

function clearResults() {
  summaryEl.style.display = 'none';
  renderTests();
}

runAllBtn.addEventListener('click', runAll);
clearBtn.addEventListener('click', clearResults);

// Initialize
renderTests();
