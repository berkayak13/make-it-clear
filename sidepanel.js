// Side panel chatbot script — goal-oriented reading assistant

let currentSessionId = null;
let userMessageCount = 0;
let generatedGoal = null;

document.addEventListener('DOMContentLoaded', async () => {
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

  // Load user ID
  try {
    const { userId } = await chrome.runtime.sendMessage({ action: 'get-user-id' });
    userBadge.textContent = userId || '--';
  } catch {
    userBadge.textContent = '--';
  }

  // Try restoring existing session
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

  // Check for feedback refinement suggestion
  checkFeedbackRefinement();

  // Wire up the extraction panel
  setupExtractionPanel();

  // Event listeners
  sendBtn.addEventListener('click', sendMessage);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
  });

  newSessionBtn.addEventListener('click', startNewSession);

  // Set Reading Goal button
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

  // Goal preview actions
  applyGoalBtn.addEventListener('click', async () => {
    if (!generatedGoal) return;
    applyGoalBtn.disabled = true;
    try {
      await chrome.storage.sync.set({ readingGoal: generatedGoal });
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

  refineBannerBtn.addEventListener('click', () => {
    refinementBanner.style.display = 'none';
    chatInput.value = 'I\'d like to refine my reading preferences based on recent feedback.';
    chatInput.focus();
  });

  refineBannerDismiss.addEventListener('click', () => {
    refinementBanner.style.display = 'none';
  });

  async function startNewSession() {
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
      quickRepliesContainer.style.display = 'none';
      quickRepliesContainer.innerHTML = '';
      generatedGoal = null;

      // Fetch buddy suggestions for the active tab
      loadBuddySuggestions();
    }
  }

  async function loadBuddySuggestions() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url?.startsWith('http')) return;

      const pageMetadata = {
        url: tab.url,
        title: tab.title || '',
        contentPreview: ''  // content script can provide this later
      };

      const res = await chrome.runtime.sendMessage({
        action: 'get-predictions',
        tabId: tab.id,
        pageMetadata
      });

      if (!res?.success) return;
      const { suggestions, greeting } = res;

      // Show greeting in welcome area
      if (greeting) {
        const welcome = chatMessages.querySelector('.chat-welcome');
        if (welcome) {
          welcome.innerHTML = `
            <p>${escapeHtml(greeting)}</p>
            <p class="chat-welcome-hint">Pick a suggestion or type your own request.</p>
          `;
        }
      }

      // Show suggestions as quick-reply buttons
      if (suggestions?.length > 0) {
        showQuickReplies(suggestions.map(s => s.label));
      }
    } catch {
      // Suggestions are optional — don't block the session
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || !currentSessionId) return;

    chatInput.value = '';
    chatInput.style.height = 'auto';
    sendBtn.disabled = true;

    // Hide quick replies when user sends a message
    quickRepliesContainer.style.display = 'none';

    // Clear welcome message if first message
    const welcome = chatMessages.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    appendBubble('user', text);
    userMessageCount++;
    updateActionButtons();

    // Show typing indicator
    const typingEl = appendBubble('model', 'Thinking...', true);

    try {
      const res = await chrome.runtime.sendMessage({
        action: 'chatbot-send',
        sessionId: currentSessionId,
        message: text
      });
      typingEl.remove();
      if (res?.success && res.reply) {
        renderModelReply(res.reply);
      } else {
        appendBubble('model', 'Sorry, I encountered an error: ' + (res?.error || 'Unknown'));
      }
    } catch (e) {
      typingEl.remove();
      appendBubble('model', 'Connection error: ' + e.message);
    }

    sendBtn.disabled = false;
    chatInput.focus();
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
        // Re-parse quick replies from stored messages (show text only, no buttons on restore)
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
    document.getElementById('goalPreviewText').textContent = goal.readingGoal || '';
    document.getElementById('goalPreviewDepth').textContent = goal.desiredDepth || '';
    document.getElementById('goalPreviewFocus').textContent = (goal.focusAreas || []).join(', ') || 'None specified';
    document.getElementById('goalPreviewStyle').textContent = goal.outputStyle || '';
    document.getElementById('goalPreviewNotes').textContent = goal.additionalInstructions || 'None';
    goalPreview.style.display = 'block';
  }

  function setupExtractionPanel() {
    const extractBtn = document.getElementById('extractBtn');
    const statusEl = document.getElementById('extractionStatus');
    const bodyEl = document.getElementById('extractionBody');
    if (!extractBtn || !statusEl || !bodyEl) return;

    // Restore the most recent extraction on open
    chrome.runtime.sendMessage({ action: 'get-last-extraction' })
      .then((res) => {
        if (res?.success && res.extraction) {
          renderExtraction(res.extraction);
        }
      })
      .catch(() => {});

    extractBtn.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setExtractionStatus('No active tab', true);
        return;
      }
      if (!tab.url?.startsWith('http')) {
        setExtractionStatus('Cannot extract from this page', true);
        return;
      }

      extractBtn.disabled = true;
      extractBtn.textContent = 'Extracting...';
      setExtractionStatus('Capturing screenshots and extracting...', false);

      try {
        const res = await chrome.runtime.sendMessage({
          action: 'run-extraction',
          tabId: tab.id,
          pageMetadata: { url: tab.url, title: tab.title || '' },
        });
        if (res?.success && res.extraction) {
          renderExtraction(res.extraction);
        } else {
          setExtractionStatus('Extraction failed: ' + (res?.error || 'unknown'), true);
        }
      } catch (e) {
        setExtractionStatus('Extraction error: ' + (e.message || e), true);
      } finally {
        extractBtn.disabled = false;
        extractBtn.textContent = 'Extract';
      }
    });

    // Listen for live progress + completion (e.g. when full pipeline runs extraction)
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.action === 'extraction-progress' && msg.text) {
        setExtractionStatus(msg.text, false);
      } else if (msg?.action === 'extraction-update') {
        if (msg.status === 'done' && msg.extraction) {
          renderExtraction(msg.extraction);
        } else if (msg.status === 'failed') {
          setExtractionStatus('Extraction failed: ' + (msg.error || 'unknown'), true);
        } else if (msg.status === 'running') {
          setExtractionStatus('Extracting...', false);
        }
      }
    });

    function setExtractionStatus(text, isError) {
      statusEl.textContent = text;
      statusEl.classList.toggle('is-error', !!isError);
      statusEl.style.display = 'block';
    }

    function renderExtraction(result) {
      if (!result || result.error) {
        setExtractionStatus(result?.error ? 'Extraction failed: ' + result.error : 'No extraction', true);
        bodyEl.style.display = 'none';
        return;
      }
      const k = result.knowledge || {};
      const ageMin = result.at ? Math.max(0, Math.round((Date.now() - new Date(result.at).getTime()) / 60000)) : null;
      setExtractionStatus(
        `Extracted${ageMin != null ? ' ' + (ageMin === 0 ? 'just now' : ageMin + 'm ago') : ''} · ${result.sliceCount || 0} slice${result.sliceCount === 1 ? '' : 's'}`,
        false
      );

      const sections = [];
      if (k.title) sections.push(section('Title', textNode(k.title)));
      if (k.topic) sections.push(section('Topic', textNode(k.topic)));
      if (k.summary) sections.push(section('Summary', textNode(k.summary)));
      if (Array.isArray(k.facts) && k.facts.length) {
        const ul = document.createElement('ul');
        ul.className = 'extraction-facts';
        for (const f of k.facts) {
          const li = document.createElement('li');
          li.textContent = f;
          ul.appendChild(li);
        }
        sections.push(section('Facts', ul));
      }
      if (Array.isArray(k.entities) && k.entities.length) {
        sections.push(section('Entities', chips(k.entities)));
      }
      if (Array.isArray(k.keyTerms) && k.keyTerms.length) {
        sections.push(section('Key Terms', chips(k.keyTerms)));
      }

      const meta = document.createElement('div');
      meta.className = 'extraction-meta';
      meta.textContent = `${result.rawCharCount || 0} raw chars · ${result.durationMs || 0}ms${result.partial ? ' · partial' : ''}`;
      sections.push(meta);

      bodyEl.innerHTML = '';
      sections.forEach((el) => bodyEl.appendChild(el));
      bodyEl.style.display = 'flex';
    }

    function section(label, content) {
      const wrap = document.createElement('div');
      wrap.className = 'extraction-section';
      const lbl = document.createElement('div');
      lbl.className = 'extraction-section-label';
      lbl.textContent = label;
      wrap.appendChild(lbl);
      const value = document.createElement('div');
      value.className = 'extraction-section-value';
      if (typeof content === 'string') value.textContent = content;
      else value.appendChild(content);
      wrap.appendChild(value);
      return wrap;
    }

    function textNode(text) {
      const span = document.createElement('span');
      span.textContent = text;
      return span;
    }

    function chips(items) {
      const wrap = document.createElement('div');
      wrap.className = 'extraction-chips';
      for (const item of items) {
        const chip = document.createElement('span');
        chip.className = 'extraction-chip';
        chip.textContent = item;
        wrap.appendChild(chip);
      }
      return wrap;
    }
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
