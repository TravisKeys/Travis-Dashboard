// ========== Storage Keys ==========
const THEME_KEY = 'daily-command-theme';
const TASK_STATE_KEY = 'daily-command-state-v2';
const NEWS_STATE_KEY = 'news-brief-state-v1';
const PULSE_STATE_KEY = 'pulse-state-v1';

// ========== Utilities ==========
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ========== Date / Time ==========
function updateDateTime() {
  const now = new Date();
  document.getElementById('time').textContent = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  document.getElementById('date').textContent = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

// ========== Greeting ==========
function updateGreeting() {
  const hour = new Date().getHours();
  let greeting;
  if (hour < 5) greeting = 'Burning the midnight oil';
  else if (hour < 12) greeting = 'Good morning';
  else if (hour < 17) greeting = 'Good afternoon';
  else if (hour < 22) greeting = 'Good evening';
  else greeting = 'Good night';
  document.getElementById('greeting-text').textContent = greeting;
}

// ========== Theme ==========
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
}
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
  applyTheme(saved || 'dark');
}
document.getElementById('theme-toggle').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// ========== Priorities Panel (Task Tracker integration) ==========
function loadTaskState() {
  try {
    const raw = localStorage.getItem(TASK_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function saveTaskState(state) {
  try { localStorage.setItem(TASK_STATE_KEY, JSON.stringify(state)); } catch (e) {}
}

function renderPriorities() {
  const state = loadTaskState();
  const container = document.getElementById('priorities-body');
  const countEl = document.getElementById('priorities-count');

  const urgent = state && state.tasks ? (state.tasks.urgent || []).filter(t => !t.done) : [];
  const today  = state && state.tasks ? (state.tasks.today  || []).filter(t => !t.done) : [];
  const total = urgent.length + today.length;

  countEl.textContent = String(total).padStart(2, '0');

  if (!state) {
    container.innerHTML = `
      <div class="panel-empty">
        No tasks yet<br><br>
        Open Task Tracker<br>to get started
      </div>`;
    return;
  }

  if (total === 0) {
    container.innerHTML = `<div class="panel-empty">All clear<br><br>No urgent or today tasks</div>`;
    return;
  }

  const renderTask = (task, cat) => {
    const subCount = (task.subtasks || []).length;
    const subLabel = subCount ? `<div class="dash-task-sub">${subCount} sub-item${subCount === 1 ? '' : 's'}</div>` : '';
    return `
      <div class="dash-task" data-cat="${cat}" data-id="${task.id}">
        <div class="dash-checkbox" data-action="toggle"></div>
        <div class="dash-task-body">
          <div class="dash-task-text">${esc(task.text)}</div>
          ${subLabel}
        </div>
      </div>
    `;
  };

  const sections = [];
  if (urgent.length) {
    sections.push(`
      <div class="dash-section">
        <div class="dash-section-header">
          <div class="dash-section-title urgent">Urgent · Act Now</div>
          <div class="dash-section-count">${String(urgent.length).padStart(2, '0')}</div>
        </div>
        ${urgent.map(t => renderTask(t, 'urgent')).join('')}
      </div>
    `);
  }
  if (today.length) {
    sections.push(`
      <div class="dash-section">
        <div class="dash-section-header">
          <div class="dash-section-title today">Today · End of Day</div>
          <div class="dash-section-count">${String(today.length).padStart(2, '0')}</div>
        </div>
        ${today.map(t => renderTask(t, 'today')).join('')}
      </div>
    `);
  }
  container.innerHTML = sections.join('');

  container.querySelectorAll('.dash-task').forEach(el => {
    el.addEventListener('click', () => completeTask(el.dataset.cat, el.dataset.id));
  });
}

function completeTask(category, taskId) {
  const state = loadTaskState();
  if (!state || !state.tasks || !state.tasks[category]) return;
  const idx = state.tasks[category].findIndex(t => t.id === taskId);
  if (idx === -1) return;

  const task = state.tasks[category][idx];
  task.done = true;
  if (!state.archive) state.archive = [];
  state.archive.unshift({ ...task, category, completedAt: new Date().toISOString() });
  state.tasks[category].splice(idx, 1);

  saveTaskState(state);
  renderPriorities();
}

// ========== News Panel (News Brief preview) ==========
function loadNewsState() {
  try {
    const raw = localStorage.getItem(NEWS_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function formatNewsRelative(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function renderNewsPreview() {
  const body = document.getElementById('news-body');
  const meta = document.getElementById('news-meta');
  const state = loadNewsState();

  if (!state || !state.topics || state.topics.length === 0) {
    meta.textContent = 'Set Up';
    body.innerHTML = `
      <div class="panel-empty">
        No topics set<br><br>
        Click below to configure
      </div>`;
    return;
  }

  // Collect all cached articles across topics, dedupe by link, sort by recency
  const all = [];
  const seen = new Set();
  for (const topic of state.topics) {
    const entry = state.cache?.[topic];
    if (!entry || !entry.items) continue;
    for (const item of entry.items) {
      if (seen.has(item.link)) continue;
      seen.add(item.link);
      all.push({ ...item, topic });
    }
  }
  all.sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));

  meta.textContent = `${String(all.length).padStart(2, '0')} TODAY`;

  if (all.length === 0) {
    body.innerHTML = `
      <div class="panel-empty">
        No articles yet<br><br>
        Refresh in the app
      </div>`;
    return;
  }

  body.innerHTML = all.slice(0, 5).map(a => {
    const parts = [a.source, formatNewsRelative(a.pubDate), a.topic].filter(Boolean);
    return `
      <a class="news-item" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">
        <div class="news-item-meta">
          ${parts.map((p, i) => `<span class="${i === 0 ? 'news-item-source' : ''}">${esc(p)}</span>`).join('<span>·</span>')}
        </div>
        <div class="news-item-title">${esc(a.title)}</div>
      </a>
    `;
  }).join('');
}

// ========== Pulse Panel (Industry Pulse preview) ==========
function loadPulseState() {
  try {
    const raw = localStorage.getItem(PULSE_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function pulseLabSources(lab) {
  return Array.isArray(lab.sources) && lab.sources.length ? lab.sources : ['gnews', 'hn'];
}

// Announcement keyword scoring — kept in sync with apps/pulse.html
const PULSE_ANNOUNCE = ['announce', 'announces', 'announced', 'announcing', 'announcement', 'launch', 'launches', 'launched', 'launching', 'release', 'releases', 'released', 'releasing', 'introduce', 'introduces', 'introduced', 'introducing', 'unveil', 'unveils', 'unveiled', 'unveiling', 'debut', 'debuts', 'reveal', 'reveals', 'revealed', 'now available', 'now shipping', 'rolls out', 'rolling out', 'arrives', 'arrived'];
const PULSE_PRODUCT = ['feature', 'features', 'model', 'models', 'device', 'devices', 'chip', 'chips', 'silicon', 'app', 'apps', 'tool', 'tools', 'api', 'sdk', 'version', 'update', 'beta', 'preview', 'agent', 'agents', 'iphone', 'ipad', 'mac', 'macbook', 'airpods', 'apple watch', 'vision pro', 'pixel', 'ios', 'macos', 'gpt', 'claude', 'gemini', 'grok', 'llama'];
const PULSE_NEGATIVE = ['lawsuit', 'sue', 'sued', 'sues', 'settlement', 'earnings', 'revenue', 'stock', 'shares', 'fired', 'hires', 'hired', 'resigns', 'resigned', 'investigation', 'antitrust', 'opinion', 'op-ed', 'tariff'];

function pulseScore(post) {
  const text = `${post.title || ''} ${post.summary || ''}`.toLowerCase();
  let bonus = 0;
  if (PULSE_ANNOUNCE.some(w => text.includes(w))) bonus += 4;
  let prod = 0;
  for (const w of PULSE_PRODUCT) if (text.includes(w)) prod++;
  bonus += Math.min(prod, 2);
  if (PULSE_NEGATIVE.some(w => text.includes(w))) bonus -= 3;
  const ageMin = post.pubDate ? (Date.now() - new Date(post.pubDate).getTime()) / 60000 : 1440 * 7;
  return ageMin - (bonus * 120);
}

function renderPulsePreview() {
  const body = document.getElementById('pulse-body');
  const meta = document.getElementById('pulse-meta');
  if (!body || !meta) return;

  const state = loadPulseState();

  const posts = [];
  const seen = new Set();
  if (state && state.labs && state.cache) {
    const enabledLabs = state.labs.filter(l => l.enabled);
    for (const lab of enabledLabs) {
      for (const sourceKey of pulseLabSources(lab)) {
        const entry = state.cache[`${lab.name}|${sourceKey}`];
        if (!entry || !entry.items) continue;
        for (const item of entry.items) {
          if (seen.has(item.link)) continue;
          seen.add(item.link);
          posts.push(item);
        }
      }
    }
    // Same composite ranking as the app — announcements first
    posts.sort((a, b) => pulseScore(a) - pulseScore(b));
  }

  if (!state || posts.length === 0) {
    meta.textContent = state ? '00 POSTS' : 'Set Up';
    body.innerHTML = `
      <div class="panel-empty">
        ${state ? 'No posts cached yet<br><br>Refresh in the app' : 'No labs followed<br><br>Click below to configure'}
      </div>`;
    return;
  }

  meta.textContent = `${String(posts.length).padStart(2, '0')} POSTS`;

  body.innerHTML = posts.slice(0, 5).map(p => {
    const sourceLabel = p.source === 'hn' ? 'HN' : (p.source === 'rss' ? (p.outlet || 'FEED') : (p.outlet || 'NEWS'));
    const parts = [sourceLabel, p.lab, formatNewsRelative(p.pubDate)].filter(Boolean);
    return `
      <a class="news-item" href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">
        <div class="news-item-meta">
          ${parts.map((part, i) => `<span class="${i === 0 ? 'news-item-source' : ''}">${esc(part)}</span>`).join('<span>·</span>')}
        </div>
        <div class="news-item-title">${esc(p.title)}</div>
      </a>
    `;
  }).join('');
}

// Stay in sync when any underlying app updates state in another tab
window.addEventListener('storage', e => {
  if (e.key === TASK_STATE_KEY) renderPriorities();
  if (e.key === NEWS_STATE_KEY) renderNewsPreview();
  if (e.key === PULSE_STATE_KEY) renderPulsePreview();
  if (e.key === THEME_KEY && e.newValue) applyTheme(e.newValue);
});

// ========== Nav Active State ==========
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    if (item.getAttribute('href').startsWith('#')) {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
    }
  });
});

// ========== Init ==========
async function init() {
  if (window.cloudSync && window.cloudSync.ready) {
    try { await window.cloudSync.ready; } catch (e) {}
  }
  initTheme();
  updateDateTime();
  updateGreeting();
  renderPriorities();
  renderNewsPreview();
  renderPulsePreview();
  setInterval(updateDateTime, 1000);
  setInterval(updateGreeting, 60000);
  setInterval(renderPriorities, 30000);
  setInterval(renderNewsPreview, 60000);
  setInterval(renderPulsePreview, 60000);
}
init();
