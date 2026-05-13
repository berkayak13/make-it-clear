// Research Dashboard — reads from Firestore via background.js messages

let currentUserFilter = '';
let currentSearchQuery = '';
let allData = {};

document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupControls();
  await loadAllData();
  renderAll();
});

function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
  });
}

function setupControls() {
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    const btn = document.getElementById('refreshBtn');
    btn.disabled = true;
    btn.textContent = 'Loading...';
    await loadAllData();
    renderAll();
    btn.disabled = false;
    btn.textContent = 'Refresh';
  });

  document.getElementById('userFilter').addEventListener('change', (e) => {
    currentUserFilter = e.target.value;
    renderAll();
  });

  document.getElementById('searchInput').addEventListener('input', (e) => {
    currentSearchQuery = e.target.value.toLowerCase();
    renderAll();
  });

  const catFilter = document.getElementById('logCategoryFilter');
  if (catFilter) {
    catFilter.addEventListener('change', () => renderLogs());
  }
}

const DATA_TAB_IDS = ['conversationsList', 'experimentsList', 'feedbackList', 'preferencesList', 'logsList'];

function setTabMessage(html) {
  for (const id of DATA_TAB_IDS) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }
}

function showLoadingState() {
  setTabMessage('<div class="empty-state">Loading data...</div>');
}

function showErrorState(errorMsg) {
  setTabMessage(`<div class="empty-state" style="color:#e53e3e;">Failed to load data: ${escapeHtml(errorMsg)}</div>`);
}

async function loadAllData() {
  showLoadingState();
  try {
    const res = await chrome.runtime.sendMessage({
      action: 'export-research-data',
      userId: null,
      format: 'json'
    });
    if (res?.success) {
      allData = res.data || {};
      populateUserFilter();
    } else {
      const errMsg = res?.error || 'No data returned';
      console.error('Research data fetch failed:', errMsg);
      showErrorState(errMsg);
    }
  } catch (e) {
    console.error('Failed to load research data:', e);
    showErrorState(e.message || 'Unknown error');
  }
}

function populateUserFilter() {
  const select = document.getElementById('userFilter');
  const userIds = new Set();
  for (const storeName of ['chatSessions', 'researchLogs', 'feedbackEvents', 'experimentRuns', 'preferenceHistory', 'userPreferences']) {
    (allData[storeName] || []).forEach(r => { if (r.userId) userIds.add(r.userId); });
  }
  const current = select.value;
  select.innerHTML = '<option value="">All Users</option>';
  [...userIds].sort().forEach(id => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    select.appendChild(opt);
  });
  select.value = current || '';
}

function filterByUser(records) {
  if (!currentUserFilter) return records;
  return records.filter(r => r.userId === currentUserFilter);
}

function filterBySearch(records) {
  if (!currentSearchQuery) return records;
  return records.filter(r => JSON.stringify(r).toLowerCase().includes(currentSearchQuery));
}

function applyFilters(records) {
  return filterBySearch(filterByUser(records));
}

function renderAll() {
  renderConversations();
  renderExperiments();
  renderFeedback();
  renderPreferences();
  renderLogs();
  renderExport();
}

function formatTime(ts) {
  if (!ts) return '--';
  return new Date(ts).toLocaleString();
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function scoreClass(score) {
  if (score >= 4) return 'high';
  if (score >= 3) return 'mid';
  return 'low';
}

// ---- Conversations ----
function renderConversations() {
  const el = document.getElementById('conversationsList');
  const sessions = applyFilters(allData.chatSessions || []).sort((a, b) => b.timestamp - a.timestamp);
  if (!sessions.length) {
    el.innerHTML = '<div class="empty-state">No chat sessions found.</div>';
    return;
  }
  let html = '<table><tr><th>Session</th><th>User</th><th>Time</th><th>Messages</th><th>Persona</th><th>Details</th></tr>';
  sessions.forEach((s, i) => {
    const msgCount = s.messages?.length || 0;
    const persona = s.extractedProfile?.name || s.appliedPersonaKey || '--';
    html += `<tr>
      <td style="font-family:monospace;font-size:11px;">${escapeHtml(s.sessionId?.slice(0, 8))}</td>
      <td><span class="pill info">${escapeHtml(s.userId)}</span></td>
      <td>${formatTime(s.timestamp)}</td>
      <td>${msgCount}</td>
      <td>${escapeHtml(persona)}</td>
      <td><button onclick="toggleExpand('conv-${i}')">View</button></td>
    </tr>
    <tr><td colspan="6" style="padding:0;border:none;">
      <div class="expand-content" id="conv-${i}">
        ${(s.messages || []).map(m => `<div class="msg-bubble ${m.role}">${escapeHtml(m.content)}</div>`).join('')}
        ${s.extractedProfile ? '<hr style="margin:8px 0;"><strong>Extracted Profile:</strong><pre>' + escapeHtml(JSON.stringify(s.extractedProfile, null, 2)) + '</pre>' : ''}
      </div>
    </td></tr>`;
  });
  html += '</table>';
  el.innerHTML = html;
}

// ---- Experiments ----
function renderExperiments() {
  const el = document.getElementById('experimentsList');
  const experiments = applyFilters(allData.experimentRuns || []).sort((a, b) => b.timestamp - a.timestamp);
  if (!experiments.length) {
    el.innerHTML = '<div class="empty-state">No experiment runs found. Run page renarration to see data here.</div>';
    return;
  }
  let html = '<table><tr><th>ID</th><th>User</th><th>Time</th><th>Task</th><th>Persona</th><th>Attempts</th><th>Best Score</th><th>Details</th></tr>';
  experiments.forEach((exp, i) => {
    const sc = scoreClass(exp.bestScore || 0);
    html += `<tr>
      <td style="font-family:monospace;font-size:11px;">${escapeHtml(exp.experimentId?.slice(0, 8))}</td>
      <td><span class="pill info">${escapeHtml(exp.userId)}</span></td>
      <td>${formatTime(exp.timestamp)}</td>
      <td>${escapeHtml(exp.taskName)}</td>
      <td>${escapeHtml(exp.personaName)}</td>
      <td>${exp.attemptCount || exp.attempts?.length || 0}</td>
      <td><span class="score-bar ${sc}" style="width:${(exp.bestScore || 0) * 20}px;"></span> ${(exp.bestScore || 0).toFixed(1)}</td>
      <td><button onclick="toggleExpand('exp-${i}')">View</button></td>
    </tr>
    <tr><td colspan="8" style="padding:0;border:none;">
      <div class="expand-content" id="exp-${i}">
        <strong>Input sample:</strong><br>${escapeHtml(exp.inputTextSample)}<br><br>
        <strong>Best output:</strong><br>${escapeHtml(exp.bestOutput)}<br><br>
        <strong>Attempts:</strong><pre>${escapeHtml(JSON.stringify(exp.attempts, null, 2))}</pre>
      </div>
    </td></tr>`;
  });
  html += '</table>';
  el.innerHTML = html;
}

// ---- Feedback ----
function renderFeedback() {
  const el = document.getElementById('feedbackList');
  const feedback = applyFilters(allData.feedbackEvents || []).sort((a, b) => b.timestamp - a.timestamp);
  if (!feedback.length) {
    el.innerHTML = '<div class="empty-state">No feedback events found.</div>';
    return;
  }
  let html = '<table><tr><th>User</th><th>Time</th><th>Type</th><th>Run ID</th><th>Correction</th></tr>';
  feedback.forEach(f => {
    const pillClass = f.feedbackType === 'thumbs-up' ? 'success' : (f.feedbackType === 'thumbs-down' ? 'fail' : 'info');
    html += `<tr>
      <td><span class="pill info">${escapeHtml(f.userId)}</span></td>
      <td>${formatTime(f.timestamp)}</td>
      <td><span class="pill ${pillClass}">${escapeHtml(f.feedbackType)}</span></td>
      <td style="font-family:monospace;font-size:11px;">${escapeHtml(f.runId?.slice(0, 8))}</td>
      <td>${escapeHtml(f.correctedText || '--')}</td>
    </tr>`;
  });
  html += '</table>';
  el.innerHTML = html;
}

// ---- Preferences ----
function renderPreferences() {
  const el = document.getElementById('preferencesList');
  const prefs = applyFilters(allData.preferenceHistory || []).sort((a, b) => b.timestamp - a.timestamp);
  if (!prefs.length) {
    el.innerHTML = '<div class="empty-state">No preference changes recorded.</div>';
    return;
  }
  let html = '<table><tr><th>User</th><th>Time</th><th>Field</th><th>Old Value</th><th>New Value</th></tr>';
  prefs.forEach(p => {
    const oldVal = typeof p.oldValue === 'object' ? JSON.stringify(p.oldValue) : String(p.oldValue ?? '--');
    const newVal = typeof p.newValue === 'object' ? JSON.stringify(p.newValue) : String(p.newValue ?? '--');
    html += `<tr>
      <td><span class="pill info">${escapeHtml(p.userId)}</span></td>
      <td>${formatTime(p.timestamp)}</td>
      <td><strong>${escapeHtml(p.field)}</strong></td>
      <td style="font-size:12px;">${escapeHtml(oldVal?.slice(0, 100))}</td>
      <td style="font-size:12px;">${escapeHtml(newVal?.slice(0, 100))}</td>
    </tr>`;
  });
  html += '</table>';
  el.innerHTML = html;
}

// ---- Research Logs ----
function renderLogs() {
  const el = document.getElementById('logsList');
  const catFilter = document.getElementById('logCategoryFilter')?.value || '';
  let logs = applyFilters(allData.researchLogs || []);
  if (catFilter) logs = logs.filter(l => l.category === catFilter);
  logs.sort((a, b) => b.timestamp - a.timestamp);
  if (!logs.length) {
    el.innerHTML = '<div class="empty-state">No research logs found.</div>';
    return;
  }
  let html = '<table><tr><th>User</th><th>Time</th><th>Category</th><th>Details</th></tr>';
  logs.forEach((l, i) => {
    const details = Object.entries(l)
      .filter(([k]) => !['logId', 'userId', 'timestamp', 'category'].includes(k))
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(', ');
    html += `<tr>
      <td><span class="pill info">${escapeHtml(l.userId)}</span></td>
      <td>${formatTime(l.timestamp)}</td>
      <td><span class="pill warn">${escapeHtml(l.category)}</span></td>
      <td style="font-size:12px;">${escapeHtml(details?.slice(0, 200))}</td>
    </tr>`;
  });
  html += '</table>';
  el.innerHTML = html;
}

// ---- Export ----
function renderExport() {
  const el = document.getElementById('exportSection');
  const stores = ['chatSessions', 'researchLogs', 'feedbackEvents', 'experimentRuns', 'preferenceHistory', 'userPreferences'];
  const hasAnyData = Object.values(allData).some(arr => Array.isArray(arr) && arr.length > 0);
  el.innerHTML = stores.map(name => {
    const count = (allData[name] || []).length;
    const disabled = count === 0 ? ' disabled style="opacity:0.5;cursor:not-allowed;"' : '';
    return `
    <div class="export-card">
      <h4>${name}</h4>
      <p style="font-size:12px;color:#718096;margin-bottom:8px;">${count} records</p>
      <div class="btn-group">
        <button onclick="exportStore(this.dataset.store, 'json')" data-store="${escapeHtml(name)}"${disabled}>JSON</button>
        <button onclick="exportStore(this.dataset.store, 'csv')" data-store="${escapeHtml(name)}"${disabled}>CSV</button>
      </div>
    </div>`;
  }).join('') + `
    <div class="export-card" style="border-color:#667eea;">
      <h4>All Data</h4>
      <p style="font-size:12px;color:#718096;margin-bottom:8px;">Export everything as a single JSON file</p>
      <div class="btn-group">
        <button onclick="exportAll()"${hasAnyData ? '' : ' disabled style="opacity:0.5;cursor:not-allowed;"'}>Export All (JSON)</button>
      </div>
    </div>
  `;
}

// ---- Global functions for onclick handlers ----

window.toggleExpand = function(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('open');
};

window.exportStore = async function(storeName, format) {
  if (!allData[storeName] || allData[storeName].length === 0) {
    alert(`No data available in "${storeName}" to export.`);
    return;
  }
  try {
    const res = await chrome.runtime.sendMessage({
      action: 'export-research-data',
      storeName,
      userId: currentUserFilter || null,
      format
    });
    if (!res?.success) { alert('Export failed: ' + (res?.error || 'Unknown')); return; }

    let content, mimeType, ext;
    if (format === 'csv') {
      content = res.data;
      mimeType = 'text/csv';
      ext = 'csv';
    } else {
      content = JSON.stringify(res.data, null, 2);
      mimeType = 'application/json';
      ext = 'json';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${storeName}-${currentUserFilter || 'all'}-${new Date().toISOString().slice(0, 10)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Export error: ' + e.message);
  }
};

window.exportAll = async function() {
  const hasAnyData = Object.values(allData).some(arr => Array.isArray(arr) && arr.length > 0);
  if (!hasAnyData) {
    alert('No research data available to export.');
    return;
  }
  try {
    const res = await chrome.runtime.sendMessage({
      action: 'export-research-data',
      userId: currentUserFilter || null,
      format: 'json'
    });
    if (!res?.success) { alert('Export failed: ' + (res?.error || 'Unknown')); return; }

    const content = JSON.stringify(res.data, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `research-all-${currentUserFilter || 'all'}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Export error: ' + e.message);
  }
};
