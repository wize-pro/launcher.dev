// ── i18n ─────────────────────────────────────────────────────────────────────
let LANG = localStorage.getItem('dlLang') || 'en';
const CATALOGS = {};

function t(key, params) { return I18n.translate(CATALOGS, LANG, key, params); }

async function loadCatalog(lang) {
  if (CATALOGS[lang]) return;
  CATALOGS[lang] = await fetch(`/locales/${lang}.json`).then(r => r.json()).catch(() => ({}));
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
}

async function initI18n() {
  const locales = await fetch('/api/locales').then(r => r.json()).catch(() => [{ code: 'en' }]);
  const supported = locales.map(l => l.code);
  const settings = await fetch('/api/settings').then(r => r.json()).catch(() => ({}));
  let lang = settings.lang;
  if (!lang || !supported.includes(lang)) {
    lang = I18n.detectLang(navigator.language, supported); // first launch: follow the system
    fetch('/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang }),
    }).catch(() => {});
  }
  LANG = lang;
  localStorage.setItem('dlLang', lang);
  await Promise.all([loadCatalog('en'), loadCatalog(lang)]);
  applyTranslations();
}

async function populateLangSelector() {
  const sel = document.getElementById('cfg-lang');
  if (!sel) return;
  const locales = await fetch('/api/locales').then(r => r.json()).catch(() => []);
  sel.innerHTML = locales.map(l =>
    `<option value="${l.code}"${l.code === LANG ? ' selected' : ''}>${l.name}</option>`
  ).join('');
}

async function setLang(lang) {
  LANG = lang;
  localStorage.setItem('dlLang', lang);
  await loadCatalog(lang);
  fetch('/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang }),
  }).catch(() => {});
  applyTranslations();
  rerenderDynamic();
}

// Re-render views that build HTML in JS so a live language switch updates them too.
function rerenderDynamic() {
  loadProjects();
  renderIdeSettings();
}

// ══ State ══════════════════════════════════════════════════════════════════
let allProjects = [];
let activeFilter = 'all';
let activeTypes  = new Set(); // multi-select type filters
let activePortFilter = null;  // port number or null
let portConflicts = new Map(); // port → [projectId, ...]
let sortBy  = 'recent'; // 'name' | 'recent'
let sortDir = 'desc';   // 'asc' | 'desc'
let favorites = new Set();
let idesList    = [];
let defaultIdeId = 'vscode';

// Presets connus pour l'ajout rapide
const IDE_PRESETS = {
  vscode:   { name: 'VS Code',       cmd: 'code'      },
  cursor:   { name: 'Cursor',        cmd: 'cursor'    },
  windsurf: { name: 'Windsurf',      cmd: 'windsurf'  },
  zed:      { name: 'Zed',           cmd: 'zed'       },
  rider:    { name: 'Rider',         cmd: 'rider'     },
  webstorm: { name: 'WebStorm',      cmd: 'webstorm'  },
  idea:     { name: 'IntelliJ IDEA', cmd: 'idea'      },
  pycharm:  { name: 'PyCharm',       cmd: 'pycharm'   },
  sublime:  { name: 'Sublime Text',  cmd: 'subl'      },
};

function getProjectIde(p) {
  const id = p.ideId || defaultIdeId;
  return idesList.find(i => i.id === id) || idesList[0] || { id:'vscode', name:'Code', cmd:'code' };
}

async function loadFavorites() {
  try {
    const ids = await fetch('/api/favorites').then(r => r.json());
    favorites = new Set(ids);
  } catch { favorites = new Set(); }
}

// ══ Theme ══════════════════════════════════════════════════════════════════
let currentTheme = localStorage.getItem('dlTheme') || 'dark';
function applyTheme(theme) {
  currentTheme = theme;
  if (theme === 'light') document.documentElement.setAttribute('data-theme','light');
  else document.documentElement.removeAttribute('data-theme');
  localStorage.setItem('dlTheme', theme);
}
function toggleTheme() { applyTheme(currentTheme === 'dark' ? 'light' : 'dark'); }
applyTheme(currentTheme);
let terminalOpen = true;
let activeTabId = null;
let activeScanEs = null;
// tabId → { projectName, cmdLabel, logs[], es, running }
const tabs = new Map();
// expanded rows
const expandedRows = new Set();

// ══ Tag color map ══════════════════════════════════════════════════════════
const TAG_COLORS = {
  dotnet:'#a78bfa', node:'#fbbf24', typescript:'#fbbf24', vite:'#fbbf24',
  next:'#fbbf24', react:'#61dafb', docker:'#22d3ee', python:'#4ade80',
  go:'#60a5fa', multi:'#f472b6', rust:'#fb923c',
};

// ── Util ───────────────────────────────────────────────────────────────────
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

