document.getElementById('runBtn').addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ action: 'run-test-cases' });
  renderLogs(res.logs || []);
});
document.getElementById('refreshBtn').addEventListener('click', loadLogs);
document.getElementById('exportBtn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'export-logs' });
});
document.getElementById('clearBtn').addEventListener('click', async () => {
  if (!confirm('Clear all logs?')) return;
  await chrome.runtime.sendMessage({ action: 'clear-logs' });
  renderLogs([]);
});

async function loadLogs() {
  const res = await chrome.runtime.sendMessage({ action: 'get-logs' });
  renderLogs(res.logs || []);
}

function renderLogs(logs) {
  const tbody = document.querySelector('#logTable tbody');
  tbody.innerHTML = '';
  logs.forEach(l => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${l.testId}</td>
      <td>${l.modelId}</td>
      <td>${escapeHtml(l.persona)}</td>
      <td>${l.taskName}</td>
      <td>${l.timestampHuman ?? l.timestampIso}</td>
      <td style="max-width:320px;white-space:pre-wrap;">${l.success ? escapeHtml(l.output||'') : `<span style="color:#e53e3e">${escapeHtml(l.error||'')}</span>`}</td>
      <td>
        <textarea class="eval-text" data-id="${l.testId}" placeholder="Enter evaluation...">${escapeHtml(l.evaluation||'')}</textarea>
        <button data-save="${l.testId}" style="margin-top:4px;">Save</button>
      </td>
    `;
    tbody.appendChild(tr);

    // After appending, match the textarea height to the output cell height (or content), whichever is larger
    const outputCell = tr.children[5];
    const evalCell = tr.children[6];
    const ta = evalCell.querySelector('textarea');
    const baseline = outputCell ? outputCell.clientHeight : 0;

    const adjust = () => {
      // allow the textarea to grow based on content but never smaller than the output cell
      requestAnimationFrame(() => {
        ta.style.height = 'auto';
        const contentH = ta.scrollHeight;
        const refH = Math.max(baseline, outputCell ? outputCell.clientHeight : 0);
        const desired = Math.max(120, refH, contentH);
        ta.style.height = desired + 'px';
      });
    };

    // Initial adjust
    adjust();
    // Re-adjust on content input
    ta.addEventListener('input', adjust);
    // Re-adjust on window resize to keep matching the output cell height
    window.addEventListener('resize', adjust, { passive: true });
  });
  tbody.querySelectorAll('button[data-save]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-save');
      const ta = tbody.querySelector(`textarea[data-id="${id}"]`);
      const evaluation = ta.value.trim();
      await chrome.runtime.sendMessage({ action: 'evaluate-log-entry', testId: id, evaluation });
    });
  });
}

function escapeHtml(s='') {
  return s.replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

loadLogs();