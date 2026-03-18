// Popup script
document.addEventListener('DOMContentLoaded', async () => {
  const enableToggle = document.getElementById('enableToggle');
  const taskSelect = document.getElementById('taskSelect');
  const personaSelect = document.getElementById('personaSelect');
  const llmProviderSelect = document.getElementById('llmProviderSelect');
  const webllmControls = document.getElementById('webllmControls');
  const initModelBtn = document.getElementById('initModelBtn');
  const webllmStatus = document.getElementById('webllmStatus');
  const captureBtn = document.getElementById('capturePageBtn');
  const captureStatus = document.getElementById('captureStatus');
  const describeBtn = document.getElementById('describePageBtn');
  const describeStatus = document.getElementById('describeStatus');
  const renarrateBtn = document.getElementById('renarratePageBtn');
  const renarrateStatus = document.getElementById('renarrateStatus');
  const openChatBtn = document.getElementById('openChatBtn');
  const agenticToggle = document.getElementById('agenticToggle');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const apiKeyToggleBtn = document.getElementById('apiKeyToggleBtn');
  const apiKeyStatus = document.getElementById('apiKeyStatus');
  const configSummary = document.getElementById('configSummary');
  const optionsLink = document.getElementById('optionsLink');
  const testingDashboardLink = document.getElementById('testingDashboardLink');

  let currentTasks = {};
  let currentPersonas = {};

  // Load current settings
  const settings = await chrome.storage.sync.get([
    'enabled',
    'currentTask',
    'currentProfile',
    'autoDetect',
    'llmProvider',
    'useWebLLM',
    'currentPersona',
    'personas',
    'tasks',
    'profiles'
  ]);

  // Load local settings (API key + agentic toggle)
  const localSettings = await chrome.storage.local.get(['useAgenticPipeline', 'remoteVLMApiKey']);

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
    tasks = {};
  }
  if (!currentTask) {
    currentTask = Object.keys(tasks)[0] || 'simple';
  }
  if (shouldWrite) {
    await chrome.storage.sync.set({ tasks, currentTask });
  }

  currentTasks = tasks || {};
  currentPersonas = settings.personas || {};
  enableToggle.checked = settings.enabled !== false;
  taskSelect.value = currentTask || 'simple';
  populatePersonaOptions(currentPersonas, settings.currentPersona);

  // LLM Provider (backward compat: fall back to useWebLLM)
  const effectiveProvider = settings.llmProvider || (settings.useWebLLM ? 'on-device' : 'remote');
  llmProviderSelect.value = effectiveProvider;
  if (webllmControls) webllmControls.style.display = effectiveProvider === 'on-device' ? 'block' : 'none';

  // Agentic toggle
  if (agenticToggle) agenticToggle.checked = !!localSettings.useAgenticPipeline;

  // API key — load
  if (apiKeyInput) {
    const storedKey = localSettings.remoteVLMApiKey || '';
    apiKeyInput.value = storedKey;
    updateApiKeyStatus(storedKey);
  }

  populateTaskOptions(currentTasks, currentTask || 'simple');
  updateConfigSummary();

  // --- Storage change listeners ---
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.llmProvider) {
      const newProvider = changes.llmProvider.newValue || 'remote';
      llmProviderSelect.value = newProvider;
      if (webllmControls) webllmControls.style.display = newProvider === 'on-device' ? 'block' : 'none';
    }
    if (area === 'sync' && (changes.personas || changes.currentPersona || changes.tasks || changes.currentTask || changes.profiles || changes.currentProfile)) {
      chrome.storage.sync.get(['personas','currentPersona','tasks','currentTask','profiles','currentProfile']).then(async ({ personas, currentPersona, tasks, currentTask, profiles, currentProfile }) => {
        let nextTasks = tasks;
        let nextTask = currentTask;
        let shouldWrite = false;
        if ((!nextTasks || !Object.keys(nextTasks).length) && profiles && Object.keys(profiles).length) {
          nextTasks = profiles;
          shouldWrite = true;
        }
        if (!nextTask && currentProfile) {
          nextTask = currentProfile;
          shouldWrite = true;
        }
        if (!nextTasks || !Object.keys(nextTasks).length) {
          nextTasks = {};
        }
        if (!nextTask) {
          nextTask = Object.keys(nextTasks)[0] || 'simple';
        }
        if (shouldWrite) {
          await chrome.storage.sync.set({ tasks: nextTasks, currentTask: nextTask });
        }
        if (nextTasks) {
          currentTasks = nextTasks;
          populateTaskOptions(currentTasks, nextTask || taskSelect.value || 'simple');
          updateConfigSummary();
        }
        if (personas) {
          currentPersonas = personas;
          populatePersonaOptions(currentPersonas, currentPersona);
          updateConfigSummary();
        }
      });
    }
    // API key sync from options page
    if (area === 'local' && changes.remoteVLMApiKey) {
      const newKey = changes.remoteVLMApiKey.newValue || '';
      if (apiKeyInput) apiKeyInput.value = newKey;
      updateApiKeyStatus(newKey);
    }
  });

  // --- Event listeners ---
  enableToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ enabled: enableToggle.checked });
  });

  taskSelect.addEventListener('change', () => {
    const task = taskSelect.value;
    chrome.storage.sync.set({ currentTask: task });
    updateConfigSummary();
  });

  personaSelect.addEventListener('change', () => {
    const personaKey = personaSelect.value;
    chrome.storage.sync.set({ currentPersona: personaKey });
    updateConfigSummary();
  });

  llmProviderSelect.addEventListener('change', () => {
    const provider = llmProviderSelect.value;
    chrome.storage.sync.set({ llmProvider: provider });
    if (webllmControls) webllmControls.style.display = provider === 'on-device' ? 'block' : 'none';
  });

  initModelBtn.addEventListener('click', async () => {
    webllmStatus.textContent = 'Status: initializing...';
    try {
      const res = await chrome.runtime.sendMessage({ action: 'webllm-init' });
      if (res && res.success !== false) {
        webllmStatus.textContent = 'Status: ready';
      } else {
        webllmStatus.textContent = 'Status: failed (fallback active)';
      }
    } catch (e) {
      webllmStatus.textContent = 'Status: failed (see console)';
    }
  });

  // API key — debounced save on input
  let apiKeySaveTimer = null;
  if (apiKeyInput) {
    apiKeyInput.addEventListener('input', () => {
      clearTimeout(apiKeySaveTimer);
      apiKeySaveTimer = setTimeout(() => {
        const key = apiKeyInput.value.trim();
        chrome.storage.local.set({ remoteVLMApiKey: key });
        updateApiKeyStatus(key);
      }, 500);
    });

    apiKeyInput.addEventListener('blur', () => {
      clearTimeout(apiKeySaveTimer);
      const key = apiKeyInput.value.trim();
      chrome.storage.local.set({ remoteVLMApiKey: key });
      updateApiKeyStatus(key);
    });
  }

  // API key — save on popup close (safety net)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && apiKeyInput) {
      clearTimeout(apiKeySaveTimer);
      chrome.storage.local.set({ remoteVLMApiKey: apiKeyInput.value.trim() });
    }
  });

  // API key — show/hide toggle
  if (apiKeyToggleBtn && apiKeyInput) {
    apiKeyToggleBtn.addEventListener('click', () => {
      if (apiKeyInput.type === 'password') {
        apiKeyInput.type = 'text';
        apiKeyToggleBtn.textContent = '\u2715';
      } else {
        apiKeyInput.type = 'password';
        apiKeyToggleBtn.innerHTML = '&#x1F441;';
      }
    });
  }

  // Capture full page screenshots
  if (captureBtn) {
    captureBtn.addEventListener('click', async () => {
      if (captureStatus) captureStatus.textContent = 'Capturing\u2026';
      try {
        const res = await chrome.runtime.sendMessage({ action: 'capture-fullpage' });
        if (res && res.success) {
          if (captureStatus) captureStatus.textContent = `Captured ${res.count} slice(s)`;
        } else {
          if (captureStatus) captureStatus.textContent = res.error;
        }
      } catch (e) {
        if (captureStatus) captureStatus.textContent = 'Error during capture';
      }
    });
  }

  if (describeBtn) {
    describeBtn.addEventListener('click', async () => {
      if (describeStatus) describeStatus.textContent = 'Requesting\u2026';
      try {
        const res = await chrome.runtime.sendMessage({ action: 'describe-page-screenshot' });
        if (res && res.success) {
          if (describeStatus) describeStatus.textContent = 'Done';
          await chrome.tabs.create({ url: chrome.runtime.getURL('viewers/describe-viewer.html') });
        } else {
          if (describeStatus) describeStatus.textContent = res?.error || 'Failed';
        }
      } catch (e) {
        if (describeStatus) describeStatus.textContent = 'Error';
      }
    });
  }

  if (renarrateBtn) {
    renarrateBtn.addEventListener('click', async () => {
      if (renarrateStatus) renarrateStatus.textContent = 'Processing\u2026';
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tab?.id;
        const res = await chrome.runtime.sendMessage({ action: 'renarrate-page', tabId });
        if (res && res.success) {
          if (renarrateStatus) renarrateStatus.textContent = 'Done';
        } else {
          if (renarrateStatus) renarrateStatus.textContent = res?.error || 'Failed';
        }
      } catch (e) {
        if (renarrateStatus) renarrateStatus.textContent = 'Error';
      }
    });
  }

  // Open side panel for chatbot
  if (openChatBtn) {
    openChatBtn.addEventListener('click', async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          await chrome.sidePanel.open({ tabId: tab.id });
        }
      } catch (e) {
        console.warn('Failed to open side panel:', e);
      }
    });
  }

  // Agentic pipeline toggle
  if (agenticToggle) {
    agenticToggle.addEventListener('change', () => {
      chrome.storage.local.set({ useAgenticPipeline: agenticToggle.checked });
    });
  }

  // Footer links
  if (optionsLink) {
    optionsLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }

  if (testingDashboardLink) {
    testingDashboardLink.addEventListener('click', async (e) => {
      e.preventDefault();
      await chrome.tabs.create({ url: chrome.runtime.getURL('viewers/testing-dashboard.html') });
    });
  }

  // Listen to progress events from offscreen init
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.__offscreenProgress) {
      const pct = Math.round((msg.progress || 0) * 100);
      webllmStatus.textContent = `Status: ${msg.stage} ${isFinite(pct) ? `(${pct}%)` : ''}`;
    }
  });

  // --- Helper functions ---

  function updateApiKeyStatus(key) {
    if (!apiKeyStatus) return;
    if (key && key.length > 0) {
      apiKeyStatus.textContent = 'Configured';
      apiKeyStatus.className = 'status-pill status-pill--configured';
    } else {
      apiKeyStatus.textContent = 'Missing';
      apiKeyStatus.className = 'status-pill status-pill--missing';
    }
  }

  function updateConfigSummary() {
    if (!configSummary) return;
    const taskKey = taskSelect.value;
    const personaKey = personaSelect.value;
    const taskLabel = (currentTasks[taskKey] && currentTasks[taskKey].name) || taskKey || 'Unknown';
    const personaLabel = (currentPersonas[personaKey] && currentPersonas[personaKey].name) || personaKey || 'Unknown';
    configSummary.textContent = `Task: ${taskLabel} \u00B7 Persona: ${personaLabel}`;
  }

  function populatePersonaOptions(personas = {}, currentKey = 'general') {
    if (!personaSelect) return;
    personaSelect.innerHTML = '';
    const entries = Object.entries(personas || {});
    entries.forEach(([key, val]) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = val.name || key;
      personaSelect.appendChild(opt);
    });
    const effective = personas && personas[currentKey] ? currentKey : (entries[0]?.[0] || 'general');
    personaSelect.value = effective;
  }

  function populateTaskOptions(tasks = {}, currentKey = 'simple') {
    if (!taskSelect) return;
    taskSelect.innerHTML = '';
    const entries = Object.entries(tasks || {});
    entries.forEach(([key, val]) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = val.name || key;
      taskSelect.appendChild(opt);
    });
    const effective = tasks && tasks[currentKey] ? currentKey : (entries[0]?.[0] || 'simple');
    taskSelect.value = effective;
  }
});
