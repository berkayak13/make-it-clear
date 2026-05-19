// Options page script

// Default tasks - keep in sync with storage-helpers.js DEFAULT_TASKS
const DEFAULT_TASKS = {
  'simple': {
    name: 'Simple Language',
    textPrompt:
      'You are performing a re-narration task. Express the given text in simple, easy-to-understand language with short sentences and plain vocabulary suitable for a general audience.',
    imagePrompt:
      'You are describing an image in plain, accessible language. Keep sentences short and avoid technical terms.',
    maxLength: 150,
    isDefault: true
  },
  'detailed': {
    name: 'Detailed Explanation',
    textPrompt:
      'You are performing a re-narration task. Produce a detailed and comprehensive version of the given text that adds clarity, elaboration, and logical flow while remaining faithful to the original meaning.',
    imagePrompt:
      'You are describing an image in a detailed way. Cover all visible elements, relationships, and contextual features.',
    maxLength: 300,
    isDefault: true
  },
  'academic': {
    name: 'Academic Style',
    textPrompt:
      'You are performing a re-narration task. Render the given text in formal academic language, using precise terminology and structured phrasing consistent with scholarly writing.',
    imagePrompt:
      'You are describing an image in an academic tone, focusing on analytical, objective, and domain-appropriate terminology.',
    maxLength: 250,
    isDefault: true
  },
  'summary': {
    name: 'Summary',
    textPrompt:
      'You are performing a re-narration task. Summarize the given text concisely, keeping only the essential ideas and expressing them clearly and neutrally.',
    imagePrompt:
      'You are summarizing the content of an image briefly, noting only the key elements or actions depicted.',
    maxLength: 100,
    isDefault: true
  }
};

let currentTasks = {};
let editingTaskKey = null;
let currentTaskActive = 'simple';
let systemPromptTemplate = '';
let boilerplateText = '';
let templateSaveTimer = null;
let currentReadingGoal = '';

function retiredKey(parts) {
  return parts.join('');
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupEventListeners();
  hydrateActiveSelectors();
  updateEffectiveSystemPrompt();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.readingGoal) {
    currentReadingGoal = changes.readingGoal.newValue || '';
    updateEffectiveSystemPrompt();
  }
});

async function loadSettings() {
  const settings = await chrome.storage.sync.get([
    'tasks',
    'currentTask',
    'systemPromptTemplate'
  ]);
  const local = await chrome.storage.local.get(['studyUserId', 'enableResearchLogging', 'firebaseProjectId', 'firebaseApiKey']);

  const userIdInput = document.getElementById('studyUserId');
  const loggingOpt = document.getElementById('enableResearchLoggingOpt');
  if (userIdInput) userIdInput.value = local.studyUserId || '';
  if (loggingOpt) loggingOpt.checked = local.enableResearchLogging !== false;

  const fbProjectInput = document.getElementById('firebaseProjectId');
  const fbApiKeyInput = document.getElementById('firebaseApiKey');
  if (fbProjectInput) fbProjectInput.value = local.firebaseProjectId || 'renarration-research';
  if (fbApiKeyInput) fbApiKeyInput.value = local.firebaseApiKey || '';

  boilerplateText = await fetch(chrome.runtime.getURL('src/prompts/system.md')).then(r => r.text()).catch(() => '');

  let tasks = settings.tasks;
  let currentTask = settings.currentTask;
  let shouldWrite = false;

  if (!tasks || !Object.keys(tasks).length) {
    tasks = DEFAULT_TASKS;
    shouldWrite = true;
  }
  if (!currentTask) {
    currentTask = Object.keys(tasks)[0] || 'simple';
    shouldWrite = true;
  }
  if (shouldWrite) {
    await chrome.storage.sync.set({ tasks, currentTask });
  }

  currentTasks = tasks;
  currentTaskActive = currentTask;
  systemPromptTemplate = sanitizeTemplate((settings.systemPromptTemplate || '').trim());
  if (!systemPromptTemplate) {
    systemPromptTemplate = buildDefaultTemplate(boilerplateText);
    await chrome.storage.sync.set({ systemPromptTemplate });
  } else if (systemPromptTemplate !== (settings.systemPromptTemplate || '').trim()) {
    await chrome.storage.sync.set({ systemPromptTemplate });
  }

  const templateEl = document.getElementById('systemPromptTemplate');
  if (templateEl) templateEl.value = systemPromptTemplate;

  renderTasks();
  const { readingGoal: savedGoal } = await chrome.storage.sync.get(['readingGoal']);
  currentReadingGoal = savedGoal || '';
  document.getElementById('effectiveSystemPrompt').value = buildEffectiveSystemPrompt(boilerplateText, systemPromptTemplate, currentReadingGoal);
}

function hydrateActiveSelectors() {
  const taskSel = document.getElementById('currentTaskSelect');
  if (!taskSel) return;
  taskSel.innerHTML = '';
  Object.entries(currentTasks || {}).forEach(([key, val]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = val.name || key;
    taskSel.appendChild(opt);
  });
  taskSel.value = currentTaskActive;
}

function buildDefaultTemplate(boilerplate) {
  const parts = [];
  const base = (boilerplate || '').trim();
  if (base) parts.push(base);
  parts.push('Task:\n{task}');
  parts.push('Reading Goal:\n{readingGoal}');
  return parts.join('\n\n');
}

function sanitizeTemplate(template) {
  const lines = String(template || '').replace(/\r\n/g, '\n').split('\n');
  const cleaned = [];
  const retiredLabelRe = new RegExp(retiredKey(['^\\s*Per(?:', 's', 'o', 'n', 'a', ')\\s*:?\\s*$']), 'i');
  const retiredTokenRe = new RegExp(retiredKey(['\\{', 'p', 'e', 'r', 's', 'o', 'n', 'a', '\\}']), 'i');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (retiredLabelRe.test(line)) {
      while (
        i + 1 < lines.length &&
        !/^\s*(Task|Reading Goal)\s*:?\s*$/i.test(lines[i + 1])
      ) {
        i += 1;
      }
      continue;
    }
    if (retiredTokenRe.test(line)) continue;
    cleaned.push(line);
  }
  return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildEffectiveSystemPrompt(boilerplate, templateText, readingGoalText) {
  const task = currentTasks[currentTaskActive];
  if (!task) return '';
  const taskText = task.textPrompt || '';
  const template = sanitizeTemplate(templateText || '').trim() || buildDefaultTemplate(boilerplate);
  return applyTemplate(template, taskText, readingGoalText || '').trim();
}

function updateEffectiveSystemPrompt() {
  const ta = document.getElementById('effectiveSystemPrompt');
  if (!ta) return;
  const templateEl = document.getElementById('systemPromptTemplate');
  const templateText = templateEl ? templateEl.value : systemPromptTemplate;
  ta.value = buildEffectiveSystemPrompt(boilerplateText, templateText, currentReadingGoal);
}

function renderTasks() {
  const taskList = document.getElementById('taskList');
  taskList.innerHTML = '';

  Object.keys(currentTasks).forEach(key => {
    const task = currentTasks[key];
    const taskItem = document.createElement('div');
    taskItem.className = `task-item ${task.isDefault ? 'default' : ''}`;
    const taskName = escapeHtml(task.name || '');
    const taskText = escapeHtml(task.textPrompt || '');

    taskItem.innerHTML = `
      <div class="task-info">
        <h3>${taskName}</h3>
        <p class="task-prompt"><strong>Text:</strong> ${taskText}</p>
        ${task.isDefault ? '<span class="task-badge">Default</span>' : ''}
        ${key === currentTaskActive ? '<span class="task-badge" style="background:#48bb78;">Active</span>' : ''}
      </div>
      <div class="task-actions">
        <button class="icon-btn edit-btn" data-key="${key}" title="Edit">Edit</button>
        ${!task.isDefault ? `<button class="icon-btn delete-btn" data-key="${key}" title="Delete">Delete</button>` : ''}
      </div>
    `;

    taskList.appendChild(taskItem);
  });

  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      openTaskModal(e.target.dataset.key);
    });
  });

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      deleteTask(e.target.dataset.key);
    });
  });
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setupEventListeners() {
  const tabsNav = document.getElementById('settingsTabs');
  if (tabsNav) {
    tabsNav.addEventListener('click', (e) => {
      const btn = e.target.closest('.settings-tab');
      if (!btn) return;
      const tab = btn.dataset.tab;
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.settings-panel').forEach(p => {
        p.classList.toggle('active', p.dataset.panel === tab);
      });
    });
  }

  document.getElementById('addTaskBtn').addEventListener('click', () => {
    openTaskModal(null);
  });
  document.getElementById('resetBtn').addEventListener('click', resetToDefaults);
  document.getElementById('modalClose').addEventListener('click', closeTaskModal);
  document.getElementById('cancelTaskBtn').addEventListener('click', closeTaskModal);
  document.getElementById('saveTaskBtn').addEventListener('click', saveTask);
  document.getElementById('taskModal').addEventListener('click', (e) => {
    if (e.target.id === 'taskModal') closeTaskModal();
  });

  const templateEl = document.getElementById('systemPromptTemplate');
  if (templateEl) {
    templateEl.addEventListener('input', queueSystemPromptSave);
  }
  const restoreBtn = document.getElementById('restoreSystemPromptBtn');
  if (restoreBtn) {
    restoreBtn.addEventListener('click', restoreSystemPromptTemplate);
  }

  const taskSel = document.getElementById('currentTaskSelect');
  if (taskSel) {
    taskSel.addEventListener('change', async () => {
      const key = taskSel.value;
      currentTaskActive = key;
      await chrome.storage.sync.set({ currentTask: key });
      renderTasks();
      updateEffectiveSystemPrompt();
    });
  }

  const saveUserIdBtn = document.getElementById('saveUserIdBtn');
  if (saveUserIdBtn) {
    saveUserIdBtn.addEventListener('click', async () => {
      const val = document.getElementById('studyUserId').value.trim();
      if (val) {
        await chrome.runtime.sendMessage({ action: 'set-user-id', userId: val });
        showSaveStatus('Participant ID saved');
      }
    });
  }

  const loggingOpt = document.getElementById('enableResearchLoggingOpt');
  if (loggingOpt) {
    loggingOpt.addEventListener('change', () => {
      chrome.storage.local.set({ enableResearchLogging: loggingOpt.checked });
      showSaveStatus('Research logging ' + (loggingOpt.checked ? 'enabled' : 'disabled'));
    });
  }

  const openDashBtn = document.getElementById('openResearchDashboardBtn');
  if (openDashBtn) {
    openDashBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('viewers/research-dashboard.html') });
    });
  }

  const fbProjectInput = document.getElementById('firebaseProjectId');
  const fbApiKeyInput = document.getElementById('firebaseApiKey');
  if (fbProjectInput) {
    fbProjectInput.addEventListener('change', () => {
      chrome.storage.local.set({ firebaseProjectId: fbProjectInput.value.trim() });
      showSaveStatus('Firebase Project ID saved');
      showFbSaveStatus();
    });
  }
  if (fbApiKeyInput) {
    fbApiKeyInput.addEventListener('change', () => {
      chrome.storage.local.set({ firebaseApiKey: fbApiKeyInput.value.trim() });
      showSaveStatus('Firebase API Key saved');
      showFbSaveStatus();
    });
  }

  const clearResearchBtn = document.getElementById('clearResearchDataBtn');
  if (clearResearchBtn) {
    clearResearchBtn.addEventListener('click', async () => {
      if (!confirm('This will permanently delete all active research data stores. Continue?')) return;
      const res = await chrome.runtime.sendMessage({ action: 'clear-research-data' });
      showSaveStatus(res?.success ? 'All research data cleared' : 'Error clearing data');
    });
  }
}

function openTaskModal(taskKey) {
  editingTaskKey = taskKey;
  const modal = document.getElementById('taskModal');
  const modalTitle = document.getElementById('modalTitle');
  const nameInput = document.getElementById('taskNameInput');
  nameInput.style.borderColor = '';
  if (taskKey) {
    const task = currentTasks[taskKey];
    modalTitle.textContent = 'Edit Task';
    nameInput.value = task.name;
    document.getElementById('textPromptInput').value = task.textPrompt;
  } else {
    modalTitle.textContent = 'Add Custom Task';
    nameInput.value = '';
    document.getElementById('textPromptInput').value = '';
  }

  modal.style.display = 'flex';
}

function closeTaskModal() {
  document.getElementById('taskModal').style.display = 'none';
  editingTaskKey = null;
}

async function saveTask() {
  const nameInput = document.getElementById('taskNameInput');
  const name = nameInput.value.trim();
  const textPrompt = document.getElementById('textPromptInput').value.trim();
  if (!name) {
    alert('Task name is required.');
    nameInput.focus();
    nameInput.style.borderColor = '#e53e3e';
    return;
  }
  nameInput.style.borderColor = '';
  if (!textPrompt) {
    alert('Please fill in all fields');
    return;
  }

  const existingTask = editingTaskKey ? currentTasks[editingTaskKey] : null;
  const task = {
    name,
    textPrompt,
    isDefault: existingTask ? !!existingTask.isDefault : false
  };

  if (editingTaskKey) {
    currentTasks[editingTaskKey] = task;
  } else {
    let key = name.toLowerCase().replace(/\s+/g, '-');
    if (currentTasks[key]) {
      key = key + '-' + Date.now().toString(36);
    }
    currentTasks[key] = { ...task, isDefault: false };
  }

  await chrome.storage.sync.set({ tasks: currentTasks });
  renderTasks();
  hydrateActiveSelectors();
  updateEffectiveSystemPrompt();
  closeTaskModal();
  showSaveStatus('Task saved successfully');
}

async function deleteTask(key) {
  if (confirm(`Are you sure you want to delete the task "${currentTasks[key].name}"?`)) {
    delete currentTasks[key];
    await chrome.storage.sync.set({ tasks: currentTasks });
    renderTasks();
    hydrateActiveSelectors();
    updateEffectiveSystemPrompt();
    showSaveStatus('Task deleted');
  }
}

async function resetToDefaults() {
  if (confirm('Reset all settings to defaults? This will remove custom tasks.')) {
    try {
      currentTasks = DEFAULT_TASKS;
      systemPromptTemplate = buildDefaultTemplate(boilerplateText);
      currentReadingGoal = '';
      await chrome.storage.sync.set({
        tasks: DEFAULT_TASKS,
        currentTask: 'simple',
        enabled: true,
        systemPromptTemplate,
        readingGoal: ''
      });
      await chrome.storage.sync.remove([
        retiredKey(['p', 'e', 'r', 's', 'o', 'n', 'a', 's']),
        retiredKey(['c', 'u', 'r', 'r', 'e', 'n', 't', 'P', 'e', 'r', 's', 'o', 'n', 'a']),
        retiredKey(['p', 'r', 'o', 'f', 'i', 'l', 'e', 's']),
        retiredKey(['c', 'u', 'r', 'r', 'e', 'n', 't', 'P', 'r', 'o', 'f', 'i', 'l', 'e']),
      ]);
      await loadSettings();
      hydrateActiveSelectors();
      updateEffectiveSystemPrompt();
      showSaveStatus('Reset to defaults');
    } catch (e) {
      console.error('[Options] Reset to defaults failed:', e?.message);
      showSaveStatus('Reset failed - please try again');
    }
  }
}

function showSaveStatus(message) {
  const status = document.getElementById('saveStatus');
  status.textContent = message;
  setTimeout(() => {
    status.textContent = '';
  }, 3000);
}

function showFbSaveStatus() {
  const el = document.getElementById('fbSaveStatus');
  if (!el) return;
  el.style.display = 'inline';
  setTimeout(() => {
    el.style.display = 'none';
  }, 2000);
}

function applyTemplate(template, taskText, readingGoalText) {
  return sanitizeTemplate(template)
    .replace(/\{task\}/gi, () => taskText)
    .replace(/\{readingGoal\}/gi, () => readingGoalText || '');
}

function queueSystemPromptSave() {
  const templateEl = document.getElementById('systemPromptTemplate');
  if (!templateEl) return;
  const cleaned = sanitizeTemplate(templateEl.value);
  if (cleaned !== templateEl.value.trim()) {
    templateEl.value = cleaned;
  }
  systemPromptTemplate = cleaned;
  updateEffectiveSystemPrompt();
  if (templateSaveTimer) clearTimeout(templateSaveTimer);
  templateSaveTimer = setTimeout(async () => {
    await chrome.storage.sync.set({ systemPromptTemplate });
    showSaveStatus('System prompt template saved');
  }, 400);
}

window.addEventListener('beforeunload', () => {
  if (templateSaveTimer) {
    clearTimeout(templateSaveTimer);
    const templateEl = document.getElementById('systemPromptTemplate');
    if (templateEl) {
      chrome.storage.sync.set({ systemPromptTemplate: sanitizeTemplate(templateEl.value) });
    }
  }
});

async function restoreSystemPromptTemplate() {
  const templateEl = document.getElementById('systemPromptTemplate');
  if (!templateEl) return;
  systemPromptTemplate = buildDefaultTemplate(boilerplateText);
  templateEl.value = systemPromptTemplate;
  updateEffectiveSystemPrompt();
  await chrome.storage.sync.set({ systemPromptTemplate });
  showSaveStatus('System prompt template restored');
}
