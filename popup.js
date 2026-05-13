// Popup script — embedded chat + renarration
let currentSessionId = null;
let userMessageCount = 0;
let generatedGoal = null;
let sending = false;

document.addEventListener('DOMContentLoaded', async () => {
  // --- DOM references ---
  const renarrateStatus = document.getElementById('renarrateStatus');
  const renarratePageBtn = document.getElementById('renarratePageBtn');
  const reextractBtn = document.getElementById('reextractBtn');
  const optionsLink = document.getElementById('optionsLink');

  // Chat DOM
  const chatMessages = document.getElementById('chatMessages');
  const chatInput = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const newSessionBtn = document.getElementById('newSessionBtn');
  const setGoalBtn = document.getElementById('setGoalBtn');
  const secondaryActions = document.getElementById('secondaryActions');
  const goalPreview = document.getElementById('goalPreview');
  const applyGoalBtn = document.getElementById('applyGoalBtn');
  const discardGoalBtn = document.getElementById('discardGoalBtn');
  const goalDismiss = document.getElementById('goalDismiss');
  const userBadge = document.getElementById('userBadge');
  const quickRepliesContainer = document.getElementById('quickReplies');
  const refinementBanner = document.getElementById('refinementBanner');
  const refineBannerBtn = document.getElementById('refineBannerBtn');
  const refineBannerDismiss = document.getElementById('refineBannerDismiss');

  // --- Load settings ---
  let settings;
  try {
    settings = await chrome.storage.sync.get([
      'currentTask', 'currentProfile',
      'tasks', 'profiles'
    ]);
  } catch (e) {
    console.warn('[Popup] Failed to load settings, using defaults:', e?.message);
    settings = {};
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
    try {
      await chrome.storage.sync.set({ tasks, currentTask });
    } catch (e) {
      console.warn('[Popup] Failed to migrate settings:', e?.message);
    }
  }

  // Load user ID
  try {
    const { userId } = await chrome.runtime.sendMessage({ action: 'get-user-id' });
    userBadge.textContent = userId || '--';
  } catch {
    userBadge.textContent = '--';
  }

  // --- Chat session restore ---
  try {
    const { currentChatSessionId } = await chrome.storage.local.get(['currentChatSessionId']);
    if (currentChatSessionId) {
      const res = await chrome.runtime.sendMessage({ action: 'chatbot-get-session', sessionId: currentChatSessionId });
      if (res?.success && res.session) {
        currentSessionId = currentChatSessionId;
        renderMessages(res.session.messages);
        userMessageCount = res.session.messages.filter(m => m.role === 'user').length;
        updateActionButtons();
      } else {
        await startNewSession();
      }
    } else {
      await startNewSession();
    }
  } catch (e) {
    addSystemMessage('Failed to restore chat session: ' + (e.message || 'Unknown error'));
    await startNewSession();
  }

  checkFeedbackRefinement();

  // --- Page extraction ---
  let pageActionMode = 'extract';
  let extractionInProgress = false;

  if (renarratePageBtn) {
    renarratePageBtn.addEventListener('click', async () => {
      if (pageActionMode === 'view') {
        openExtractionViewer();
        return;
      }
      await runExtraction();
    });
  }

  if (reextractBtn) {
    reextractBtn.addEventListener('click', runExtraction);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!extractionInProgress) return false;
    if (msg?.action === 'extraction-progress' && msg.text) {
      setExtractionStatus(msg.text, false);
    } else if (msg?.action === 'extraction-update') {
      if (msg.status === 'done' && msg.extraction) {
        showExtractedState(msg.extraction);
      } else if (msg.status === 'failed') {
        showExtractionFailure(msg.error || 'Extraction failed');
      } else if (msg.status === 'running') {
        setExtractionStatus('Extracting...', false);
      }
    }
    return false;
  });

  await refreshExtractionState();

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
    if (!currentSessionId) {
      addSystemMessage('No active chat session. Start a new session and send at least two messages before setting a reading goal.');
      return;
    }
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

  // Goal preview actions
  applyGoalBtn.addEventListener('click', async () => {
    if (!generatedGoal) return;
    applyGoalBtn.disabled = true;
    applyGoalBtn.textContent = 'Renarrating...';
    try {
      await chrome.storage.sync.set({ readingGoal: generatedGoal });
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const { lastExtraction } = await chrome.storage.local.get(['lastExtraction']);

      if (!isSameExtractionForTab(lastExtraction, tab)) {
        setExtractionStatus('First extract the page', true);
        addSystemMessage('First extract the page');
        return;
      }

      setExtractionStatus('Renarrating with saved goal...', false);
      const res = await chrome.runtime.sendMessage({
        action: 'run-page-renarration-from-extraction',
        tabId: tab.id,
        pageMetadata: { url: tab.url, title: tab.title || '' },
      });

      if (res?.success) {
        addSystemMessage('Reading goal applied. The right-side page panel opened.');
        setExtractionStatus('Done - page panel opened', false);
        showExtractedState(lastExtraction, { keepStatus: true });
        goalPreview.style.display = 'none';
        generatedGoal = null;
      } else {
        const error = res?.error || 'Renarration failed';
        setExtractionStatus('Error: ' + error, true);
        addSystemMessage('Page renarration error: ' + error);
      }
    } catch (e) {
      setExtractionStatus('Error: ' + (e.message || 'unknown'), true);
      addSystemMessage('Error renarrating page: ' + e.message);
    } finally {
      applyGoalBtn.disabled = false;
      applyGoalBtn.textContent = 'Renarrate Page With This';
    }
  });

  discardGoalBtn.addEventListener('click', () => {
    goalPreview.style.display = 'none';
    generatedGoal = null;
  });

  goalDismiss.addEventListener('click', () => {
    goalPreview.style.display = 'none';
    generatedGoal = null;
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

  // --- Chat functions ---

  async function startNewSession() {
    try {
      const res = await chrome.runtime.sendMessage({ action: 'chatbot-new-session' });
      if (res?.success && res.sessionId) {
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
        quickRepliesContainer.style.display = 'none';
        quickRepliesContainer.innerHTML = '';
        generatedGoal = null;
        return true;
      }
      addSystemMessage('Failed to start session: ' + (res?.error || 'Unknown error'));
    } catch (e) {
      addSystemMessage('Failed to start session: ' + (e.message || 'Please reload the extension.'));
    }
    return false;
  }

  async function ensureChatSession() {
    if (currentSessionId) return true;
    return await startNewSession();
  }

  async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || sending) return;

    sending = true;
    sendBtn.disabled = true;
    let typingEl = null;

    try {
      const hasSession = await ensureChatSession();
      if (!hasSession) return;

      chatInput.value = '';
      chatInput.style.height = 'auto';

      quickRepliesContainer.style.display = 'none';

      const welcome = chatMessages.querySelector('.chat-welcome');
      if (welcome) welcome.remove();

      appendBubble('user', text);
      userMessageCount++;
      updateActionButtons();

      typingEl = appendBubble('model', 'Thinking...', true);

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
      if (typingEl?.parentElement) typingEl.remove();
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

  async function refreshExtractionState() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const { lastExtraction } = await chrome.storage.local.get(['lastExtraction']);
      if (isSameExtractionForTab(lastExtraction, tab)) {
        showExtractedState(lastExtraction);
      } else {
        showDefaultExtractionState();
      }
    } catch {
      showDefaultExtractionState();
    }
  }

  async function runExtraction() {
    if (extractionInProgress) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      showExtractionFailure('No active tab');
      return;
    }
    if (!/^https?:/i.test(tab.url || '')) {
      showExtractionFailure('Cannot extract from this page');
      return;
    }

    extractionInProgress = true;
    if (renarratePageBtn) {
      renarratePageBtn.disabled = true;
      renarratePageBtn.textContent = 'Extracting...';
    }
    if (reextractBtn) {
      reextractBtn.disabled = true;
      reextractBtn.style.display = 'none';
    }
    setExtractionStatus('Capturing screenshots and extracting...', false);

    try {
      const res = await chrome.runtime.sendMessage({
        action: 'extract-page-knowledge',
        tabId: tab.id,
        pageMetadata: { url: tab.url, title: tab.title || '' },
      });
      if (res?.success && res.extraction) {
        showExtractedState(res.extraction);
      } else {
        showExtractionFailure(res?.error || 'Extraction failed');
      }
    } catch (e) {
      showExtractionFailure(e.message || 'Extraction failed');
    } finally {
      extractionInProgress = false;
      if (renarratePageBtn) renarratePageBtn.disabled = false;
      if (reextractBtn) reextractBtn.disabled = false;
    }
  }

  function openExtractionViewer() {
    chrome.tabs.create({ url: chrome.runtime.getURL('viewers/extracted-content.html') });
  }

  function showDefaultExtractionState() {
    setPageAction('extract', 'Extract Page');
    setExtractionStatus('Ready', false);
    if (reextractBtn) reextractBtn.style.display = 'none';
  }

  function showExtractedState(extraction, options = {}) {
    setPageAction('view', 'See Extracted Content');
    if (!options.keepStatus) {
      setExtractionStatus(formatExtractionStatus(extraction), false);
    }
    if (reextractBtn) reextractBtn.style.display = 'block';
  }

  function showExtractionFailure(error) {
    setPageAction('extract', 'Retry');
    setExtractionStatus('Error: ' + (error || 'Extraction failed'), true);
    if (reextractBtn) reextractBtn.style.display = 'none';
  }

  function setPageAction(mode, label) {
    pageActionMode = mode;
    if (renarratePageBtn) renarratePageBtn.textContent = label;
  }

  function setExtractionStatus(text, isError) {
    if (!renarrateStatus) return;
    renarrateStatus.textContent = text || '';
    renarrateStatus.classList.toggle('is-error', !!isError);
  }

  function formatExtractionStatus(extraction) {
    const count = extraction?.sliceCount || 0;
    const partial = extraction?.partial ? ' · partial' : '';
    return `Extracted ${count} slice${count === 1 ? '' : 's'}${partial}`;
  }

  function isSameExtractionForTab(extraction, tab) {
    return (
      !!String(extraction?.compactText || '').trim() &&
      !!extraction?.url &&
      !!tab?.url &&
      extraction.url === tab.url
    );
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
