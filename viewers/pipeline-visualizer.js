/* Pipeline Visualizer — standalone viewer for the 12-agent agentic pipeline */

const AGENTS = [
  { id: 'pipeline-router',      num: 0,  name: 'Pipeline Router',     phase: 0, x: 300, y: 40  },
  { id: 'intent-analyst',       num: 1,  name: 'Intent Analyst',      phase: 1, x: 300, y: 120 },
  { id: 'visual-cartographer',  num: 2,  name: 'Visual Cartographer', phase: 2, x: 300, y: 200 },
  { id: 'narrator',             num: 4,  name: 'Narrator',            phase: 4, x: 300, y: 300 },
  { id: 'guardrails',           num: 10, name: 'Guardrails',          phase: 5, x: 300, y: 380 },
  { id: 'quality-validator',    num: 6,  name: 'Quality Validator',   phase: 6, x: 120, y: 480 },
  { id: 'memory-manager',       num: 7,  name: 'Memory Mgr',         phase: 6, x: 300, y: 480 },
  { id: 'feedback-analyst',     num: 8,  name: 'Feedback Analyst',    phase: 6, x: 480, y: 480 },
];

const AGENT_PHASE_MAP = Object.fromEntries(AGENTS.map(a => [a.id, a.phase]));

const PHASE_NAMES = ['Routing', 'Understanding', 'Vision', '', 'Execution', 'Sanitization', 'Background'];

const NODE_W = 150;
const NODE_H = 50;
const SVG_W = 650;
const SVG_H = 580;

const STATUS_COLORS = {
  idle:    { fill: '#2a2a4a', stroke: '#4a5568', dot: '#4a5568' },
  running: { fill: '#1a3a5c', stroke: '#2196F3', dot: '#2196F3' },
  success: { fill: '#1a3c2a', stroke: '#4CAF50', dot: '#4CAF50' },
  failed:  { fill: '#3c1a1a', stroke: '#f44336', dot: '#f44336' },
  skipped: { fill: '#3c2e1a', stroke: '#ff9800', dot: '#ff9800' },
};

const CONNECTIONS = [
  ['pipeline-router',     'intent-analyst',       false],
  ['intent-analyst',      'visual-cartographer',  false],
  ['visual-cartographer', 'narrator',             false],
  ['narrator',            'guardrails',           false],
  ['guardrails',          'quality-validator',    false],
  ['guardrails',          'memory-manager',       false],
  ['guardrails',          'feedback-analyst',     false],
];

let currentState = null;
let pipelineRunning = false;
const agentElementCache = new Map();

/* ──────────────────────────── Utilities ──────────────────────────── */

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDuration(ms) {
  if (typeof ms !== 'number' || ms <= 0) return '--';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

function switchTab(tabName) {
  document.querySelectorAll('.viz-tab').forEach(t => {
    t.classList.remove('active');
    t.setAttribute('aria-selected', 'false');
  });
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const btn = document.querySelector(`[data-tab="${tabName}"]`);
  if (btn) {
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
  }
  const panel = document.getElementById(tabName + 'Panel');
  if (panel) panel.classList.add('active');
}

function computeTotalDuration(state) {
  if (!state?.log?.length) return 0;
  return state.log.reduce((sum, e) => sum + (e.durationMs || 0), 0);
}

function setRunningState(running) {
  pipelineRunning = running;
  const indicator = document.getElementById('runningIndicator');
  if (indicator) indicator.style.display = running ? 'flex' : 'none';
  const badge = document.getElementById('pipelineBadge');
  if (running && badge) {
    badge.textContent = 'Pipeline Running...';
    badge.className = 'pipeline-badge pipeline-badge--running';
  }
}

/* ──────────────────────────── SVG Rendering ──────────────────────────── */

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  return el;
}

function renderPipelineSVG() {
  const container = document.getElementById('pipelineDiagram');
  if (!container) return;
  try {
  const svg = svgEl('svg', { width: '100%', height: SVG_H, viewBox: `0 0 ${SVG_W} ${SVG_H}`, preserveAspectRatio: 'xMidYMin meet' });

  // Connections
  for (const [fromId, toId, dashed] of CONNECTIONS) {
    const from = AGENTS.find(a => a.id === fromId);
    const to = AGENTS.find(a => a.id === toId);
    const x1 = from.x + NODE_W / 2, y1 = from.y + NODE_H;
    const x2 = to.x + NODE_W / 2, y2 = to.y;
    svg.appendChild(svgEl('line', { x1, y1, x2, y2, class: dashed ? 'connector connector--dashed' : 'connector' }));
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const s = 6, ax = x2 - Math.cos(angle) * 2, ay = y2 - Math.sin(angle) * 2;
    svg.appendChild(svgEl('polygon', {
      points: `${ax},${ay} ${ax - s * Math.cos(angle - 0.5)},${ay - s * Math.sin(angle - 0.5)} ${ax - s * Math.cos(angle + 0.5)},${ay - s * Math.sin(angle + 0.5)}`,
      class: dashed ? 'connector-arrow connector-arrow--dashed' : 'connector-arrow',
    }));
  }

  // Phase labels
  const phaseYs = { 0: 55, 1: 135, 2: 215, 4: 315, 5: 395, 6: 495 };
  for (const [phase, y] of Object.entries(phaseYs)) {
    const label = svgEl('text', { x: 8, y, class: 'phase-label' });
    label.textContent = `P${phase}`;
    svg.appendChild(label);
  }

  // Agent nodes
  for (const agent of AGENTS) {
    const g = svgEl('g', { class: 'agent-node', 'data-agent': agent.id });
    g.appendChild(svgEl('rect', {
      x: agent.x, y: agent.y, width: NODE_W, height: NODE_H,
      class: 'agent-node__rect agent-node__rect--idle', 'data-agent-rect': agent.id,
    }));
    g.appendChild(svgEl('circle', {
      cx: agent.x + 14, cy: agent.y + 16, r: 5,
      fill: STATUS_COLORS.idle.dot, class: 'agent-node__status-dot', 'data-agent-dot': agent.id,
    }));
    const num = svgEl('text', { x: agent.x + 26, y: agent.y + 19, class: 'agent-node__num' });
    num.textContent = `#${agent.num}`;
    g.appendChild(num);
    const label = svgEl('text', { x: agent.x + NODE_W / 2, y: agent.y + 34, class: 'agent-node__label', 'text-anchor': 'middle' });
    label.textContent = agent.name;
    g.appendChild(label);
    const dur = svgEl('text', { x: agent.x + NODE_W - 8, y: agent.y + 16, class: 'agent-node__duration', 'text-anchor': 'end', 'data-agent-dur': agent.id });
    g.appendChild(dur);
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', `${agent.name}, phase ${agent.phase}`);
    g.addEventListener('click', () => showAgentData(agent.id));
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showAgentData(agent.id);
      }
    });
    svg.appendChild(g);
  }

  // Build element cache for fast updates
  agentElementCache.clear();
  for (const agent of AGENTS) {
    agentElementCache.set(agent.id, {
      rect: svg.querySelector(`[data-agent-rect="${agent.id}"]`),
      dot:  svg.querySelector(`[data-agent-dot="${agent.id}"]`),
      dur:  svg.querySelector(`[data-agent-dur="${agent.id}"]`),
    });
  }

  // Output node — placed below the Phase 6 learning agents
  const outX = 260, outY = 540;
  svg.appendChild(svgEl('rect', { x: outX, y: outY, width: 80, height: 30, rx: 15, ry: 15, fill: '#667eea', stroke: '#764ba2', 'stroke-width': 2 }));
  const outLabel = svgEl('text', { x: outX + 40, y: outY + 20, fill: '#fff', 'font-size': 12, 'font-weight': 700, 'text-anchor': 'middle' });
  outLabel.textContent = 'OUTPUT';
  svg.appendChild(outLabel);
  // Connect feedback-analyst (center Phase 6 agent) down to OUTPUT
  const fb = AGENTS.find(a => a.id === 'feedback-analyst');
  svg.appendChild(svgEl('line', { x1: fb.x + NODE_W / 2, y1: fb.y + NODE_H, x2: outX + 40, y2: outY, class: 'connector' }));

  container.innerHTML = '';
  container.appendChild(svg);
  } catch (err) {
    console.error('Failed to render pipeline SVG:', err);
    container.innerHTML = `<div class="viz-error"><div class="viz-error__title">Failed to render pipeline diagram</div><div class="viz-error__detail">${escapeHtml(err.message)}</div></div>`;
  }
}

function updateAgentStatus(agentId, status, durationMs) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.idle;
  const cached = agentElementCache.get(agentId);
  const rect = cached?.rect || document.querySelector(`[data-agent-rect="${agentId}"]`);
  if (rect) {
    rect.setAttribute('class', `agent-node__rect agent-node__rect--${status}`);
    rect.setAttribute('fill', colors.fill);
    rect.setAttribute('stroke', colors.stroke);
  }
  const dot = cached?.dot || document.querySelector(`[data-agent-dot="${agentId}"]`);
  if (dot) dot.setAttribute('fill', colors.dot);
  const dur = cached?.dur || document.querySelector(`[data-agent-dur="${agentId}"]`);
  if (dur && typeof durationMs === 'number' && durationMs > 0) dur.textContent = formatDuration(durationMs);
}

function applyLogToAgents(log) {
  if (!log?.length) return;
  for (const entry of log) {
    const status = entry.success ? 'success' : 'failed';
    updateAgentStatus(entry.agent, status, entry.durationMs);
  }
}

/* ──────────────────────────── Pipeline Badge ──────────────────────────── */

function updatePipelineBadge(type) {
  const badge = document.getElementById('pipelineBadge');
  if (!badge) return;
  if (!type) { badge.textContent = 'No active pipeline'; badge.className = 'pipeline-badge'; return; }
  badge.textContent = `${capitalize(type)} Pipeline`;
  badge.className = `pipeline-badge pipeline-badge--${type.toLowerCase()}`;
}

/* ──────────────────────────── Phase Timeline ──────────────────────────── */

function renderPhaseTimeline(state) {
  const container = document.getElementById('phaseTimeline');
  if (!container) return;
  if (!state?.log?.length) {
    container.innerHTML = PHASE_NAMES.map((name, i) =>
      `<div class="phase-segment phase-segment--${i}" style="flex:1">${name}</div>`
    ).join('');
    return;
  }

  // Map agent log entries to phases
  const phaseDurations = {};
  for (const entry of state.log) {
    const phase = AGENT_PHASE_MAP[entry.agent];
    if (phase == null) continue;
    phaseDurations[phase] = (phaseDurations[phase] || 0) + (entry.durationMs || 0);
  }

  const total = Object.values(phaseDurations).reduce((s, v) => s + v, 0) || 1;
  container.innerHTML = PHASE_NAMES.map((name, i) => {
    const ms = phaseDurations[i] || 0;
    const pct = Math.max((ms / total) * 100, 6);
    const label = ms > 0 ? `${name} ${formatDuration(ms)}` : name;
    return `<div class="phase-segment phase-segment--${i}" style="flex:${pct}" title="${label}">${label}</div>`;
  }).join('');
}

/* ──────────────────────────── Metrics Panel ──────────────────────────── */

function renderMetrics(state) {
  const panel = document.getElementById('metricsPanel');
  if (!panel) return;
  if (!state) {
    panel.innerHTML = `<div class="metrics-empty">
      <div class="metrics-empty__icon"></div>
      <div>No pipeline runs yet</div>
      <div class="metrics-empty__sub">Run the agentic pipeline from the popup to see metrics here.</div>
    </div>`;
    return;
  }

  try {
  const totalDuration = computeTotalDuration(state);
  const agentCount = state.log?.length || 0;
  const successCount = state.log?.filter(e => e.success).length || 0;
  const retryCount = state.validation?.retryCount || 0;
  const sectionCount = state.sectionCount || 0;
  const renarrationCount = state.renarrationCount || 0;
  const pipelineType = state.pipelineType || 'unknown';
  const scores = state.validation?.scores || {};
  const guardrailFlags = state.guardrails?.flags || [];
  const passed = state.validation?.passed;

  const estimatedCost = (agentCount * 0.002).toFixed(3);

  let html = '<div class="metrics-grid">';
  html += metricCard('Pipeline', capitalize(pipelineType));
  html += metricCard('Duration', formatDuration(totalDuration));
  html += metricCard('Agents', `${successCount}/${agentCount}`, successCount < agentCount ? 'warn' : 'good');
  html += metricCard('Sections', sectionCount);
  html += metricCard('Renarrated', renarrationCount);
  html += metricCard('Retries', retryCount, retryCount > 0 ? 'warn' : null);
  html += metricCard('Validated', passed ? 'Pass' : 'Fail', passed ? 'good' : 'bad');
  html += metricCard('Est. Cost', `$${estimatedCost}`);
  html += '</div>';

  if (Object.keys(scores).length > 0) {
    html += '<div class="metrics-section"><div class="metrics-section__title">Validation Scores</div>';
    for (const [key, val] of Object.entries(scores)) {
      if (key === 'averageScore') continue;
      const numVal = typeof val === 'number' ? val : parseFloat(val) || 0;
      const pct = (numVal / 5) * 100;
      const color = numVal >= 4 ? '#4CAF50' : numVal >= 3 ? '#ff9800' : '#f44336';
      html += `<div class="score-bar">
        <span class="score-bar__label">${formatLabel(key)}</span>
        <div class="score-bar__track"><div class="score-bar__fill" style="width:${pct}%;background:${color}"></div></div>
        <span class="score-bar__value">${numVal.toFixed(1)}</span>
      </div>`;
    }
    if (scores.averageScore != null) {
      html += `<div class="score-bar" style="margin-top:8px;font-weight:600">
        <span class="score-bar__label">Average</span>
        <div class="score-bar__track"><div class="score-bar__fill" style="width:${(scores.averageScore / 5) * 100}%;background:#667eea"></div></div>
        <span class="score-bar__value">${Number(scores.averageScore).toFixed(1)}</span>
      </div>`;
    }
    html += '</div>';
  }

  if (guardrailFlags.length > 0) {
    const biasFlags = guardrailFlags.filter(f => typeof f === 'object' && f.type === 'bias');
    const otherFlags = guardrailFlags.filter(f => typeof f === 'string' || (typeof f === 'object' && f.type !== 'bias'));

    if (otherFlags.length > 0) {
      html += '<div class="metrics-section"><div class="metrics-section__title">Guardrail Flags</div>';
      for (const f of otherFlags) {
        const label = typeof f === 'string' ? f : `${f.type || 'unknown'}: ${f.detail || ''}`;
        html += `<div class="guardrail-flag"><span class="guardrail-flag__icon">${f.severity === 'error' ? '!' : '\u26A0'}</span>${escapeHtml(label)}</div>`;
      }
      html += '</div>';
    }

    if (biasFlags.length > 0) {
      html += '<div class="metrics-section"><div class="metrics-section__title">Bias Warnings</div>';
      for (const f of biasFlags) {
        const label = `${f.detail || 'Bias detected'}`;
        html += `<div class="guardrail-flag guardrail-flag--bias"><span class="guardrail-flag__icon">!</span>${escapeHtml(label)}</div>`;
      }
      html += '</div>';
    }
  }

  // Show parseError flag if present
  if (state.validation?.parseError) {
    html += '<div class="metrics-section"><div class="metrics-section__title">Parse Errors</div>';
    html += `<div class="guardrail-flag"><span class="guardrail-flag__icon">!</span>Validation response could not be parsed correctly</div>`;
    html += '</div>';
  }

  // Agent execution log
  if (state.log?.length) {
    html += '<div class="metrics-section"><div class="metrics-section__title">Agent Execution Log</div>';
    html += '<div class="agent-log">';
    for (const entry of state.log) {
      const iconCls = entry.success ? 'agent-log__icon--ok' : 'agent-log__icon--fail';
      html += `<div class="agent-log__entry">
        <span class="agent-log__icon ${iconCls}"></span>
        <span class="agent-log__name">${escapeHtml(entry.agent)}</span>
        <span class="agent-log__dur">${formatDuration(entry.durationMs)}</span>
        ${entry.detail ? `<span class="agent-log__detail">${escapeHtml(entry.detail)}</span>` : ''}
      </div>`;
    }
    html += '</div></div>';
  }

  panel.innerHTML = html;
  } catch (err) {
    console.error('Failed to render metrics:', err);
    panel.innerHTML = `<div class="viz-error"><div class="viz-error__title">Failed to render metrics</div><div class="viz-error__detail">${escapeHtml(err.message)}</div></div>`;
  }
}

function metricCard(label, value, variant) {
  const cls = variant ? ` metric-card__value--${variant}` : '';
  return `<div class="metric-card">
    <div class="metric-card__label">${escapeHtml(label)}</div>
    <div class="metric-card__value${cls}">${escapeHtml(String(value))}</div>
  </div>`;
}

function formatLabel(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
}

/* ──────────────────────────── Data Inspector ──────────────────────────── */

async function showAgentData(agentId) {
  switchTab('inspector');
  const panel = document.getElementById('inspectorPanel');
  if (!panel) return;
  const agent = AGENTS.find(a => a.id === agentId);
  const label = agent ? `Agent #${agent.num}: ${agent.name}` : agentId;

  // Try completed state first, then fall back to live data
  let snapshot = currentState?.agentSnapshots?.[agentId] || null;
  let logEntry = currentState?.log?.find(e => e.agent === agentId) || null;
  let liveStatus = null;

  // Check live data for in-flight agents
  try {
    const { pipelineVisualizerLive } = await chrome.storage.local.get('pipelineVisualizerLive');
    const liveAgent = pipelineVisualizerLive?.[agentId];
    if (liveAgent) {
      liveStatus = liveAgent.status;
      if (!snapshot && liveAgent.snapshot) snapshot = liveAgent.snapshot;
    }
  } catch { /* best-effort */ }

  let statusBadge;
  if (liveStatus === 'running') {
    statusBadge = '<span class="inspector-badge inspector-badge--running">Running...</span>';
  } else if (logEntry) {
    statusBadge = `<span class="inspector-badge inspector-badge--${logEntry.success ? 'success' : 'failed'}">${logEntry.success ? 'Success' : 'Failed'} (${formatDuration(logEntry.durationMs)})</span>`;
  } else if (liveStatus) {
    statusBadge = `<span class="inspector-badge inspector-badge--${liveStatus}">${liveStatus}</span>`;
  } else {
    statusBadge = '<span class="inspector-badge inspector-badge--idle">Not executed</span>';
  }

  let html = `<div class="inspector-header">${escapeHtml(label)} ${statusBadge}</div>`;

  if (snapshot) {
    html += `<div class="inspector-section"><div class="inspector-section__title">Input</div>
      <div class="code-block json-viewer">${syntaxHighlight(JSON.stringify(snapshot.input, null, 2))}</div></div>`;
    if (snapshot.output) {
      html += `<div class="inspector-section"><div class="inspector-section__title">Output</div>
        <div class="code-block json-viewer">${syntaxHighlight(JSON.stringify(snapshot.output, null, 2))}</div></div>`;
    }
    if (snapshot.error) {
      html += `<div class="inspector-section"><div class="inspector-section__title">Error</div>
        <div class="guardrail-flag"><span class="guardrail-flag__icon">!</span>${escapeHtml(snapshot.error)}</div></div>`;
    }
  } else if (liveStatus === 'running') {
    html += `<div class="inspector-placeholder">Agent is currently running — input will appear when it completes.</div>`;
  } else if (!currentState?.log) {
    html += `<div class="inspector-placeholder">No pipeline data available. Run a pipeline first.</div>`;
  }

  panel.innerHTML = html;
}

function syntaxHighlight(json) {
  return escapeHtml(json).replace(
    /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(\.\d+)?([eE][+-]?\d+)?)/g,
    match => {
      let cls = 'json-number';
      if (/^"/.test(match)) cls = /:$/.test(match) ? 'json-key' : 'json-string';
      else if (/true|false/.test(match)) cls = 'json-boolean';
      else if (/null/.test(match)) cls = 'json-null';
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

/* ──────────────────────────── Memory Panel ──────────────────────────── */

async function renderMemoryState(layer) {
  const panel = document.getElementById('memoryPanel');
  if (!panel) return;
  const activeLayer = layer || 'semantic';

  let html = '<div class="memory-tabs">';
  for (const l of ['semantic', 'episodic', 'procedural']) {
    const cls = l === activeLayer ? 'memory-tab active' : 'memory-tab';
    html += `<button class="${cls}" data-memory-layer="${l}">${capitalize(l)}</button>`;
  }
  html += '</div>';

  try {
    let data = null;
    let description = '';
    if (activeLayer === 'semantic') {
      const result = await chrome.storage.sync.get('memoryProfile');
      data = result.memoryProfile || null;
      description = 'User profile: role, expertise, preferred tone, terminology preferences.';
    } else if (activeLayer === 'episodic') {
      description = 'Past session summaries stored in Firestore. Shows recent entries if available.';
      // Episodic is in Firestore, not directly readable here. Show what we have in currentState.
      if (currentState?.memory?.episodic?.length) {
        data = currentState.memory.episodic;
      }
    } else {
      const result = await chrome.storage.local.get('proceduralMemory');
      data = result.proceduralMemory || null;
      description = 'Learned agent instructions from feedback patterns.';
    }

    html += `<div class="memory-description">${escapeHtml(description)}</div>`;
    if (data && ((Array.isArray(data) && data.length > 0) || (!Array.isArray(data) && Object.keys(data).length > 0))) {
      html += `<div class="code-block memory-content">${syntaxHighlight(JSON.stringify(data, null, 2))}</div>`;
    } else {
      html += `<div class="memory-empty">No ${activeLayer} memory data stored yet.</div>`;
    }
  } catch (err) {
    html += `<div class="memory-empty">Could not load memory: ${escapeHtml(err.message)}</div>`;
  }

  panel.innerHTML = html;
  panel.querySelectorAll('[data-memory-layer]').forEach(btn => {
    btn.addEventListener('click', () => renderMemoryState(btn.dataset.memoryLayer));
  });
}

/* ──────────────────────────── Diagrams Panel ──────────────────────────── */

function renderDiagrams(state) {
  const panel = document.getElementById('diagramsPanel');
  if (!panel) return;
  try {
    // Check renarrations for mermaid content
    const diagrams = [];
    if (state?.renarrations) {
      for (const r of state.renarrations) {
        if (r.mermaid) diagrams.push({ title: `Section: ${r.sectionId}`, code: r.mermaid });
      }
    }
    if (diagrams.length === 0) {
      panel.innerHTML = `<div class="diagrams-empty">
        <div>No diagrams generated</div>
        <div class="diagrams-empty__sub">Agent 5 (Diagram Generator) creates Mermaid diagrams for complex content sections.</div>
      </div>`;
      return;
    }
    panel.innerHTML = diagrams.map(d =>
      `<div class="diagram-block">
        <div class="diagram-block__title">${escapeHtml(d.title)}</div>
        <div class="code-block diagram-block__code">${escapeHtml(d.code)}</div>
      </div>`
    ).join('');
  } catch (err) {
    console.error('Failed to render diagrams:', err);
    panel.innerHTML = `<div class="viz-error"><div class="viz-error__title">Failed to render diagrams</div><div class="viz-error__detail">${escapeHtml(err.message)}</div></div>`;
  }
}

/* ──────────────────────────── Run History ──────────────────────────── */

async function loadRunHistory() {
  const listEl = document.getElementById('runList');
  if (!listEl) return;
  try {
    const { pipelineLogs } = await chrome.storage.local.get('pipelineLogs');
    const logs = (pipelineLogs || []).filter(e => e.stage === 'pipeline-complete');
    if (logs.length === 0) {
      listEl.innerHTML = '<div class="run-history__empty">No pipeline runs recorded yet.</div>';
      return;
    }

    listEl.innerHTML = [...logs].reverse().map((run, i) => {
      const idx = logs.length - 1 - i;
      const type = run.pipelineType || 'unknown';
      const status = run.success ? 'success' : 'failed';
      const ts = run.timestampIso ? new Date(run.timestampIso).toLocaleString() : 'Unknown';
      const dur = formatDuration(run.duration);
      return `<button class="run-item" data-run-index="${idx}">
        <div><span class="run-item__status run-item__status--${status}"></span><span class="run-item__type run-item__type--${type.toLowerCase()}">${type}</span></div>
        <div class="run-item__time">${escapeHtml(ts)}</div>
        <div class="run-item__duration">${dur} · ${run.agentCount || 0} agents</div>
      </button>`;
    }).join('');
    listEl.querySelectorAll('.run-item').forEach(el => {
      el.addEventListener('click', () => selectRun(parseInt(el.dataset.runIndex, 10)));
    });
  } catch {
    listEl.innerHTML = '<div class="run-history__empty">Could not load run history.</div>';
  }
}

async function selectRun(index) {
  try {
    const { pipelineLogs } = await chrome.storage.local.get('pipelineLogs');
    const logs = (pipelineLogs || []).filter(e => e.stage === 'pipeline-complete');
    const run = logs[index];
    if (!run) return;

    document.querySelectorAll('.run-item').forEach(el => el.classList.remove('run-item--active'));
    const active = document.querySelector(`[data-run-index="${index}"]`);
    if (active) active.classList.add('run-item--active');

    // Try per-run history first, then fall back to current visualizer state
    const { pipelineRunHistory, pipelineVisualizer } = await chrome.storage.local.get([
      'pipelineRunHistory', 'pipelineVisualizer',
    ]);
    if (pipelineRunHistory?.[run.runId]) {
      currentState = pipelineRunHistory[run.runId];
    } else if (pipelineVisualizer?.runId === run.runId) {
      currentState = pipelineVisualizer;
    } else {
      // Best-effort from the log entry itself
      currentState = { ...run, log: [], validation: { scores: {}, passed: run.success }, guardrails: { passed: true, flags: [] } };
    }

    // Reset all agents then apply states
    for (const agent of AGENTS) updateAgentStatus(agent.id, 'idle', 0);
    if (currentState.log) applyLogToAgents(currentState.log);

    updatePipelineBadge(run.pipelineType || currentState.pipelineType);
    renderPhaseTimeline(currentState);
    renderMetrics(currentState);
    renderDiagrams(currentState);
  } catch (err) {
    console.warn('Failed to load run:', err);
  }
}

async function clearVisualizerState() {
  await chrome.storage.local.remove(['pipelineVisualizer', 'pipelineVisualizerLive', 'pipelineRunHistory']);
  document.querySelectorAll('.run-item').forEach(el => el.classList.remove('run-item--active'));
  currentState = null;
  for (const agent of AGENTS) updateAgentStatus(agent.id, 'idle', 0);
  updatePipelineBadge(null);
  renderPhaseTimeline(null);
  renderMetrics(null);
  renderDiagrams(null);
  setRunningState(false);
}

/* ──────────────────────────── Tab Switching ──────────────────────────── */

function initTabs() {
  document.querySelectorAll('.viz-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.tab);
      if (tab.dataset.tab === 'memory') renderMemoryState();
    });
  });
}

/* ──────────────────────────── Storage Listener ──────────────────────────── */

let _storageListener = null;

function initStorageListener() {
  // Remove previous listener to prevent leaks on reload
  if (_storageListener) {
    chrome.storage.onChanged.removeListener(_storageListener);
  }
  _storageListener = (changes, area) => {
    if (area !== 'local') return;

    if (changes.pipelineVisualizerLive) {
      const live = changes.pipelineVisualizerLive.newValue;
      if (!live) {
        // Live state was cleared (pipeline finished or reset)
        setRunningState(false);
        return;
      }
      setRunningState(true);
      for (const [agentName, data] of Object.entries(live || {})) {
        if (agentName.startsWith('_') || !data) continue;
        updateAgentStatus(agentName, data.status, data.durationMs);
      }
      if (live._pipelineType) updatePipelineBadge(live._pipelineType);
    }

    if (changes.pipelineVisualizer) {
      const state = changes.pipelineVisualizer.newValue;
      if (state?.completed) {
        currentState = state;
        setRunningState(false);
        applyLogToAgents(state.log);
        renderMetrics(state);
        renderPhaseTimeline(state);
        renderDiagrams(state);
        loadRunHistory();
      }
    }
  };
  chrome.storage.onChanged.addListener(_storageListener);
}

/* ──────────────────────────── Init ──────────────────────────── */

document.addEventListener('DOMContentLoaded', async () => {
  renderPipelineSVG();
  initTabs();
  initStorageListener();

  // Clear button
  const clearBtn = document.getElementById('clearBtn');
  if (clearBtn) clearBtn.addEventListener('click', clearVisualizerState);

  // Empty states
  renderMetrics(null);
  renderPhaseTimeline(null);
  const inspectorPanel = document.getElementById('inspectorPanel');
  if (inspectorPanel) inspectorPanel.innerHTML =
    '<div class="inspector-placeholder">Click an agent node in the diagram above to inspect its data.</div>';
  const diagramsPanel = document.getElementById('diagramsPanel');
  if (diagramsPanel) diagramsPanel.innerHTML =
    '<div class="diagrams-empty"><div>No diagrams generated</div></div>';

  await loadRunHistory();

  try {
    const { pipelineVisualizer, pipelineVisualizerLive } = await chrome.storage.local.get([
      'pipelineVisualizer', 'pipelineVisualizerLive',
    ]);

    if (pipelineVisualizerLive) {
      // Detect if a pipeline is currently running (has live data but not yet completed)
      const liveEntries = Object.entries(pipelineVisualizerLive || {});
      const hasRunningAgents = liveEntries.some(
        ([k, v]) => !k.startsWith('_') && v?.status === 'running'
      );
      if (hasRunningAgents || (!pipelineVisualizer?.completed && pipelineVisualizerLive._runId)) {
        setRunningState(true);
      }
      for (const [agentName, data] of liveEntries) {
        if (!agentName.startsWith('_') && data) updateAgentStatus(agentName, data.status, data.durationMs);
      }
      if (pipelineVisualizerLive._pipelineType) updatePipelineBadge(pipelineVisualizerLive._pipelineType);
    }

    if (pipelineVisualizer?.completed) {
      currentState = pipelineVisualizer;
      applyLogToAgents(pipelineVisualizer.log);
      renderMetrics(pipelineVisualizer);
      renderPhaseTimeline(pipelineVisualizer);
      renderDiagrams(pipelineVisualizer);
    }
  } catch (err) {
    console.warn('Could not load pipeline state:', err.message);
    const metricsPanel = document.getElementById('metricsPanel');
    if (metricsPanel) {
      metricsPanel.innerHTML = `<div class="viz-error"><div class="viz-error__title">Failed to load pipeline data</div><div class="viz-error__detail">${escapeHtml(err.message)}</div></div>`;
    }
  }
});
