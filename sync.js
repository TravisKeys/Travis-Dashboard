// sync.js — Cloud sync via private GitHub Gist
// Loaded by every page. Maintains a single private gist that mirrors
// localStorage for all Daily Command apps.
//
// Public API:
//   window.cloudSync.ready          — Promise resolved after initial pull
//   window.cloudSync.openSettings() — opens setup/status modal
//   window.cloudSync.syncNow()      — force pull then push
//   window.cloudSync.disconnect()
//   window.cloudSync.isConfigured()

(function () {
  const PAT_KEY        = 'cloud-sync-pat';
  const GIST_ID_KEY    = 'cloud-sync-gist-id';
  const SYNCED_AT_KEY  = 'cloud-sync-last';
  const FILENAME       = 'daily-command-sync.json';
  const DEBOUNCE_MS    = 2500;
  const PULL_INTERVAL  = 60000;

  // localStorage keys that get mirrored to the gist
  const SYNC_KEYS = [
    'daily-command-state-v2',  // Task Tracker
    'notes-vault-state-v1',    // Notes Vault
    'news-brief-state-v1',     // News Brief
    'pulse-state-v1',          // Pulse
    'daily-command-theme',     // theme
  ];

  // Original setItem reference so we can write without retriggering the hook
  const _setItem = localStorage.setItem.bind(localStorage);
  const _removeItem = localStorage.removeItem.bind(localStorage);

  let pat        = readLS(PAT_KEY);
  let gistId     = readLS(GIST_ID_KEY);
  let lastSyncAt = readLS(SYNCED_AT_KEY);
  let pushTimer  = null;
  let pullTimer  = null;
  let isPushing  = false;
  let isPulling  = false;
  let applying   = false;
  let lastError  = null;
  let indicatorEl = null;
  let modalEl     = null;

  function readLS(k)  { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function writeLS(k, v) { try { _setItem(k, v); } catch (e) {} }
  function delLS(k)   { try { _removeItem(k); } catch (e) {} }

  function getSnapshot() {
    const data = { syncedAt: new Date().toISOString() };
    for (const key of SYNC_KEYS) {
      const v = readLS(key);
      if (v != null) data[key] = v;
    }
    return data;
  }

  function applySnapshot(data) {
    let changed = false;
    applying = true;
    try {
      for (const key of SYNC_KEYS) {
        if (key in data) {
          const cur = readLS(key);
          if (cur !== data[key]) {
            writeLS(key, data[key]);
            changed = true;
          }
        }
      }
    } finally {
      applying = false;
    }
    return changed;
  }

  // ============ Network ============

  async function pullFromGist() {
    if (!pat || !gistId || isPulling) return false;
    isPulling = true;
    updateIndicator('syncing');
    try {
      const res = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: {
          'Authorization': `Bearer ${pat}`,
          'Accept': 'application/vnd.github+json',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const gist = await res.json();
      const file = gist.files && gist.files[FILENAME];
      if (file && file.content) {
        let parsed;
        try { parsed = JSON.parse(file.content); }
        catch (e) { throw new Error('Corrupt gist content'); }
        applySnapshot(parsed);
      }
      lastError = null;
      lastSyncAt = new Date().toISOString();
      writeLS(SYNCED_AT_KEY, lastSyncAt);
      updateIndicator('synced');
      return true;
    } catch (e) {
      lastError = e.message || 'Pull failed';
      updateIndicator('error');
      return false;
    } finally {
      isPulling = false;
    }
  }

  async function pushToGist() {
    if (!pat || !gistId || isPushing) return false;
    isPushing = true;
    updateIndicator('syncing');
    try {
      const data = getSnapshot();
      const res = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${pat}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          files: { [FILENAME]: { content: JSON.stringify(data, null, 2) } },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      lastError = null;
      lastSyncAt = new Date().toISOString();
      writeLS(SYNCED_AT_KEY, lastSyncAt);
      updateIndicator('synced');
      return true;
    } catch (e) {
      lastError = e.message || 'Push failed';
      updateIndicator('error');
      return false;
    } finally {
      isPushing = false;
    }
  }

  function schedulePush() {
    if (!pat || !gistId) return;
    clearTimeout(pushTimer);
    updateIndicator('pending');
    pushTimer = setTimeout(pushToGist, DEBOUNCE_MS);
  }

  // Hook localStorage.setItem to detect synced-key writes
  localStorage.setItem = function (key, value) {
    _setItem(key, value);
    if (!applying && SYNC_KEYS.includes(key)) schedulePush();
  };

  // Cross-tab updates
  window.addEventListener('storage', e => {
    if (e.key && SYNC_KEYS.includes(e.key) && !applying) schedulePush();
  });

  // ============ Setup / disconnect ============

  async function setupSync(newPat) {
    const headers = {
      'Authorization': `Bearer ${newPat}`,
      'Accept': 'application/vnd.github+json',
    };
    // Verify token
    const userRes = await fetch('https://api.github.com/user', { headers });
    if (!userRes.ok) throw new Error(`Token rejected (${userRes.status})`);

    // Find existing sync gist or create a new one
    let id = null;
    const listRes = await fetch('https://api.github.com/gists?per_page=100', { headers });
    if (listRes.ok) {
      const gists = await listRes.json();
      const found = gists.find(g => g.files && g.files[FILENAME]);
      if (found) id = found.id;
    }
    if (!id) {
      const createRes = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: 'Daily Command — Dashboard Sync',
          public: false,
          files: { [FILENAME]: { content: JSON.stringify(getSnapshot(), null, 2) } },
        }),
      });
      if (!createRes.ok) throw new Error(`Could not create gist (${createRes.status})`);
      const gist = await createRes.json();
      id = gist.id;
    }

    pat = newPat;
    gistId = id;
    writeLS(PAT_KEY, newPat);
    writeLS(GIST_ID_KEY, id);

    // Pull whatever's in the gist now (may overwrite local with newer remote data)
    await pullFromGist();
    // Then push our current state in case local has unsynced changes
    await pushToGist();
    startPeriodicPull();
    return { gistId: id };
  }

  function disconnect() {
    pat = null;
    gistId = null;
    lastSyncAt = null;
    lastError = null;
    delLS(PAT_KEY);
    delLS(GIST_ID_KEY);
    delLS(SYNCED_AT_KEY);
    clearTimeout(pushTimer);
    clearInterval(pullTimer);
    updateIndicator('off');
  }

  function startPeriodicPull() {
    clearInterval(pullTimer);
    pullTimer = setInterval(() => { pullFromGist(); }, PULL_INTERVAL);
  }

  // ============ UI: Indicator ============

  function injectIndicator() {
    const themeBtn = document.querySelector('#theme-toggle, #themeToggle');
    if (!themeBtn || indicatorEl) return;
    indicatorEl = document.createElement('button');
    indicatorEl.className = 'cloud-sync-indicator';
    indicatorEl.title = 'Cloud sync — click to configure';
    indicatorEl.addEventListener('click', openSettings);
    themeBtn.parentNode.insertBefore(indicatorEl, themeBtn);
    updateIndicator(currentStatus());
  }

  function currentStatus() {
    if (!pat || !gistId) return 'off';
    if (isPushing || isPulling) return 'syncing';
    if (lastError) return 'error';
    if (pushTimer) return 'pending';
    return 'synced';
  }

  function formatRel(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'now';
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h`;
    return `${Math.floor(hr / 24)}d`;
  }

  function updateIndicator(status) {
    if (!indicatorEl) return;
    indicatorEl.dataset.status = status;
    const labels = {
      off:     'Sync · Off',
      syncing: 'Syncing…',
      pending: 'Pending',
      synced:  lastSyncAt ? `Synced ${formatRel(lastSyncAt)}` : 'Synced',
      error:   'Sync · Error',
    };
    indicatorEl.textContent = labels[status] || 'Sync';
  }

  // ============ UI: Settings Modal ============

  function buildModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.className = 'cloud-sync-modal-bg';
    modalEl.innerHTML = `
      <div class="cloud-sync-modal" role="dialog" aria-modal="true">
        <div class="cloud-sync-modal-head">
          <div class="cloud-sync-modal-title">Cloud Sync</div>
          <button class="cloud-sync-close" data-action="close" aria-label="Close">×</button>
        </div>
        <div class="cloud-sync-modal-body" id="cloud-sync-body"></div>
      </div>
    `;
    modalEl.addEventListener('click', e => {
      if (e.target === modalEl || e.target.dataset.action === 'close') closeSettings();
    });
    document.body.appendChild(modalEl);
    return modalEl;
  }

  function renderModalBody() {
    const body = document.getElementById('cloud-sync-body');
    if (!body) return;
    if (!pat || !gistId) {
      body.innerHTML = `
        <div class="cloud-sync-section">
          <p class="cloud-sync-p">
            Sync tasks, notes, news topics, and pulse feeds across browsers and devices via a
            <strong>private GitHub gist</strong>. Stored locally only on devices you connect.
          </p>
          <ol class="cloud-sync-steps">
            <li>Open <a href="https://github.com/settings/tokens/new?scopes=gist&description=Daily+Command+Sync" target="_blank" rel="noopener noreferrer">github.com/settings/tokens/new</a></li>
            <li>Scopes: check only <code>gist</code></li>
            <li>Generate and paste the <code>ghp_…</code> token below</li>
          </ol>
          <input type="password" class="cloud-sync-input" id="cloud-sync-token" placeholder="ghp_…" autocomplete="off" spellcheck="false">
          <div class="cloud-sync-actions">
            <button class="cloud-sync-btn" id="cloud-sync-connect">Connect</button>
          </div>
          <div class="cloud-sync-status" id="cloud-sync-msg"></div>
        </div>
      `;
      const tokenEl  = document.getElementById('cloud-sync-token');
      const connectEl = document.getElementById('cloud-sync-connect');
      const msgEl     = document.getElementById('cloud-sync-msg');
      const doConnect = async () => {
        const token = tokenEl.value.trim();
        if (!token) { msgEl.textContent = 'Enter a token'; msgEl.dataset.kind = 'error'; return; }
        connectEl.disabled = true;
        msgEl.textContent = 'Connecting…'; msgEl.dataset.kind = 'info';
        try {
          await setupSync(token);
          msgEl.textContent = 'Connected ✓'; msgEl.dataset.kind = 'ok';
          setTimeout(() => { renderModalBody(); }, 600);
        } catch (e) {
          msgEl.textContent = e.message || 'Connection failed';
          msgEl.dataset.kind = 'error';
          connectEl.disabled = false;
        }
      };
      connectEl.addEventListener('click', doConnect);
      tokenEl.addEventListener('keydown', e => { if (e.key === 'Enter') doConnect(); });
      setTimeout(() => tokenEl.focus(), 50);
    } else {
      body.innerHTML = `
        <div class="cloud-sync-section">
          <div class="cloud-sync-row">
            <span>Status</span>
            <span data-kind="${lastError ? 'error' : 'ok'}">${lastError ? 'Error · ' + escHtml(lastError) : 'Connected'}</span>
          </div>
          <div class="cloud-sync-row">
            <span>Last synced</span>
            <span>${lastSyncAt ? new Date(lastSyncAt).toLocaleString() : '—'}</span>
          </div>
          <div class="cloud-sync-row">
            <span>Gist</span>
            <a href="https://gist.github.com/${escHtml(gistId)}" target="_blank" rel="noopener noreferrer" class="cloud-sync-link">View on GitHub →</a>
          </div>
          <div class="cloud-sync-actions">
            <button class="cloud-sync-btn" id="cloud-sync-now">↻ Sync Now</button>
            <button class="cloud-sync-btn secondary" id="cloud-sync-disconnect">Disconnect</button>
          </div>
          <p class="cloud-sync-p" style="font-size:11px; color: var(--ink-muted, #6b6966); letter-spacing: 0.05em;">
            Disconnecting clears the token from this browser. Your gist and other devices are untouched.
          </p>
        </div>
      `;
      document.getElementById('cloud-sync-now').addEventListener('click', async () => {
        const btn = document.getElementById('cloud-sync-now');
        btn.disabled = true;
        await pullFromGist();
        await pushToGist();
        btn.disabled = false;
        renderModalBody();
      });
      document.getElementById('cloud-sync-disconnect').addEventListener('click', () => {
        if (confirm('Disconnect cloud sync from this browser?\n\nYour data and the gist itself are kept — this just removes the token here.')) {
          disconnect();
          renderModalBody();
        }
      });
    }
  }

  function openSettings() {
    buildModal();
    modalEl.dataset.open = 'true';
    renderModalBody();
  }
  function closeSettings() {
    if (modalEl) modalEl.dataset.open = 'false';
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ============ Styles ============

  const style = document.createElement('style');
  style.textContent = `
    .cloud-sync-indicator {
      height: 38px;
      background: var(--bg-panel, #16191d);
      border: 1px solid var(--line, #2a2e34);
      color: var(--ink-soft, #a8a6a1);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 0 12px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      font-weight: 600;
      flex-shrink: 0;
      margin-top: 2px;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .cloud-sync-indicator:hover {
      border-color: var(--accent, #b8945f);
      color: var(--accent, #b8945f);
    }
    .cloud-sync-indicator::before {
      content: '';
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--ink-muted, #6b6966);
      flex-shrink: 0;
    }
    .cloud-sync-indicator[data-status="synced"]::before { background: #5fb878; }
    .cloud-sync-indicator[data-status="syncing"]::before { background: var(--accent, #b8945f); animation: cs-pulse 1.2s infinite; }
    .cloud-sync-indicator[data-status="pending"]::before { background: var(--accent, #b8945f); }
    .cloud-sync-indicator[data-status="error"]::before { background: var(--urgent, #9c2b2b); }
    @keyframes cs-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

    .cloud-sync-modal-bg {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.65);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      padding: 20px;
    }
    .cloud-sync-modal-bg[data-open="true"] { display: flex; }
    .cloud-sync-modal {
      background: var(--bg-panel, #16191d);
      border: 1px solid var(--line, #2a2e34);
      max-width: 480px;
      width: 100%;
      max-height: 85vh;
      overflow-y: auto;
      color: var(--ink, #e8e6e1);
      font-family: 'Inter', sans-serif;
    }
    .cloud-sync-modal-head {
      padding: 18px 22px 14px;
      border-bottom: 1px solid var(--line-soft, #21252a);
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: relative;
    }
    .cloud-sync-modal-head::after {
      content: '';
      position: absolute;
      bottom: -1px; left: 22px;
      width: 40px; height: 1px;
      background: var(--accent, #b8945f);
    }
    .cloud-sync-modal-title {
      font-family: 'Playfair Display', serif;
      font-size: 22px;
      font-weight: 500;
      letter-spacing: -0.005em;
    }
    .cloud-sync-close {
      background: none;
      border: none;
      color: var(--ink-muted, #6b6966);
      cursor: pointer;
      font-size: 22px;
      line-height: 1;
      padding: 4px 8px;
      transition: color 0.15s;
    }
    .cloud-sync-close:hover { color: var(--urgent, #9c2b2b); }
    .cloud-sync-modal-body { padding: 22px; }
    .cloud-sync-section { display: flex; flex-direction: column; gap: 12px; }
    .cloud-sync-p {
      color: var(--ink-soft, #a8a6a1);
      line-height: 1.6;
      font-size: 13px;
    }
    .cloud-sync-steps {
      list-style-position: inside;
      color: var(--ink-soft, #a8a6a1);
      font-size: 13px;
      line-height: 1.8;
      padding-left: 4px;
    }
    .cloud-sync-steps a { color: var(--accent, #b8945f); text-decoration: underline; }
    .cloud-sync-steps code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      background: var(--bg, #0e1013);
      padding: 1px 5px;
      border: 1px solid var(--line, #2a2e34);
    }
    .cloud-sync-input {
      background: var(--bg, #0e1013);
      border: 1px solid var(--line, #2a2e34);
      color: var(--ink, #e8e6e1);
      padding: 10px 12px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      outline: none;
      width: 100%;
    }
    .cloud-sync-input:focus { border-color: var(--accent, #b8945f); }
    .cloud-sync-btn {
      background: var(--accent, #b8945f);
      color: var(--bg, #0e1013);
      border: none;
      padding: 10px 18px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      letter-spacing: 0.25em;
      text-transform: uppercase;
      cursor: pointer;
      font-weight: 700;
      transition: background 0.15s;
    }
    .cloud-sync-btn:hover { background: var(--accent-dim, #8a6d44); }
    .cloud-sync-btn:disabled { opacity: 0.5; cursor: default; }
    .cloud-sync-btn.secondary {
      background: transparent;
      color: var(--ink-soft, #a8a6a1);
      border: 1px solid var(--line, #2a2e34);
    }
    .cloud-sync-btn.secondary:hover { color: var(--urgent, #9c2b2b); border-color: var(--urgent, #9c2b2b); }
    [data-theme="light"] .cloud-sync-btn { color: #fbf8f1; }
    .cloud-sync-status {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      letter-spacing: 0.1em;
      min-height: 16px;
    }
    .cloud-sync-status[data-kind="error"] { color: var(--urgent, #9c2b2b); }
    .cloud-sync-status[data-kind="ok"]    { color: #5fb878; }
    .cloud-sync-status[data-kind="info"]  { color: var(--accent, #b8945f); }
    .cloud-sync-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 8px 0;
      border-bottom: 1px solid var(--line-soft, #21252a);
      font-size: 13px;
      gap: 12px;
    }
    .cloud-sync-row:last-of-type { border-bottom: none; }
    .cloud-sync-row > span:first-child {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--ink-muted, #6b6966);
      font-weight: 600;
    }
    .cloud-sync-row [data-kind="error"] { color: var(--urgent, #9c2b2b); }
    .cloud-sync-row [data-kind="ok"]    { color: #5fb878; }
    .cloud-sync-link { color: var(--accent, #b8945f); text-decoration: underline; font-size: 13px; }
    .cloud-sync-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
  `;
  document.head.appendChild(style);

  // ============ Init ============

  let resolveReady;
  const readyPromise = new Promise(r => { resolveReady = r; });

  async function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectIndicator, { once: true });
    } else {
      injectIndicator();
    }
    if (pat && gistId) {
      try { await pullFromGist(); } catch (e) { /* error noted on indicator */ }
      startPeriodicPull();
    }
    // Refresh "Synced Xm ago" label periodically
    setInterval(() => {
      if (currentStatus() === 'synced') updateIndicator('synced');
    }, 30000);
    resolveReady();
  }

  // Public API
  window.cloudSync = {
    ready: readyPromise,
    openSettings,
    syncNow: async () => { await pullFromGist(); await pushToGist(); },
    disconnect,
    isConfigured: () => !!(pat && gistId),
  };

  init();
})();
