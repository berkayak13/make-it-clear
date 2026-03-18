async function loadLogs() {
  const status = document.getElementById('status');
  const tbody = document.getElementById('logBody');
  status.textContent = 'Loading…';
  const res = await chrome.runtime.sendMessage({ action: 'get-pipeline-logs' });
  const logs = res?.logs || [];
  renderLogs(logs);
  status.textContent = `${logs.length} entries`;
}

let currentFilter = 'all';
let stageFilter = 'all';
let titleSearch = '';

function renderLogs(logs) {
  const tbody = document.getElementById('logBody');
  let filtered = currentFilter === 'starred' ? logs.filter(l => l.starred) : logs;
  if (stageFilter !== 'all') {
    filtered = filtered.filter(l => (l.stage || '').toLowerCase() === stageFilter);
  }
  if (titleSearch.trim()) {
    const query = titleSearch.toLowerCase().trim();
    filtered = filtered.filter(l => (l.title || '').toLowerCase().includes(query));
  }
  tbody.innerHTML = '';
  filtered.forEach(l => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td title="${escapeHtml(l.title || '')}">${escapeHtml(shortTitle(l.title))}</td>
      <td>${escapeHtml(l.runId || '')}</td>
      <td>${escapeHtml(l.stage || '')}</td>
      <td><span class="pill ${l.success ? 'success' : 'fail'}">${l.success ? 'OK' : 'Fail'}</span></td>
      <td>${escapeHtml(l.model || '')}</td>
      <td>${l.durationMs ? `${l.durationMs} ms` : ''}</td>
      <td>${escapeHtml(formatTime(l.timestampIso))}</td>
      <td>${l.url ? `<a href="${escapeHtml(l.url)}" target="_blank" rel="noreferrer">${escapeHtml(shortUrl(l.url))}</a>` : ''}</td>
      <td class="button-cell">${l.error ? `<button class="link-btn" data-error="${l.runId}-${l.stage}">View</button>` : ''}</td>
      <td class="button-cell">${
        l.input && l.stage !== 'capture'
          ? `<button class="link-btn" data-input="${l.runId}-${l.stage}">View</button>`
          : ''
      }</td>
      <td class="button-cell">${l.content ? `<button class="link-btn" data-content="${l.runId}-${l.stage}">View</button>` : ''}</td>
      <td class="actions-cell">
        <button class="link-btn" data-star="${l.runId}-${l.stage}" title="${l.starred ? 'Unstar' : 'Star'}">${l.starred ? '★' : '☆'}</button>
        <button class="link-btn" data-delete="${l.runId}-${l.stage}" title="Remove">🗑</button>
      </td>
    `;
    if (l.input && l.stage !== 'capture') {
      tr.querySelector('[data-input]').addEventListener('click', () => {
        openModal(`${l.stage?.toUpperCase()} input`, renderInput(l));
      });
    }
    if (l.content) {
      tr.querySelector('[data-content]').addEventListener('click', () => {
        openModal(`${l.stage?.toUpperCase()} content`, renderOutput(l));
      });
    }
    if (l.error) {
      tr.querySelector('[data-error]').addEventListener('click', () => {
        openModal(`${l.stage?.toUpperCase()} error`, l.error);
      });
    }
    tr.querySelector('[data-star]').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ action: 'toggle-pipeline-star', runId: l.runId, stage: l.stage });
      loadLogs();
    });
    tr.querySelector('[data-delete]').addEventListener('click', async () => {
      if (!confirm('Remove this entry?')) return;
      await chrome.runtime.sendMessage({ action: 'delete-pipeline-entry', runId: l.runId, stage: l.stage });
      loadLogs();
    });
    tbody.appendChild(tr);
  });
}

function renderInput(log) {
  const parts = [];
  if (log.input?.prompt) {
    parts.push(`<div><strong>Prompt:</strong></div><div class="code">${escapeHtml(log.input.prompt)}</div>`);
  }
  if (log.input?.systemPrompt || log.input?.userText) {
    if (log.input.systemPrompt) parts.push(`<div><strong>System:</strong></div><div class="code">${escapeHtml(log.input.systemPrompt)}</div>`);
    if (log.input.userText) parts.push(`<div><strong>User:</strong></div><div class="code">${escapeHtml(log.input.userText)}</div>`);
  }
  if (log.input?.imageCount) {
    parts.push(`<div><strong>Screenshots:</strong> ${log.input.imageCount} slice(s)</div>`);
  }
  return parts.join('<hr>');
}

function renderOutput(log) {
  const parts = [];
  if (log.content) {
    parts.push(`<div><strong>Output:</strong></div><div class="code">${escapeHtml(log.content)}</div>`);
  }
  if (log.input?.imageCount) {
    parts.push(`<div><strong>Screenshots:</strong> ${log.input.imageCount} slice(s)</div>`);
  }
  return parts.join('<hr>');
}

function openModal(title, content, isHtml = true) {
  const modal = document.getElementById('contentModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalContent = document.getElementById('modalContent');
  modalTitle.textContent = title || 'Content';
  if (isHtml) {
    modalContent.innerHTML = content || '';
  } else {
    modalContent.textContent = content || '';
  }
  modal.style.display = 'flex';
}

function closeModal() {
  const modal = document.getElementById('contentModal');
  modal.style.display = 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('refreshBtn').addEventListener('click', loadLogs);
  document.getElementById('clearBtn').addEventListener('click', async () => {
    if (!confirm('Clear pipeline logs?')) return;
    await chrome.runtime.sendMessage({ action: 'clear-pipeline-logs' });
    loadLogs();
  });
  document.getElementById('allFilterBtn').addEventListener('click', () => { currentFilter = 'all'; loadLogs(); });
  document.getElementById('starFilterBtn').addEventListener('click', () => { currentFilter = 'starred'; loadLogs(); });
  document.getElementById('stageFilter').addEventListener('change', (e) => {
    stageFilter = e.target.value;
    loadLogs();
  });
  document.getElementById('titleSearch').addEventListener('input', (e) => {
    titleSearch = e.target.value;
    loadLogs();
  });
  loadLogs();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.pipelineLogs) {
    loadLogs();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('contentModal');
  const modalClose = document.getElementById('modalClose');
  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }
});

function escapeHtml(s='') {
  return s.replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function shortUrl(u='') {
  try {
    const obj = new URL(u);
    return obj.host + obj.pathname;
  } catch {
    return u;
  }
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString();
    const time = d.toLocaleTimeString();
    return `${date} ${time}`;
  } catch {
    return iso;
  }
}

function shortTitle(t='') {
  if (!t) return '—';
  return t.length > 40 ? t.slice(0, 37) + '...' : t;
}
