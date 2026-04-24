// ========== Card Definitions ==========
// Edit this list to add/remove tools. `href` is what the card links to.
// `tone` controls the top accent stripe color: urgent | today | week | long | accent
const CARDS = [
  {
    title: 'Task Tracker',
    desc: 'Daily directives across urgent, today, weekly, and strategic horizons.',
    icon: '✓',
    href: 'apps/tasks.html',
    status: 'Live',
    statusType: 'live',
    tone: 'urgent',
  },
  {
    title: 'Notes Vault',
    desc: 'Rich-text notes with search, starring, and full formatting controls.',
    icon: '✎',
    href: 'apps/notes.html',
    status: 'Live',
    statusType: 'live',
    tone: 'today',
  },
  {
    title: 'Habit Logger',
    desc: 'Track recurring habits and visualize streaks over time.',
    icon: '◐',
    href: '#',
    status: 'Planned',
    statusType: 'dev',
    tone: 'week',
  },
  {
    title: 'Finance Snapshot',
    desc: 'Budget overview, recurring expenses, and savings targets.',
    icon: '$',
    href: '#',
    status: 'Planned',
    statusType: 'dev',
    tone: 'long',
  },
  {
    title: 'Reading List',
    desc: 'Active reads, queued books, and highlights from past titles.',
    icon: '❡',
    href: '#',
    status: 'Planned',
    statusType: 'dev',
    tone: 'accent',
  },
  {
    title: 'Quick Links',
    desc: 'Bookmarks and frequently-used external resources.',
    icon: '↗',
    href: '#',
    status: 'Planned',
    statusType: 'dev',
    tone: 'today',
  },
];

// ========== Render Cards ==========
function renderCards() {
  const container = document.getElementById('cards');
  container.innerHTML = CARDS.map((card, i) => `
    <a class="card" href="${card.href}" data-tone="${card.tone || 'accent'}">
      <div class="card-head">
        <div class="card-icon">${card.icon}</div>
        <div class="card-index">${String(i + 1).padStart(2, '0')} / ${String(CARDS.length).padStart(2, '0')}</div>
      </div>
      <h3 class="card-title">${card.title}</h3>
      <p class="card-desc">${card.desc}</p>
      <div class="card-footer">
        <span class="card-status ${card.statusType || ''}">${card.status || ''}</span>
        <span class="card-arrow">→</span>
      </div>
    </a>
  `).join('');

  const liveCount = CARDS.filter(c => c.statusType === 'live').length;
  document.getElementById('card-count').textContent =
    `${String(CARDS.length).padStart(2, '0')} TOTAL · ${String(liveCount).padStart(2, '0')} LIVE`;
}

// ========== Date / Time ==========
function updateDateTime() {
  const now = new Date();
  const time = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const date = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  document.getElementById('time').textContent = time;
  document.getElementById('date').textContent = date;
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

// ========== Theme Toggle (shared key with Daily Command) ==========
const THEME_KEY = 'daily-command-theme';

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
initTheme();
renderCards();
updateDateTime();
updateGreeting();
setInterval(updateDateTime, 1000);
setInterval(updateGreeting, 60000);
