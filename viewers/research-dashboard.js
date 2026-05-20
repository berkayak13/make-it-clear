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

  document.getElementById('exportAllBtn').addEventListener('click', exportAll);

  // Delegated handler for dynamically rendered buttons. Inline onclick is
  // blocked by the extension's content security policy.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'toggle') toggleExpand(btn.dataset.target);
    else if (btn.dataset.action === 'export-store') exportStore(btn.dataset.store, btn.dataset.format);
    else if (btn.dataset.action === 'export-all') exportAll();
  });
}

const DATA_TAB_IDS = ['conversationsList', 'feedbackList', 'preferencesList', 'logsList'];

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
  for (const storeName of ['chatSessions', 'researchLogs', 'feedbackEvents', 'userPreferences']) {
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
  renderOverview();
  renderConversations();
  renderFeedback();
  renderPreferences();
  renderLogs();
  renderExport();
}

function renderOverview() {
  const sessions = allData.chatSessions || [];
  const feedback = allData.feedbackEvents || [];

  const userIds = new Set();
  for (const store of ['chatSessions', 'researchLogs', 'feedbackEvents', 'userPreferences']) {
    (allData[store] || []).forEach(r => { if (r.userId) userIds.add(r.userId); });
  }

  document.getElementById('kpiSessions').textContent = sessions.length;
  document.getElementById('kpiFeedback').textContent = feedback.length;
  document.getElementById('kpiUsers').textContent = userIds.size;

  // Feedback distribution
  const pos = feedback.filter(f => f.feedbackType === 'thumbs-up').length;
  const neg = feedback.filter(f => f.feedbackType === 'thumbs-down').length;
  const neu = feedback.length - pos - neg;
  const total = feedback.length || 1;

  const bar = document.getElementById('feedbackBar');
  if (bar) {
    bar.innerHTML = `
      <div class="rd-fb-pos" style="flex:${pos}"></div>
      <div class="rd-fb-neu" style="flex:${neu}"></div>
      <div class="rd-fb-neg" style="flex:${neg}"></div>
    `;
  }

  const legend = document.getElementById('feedbackLegend');
  if (legend) {
    legend.innerHTML = [
      { k: 'Good', v: Math.round(pos / total * 100), c: 'var(--pos)' },
      { k: 'Neutral', v: Math.round(neu / total * 100), c: 'var(--muted)' },
      { k: 'Off', v: Math.round(neg / total * 100), c: 'var(--neg)' },
    ].map(r => `
      <div class="rd-legend-row">
        <span class="rd-legend-dot" style="background:${r.c}"></span>
        <span class="rd-legend-label">${r.k}</span>
        <span class="rd-legend-value">${r.v}%</span>
      </div>
    `).join('');
  }
}

function formatTime(ts) {
  if (!ts) return '--';
  return new Date(ts).toLocaleString();
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---- Conversations ----
function renderConversations() {
  const el = document.getElementById('conversationsList');
  const sessions = applyFilters(allData.chatSessions || []).slice().sort((a, b) => b.timestamp - a.timestamp);
  if (!sessions.length) {
    el.innerHTML = '<div class="empty-state">No chat sessions found.</div>';
    return;
  }
  let html = '<table><tr><th>Session</th><th>User</th><th>Time</th><th>Messages</th><th>Details</th></tr>';
  sessions.forEach((s, i) => {
    const msgCount = s.messages?.length || 0;
    html += `<tr>
      <td style="font-family:monospace;font-size:11px;">${escapeHtml(s.sessionId?.slice(0, 8))}</td>
      <td><span class="pill info">${escapeHtml(s.userId)}</span></td>
      <td>${formatTime(s.timestamp)}</td>
      <td>${msgCount}</td>
      <td><button data-action="toggle" data-target="conv-${i}">View</button></td>
    </tr>
    <tr><td colspan="5" style="padding:0;border:none;">
      <div class="expand-content" id="conv-${i}">
        ${(s.messages || []).map(m => `<div class="msg-bubble ${m.role}">${escapeHtml(m.content)}</div>`).join('')}
      </div>
    </td></tr>`;
  });
  html += '</table>';
  el.innerHTML = html;
}

// ---- Feedback ----
function renderFeedback() {
  const el = document.getElementById('feedbackList');
  const feedback = applyFilters(allData.feedbackEvents || []).slice().sort((a, b) => b.timestamp - a.timestamp);
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
  const prefs = applyFilters(allData.userPreferences || []).slice().sort((a, b) => b.timestamp - a.timestamp);
  if (!prefs.length) {
    el.innerHTML = '<div class="empty-state">No saved reading goals found.</div>';
    return;
  }
  let html = '<table><tr><th>User</th><th>Time</th><th>Session</th><th>Reading Goal</th></tr>';
  prefs.forEach(p => {
    const goal = typeof p.preferences === 'object' ? JSON.stringify(p.preferences) : String(p.preferences ?? '--');
    html += `<tr>
      <td><span class="pill info">${escapeHtml(p.userId)}</span></td>
      <td>${formatTime(p.timestamp)}</td>
      <td style="font-family:monospace;font-size:11px;">${escapeHtml(p.sessionId?.slice(0, 8) || '--')}</td>
      <td style="font-size:12px;">${escapeHtml(goal?.slice(0, 180))}</td>
    </tr>`;
  });
  html += '</table>';
  el.innerHTML = html;
}

// ---- Research Logs ----
function renderLogs() {
  const el = document.getElementById('logsList');
  const catFilter = document.getElementById('logCategoryFilter')?.value || '';
  let logs = applyFilters(allData.researchLogs || []).slice();
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
  const stores = ['chatSessions', 'researchLogs', 'feedbackEvents', 'userPreferences'];
  const hasAnyData = Object.values(allData).some(arr => Array.isArray(arr) && arr.length > 0);
  el.innerHTML = stores.map(name => {
    const count = (allData[name] || []).length;
    const disabled = count === 0 ? ' disabled style="opacity:0.5;cursor:not-allowed;"' : '';
    return `
    <div class="export-card">
      <h4>${name}</h4>
      <p style="font-size:12px;color:#718096;margin-bottom:8px;">${count} records</p>
      <div class="btn-group">
        <button data-action="export-store" data-store="${escapeHtml(name)}" data-format="json"${disabled}>JSON</button>
        <button data-action="export-store" data-store="${escapeHtml(name)}" data-format="csv"${disabled}>CSV</button>
      </div>
    </div>`;
  }).join('') + `
    <div class="export-card" style="border-color:#667eea;">
      <h4>All Data</h4>
      <p style="font-size:12px;color:#718096;margin-bottom:8px;">Export everything as a single JSON file</p>
      <div class="btn-group">
        <button data-action="export-all"${hasAnyData ? '' : ' disabled style="opacity:0.5;cursor:not-allowed;"'}>Export All (JSON)</button>
      </div>
    </div>
  `;
}

// ---- Actions invoked by the delegated click handler ----

function toggleExpand(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}

async function exportStore(storeName, format) {
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
}

async function exportAll() {
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
}
