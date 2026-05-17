document.addEventListener('DOMContentLoaded', async () => {
  const titleEl = document.getElementById('pageTitle');
  const sourceEl = document.getElementById('pageSource');
  const readTimeEl = document.getElementById('readTime');
  const wordCountEl = document.getElementById('wordCount');
  const summaryEl = document.getElementById('summaryText');
  const factsTable = document.getElementById('factsTable');
  const factsLabel = document.getElementById('factsLabel');
  const rawSection = document.getElementById('rawSection');
  const rawEl = document.getElementById('extractedContent');
  const emptyState = document.getElementById('emptyState');

  const entitiesCard = document.getElementById('entitiesCard');
  const entitiesList = document.getElementById('entitiesList');
  const goalMatchCard = document.getElementById('goalMatchCard');
  const goalScore = document.getElementById('goalScore');
  const goalBarFill = document.getElementById('goalBarFill');
  const goalExplanation = document.getElementById('goalExplanation');
  const metaCard = document.getElementById('extractionMetaCard');
  const metaList = document.getElementById('extractionMeta');
  let loadedExtraction = null;

  try {
    const { lastExtraction } = await chrome.storage.local.get(['lastExtraction']);
    if (!lastExtraction) {
      summaryEl.textContent = 'No extracted content found.';
      return;
    }
    loadedExtraction = lastExtraction;

    const knowledge = lastExtraction.knowledge || {};
    const staleLocalExtraction = isStaleLocalExtraction(lastExtraction);

    // Title
    if (lastExtraction.title) {
      titleEl.textContent = lastExtraction.title;
      document.title = `Clear · ${lastExtraction.title}`;
    }

    // Source
    if (lastExtraction.url) {
      try {
        const u = new URL(lastExtraction.url);
        sourceEl.textContent = u.hostname.replace('www.', '');
      } catch { sourceEl.textContent = '—'; }
    }

    // Word count & read time
    const text = lastExtraction.compactText || '';
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words) {
      wordCountEl.textContent = `${words.toLocaleString()} WORDS`;
      const mins = Math.max(1, Math.round(words / 200));
      readTimeEl.textContent = `${mins} MIN READ`;
    }

    // Summary
    if (staleLocalExtraction) {
      summaryEl.textContent = 'This stored extraction was created by the retired local fallback. Click Re-extract to generate structured facts and claims.';
    } else if (lastExtraction.summary || knowledge.summary) {
      summaryEl.textContent = lastExtraction.summary || knowledge.summary;
    } else if (text) {
      summaryEl.textContent = text.slice(0, 300) + (text.length > 300 ? '...' : '');
    }

    // Facts / key points
    const facts = staleLocalExtraction ? [] : (lastExtraction.facts || lastExtraction.keyPoints || knowledge.facts || []);
    if (facts.length) {
      emptyState.style.display = 'none';
      factsLabel.textContent = `Facts & claims · ${facts.length}`;
      facts.forEach((f) => {
        const row = document.createElement('div');
        row.className = 'ev-fact-row';

        const factText = typeof f === 'string' ? f : (f.text || f.content || '');
        const kindStr = (typeof f === 'string' ? 'CLAIM' : (f.kind || f.type || 'CLAIM')).toUpperCase();
        const kindClass = ({ COUNTER: '--counter', FIGURE: '--figure', QUOTE: '--quote' })[kindStr] || '--claim';
        const conf = typeof f === 'string' || f.confidence == null ? 0.8 : f.confidence;

        row.innerHTML = `
          <span class="ev-fact-kind ev-fact-kind${kindClass}">${esc(kindStr)}</span>
          <span class="ev-fact-text">${esc(factText)}</span>
          <div class="ev-fact-conf">
            <span class="ev-fact-conf-num">${Math.round(conf * 100)}</span>
            <div class="ev-fact-conf-bar">
              <div class="ev-fact-conf-bar-fill" style="width:${conf * 100}%;background:${conf > 0.85 ? 'var(--pos)' : conf > 0.65 ? 'var(--accent)' : 'var(--warn)'}"></div>
            </div>
          </div>
        `;
        factsTable.appendChild(row);
      });
    } else if (text && !staleLocalExtraction) {
      emptyState.style.display = 'none';
      rawSection.style.display = 'block';
      rawEl.textContent = text;
    }

    // Entities sidebar
    const entities = lastExtraction.entities || knowledge.entities || [];
    if (entities.length) {
      entitiesCard.style.display = 'block';
      entities.forEach((e) => {
        const chip = document.createElement('span');
        chip.className = 'ev-entity-chip';
        chip.textContent = typeof e === 'string' ? e : (e.name || e.text || '');
        entitiesList.appendChild(chip);
      });
    }

    // Goal match sidebar
    if (lastExtraction.goalMatch != null) {
      goalMatchCard.style.display = 'block';
      const score = Math.round(lastExtraction.goalMatch);
      goalScore.textContent = score;
      goalBarFill.style.width = score + '%';
      if (lastExtraction.goalExplanation) {
        goalExplanation.textContent = lastExtraction.goalExplanation;
      }
    }

    // Extraction meta sidebar
    const meta = lastExtraction.meta || {};
    if (Object.keys(meta).length || lastExtraction.model || lastExtraction.tokensIn) {
      metaCard.style.display = 'block';
      const rows = [];
      if (meta.model || lastExtraction.model) rows.push(['Model', meta.model || lastExtraction.model]);
      if (meta.tokensIn || lastExtraction.tokensIn) rows.push(['Tokens', `${meta.tokensIn || lastExtraction.tokensIn || '?'} in · ${meta.tokensOut || lastExtraction.tokensOut || '?'} out`]);
      if (meta.latency || lastExtraction.latency) rows.push(['Latency', `${((meta.latency || lastExtraction.latency) / 1000).toFixed(1)} s`]);
      if (lastExtraction.durationMs) rows.push(['Duration', `${(lastExtraction.durationMs / 1000).toFixed(1)} s`]);
      rows.forEach(([k, v]) => {
        const el = document.createElement('div');
        el.className = 'ev-meta-row-item';
        el.innerHTML = `<span class="label">${esc(k)}</span><span>${esc(v)}</span>`;
        metaList.appendChild(el);
      });
    }

  } catch (e) {
    summaryEl.textContent = 'Could not load extracted content: ' + (e.message || 'unknown error');
  }

  // Action buttons
  document.getElementById('reextractBtn')?.addEventListener('click', async () => {
    const tabId = await resolveSourceTabId(loadedExtraction);
    if (!tabId) {
      summaryEl.textContent = 'Could not find the source page tab to re-extract.';
      return;
    }
    summaryEl.textContent = 'Extracting page knowledge...';
    const res = await chrome.runtime.sendMessage({
      action: 'extract-page-knowledge',
      tabId,
      pageMetadata: { url: loadedExtraction?.url || '', title: loadedExtraction?.title || '' },
    });
    if (res?.success) location.reload();
    else summaryEl.textContent = res?.error || 'Extraction failed.';
  });

  document.getElementById('copyJsonBtn')?.addEventListener('click', async () => {
    const { lastExtraction } = await chrome.storage.local.get(['lastExtraction']);
    if (lastExtraction) {
      await navigator.clipboard.writeText(JSON.stringify(lastExtraction, null, 2));
    }
  });

  document.getElementById('renarrateBtn')?.addEventListener('click', async () => {
    const tabId = await resolveSourceTabId(loadedExtraction);
    if (!tabId) {
      summaryEl.textContent = 'Could not find the source page tab to renarrate.';
      return;
    }
    const res = await chrome.runtime.sendMessage({
      action: 'run-page-renarration-from-extraction',
      tabId,
    });
    if (res?.success === false) summaryEl.textContent = res.error || 'Renarration failed.';
  });
});

async function resolveSourceTabId(extraction) {
  const fromUrl = Number(new URLSearchParams(location.search).get('tabId'));
  if (Number.isFinite(fromUrl) && fromUrl > 0) {
    try {
      const tab = await chrome.tabs.get(fromUrl);
      if (tab?.id) return tab.id;
    } catch {}
  }

  if (!extraction?.url) return null;
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => tab.url === extraction.url)?.id || null;
}

function isStaleLocalExtraction(value) {
  return value?.model === 'local-fast-text';
}

function esc(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
