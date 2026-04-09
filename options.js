// Options page script

// Default tasks — keep in sync with background.js DEFAULT_TASKS
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

// Default personas — keep in sync with background.js DEFAULT_PERSONAS
const DEFAULT_PERSONAS = {
  'berat': {
    name: 'Berat (Neighborhood Barber)',
    description: 'Low computer literacy; prefers very plain Turkish/English explanations.',
    systemAddendum: 'Target audience persona: Berat is a neighborhood barber with limited computer experience. Use very plain language and avoid economic jargon.'
  },
  'student': {
    name: 'Undergrad Student',
    description: 'Understands basic academic concepts; wants clear but not oversimplified explanations.',
    systemAddendum: 'Target audience persona: An undergraduate student seeking clear educational explanations with light context.'
  },
  'researcher': {
    name: 'Academic Researcher',
    description: 'Prefers formal, precise, domain-rich terminology.',
    systemAddendum: 'Target audience persona: Academic researcher expecting formal tone with precise terminology.'
  },
  'general': {
    name: 'General Public',
    description: 'Average reader; keep it accessible and neutral.',
    systemAddendum: 'Target audience persona: General public; keep tone neutral and accessible.'
  },
  'gamer_student': {
    name: 'High-School Gamer',
    description: 'High school student, enjoys video games; prefers casual, engaging explanations with relatable metaphors.',
    systemAddendum:
      'Target audience persona: High-school student who enjoys video games. Use casual, energetic language, short sentences, and relatable game-based metaphors when appropriate. Avoid heavy jargon; if technical terms are needed, briefly define them using simple analogies.'
  },
  'smallbiz_owner': {
    name: 'Small Business Owner',
    description: 'Runs a small business and handles basic accounting in Excel; prefers direct, practical, and actionable explanations.',
    systemAddendum:
      'Target audience persona: Small business owner who performs accounting tasks (often in Excel). Provide clear, step-by-step guidance, prioritize practical examples and actionable items, and show short illustrative snippets (e.g., Excel formulas or brief workflow steps) when relevant. Keep language concise and business-focused.'
  },
  'arch_student': {
    name: 'Architecture Student',
    description: 'University architecture student experienced with 3D design tools and technical drawings; prefers precise, design-oriented language.',
    systemAddendum:
      'Target audience persona: University student majoring in architecture who frequently uses 3D design software. Use precise, domain-relevant terminology (but define very specialized terms if they are uncommon), reference spatial concepts and design workflow when useful, and give examples that can map to 3D modeling or drafting steps. Keep explanations structured and include suggested practical next steps for application in design software.'
  }
};

const DEFAULT_REMOTE_VLM = {
  useRemoteVLM: false,
  remoteVLMModel: 'gemini-2.5-pro',
  remoteVLMEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
  remoteVLMApiKey: ''
};

let currentTasks = {};
let editingTaskKey = null;

// NEW persona state
let currentPersonas = {};
let editingPersonaKey = null;
let currentPersonaActive = 'general';
let remoteSettings = { ...DEFAULT_REMOTE_VLM };
let currentTaskActive = 'simple';
let systemPromptTemplate = '';
let boilerplateText = '';
let templateSaveTimer = null;
let currentReadingGoal = '';

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupEventListeners();

  // Initialize active selectors after DOM and settings are ready
  hydrateActiveSelectors();
  updateEffectiveSystemPrompt();
});

// Keep cached readingGoal in sync when changed externally (e.g. from sidepanel)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.readingGoal) {
    currentReadingGoal = changes.readingGoal.newValue || '';
    updateEffectiveSystemPrompt();
  }
});

// Extend loadSettings to include personas
async function loadSettings() {
  const settings = await chrome.storage.sync.get([
    'tasks',
    'currentTask',
    'profiles',
    'currentProfile',
    'personas',
    'currentPersona',
    'systemPromptTemplate',
    'llmProvider',
    'useWebLLM',
    'useRemoteVLM',
    'remoteVLMModel',
    'remoteVLMEndpoint'
  ]);
  const local = await chrome.storage.local.get(['remoteVLMApiKey', 'studyUserId', 'useAgenticPipeline', 'enableResearchLogging', 'firebaseProjectId', 'firebaseApiKey']);

  // Research settings
  const userIdInput = document.getElementById('studyUserId');
  const agenticOpt = document.getElementById('useAgenticPipelineOpt');
  const loggingOpt = document.getElementById('enableResearchLoggingOpt');
  if (userIdInput) userIdInput.value = local.studyUserId || '';
  if (agenticOpt) agenticOpt.checked = !!local.useAgenticPipeline;
  if (loggingOpt) loggingOpt.checked = local.enableResearchLogging !== false;

  // Firebase config
  const fbProjectInput = document.getElementById('firebaseProjectId');
  const fbApiKeyInput = document.getElementById('firebaseApiKey');
  if (fbProjectInput) fbProjectInput.value = local.firebaseProjectId || 'renarration-research';
  if (fbApiKeyInput) fbApiKeyInput.value = local.firebaseApiKey || 'AIzaSyB7WIlE0klfLmUKvO7JWF69Q2ioh2z_MBU';

  boilerplateText = await fetch(chrome.runtime.getURL('src/prompts/system.md')).then(r => r.text()).catch(() => '');
  
  let tasks = settings.tasks;
  let currentTask = settings.currentTask;
  let shouldWrite = false;

  if ((!tasks || !Object.keys(tasks).length) && settings.profiles && Object.keys(settings.profiles).length) {
    tasks = settings.profiles;
    shouldWrite = true;
  }
  if (!currentTask && settings.currentProfile) {
    currentTask = settings.currentProfile;
    shouldWrite = true;
  }
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
  currentPersonas = settings.personas || DEFAULT_PERSONAS;
  currentPersonaActive = settings.currentPersona || 'general';
  systemPromptTemplate = (settings.systemPromptTemplate || '').trim();
  if (!systemPromptTemplate) {
    systemPromptTemplate = buildDefaultTemplate(boilerplateText);
    await chrome.storage.sync.set({ systemPromptTemplate });
  }
  const templateEl = document.getElementById('systemPromptTemplate');
  if (templateEl) templateEl.value = systemPromptTemplate;
  
  remoteSettings = {
    useRemoteVLM: settings.useRemoteVLM ?? DEFAULT_REMOTE_VLM.useRemoteVLM,
    remoteVLMModel: settings.remoteVLMModel || DEFAULT_REMOTE_VLM.remoteVLMModel,
    remoteVLMEndpoint: settings.remoteVLMEndpoint || DEFAULT_REMOTE_VLM.remoteVLMEndpoint,
    remoteVLMApiKey: local.remoteVLMApiKey || ''
  };
  // LLM Provider selector (backward compat: fall back to useWebLLM)
  const llmProviderSel = document.getElementById('llmProviderSelect');
  if (llmProviderSel) {
    const effectiveProvider = settings.llmProvider || (settings.useWebLLM ? 'on-device' : 'remote');
    llmProviderSel.value = effectiveProvider;
  }

  document.getElementById('useRemoteVLM').checked = remoteSettings.useRemoteVLM;
  document.getElementById('remoteVLMEndpoint').value = remoteSettings.remoteVLMEndpoint;
  document.getElementById('remoteVLMModel').value = remoteSettings.remoteVLMModel;
  document.getElementById('remoteVLMApiKey').value = remoteSettings.remoteVLMApiKey;
  // Active persona selection removed from options (selection handled in popup)

  renderTasks();
  renderPersonas();
  const { readingGoal: savedGoal } = await chrome.storage.sync.get(['readingGoal']);
  currentReadingGoal = savedGoal || '';
  document.getElementById('effectiveSystemPrompt').value = buildEffectiveSystemPrompt(boilerplateText, systemPromptTemplate, currentReadingGoal);
}

// Populate and sync the top-level active task/persona dropdowns
function hydrateActiveSelectors() {
  const taskSel = document.getElementById('currentTaskSelect');
  const personaSel = document.getElementById('currentPersonaSelect');
  if (taskSel) {
    taskSel.innerHTML = '';
    Object.entries(currentTasks || {}).forEach(([key, val]) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = val.name || key;
      taskSel.appendChild(opt);
    });
    taskSel.value = currentTaskActive;
  }
  if (personaSel) {
    personaSel.innerHTML = '';
    Object.entries(currentPersonas || {}).forEach(([key, val]) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = val.name || key;
      personaSel.appendChild(opt);
    });
    personaSel.value = currentPersonaActive;
  }
}

function buildDefaultTemplate(boilerplate) {
  const parts = [];
  const base = (boilerplate || '').trim();
  if (base) parts.push(base);
  parts.push('Task:\n{task}');
  parts.push('Persona:\n{persona}');
  parts.push('Reading Goal:\n{readingGoal}');
  return parts.join('\n\n');
}

function buildEffectiveSystemPrompt(boilerplate, templateText, readingGoalText) {
  const task = currentTasks[currentTaskActive];
  const persona = currentPersonas[currentPersonaActive];
  if (!task) return '';
  const taskText = task.textPrompt || '';
  const personaText = persona ? (persona.systemAddendum || persona.description || '') : '';
  const template = (templateText || '').trim() || buildDefaultTemplate(boilerplate);
  return applyTemplate(template, taskText, personaText, readingGoalText || '').trim();
}

function updateEffectiveSystemPrompt() {
  const ta = document.getElementById('effectiveSystemPrompt');
  if (!ta) return;
  const templateEl = document.getElementById('systemPromptTemplate');
  const templateText = templateEl ? templateEl.value : systemPromptTemplate;
  ta.value = buildEffectiveSystemPrompt(boilerplateText, templateText, currentReadingGoal);
}

// Render tasks
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
        <button class="icon-btn edit-btn" data-key="${key}" title="Edit">✏️</button>
        ${!task.isDefault ? `<button class="icon-btn delete-btn" data-key="${key}" title="Delete">🗑️</button>` : ''}
      </div>
    `;
    
    taskList.appendChild(taskItem);
  });
  
  // Add event listeners to edit and delete buttons
  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const key = e.target.dataset.key;
      openTaskModal(key);
    });
  });
  
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const key = e.target.dataset.key;
      deleteTask(key);
    });
  });
}

// NEW: Render personas list
function renderPersonas() {
  const list = document.getElementById('personaList');
  list.innerHTML = '';
  Object.keys(currentPersonas).forEach(key => {
    const p = currentPersonas[key];
    const item = document.createElement('div');
    item.className = 'task-item'; // reuse styles
    const personaName = escapeHtml(p.name || '');
    const personaText = escapeHtml(p.systemAddendum || p.description || '');
    item.innerHTML = `
      <div class="task-info">
        <h3>${personaName}</h3>
        <p class="persona-prompt"><strong>Text:</strong> ${personaText}</p>
        ${key === currentPersonaActive ? '<span class="task-badge" style="background:#48bb78;">Active</span>' : ''}
      </div>
      <div class="task-actions">
        <button class="icon-btn persona-edit-btn" data-key="${key}" title="Edit">✏️</button>
        ${DEFAULT_PERSONAS[key] ? '' : `<button class="icon-btn persona-delete-btn" data-key="${key}" title="Delete">🗑️</button>`}
      </div>
    `;
    list.appendChild(item);
  });
  list.querySelectorAll('.persona-edit-btn').forEach(btn => {
    btn.addEventListener('click', e => openPersonaModal(e.target.dataset.key));
  });
  list.querySelectorAll('.persona-delete-btn').forEach(btn => {
    btn.addEventListener('click', e => deletePersona(e.target.dataset.key));
  });
}

function escapeHtml(value='') {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Setup event listeners
function setupEventListeners() {
  // LLM Provider selector
  const llmProviderSel = document.getElementById('llmProviderSelect');
  if (llmProviderSel) {
    llmProviderSel.addEventListener('change', async () => {
      await chrome.storage.sync.set({ llmProvider: llmProviderSel.value });
      showSaveStatus('LLM provider updated');
    });
  }

  // General settings
  document.getElementById('useRemoteVLM').addEventListener('change', saveSettings);
  document.getElementById('remoteVLMEndpoint').addEventListener('input', saveSettings);
  document.getElementById('remoteVLMModel').addEventListener('input', saveSettings);
  document.getElementById('remoteVLMApiKey').addEventListener('input', saveSettings);
  
  // Add task button
  document.getElementById('addTaskBtn').addEventListener('click', () => {
    openTaskModal(null);
  });
  
  // Reset button
  document.getElementById('resetBtn').addEventListener('click', resetToDefaults);
  
  // Modal buttons
  document.getElementById('modalClose').addEventListener('click', closeTaskModal);
  document.getElementById('cancelTaskBtn').addEventListener('click', closeTaskModal);
  document.getElementById('saveTaskBtn').addEventListener('click', saveTask);
  
  // Close modal on outside click
  document.getElementById('taskModal').addEventListener('click', (e) => {
    if (e.target.id === 'taskModal') {
      closeTaskModal();
    }
  });

  // NEW persona events
  document.getElementById('addPersonaBtn').addEventListener('click', () => openPersonaModal(null));
  document.getElementById('personaModalClose').addEventListener('click', closePersonaModal);
  document.getElementById('cancelPersonaBtn').addEventListener('click', closePersonaModal);
  document.getElementById('savePersonaBtn').addEventListener('click', savePersona);
  document.getElementById('personaModal').addEventListener('click', (e) => {
    if (e.target.id === 'personaModal') closePersonaModal();
  });
  const templateEl = document.getElementById('systemPromptTemplate');
  if (templateEl) {
    templateEl.addEventListener('input', queueSystemPromptSave);
  }
  const restoreBtn = document.getElementById('restoreSystemPromptBtn');
  if (restoreBtn) {
    restoreBtn.addEventListener('click', restoreSystemPromptTemplate);
  }

  // Active task selector
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

  // Research settings
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

  const agenticOpt = document.getElementById('useAgenticPipelineOpt');
  if (agenticOpt) {
    agenticOpt.addEventListener('change', () => {
      chrome.storage.local.set({ useAgenticPipeline: agenticOpt.checked });
      showSaveStatus('Agentic pipeline ' + (agenticOpt.checked ? 'enabled' : 'disabled'));
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

  // Firebase config auto-save
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
      if (!confirm('This will permanently delete ALL research data (chat sessions, logs, feedback, experiments, preference history). Continue?')) return;
      const res = await chrome.runtime.sendMessage({ action: 'clear-research-data' });
      if (res?.success) {
        showSaveStatus('All research data cleared');
      } else {
        showSaveStatus('Error clearing data');
      }
    });
  }

  // Active persona selector
  const personaSel = document.getElementById('currentPersonaSelect');
  if (personaSel) {
    personaSel.addEventListener('change', async () => {
      const key = personaSel.value;
      currentPersonaActive = key;
      await chrome.storage.sync.set({ currentPersona: key });
      renderPersonas();
      updateEffectiveSystemPrompt();
    });
  }
}

// Open task modal
function openTaskModal(taskKey) {
  editingTaskKey = taskKey;
  const modal = document.getElementById('taskModal');
  const modalTitle = document.getElementById('modalTitle');
  
  const nameInput = document.getElementById('taskNameInput');
  nameInput.style.borderColor = '';
  if (taskKey) {
    // Edit existing task
    const task = currentTasks[taskKey];
    modalTitle.textContent = 'Edit Task';
    nameInput.value = task.name;
    document.getElementById('textPromptInput').value = task.textPrompt;
  } else {
    // Create new task
    modalTitle.textContent = 'Add Custom Task';
    nameInput.value = '';
    document.getElementById('textPromptInput').value = '';
  }

  modal.style.display = 'flex';
}

// Close task modal
function closeTaskModal() {
  document.getElementById('taskModal').style.display = 'none';
  editingTaskKey = null;
}

// Open persona modal
function openPersonaModal(key) {
  editingPersonaKey = key;
  const modal = document.getElementById('personaModal');
  const title = document.getElementById('personaModalTitle');
  const nameInput = document.getElementById('personaNameInput');
  nameInput.style.borderColor = '';
  if (key) {
    const p = currentPersonas[key];
    title.textContent = 'Edit Persona';
    nameInput.value = p.name;
    document.getElementById('personaAddendumInput').value = p.systemAddendum || p.description || '';
  } else {
    title.textContent = 'Add Persona';
    nameInput.value = '';
    document.getElementById('personaAddendumInput').value = '';
  }
  modal.style.display = 'flex';
}

function closePersonaModal() {
  document.getElementById('personaModal').style.display = 'none';
  editingPersonaKey = null;
}

// Save task
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
    // Update existing task
    currentTasks[editingTaskKey] = task;
  } else {
    // Create new task with unique key
    const key = name.toLowerCase().replace(/\s+/g, '-');
    currentTasks[key] = { ...task, isDefault: false };
  }
  
  await chrome.storage.sync.set({ tasks: currentTasks });
  renderTasks();
  hydrateActiveSelectors();
  updateEffectiveSystemPrompt();
  closeTaskModal();
  showSaveStatus('Task saved successfully!');
}

// NEW save persona
async function savePersona() {
  const nameInput = document.getElementById('personaNameInput');
  const name = nameInput.value.trim();
  let addendum = document.getElementById('personaAddendumInput').value.trim();
  if (!name) {
    alert('Persona name is required.');
    nameInput.focus();
    nameInput.style.borderColor = '#e53e3e';
    return;
  }
  nameInput.style.borderColor = '';
  if (!addendum) {
    alert('Persona name and text prompt are required.');
    return;
  }
  const obj = { name, systemAddendum: addendum };
  if (editingPersonaKey) {
    currentPersonas[editingPersonaKey] = obj;
  } else {
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    currentPersonas[key] = obj;
  }
  await chrome.storage.sync.set({ personas: currentPersonas });
  renderPersonas();
  hydrateActiveSelectors();
  updateEffectiveSystemPrompt();
  closePersonaModal();
  showSaveStatus('Persona saved');
}

// Delete task
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

// NEW delete persona
async function deletePersona(key) {
  if (!currentPersonas[key]) return;
  if (DEFAULT_PERSONAS[key]) {
    alert('Default personas cannot be deleted.');
    return;
  }
  if (!confirm(`Delete persona "${currentPersonas[key].name}"?`)) return;
  delete currentPersonas[key];
  if (currentPersonaActive === key) {
    currentPersonaActive = 'general';
    await chrome.storage.sync.set({ currentPersona: currentPersonaActive });
  }
  await chrome.storage.sync.set({ personas: currentPersonas });
  renderPersonas();
  hydrateActiveSelectors();
  updateEffectiveSystemPrompt();
  showSaveStatus('Persona deleted');
}

// Save settings
async function saveSettings() {
  const useRemoteVLM = document.getElementById('useRemoteVLM').checked;
  const remoteVLMEndpoint = document.getElementById('remoteVLMEndpoint').value.trim() || DEFAULT_REMOTE_VLM.remoteVLMEndpoint;
  const remoteVLMModel = document.getElementById('remoteVLMModel').value.trim() || DEFAULT_REMOTE_VLM.remoteVLMModel;
  const remoteVLMApiKey = document.getElementById('remoteVLMApiKey').value.trim();
  
  await chrome.storage.sync.set({
    useRemoteVLM,
    remoteVLMEndpoint,
    remoteVLMModel
  });
  await chrome.storage.local.set({ remoteVLMApiKey });
  
  showSaveStatus('Settings saved!');
}

// Extend reset to also restore personas
async function resetToDefaults() {
  if (confirm('Reset all settings to defaults? This will remove custom tasks and personas.')) {
    currentTasks = DEFAULT_TASKS;
    currentPersonas = DEFAULT_PERSONAS;
    currentPersonaActive = 'general';
    systemPromptTemplate = buildDefaultTemplate(boilerplateText);
    currentReadingGoal = '';
    await chrome.storage.sync.set({
      tasks: DEFAULT_TASKS,
      personas: DEFAULT_PERSONAS,
      currentTask: 'simple',
      currentPersona: 'general',
      enabled: true,
      llmProvider: 'remote',
      systemPromptTemplate,
      readingGoal: '',
      useRemoteVLM: DEFAULT_REMOTE_VLM.useRemoteVLM,
      remoteVLMEndpoint: DEFAULT_REMOTE_VLM.remoteVLMEndpoint,
      remoteVLMModel: DEFAULT_REMOTE_VLM.remoteVLMModel
    });
    await chrome.storage.local.set({ remoteVLMApiKey: DEFAULT_REMOTE_VLM.remoteVLMApiKey });
    await loadSettings();
    hydrateActiveSelectors();
    updateEffectiveSystemPrompt();
    showSaveStatus('Reset to defaults');
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

function applyTemplate(template, taskText, personaText, readingGoalText) {
  return template
    .replace(/\{task\}/gi, () => taskText)
    .replace(/\{persona\}/gi, () => personaText)
    .replace(/\{readingGoal\}/gi, () => readingGoalText || '');
}

function queueSystemPromptSave() {
  const templateEl = document.getElementById('systemPromptTemplate');
  if (!templateEl) return;
  systemPromptTemplate = templateEl.value;
  updateEffectiveSystemPrompt();
  if (templateSaveTimer) clearTimeout(templateSaveTimer);
  templateSaveTimer = setTimeout(async () => {
    await chrome.storage.sync.set({ systemPromptTemplate });
    showSaveStatus('System prompt template saved');
  }, 400);
}

async function restoreSystemPromptTemplate() {
  const templateEl = document.getElementById('systemPromptTemplate');
  if (!templateEl) return;
  systemPromptTemplate = buildDefaultTemplate(boilerplateText);
  templateEl.value = systemPromptTemplate;
  updateEffectiveSystemPrompt();
  await chrome.storage.sync.set({ systemPromptTemplate });
  showSaveStatus('System prompt template restored');
}
