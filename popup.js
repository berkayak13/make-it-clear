// Popup script — embedded chat + renarration
let currentSessionId = null;
let userMessageCount = 0;
let generatedGoal = null;
let generatedPersona = null;
let sending = false;

document.addEventListener('DOMContentLoaded', async () => {
  // --- DOM references ---
  const llmProviderSelect = document.getElementById('llmProviderSelect');
  const webllmControls = document.getElementById('webllmControls');
  const initModelBtn = document.getElementById('initModelBtn');
  const webllmStatus = document.getElementById('webllmStatus');
  const setupCard = document.getElementById('setupCard');
  const setupToggle = document.getElementById('setupToggle');
  const renarrateStatus = document.getElementById('renarrateStatus');
  const optionsLink = document.getElementById('optionsLink');

  // Chat DOM
  const chatMessages = document.getElementById('chatMessages');
  const chatInput = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const newSessionBtn = document.getElementById('newSessionBtn');
  const setGoalBtn = document.getElementById('setGoalBtn');
  const generatePersonaBtn = document.getElementById('generatePersonaBtn');
  const secondaryActions = document.getElementById('secondaryActions');
  const goalPreview = document.getElementById('goalPreview');
  const applyGoalBtn = document.getElementById('applyGoalBtn');
  const discardGoalBtn = document.getElementById('discardGoalBtn');
  const goalDismiss = document.getElementById('goalDismiss');
  const personaPreview = document.getElementById('personaPreview');
  const applyPersonaBtn = document.getElementById('applyPersonaBtn');
  const discardPersonaBtn = document.getElementById('discardPersonaBtn');
  const personaDismiss = document.getElementById('personaDismiss');
  const userBadge = document.getElementById('userBadge');
  const quickRepliesContainer = document.getElementById('quickReplies');
  const refinementBanner = document.getElementById('refinementBanner');
  const refineBannerBtn = document.getElementById('refineBannerBtn');
  const refineBannerDismiss = document.getElementById('refineBannerDismiss');

  // --- Load settings ---
  let settings, localSettings;
  try {
    settings = await chrome.storage.sync.get([
      'currentTask', 'currentProfile', 'llmProvider', 'useWebLLM',
      'tasks', 'profiles'
    ]);
    localSettings = await chrome.storage.local.get(['useAgenticPipeline']);
  } catch (e) {
    console.warn('[Popup] Failed to load settings, using defaults:', e?.message);
    settings = {};
    localSettings = {};
  }

  // Backward compat: profiles -> tasks
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
  if (shouldWrite) {
    await chrome.storage.sync.set({ tasks, currentTask });
  }

  // LLM Provider (backward compat: fall back to useWebLLM)
  const effectiveProvider = settings.llmProvider || (settings.useWebLLM ? 'on-device' : 'remote');
  llmProviderSelect.value = effectiveProvider;
  if (webllmControls) webllmControls.style.display = effectiveProvider === 'on-device' ? 'block' : 'none';

  // Load user ID
  try {
    const { userId } = await chrome.runtime.sendMessage({ action: 'get-user-id' });
    userBadge.textContent = userId || '--';
  } catch {
    userBadge.textContent = '--';
  }

  // --- Chat session restore ---
  const { currentChatSessionId } = await chrome.storage.local.get(['currentChatSessionId']);
  if (currentChatSessionId) {
    try {
      const res = await chrome.runtime.sendMessage({ action: 'chatbot-get-session', sessionId: currentChatSessionId });
      if (res?.success && res.session) {
        currentSessionId = currentChatSessionId;
        renderMessages(res.session.messages);
        userMessageCount = res.session.messages.filter(m => m.role === 'user').length;
        updateActionButtons();
      } else {
        await startNewSession();
      }
    } catch {
      await startNewSession();
    }
  } else {
    await startNewSession();
  }

  checkFeedbackRefinement();

  // --- Storage change listeners ---
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.llmProvider) {
      const newProvider = changes.llmProvider.newValue || 'remote';
      llmProviderSelect.value = newProvider;
      if (webllmControls) webllmControls.style.display = newProvider === 'on-device' ? 'block' : 'none';
    }
  });

  // --- Setup card accordion ---
  setupToggle.addEventListener('click', () => {
    setupCard.classList.toggle('card--collapsed');
    setupToggle.setAttribute('aria-expanded', !setupCard.classList.contains('card--collapsed'));
  });

  // --- LLM Provider ---
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
    } catch {
      webllmStatus.textContent = 'Status: failed (see console)';
    }
  });

  // --- Renarrate Page (Agentic Pipeline) ---
  const agenticPipelineBtn = document.getElementById('agenticPipelineBtn');
  if (agenticPipelineBtn) {
    agenticPipelineBtn.addEventListener('click', async () => {
      if (renarrateStatus) renarrateStatus.textContent = 'Processing\u2026';
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tab?.id;
        // Run the agentic pipeline — it captures screenshots, runs agents, and
        // streams renarrated sections to the content script sidebar
        const res = await chrome.runtime.sendMessage({
          action: 'run-agentic-pipeline',
          tabId,
          text: 'Renarrate this page',
          pageMetadata: { url: tab?.url, title: tab?.title }
        });
        if (res && res.success) {
          let msg = 'Done \u2014 see sidebar';
          if (res.failedCount > 0) {
            msg += ` (${res.failedCount} agent${res.failedCount > 1 ? 's' : ''} failed)`;
          }
          if (renarrateStatus) renarrateStatus.textContent = msg;
          if (res.errors?.length) {
            console.warn('[Pipeline errors]', res.errors);
          }
        } else {
          if (renarrateStatus) renarrateStatus.textContent = 'Error: ' + (res?.error || 'Pipeline failed');
        }
      } catch (e) {
        if (renarrateStatus) renarrateStatus.textContent = 'Error: ' + (e.message || 'unknown');
        addSystemMessage('Pipeline error: ' + (e.message || 'unknown'));
      }
    });
  }

  // --- Chat event listeners ---
  sendBtn.addEventListener('click', sendMessage);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 80) + 'px';
  });

  newSessionBtn.addEventListener('click', startNewSession);

  // Set Reading Goal
  setGoalBtn.addEventListener('click', async () => {
    if (!currentSessionId) return;
    setGoalBtn.disabled = true;
    setGoalBtn.textContent = 'Extracting goal...';
    try {
      const res = await chrome.runtime.sendMessage({ action: 'chatbot-set-reading-goal', sessionId: currentSessionId });
      if (res?.success && res.goal) {
        generatedGoal = res.goal;
        showGoalPreview(res.goal);
      } else {
        addSystemMessage('Failed to extract reading goal: ' + (res?.error || 'Unknown error'));
      }
    } catch (e) {
      addSystemMessage('Error extracting reading goal: ' + e.message);
    }
    setGoalBtn.disabled = false;
    setGoalBtn.textContent = 'Set Reading Goal';
  });

  // Generate Persona
  generatePersonaBtn.addEventListener('click', async () => {
    if (!currentSessionId) return;
    generatePersonaBtn.disabled = true;
    generatePersonaBtn.textContent = 'Generating...';
    try {
      const res = await chrome.runtime.sendMessage({ action: 'chatbot-generate-persona', sessionId: currentSessionId });
      if (res?.success && res.persona) {
        generatedPersona = res.persona;
        showPersonaPreview(res.persona);
      } else {
        addSystemMessage('Failed to generate persona: ' + (res?.error || 'Unknown error'));
      }
    } catch (e) {
      addSystemMessage('Error generating persona: ' + e.message);
    }
    generatePersonaBtn.disabled = false;
    generatePersonaBtn.textContent = 'Generate Persona';
  });

  // Goal preview actions
  applyGoalBtn.addEventListener('click', async () => {
    if (!generatedGoal) return;
    applyGoalBtn.disabled = true;
    try {
      await chrome.storage.sync.set({ readingGoal: generatedGoal.readingGoal || '' });
      addSystemMessage('Reading goal applied: "' + (generatedGoal.readingGoal || '') + '"');
      goalPreview.style.display = 'none';
      generatedGoal = null;
    } catch (e) {
      addSystemMessage('Error applying goal: ' + e.message);
    }
    applyGoalBtn.disabled = false;
  });

  discardGoalBtn.addEventListener('click', () => {
    goalPreview.style.display = 'none';
    generatedGoal = null;
  });

  goalDismiss.addEventListener('click', () => {
    goalPreview.style.display = 'none';
    generatedGoal = null;
  });

  // Persona preview actions
  applyPersonaBtn.addEventListener('click', async () => {
    if (!generatedPersona || !currentSessionId) return;
    applyPersonaBtn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({
        action: 'chatbot-apply-persona',
        sessionId: currentSessionId,
        persona: generatedPersona
      });
      if (res?.success) {
        addSystemMessage('Persona "' + generatedPersona.name + '" applied successfully! It is now your active persona.');
        personaPreview.style.display = 'none';
        generatedPersona = null;
      } else {
        addSystemMessage('Failed to apply persona: ' + (res?.error || 'Unknown error'));
      }
    } catch (e) {
      addSystemMessage('Error applying persona: ' + e.message);
    }
    applyPersonaBtn.disabled = false;
  });

  discardPersonaBtn.addEventListener('click', () => {
    personaPreview.style.display = 'none';
    generatedPersona = null;
  });

  personaDismiss.addEventListener('click', () => {
    personaPreview.style.display = 'none';
    generatedPersona = null;
  });

  // Refinement banner
  refineBannerBtn.addEventListener('click', () => {
    refinementBanner.style.display = 'none';
    chatInput.value = 'I\'d like to refine my reading preferences based on recent feedback.';
    chatInput.focus();
  });

  refineBannerDismiss.addEventListener('click', () => {
    refinementBanner.style.display = 'none';
  });

  // --- Footer links ---
  if (optionsLink) {
    optionsLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }


  const pipelineVisualizerLink = document.getElementById('pipelineVisualizerLink');
  if (pipelineVisualizerLink) {
    pipelineVisualizerLink.addEventListener('click', async (e) => {
      e.preventDefault();
      await chrome.tabs.create({ url: chrome.runtime.getURL('viewers/pipeline-visualizer.html') });
    });
  }

  // --- WebLLM progress events ---
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.__offscreenProgress) {
      const pct = Math.round((msg.progress || 0) * 100);
      webllmStatus.textContent = `Status: ${msg.stage} ${isFinite(pct) ? `(${pct}%)` : ''}`;
    }
  });

  // --- Chat functions ---

  async function startNewSession() {
    try {
      const res = await chrome.runtime.sendMessage({ action: 'chatbot-new-session' });
      if (res?.success) {
        currentSessionId = res.sessionId;
        userMessageCount = 0;
        chatMessages.innerHTML = `
          <div class="chat-welcome">
            <p>Tell me what you want to get from web content today.</p>
            <p class="chat-welcome-hint">I'll help you set a reading goal so content can be adapted to your needs.</p>
          </div>
        `;
        updateActionButtons();
        goalPreview.style.display = 'none';
        personaPreview.style.display = 'none';
        quickRepliesContainer.style.display = 'none';
        quickRepliesContainer.innerHTML = '';
        generatedGoal = null;
        generatedPersona = null;
      }
    } catch (e) {
      chatMessages.innerHTML = '<div class="chat-msg model chat-msg--system">Failed to start session. Please reload the extension.</div>';
    }
  }

  async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || !currentSessionId || sending) return;

    sending = true;
    chatInput.value = '';
    chatInput.style.height = 'auto';
    sendBtn.disabled = true;

    quickRepliesContainer.style.display = 'none';

    const welcome = chatMessages.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    appendBubble('user', text);
    userMessageCount++;
    updateActionButtons();

    const typingEl = appendBubble('model', 'Thinking...', true);

    try {
      const res = await chrome.runtime.sendMessage({
        action: 'chatbot-send',
        sessionId: currentSessionId,
        message: text
      });
      if (typingEl.parentElement) typingEl.remove();
      if (res?.success && res.reply) {
        renderModelReply(res.reply);
      } else {
        appendBubble('model', 'Sorry, I encountered an error: ' + (res?.error || 'Unknown'));
      }
    } catch (e) {
      if (typingEl.parentElement) typingEl.remove();
      appendBubble('model', 'Connection error: ' + e.message);
    } finally {
      sending = false;
      sendBtn.disabled = false;
      chatInput.focus();
    }
  }

  function renderModelReply(text) {
    const lines = text.split('\n');
    const quickReplies = [];
    const messageLines = [];

    for (const line of lines) {
      if (line.trim().startsWith('>> ')) {
        quickReplies.push(line.trim().slice(3).trim());
      } else {
        messageLines.push(line);
      }
    }

    appendBubble('model', messageLines.join('\n'));

    if (quickReplies.length > 0) {
      showQuickReplies(quickReplies);
    }
  }

  function showQuickReplies(options) {
    quickRepliesContainer.innerHTML = '';
    quickRepliesContainer.style.display = 'flex';
    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'quick-reply-btn';
      btn.textContent = opt;
      btn.addEventListener('click', () => {
        quickRepliesContainer.style.display = 'none';
        chatInput.value = opt;
        sendMessage();
      });
      quickRepliesContainer.appendChild(btn);
    });
  }

  function appendBubble(role, text, isTyping = false) {
    const div = document.createElement('div');
    div.className = 'chat-msg ' + role + (isTyping ? ' typing' : '');
    div.textContent = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return div;
  }

  function addSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'chat-msg model chat-msg--system';
    div.textContent = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function renderMessages(messages) {
    chatMessages.innerHTML = '';
    if (!messages || !messages.length) {
      chatMessages.innerHTML = `
        <div class="chat-welcome">
          <p>Tell me what you want to get from web content today.</p>
          <p class="chat-welcome-hint">I'll help you set a reading goal so content can be adapted to your needs.</p>
        </div>
      `;
      return;
    }
    messages.forEach(m => {
      if (m.role === 'model') {
        const lines = m.content.split('\n');
        const messageLines = lines.filter(l => !l.trim().startsWith('>> '));
        appendBubble('model', messageLines.join('\n'));
      } else {
        appendBubble(m.role, m.content);
      }
    });
  }

  function updateActionButtons() {
    const show = userMessageCount >= 2;
    setGoalBtn.style.display = show ? 'block' : 'none';
    secondaryActions.style.display = show ? 'block' : 'none';
  }

  function showGoalPreview(goal) {
    if (!goal) return;
    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setText('goalPreviewText', goal.readingGoal || '');
    setText('goalPreviewDepth', goal.desiredDepth || '');
    setText('goalPreviewFocus', (goal.focusAreas || []).join(', ') || 'None specified');
    setText('goalPreviewStyle', goal.outputStyle || '');
    setText('goalPreviewNotes', goal.additionalInstructions || 'None');
    goalPreview.style.display = 'block';
  }

  function showPersonaPreview(persona) {
    if (!persona) return;
    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setText('personaPreviewName', persona.name || '');
    setText('personaPreviewDesc', persona.description || '');
    setText('personaPreviewExpertise',
      (persona.expertiseDomains || []).join(', ') + (persona.expertiseLevel ? ' (' + persona.expertiseLevel + ')' : ''));
    setText('personaPreviewInterests', (persona.interests || []).join(', '));
    personaPreview.style.display = 'block';
  }

  async function checkFeedbackRefinement() {
    try {
      const res = await chrome.runtime.sendMessage({ action: 'check-feedback-trends' });
      if (res?.shouldRefine) {
        refinementBanner.style.display = 'flex';
      }
    } catch {
      // ignore
    }
  }

});
