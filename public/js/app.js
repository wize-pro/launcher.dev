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

// ══ Load ═══════════════════════════════════════════════════════════════════
async function loadProjects() {
  try {
    const r = await fetch('/api/projects');
    allProjects = await r.json();
    // Sync categories from enriched project data
    allProjects.forEach(p => {
      if (p.categories?.length) {
        catAssignments[p.id] = p.categories.map(c => c.id);
      }
    });
    computePortConflicts();
    renderFilter();
    renderTypeBar();
    renderCatBar();
    updateSortButtons();
    renderProjects();
  } catch(e){ console.warn(e) }
}

// ══ Port conflict detection ════════════════════════════════════════════════
function computePortConflicts() {
  const portToProjects = new Map();
  allProjects.forEach(p => {
    const seen = new Set();
    Object.values(p.commands||{}).forEach(cmd => {
      if (cmd.port && !seen.has(cmd.port)) {
        seen.add(cmd.port);
        if (!portToProjects.has(cmd.port)) portToProjects.set(cmd.port, []);
        portToProjects.get(cmd.port).push(p.id);
      }
    });
  });
  portConflicts = new Map([...portToProjects].filter(([,ids]) => ids.length > 1));
}

// ══ Port filter ════════════════════════════════════════════════════════════
function filterByPort(port) {
  if (activePortFilter === port) {
    activePortFilter = null;
  } else {
    activePortFilter = port;
    activeFilter = 'all';
  }
  updatePortFilterBanner();
  renderProjects();
}

function clearPortFilter() {
  activePortFilter = null;
  updatePortFilterBanner();
  renderProjects();
}

// ══ Sort ═══════════════════════════════════════════════════════════════════
function setSort(key) {
  if (sortBy === key) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortBy  = key;
    sortDir = key === 'recent' ? 'desc' : 'asc';
  }
  updateSortButtons();
  renderProjects();
}

function updateSortButtons() {
  ['name','recent'].forEach(k => {
    const btn   = document.getElementById(`sort-${k}`);
    const arrow = document.getElementById(`sort-${k}-arrow`);
    if (!btn) return;
    const isActive = sortBy === k;
    btn.classList.toggle('active', isActive);
    arrow.textContent = isActive ? (sortDir === 'asc' ? '↑' : '↓') : '';
    arrow.style.opacity = isActive ? '1' : '0';
  });
}

function applySort(list) {
  return [...list].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'name') {
      cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    } else {
      const ta = a.lastActivity?.ts ?? 0;
      const tb = b.lastActivity?.ts ?? 0;
      cmp = ta - tb;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });
}

// ══ Favorites ══════════════════════════════════════════════════════════════
async function toggleFavorite(id) {
  const wasFav = favorites.has(id);
  // Immediate optimistic update
  wasFav ? favorites.delete(id) : favorites.add(id);
  renderFilter();
  renderProjects();
  // Server-side persistence (shared between web and Electron)
  try {
    await fetch(`/api/favorites/${encodeURIComponent(id)}`, {
      method: wasFav ? 'DELETE' : 'POST',
    });
  } catch {
    // On network error, roll back the optimistic update
    wasFav ? favorites.add(id) : favorites.delete(id);
    renderFilter();
    renderProjects();
  }
}

// ══ Relative date ══════════════════════════════════════════════════════════
function relativeDate(ts) {
  if (!ts) return null;
  const diff = Date.now() - ts;
  const m  = Math.floor(diff / 60000);
  const h  = Math.floor(diff / 3600000);
  const d  = Math.floor(diff / 86400000);
  const w  = Math.floor(d / 7);
  const mo = Math.floor(d / 30);
  const y  = Math.floor(d / 365);
  if (m < 1)   return { label: t('date.justNow'),                  recent: true };
  if (m < 60)  return { label: t('date.minutesAgo', { m }),        recent: true };
  if (h < 24)  return { label: t('date.hoursAgo', { h }),          recent: true };
  if (d < 2)   return { label: t('date.yesterday'),                 recent: true };
  if (d < 7)   return { label: t('date.daysAgo', { d }),           recent: false };
  if (w < 5)   return { label: t('date.weeksAgo', { w }),          recent: false };
  if (mo < 12) return { label: t('date.monthsAgo', { mo }),        recent: false };
  return       { label: t('date.yearsAgo', { y, yearPlural: y>1?'s':'' }), recent: false };
}

function updatePortFilterBanner() {
  const bar   = document.getElementById('port-filter-bar');
  const label = document.getElementById('port-filter-label');
  if (activePortFilter !== null) {
    label.textContent = t('port.filterActive', { port: activePortFilter, count: portConflicts.get(activePortFilter)?.length || '?' });
    bar.classList.add('visible');
  } else {
    bar.classList.remove('visible');
  }
}

// ══ Port check ═════════════════════════════════════════════════════════════
async function checkPort(port, btn) {
  btn.classList.add('checking');
  const dot = btn.querySelector('.port-dot');
  dot.className = 'port-dot';
  try {
    const r = await fetch(`/api/port-check/${port}`);
    const { inUse } = await r.json();
    btn.classList.remove('checking');
    dot.className = `port-dot ${inUse ? 'in-use' : 'free'}`;
    btn.title = inUse ? t('port.inUse', { port }) : t('port.free', { port });
  } catch {
    btn.classList.remove('checking');
    dot.className = 'port-dot';
  }
}

// ══ Project type detection & icon ═════════════════════════════════════════

const PROJECT_TYPES = {
  web: {
    label: 'Web / Frontend',
    color: '#38bdf8',
    bg: 'rgba(56,189,248,.12)',
    svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  },
  api: {
    label: 'API / Backend',
    color: '#a78bfa',
    bg: 'rgba(167,139,250,.12)',
    svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`,
  },
  mobile: {
    label: 'Mobile',
    color: '#34d399',
    bg: 'rgba(52,211,153,.12)',
    svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`,
  },
  desktop: {
    label: 'Desktop',
    color: '#fb923c',
    bg: 'rgba(251,146,60,.12)',
    svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
  },
  cli: {
    label: 'CLI / Outil',
    color: '#22d3ee',
    bg: 'rgba(34,211,238,.12)',
    svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
  },
  service: {
    label: 'Service / Worker',
    color: '#f472b6',
    bg: 'rgba(244,114,182,.12)',
    svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>`,
  },
  script: {
    label: 'Script',
    color: '#facc15',
    bg: 'rgba(250,204,21,.12)',
    svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
  },
  lib: {
    label: 'Librairie / Package',
    color: '#94a3b8',
    bg: 'rgba(148,163,184,.12)',
    svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 2 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`,
  },
  multi: {
    label: 'Multi-composants',
    color: '#f472b6',
    bg: 'rgba(244,114,182,.12)',
    svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
  },
  unknown: {
    label: 'Projet',
    color: '#4d5580',
    bg: 'rgba(77,85,128,.12)',
    svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  },
};

// Translated label for a project type id (falls back to the hardcoded label).
function typeLabel(id) {
  const def = PROJECT_TYPES[id] || PROJECT_TYPES.unknown;
  const translated = t('type.label.' + id);
  return translated === 'type.label.' + id ? def.label : translated;
}

// ══ Known components registry ══════════════════════════════════════════════
const KNOWN_COMPONENTS = {
  node:           { label: 'Node.js',      color: '#f59e0b' },
  typescript:     { label: 'TypeScript',   color: '#3b82f6' },
  react:          { label: 'React',        color: '#61dafb' },
  next:           { label: 'Next.js',      color: '#e2e8f0' },
  vite:           { label: 'Vite',         color: '#a855f7' },
  vue:            { label: 'Vue.js',       color: '#41b883' },
  angular:        { label: 'Angular',      color: '#dd0031' },
  docker:         { label: 'Docker',       color: '#0ea5e9' },
  python:         { label: 'Python',       color: '#4ade80' },
  dotnet:         { label: '.NET',         color: '#a78bfa' },
  go:             { label: 'Go',           color: '#60a5fa' },
  rust:           { label: 'Rust',         color: '#fb923c' },
  electron:       { label: 'Electron',     color: '#9ecff5' },
  tauri:          { label: 'Tauri',        color: '#fca5a5' },
  'react-native': { label: 'React Native', color: '#34d399' },
  expo:           { label: 'Expo',         color: '#c2c2c2' },
  flutter:        { label: 'Flutter',      color: '#54c5f8' },
  make:           { label: 'Make',         color: '#94a3b8' },
  graphql:        { label: 'GraphQL',      color: '#e535ab' },
  redis:          { label: 'Redis',        color: '#dc2626' },
  postgres:       { label: 'PostgreSQL',   color: '#336791' },
  mongodb:        { label: 'MongoDB',      color: '#4db33d' },
  mysql:          { label: 'MySQL',        color: '#00758f' },
  sentry:         { label: 'Sentry',       color: '#f05032' },
  tailwind:       { label: 'Tailwind',     color: '#06b6d4' },
  sass:           { label: 'SASS',         color: '#cc6699' },
};
const COMPONENT_PICKER_ORDER = [
  'node','typescript','react','next','vite','vue','angular',
  'python','dotnet','go','rust',
  'docker','electron','tauri','react-native','expo','flutter',
  'make','graphql','redis','postgres','mongodb','mysql',
  'sentry','tailwind','sass',
];

function detectProjectType(p) {
  // Priority 1: manually saved type
  if (p.type) return p.type;
  if (p.typeOverride) return p.typeOverride;

  const comps = new Set(p.components || p.tags || []);
  const name   = (p.name || '').toLowerCase();
  const desc   = (p.description || '').toLowerCase();
  const cmds   = Object.values(p.commands || {});
  const cmdTxt = cmds.map(c => `${c.cmd || ''} ${c.label || ''}`).join(' ').toLowerCase();
  const nameCmdTxt = name + ' ' + desc + ' ' + cmdTxt;

  // Multi-component
  if (comps.has('multi')) return 'multi';

  // Desktop
  if (comps.has('electron') || comps.has('tauri')) return 'desktop';
  if (/electron|tauri/.test(nameCmdTxt)) return 'desktop';

  // Mobile
  if (comps.has('react-native') || comps.has('expo') || comps.has('flutter')) return 'mobile';
  if (/expo|react[\s-]native|flutter/.test(nameCmdTxt)) return 'mobile';

  // Service / worker keywords in name or commands
  if (/worker|daemon|cron|job|scheduler|consumer|listener|queue/.test(nameCmdTxt)) return 'service';

  // Node.js projects
  if (comps.has('node')) {
    const hasDevServer = cmds.some(c => /vite|webpack|next|nuxt|parcel|react-scripts/.test(c.cmd || ''));
    const hasPublish   = /publish|prepublish/.test(cmdTxt);
    if (hasPublish && !hasDevServer) return 'lib';

    if (comps.has('next') || comps.has('vite') || comps.has('react')) return 'web';
    if (/vue|angular|svelte|astro|nuxt|gatsby/.test(cmdTxt)) return 'web';
    if (hasDevServer) return 'web';

    if (/express|fastify|hapi|nest|koa|restify|nodemon|ts-node/.test(cmdTxt)) return 'api';
    if (cmds.some(c => c.port)) return 'api';
    return 'service';
  }

  // .NET
  if (comps.has('dotnet')) {
    if (/blazor|razor|mvc|maui|wpf|winform/.test(nameCmdTxt)) return /maui|wpf|winform/.test(nameCmdTxt) ? 'desktop' : 'web';
    return 'api';
  }

  // Python
  if (comps.has('python')) {
    if (/uvicorn|fastapi|flask|django|gunicorn/.test(cmdTxt)) return 'api';
    if (/streamlit|dash|gradio/.test(cmdTxt)) return 'web';
    if (cmds.length > 0 && cmds.some(c => c.port)) return 'api';
    return 'script';
  }

  // Go
  if (comps.has('go')) {
    if (/gin|echo|fiber|chi|mux|http|serve/.test(nameCmdTxt)) return 'api';
    return 'cli';
  }

  // Rust
  if (comps.has('rust')) {
    if (/axum|actix|warp|rocket/.test(cmdTxt)) return 'api';
    return 'cli';
  }

  // Docker seul (sans langage connu) → service
  if (comps.has('docker')) return 'service';

  // Make-only
  if (comps.has('make') && comps.size <= 2) return 'script';

  return 'unknown';
}

// Returns compatible/recommended/discouraged types for a project
function computeCompatibleTypes(p) {
  const comps = new Set(p.components || p.tags || []);
  const autoDetected = detectProjectType({ ...p, type: null, typeOverride: null });

  // Recommended types based on the tech stack
  const recommended = new Set([autoDetected]);

  if (comps.has('electron') || comps.has('tauri'))               recommended.add('desktop');
  if (comps.has('react-native') || comps.has('expo'))            recommended.add('mobile');
  if (comps.has('node') || comps.has('typescript')) {
    recommended.add('web'); recommended.add('api'); recommended.add('service');
    recommended.add('cli'); recommended.add('lib');
    if (comps.has('electron') || comps.has('tauri'))             recommended.add('desktop');
    if (comps.has('react-native') || comps.has('expo'))          recommended.add('mobile');
  }
  if (comps.has('dotnet')) {
    recommended.add('web'); recommended.add('api'); recommended.add('desktop');
    recommended.add('lib'); recommended.add('service');
  }
  if (comps.has('python')) {
    recommended.add('api'); recommended.add('web'); recommended.add('script');
    recommended.add('service'); recommended.add('cli'); recommended.add('lib');
  }
  if (comps.has('go') || comps.has('rust')) {
    recommended.add('api'); recommended.add('cli'); recommended.add('service'); recommended.add('lib');
  }
  if (comps.has('docker')) {
    recommended.add('service'); recommended.add('multi');
  }
  if (comps.has('make')) {
    recommended.add('script'); recommended.add('cli');
  }
  // If no known tech component → everything is possible
  const knownTech = ['node','dotnet','python','go','rust','docker','make','electron','tauri','react-native','expo','flutter'];
  if (!knownTech.some(t => comps.has(t))) {
    Object.keys(PROJECT_TYPES).forEach(t => recommended.add(t));
  }

  // Types not in recommended are "discouraged"
  const all = Object.keys(PROJECT_TYPES).filter(t => t !== 'unknown');
  const discouraged = all.filter(t => !recommended.has(t));

  return { autoDetected, recommended: [...recommended].filter(t => t !== 'unknown'), discouraged };
}

function typeIconHtml(p) {
  const type = detectProjectType(p);
  const def  = PROJECT_TYPES[type] || PROJECT_TYPES.unknown;
  return `<span class="ptype-icon" title="${typeLabel(type)}" style="color:${def.color};background:${def.bg}">${def.svg}</span>`;
}

// ══ Git icon ═══════════════════════════════════════════════════════════════
const GIT_ICONS = {
  github: {
    color: '#e2e8f0',
    tip: 'GitHub',
    svg: `<svg width="14" height="14" viewBox="0 0 98 96" fill="currentColor"><path d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"/></svg>`
  },
  gitlab: {
    color: '#fc6d26',
    tip: 'GitLab',
    svg: `<svg width="14" height="14" viewBox="0 0 380 380" fill="currentColor"><path d="M282.83 170.73l-.27-.69-26.14-68.22a6.81 6.81 0 00-2.67-3.14 7 7 0 00-8.12.43 7 7 0 00-2.31 3.38l-17.65 54H154.29l-17.65-54a6.86 6.86 0 00-2.31-3.38 7 7 0 00-8.12-.43 6.85 6.85 0 00-2.67 3.14L97.44 170l-.26.69a48.54 48.54 0 0016.1 56.1l.09.07.24.17 39.82 29.82 19.72 14.93 12 9.08a8.07 8.07 0 009.76 0l12-9.08 19.72-14.93 40.06-30 .1-.08a48.56 48.56 0 0016.04-56.04z"/></svg>`
  },
  'gitlab-self': {
    color: '#e24329',
    tip: 'GitLab (self-hosted)',
    svg: `<svg width="14" height="14" viewBox="0 0 380 380" fill="currentColor"><path d="M282.83 170.73l-.27-.69-26.14-68.22a6.81 6.81 0 00-2.67-3.14 7 7 0 00-8.12.43 7 7 0 00-2.31 3.38l-17.65 54H154.29l-17.65-54a6.86 6.86 0 00-2.31-3.38 7 7 0 00-8.12-.43 6.85 6.85 0 00-2.67 3.14L97.44 170l-.26.69a48.54 48.54 0 0016.1 56.1l.09.07.24.17 39.82 29.82 19.72 14.93 12 9.08a8.07 8.07 0 009.76 0l12-9.08 19.72-14.93 40.06-30 .1-.08a48.56 48.56 0 0016.04-56.04z"/></svg>`
  },
  azure: {
    color: '#0078d4',
    tip: 'Azure DevOps',
    svg: `<svg width="14" height="14" viewBox="0 0 32 32" fill="currentColor"><path d="M29 5.17L18.72 0l-9.53 5.75L2 9.71V22.3l5.29 2.97L25 10.73v14.14l-7.28 1.98L6 19.81v3.96L18.72 32 30 25.88V7.04z"/></svg>`
  },
  bitbucket: {
    color: '#0052cc',
    tip: 'Bitbucket',
    svg: `<svg width="14" height="14" viewBox="0 0 32 32" fill="currentColor"><path d="M1.64 2A1.64 1.64 0 000 3.82l4.39 24.89a1.65 1.65 0 001.61 1.37h20.1a1.64 1.64 0 001.63-1.37l4.27-24.9A1.64 1.64 0 0030.36 2zm17.46 18.59h-6.19l-1.67-8.74h9.48z"/></svg>`
  },
  git: {
    color: '#f05032',
    tip: 'Git (remote)',
    svg: `<svg width="14" height="14" viewBox="0 0 92 92" fill="currentColor"><path d="M90.156 41.965L50.035 1.844a5.918 5.918 0 00-8.369 0l-8.332 8.332 10.566 10.566a7.03 7.03 0 017.23 1.684 7.034 7.034 0 011.669 7.277l10.187 10.184a7.028 7.028 0 017.278 1.672 7.04 7.04 0 010 9.957 7.05 7.05 0 01-9.965 0 7.044 7.044 0 01-1.528-7.67l-9.504-9.502v25.016a7.044 7.044 0 011.86 1.197 7.04 7.04 0 010 9.957 7.05 7.05 0 01-9.965 0 7.04 7.04 0 010-9.957 7.038 7.038 0 012.055-1.432V33.3a7.038 7.038 0 01-2.055-1.432 7.044 7.044 0 01-1.508-7.71L29.976 13.621 1.844 41.753a5.918 5.918 0 000 8.37L41.966 90.24a5.918 5.918 0 008.369 0l39.821-39.905a5.92 5.92 0 000-8.37"/></svg>`
  },
  local: {
    color: '#94a3b8',
    tip: 'Git local (pas de remote)',
    svg: `<svg width="14" height="14" viewBox="0 0 92 92" fill="currentColor"><path d="M90.156 41.965L50.035 1.844a5.918 5.918 0 00-8.369 0l-8.332 8.332 10.566 10.566a7.03 7.03 0 017.23 1.684 7.034 7.034 0 011.669 7.277l10.187 10.184a7.028 7.028 0 017.278 1.672 7.04 7.04 0 010 9.957 7.05 7.05 0 01-9.965 0 7.044 7.044 0 01-1.528-7.67l-9.504-9.502v25.016a7.044 7.044 0 011.86 1.197 7.04 7.04 0 010 9.957 7.05 7.05 0 01-9.965 0 7.04 7.04 0 010-9.957 7.038 7.038 0 012.055-1.432V33.3a7.038 7.038 0 01-2.055-1.432 7.044 7.044 0 01-1.508-7.71L29.976 13.621 1.844 41.753a5.918 5.918 0 000 8.37L41.966 90.24a5.918 5.918 0 008.369 0l39.821-39.905a5.92 5.92 0 000-8.37"/></svg>`
  },
};

function gitIconHtml(git) {
  if (!git || !git.hasGit) return '';
  const def = GIT_ICONS[git.provider] || GIT_ICONS.git;
  const tip = git.url || git.remote || def.tip;
  const inner = `<span style="color:${def.color}">${def.svg}</span>`;

  if (git.url) {
    return `<a class="git-icon" href="${git.url}" target="_blank" rel="noopener"
      title="${(def.tip + '\n' + git.url).replace(/"/g,'&quot;')}"
      onclick="event.stopPropagation()">${inner}</a>`;
  }
  return `<span class="git-icon" title="${(def.tip).replace(/"/g,'&quot;')}">${inner}</span>`;
}

// ══ Port HTML helper ═══════════════════════════════════════════════════════
function portHtml(port) {
  const isConflict = portConflicts.has(port);
  const conflictCount = isConflict ? portConflicts.get(port).length : 0;
  const conflictBtn = isConflict
    ? `<button class="port-conflict-btn" title="${t('port.conflictTitle', { count: conflictCount, port })}" onclick="event.stopPropagation();filterByPort(${port})">⚠</button>`
    : '';
  return `<span class="port-wrap">` +
    `<a class="port-link" href="http://localhost:${port}" target="_blank" onclick="event.stopPropagation()">:${port}</a>` +
    `<button class="port-check-btn" title="${t('port.checkTitle', { port })}" onclick="event.stopPropagation();checkPort(${port},this)"><span class="port-dot"></span></button>` +
    conflictBtn +
    `</span>`;
}

// ══ Filter bar ═════════════════════════════════════════════════════════════
function renderFilter() {
  const counts = {};
  allProjects.forEach(p => (p.components||p.tags||[]).filter(t=>t!=='multi').forEach(t => counts[t]=(counts[t]||0)+1));
  const running = allProjects.filter(p=>p.runningCommands?.length>0).length;
  const favCount = allProjects.filter(p=>favorites.has(p.id)).length;

  document.getElementById('cnt-all').textContent = allProjects.length;
  document.getElementById('cnt-running').textContent = running;
  document.getElementById('cnt-favorites').textContent = favCount;
  const favBtn = document.getElementById('btn-filter-fav');
  if (favBtn) favBtn.style.display = favCount > 0 ? '' : 'none';


  const badge = document.getElementById('running-badge');
  if (running > 0) {
    badge.textContent = t('filter.running', { count: running });
    badge.classList.add('visible');
  } else {
    badge.classList.remove('visible');
  }

  const container = document.getElementById('tag-pills');
  container.innerHTML = Object.entries(counts)
    .sort((a,b)=>b[1]-a[1])
    .map(([tag,cnt]) => {
      const col = TAG_COLORS[tag] ? `style="--tc:${TAG_COLORS[tag]}"` : '';
      return `<button class="fp ${activeFilter===tag?'active':''}" data-tag="${tag}"
        onclick="setFilter('${tag}')" ${col}>${tag} <span class="cnt">${cnt}</span></button>`;
    }).join('');

  // Update active state
  document.querySelectorAll('.fp').forEach(el =>
    el.classList.toggle('active', el.dataset.tag === activeFilter));
}

function setFilter(tag) {
  activeFilter = tag;
  renderFilter();
  renderProjects();
}

// ══ Type filter bar ════════════════════════════════════════════════════════
function renderTypeBar() {
  // Compute which types are present in the current project list
  const typeCounts = {};
  allProjects.forEach(p => {
    const t = detectProjectType(p);
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });

  const pills = document.getElementById('type-pills');
  if (!pills) return;

  // Order: by count desc, then alphabetical
  const entries = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  pills.innerHTML = entries.map(([type, cnt]) => {
    const def = PROJECT_TYPES[type] || PROJECT_TYPES.unknown;
    const label = typeLabel(type);
    const isActive = activeTypes.has(type);
    return `<button class="tfp ${isActive ? 'active' : ''}"
      style="--type-color:${def.color};--type-bg:${def.bg}"
      onclick="toggleTypeFilter('${type}')"
      title="${label}">
      <span class="tfp-icon" style="color:${isActive ? def.color : 'var(--t3)'}">${def.svg}</span>
      ${label.split('/')[0].trim()}
      <span style="font-size:10px;opacity:.6">${cnt}</span>
    </button>`;
  }).join('');

  const clearBtn = document.getElementById('type-bar-clear');
  if (clearBtn) clearBtn.classList.toggle('visible', activeTypes.size > 0);
}

function toggleTypeFilter(type) {
  if (activeTypes.has(type)) {
    activeTypes.delete(type);
  } else {
    activeTypes.add(type);
  }
  renderTypeBar();
  renderProjects();
}

function clearTypeFilters() {
  activeTypes.clear();
  renderTypeBar();
  renderProjects();
}

// ══ Render projects ════════════════════════════════════════════════════════
function renderProjects() {
  const q = document.getElementById('search').value.toLowerCase().trim();
  const main = document.getElementById('main');

  let list = allProjects.filter(p => {
    if (activeFilter === 'running')   return p.runningCommands?.length > 0;
    if (activeFilter === 'favorites') return favorites.has(p.id);
    const stack = p.components || p.tags || [];
    if (activeFilter !== 'all' && !stack.includes(activeFilter)) return false;
    // Type filter: cumulative OR (project matches any selected type)
    if (activeTypes.size > 0 && !activeTypes.has(detectProjectType(p))) return false;
    // Category filter: cumulative OR (project has any selected category)
    if (activeCatFilters.size > 0) {
      const projCats = new Set(catAssignments[p.id] || []);
      if (![...activeCatFilters].some(cid => projCats.has(cid))) return false;
    }
    if (activePortFilter !== null) {
      const hasPorts = Object.values(p.commands||{}).some(c => c.port === activePortFilter);
      if (!hasPorts) return false;
    }
    if (q && !p.name.toLowerCase().includes(q) &&
        !p.description?.toLowerCase().includes(q) &&
        !(p.components||p.tags||[]).some(t=>t.includes(q))) return false;
    return true;
  });

  // Update meta count
  const metaCount = document.getElementById('list-meta-count');
  if (metaCount) {
    const word = list.length !== 1 ? t('filter.projects') : t('filter.project');
    const ofPart = list.length < allProjects.length ? ` <span style="color:var(--t3)">${t('filter.of')} ${allProjects.length}</span>` : '';
    metaCount.innerHTML = `<strong>${list.length}</strong> ${word}${ofPart}`;
  }

  if (!list.length) {
    const emptyMsg = activeFilter === 'favorites'
      ? `<div class="empty"><div class="empty-icon">★</div>${t('filter.emptyFavorites')}<br><span style="font-size:11px">${t('filter.emptyFavoritesHint')}</span></div>`
      : `<div class="empty"><div class="empty-icon">🔍</div>${t('filter.emptySearch')}</div>`;
    main.innerHTML = emptyMsg;
    return;
  }

  // Favorites always at top, then running, then rest — sorted within each group
  const favList    = list.filter(p => favorites.has(p.id));
  const nonFavList = list.filter(p => !favorites.has(p.id));

  const favRunning = favList.filter(p => p.runningCommands?.length > 0);
  const favIdle    = applySort(favList.filter(p => !p.runningCommands?.length));
  const nfRunning  = nonFavList.filter(p => p.runningCommands?.length > 0);
  const nfIdle     = applySort(nonFavList.filter(p => !p.runningCommands?.length));

  let html = '';

  if (favList.length) {
    html += `<div class="section-label">${t('card.section.favorites')}</div>`;
    html += [...favRunning, ...favIdle].map(p => rowHtml(p)).join('');
  }
  if (nfRunning.length) {
    if (favList.length) html += `<div class="section-label" style="margin-top:8px">${t('card.section.running')}</div>`;
    else html += `<div class="section-label">${t('card.section.running')}</div>`;
    html += nfRunning.map(p => rowHtml(p)).join('');
  }
  if (nfIdle.length) {
    if (favList.length || nfRunning.length) html += `<div class="section-label" style="margin-top:8px">${t('card.section.projects')}</div>`;
    html += nfIdle.map(p => rowHtml(p)).join('');
  }

  main.innerHTML = html;
}

function rowHtml(p) {
  const isRunning = p.runningCommands?.length > 0;
  const cmds = Object.entries(p.commands||{});
  const expanded = expandedRows.has(p.id);

  // Source badge
  const badge = p.source==='multi'
    ? `<span class="badge badge-multi">multi</span>`
    : p.source==='auto'
    ? `<span class="badge badge-auto">auto</span>`
    : `<span class="badge badge-yml">.yml</span>`;

  // Composants (max 3 inline) — avec couleurs KNOWN_COMPONENTS
  const stack = (p.components||p.tags||[]).filter(t=>t!=='multi');
  const tags = stack.slice(0,3).map(t => {
    const kc = KNOWN_COMPONENTS[t];
    const style = kc ? `style="color:${kc.color};background:${kc.color}18;border-color:${kc.color}40"` : '';
    const label = kc ? kc.label : t;
    return `<span class="ptag ptag-${t}" ${style} onclick="event.stopPropagation();setFilter('${t}')" title="${label}">${label}</span>`;
  }).join('');

  // Inline actions: show max 2 primary cmds + expand if more
  const inlineActions = buildInlineActions(p, cmds);

  // Expanded section
  const expandedHtml = expanded ? buildExpanded(p, cmds) : '';

  const shortPath = p.path.replace(/.*\/dev\//, '~/dev/');
  const act = p.lastActivity?.ts ? relativeDate(p.lastActivity.ts) : null;
  const isFav = favorites.has(p.id);
  const catsHtml = catChipsHtml(p.id);
  const dateTip = act ? ` title="${new Date(p.lastActivity.ts).toLocaleString('fr-FR')} · ${p.lastActivity.source}"` : '';

  return `
<div class="prow ${isRunning?'has-running':''} ${isFav?'is-fav':''}" id="prow-${p.id}">
  <div class="prow-main">

    <!-- col 1 : status + type icon -->
    <div class="col-icon">
      <span class="sdot"></span>
      ${typeIconHtml(p)}
    </div>

    <!-- col 2 : nom + git + badge -->
    <div class="col-name">
      <span class="prow-name">${p.name}</span>
      ${gitIconHtml(p.git)}
      ${badge}
    </div>

    <!-- col 3: path -->
    <span class="col-path" title="${p.path}">${shortPath}</span>

    <!-- col 4: activity date -->
    <span class="col-date ${act?.recent?'recent':''}"${dateTip}>${act?act.label:''}</span>

    <!-- col 5: buttons -->
    <div class="prow-actions" id="actions-${p.id}">
      ${inlineActions}
      <button class="cbtn fav-btn ${isFav?'active':''}" onclick="event.stopPropagation();toggleFavorite('${p.id}')" title="${isFav?t('card.favRemove'):t('card.favAdd')}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="${isFav?'currentColor':'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      </button>
      <button class="cbtn folder-btn" onclick="openFolder('${p.id}')" title="${t('card.openFolder')}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      </button>
      ${(()=>{const ide=getProjectIde(p);return`<span class="editor-btn-wrap"><button class="cbtn editor-btn" onclick="openEditor('${p.id}')" title="${t('card.openInIde',{name:ide.name})}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>${ide.name}</button><button class="cbtn editor-chevron" onclick="event.stopPropagation();showIdePicker('${p.id}',this)" title="${t('card.changeEditor')}">▾</button></span>`;})()}
      <button class="cbtn edit-btn" onclick="editProject('${p.id}')" title="${t('card.editProject')}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="cbtn del-btn" onclick="deleteProject('${p.id}','${p.name.replace(/'/g,"\\'")}',event)" title="${t('card.deleteProject')}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      </button>
    </div>

  </div>

  <!-- row 2: tags + categories (always present for the + button) -->
  <div class="prow-meta">
    ${tags ? `<div class="prow-tags">${tags}</div>` : ''}
    ${catsHtml}
  </div>

  ${expanded ? `<div class="prow-expanded">${expandedHtml}</div>` : ''}
</div>`;
}

function buildInlineActions(p, cmds) {
  if (!cmds.length) return `<span style="font-size:11px;color:var(--t3)">${t('card.noCommands')}</span>`;

  let html = '';
  const isMulti = p.source === 'multi';

  if (isMulti) {
    // Multi: show running commands inline + expand
    const runningCmds = cmds.filter(([k])=>p.runningCommands?.includes(k));
    if (runningCmds.length) {
      runningCmds.slice(0,2).forEach(([key,cmd])=>{
        const iid = `${p.id}__${key}`;
        html += `<button class="cbtn running-btn" onclick="openTab('${iid}')">📋 ${cmd.label||key}</button>`;
        html += `<button class="cbtn stop-btn" onclick="stopCmd('${p.id}','${key}','${iid}')">■ Stop</button>`;
      });
    }
    html += `<button class="cbtn expand-btn ${expandedRows.has(p.id)?'open':''}"
      onclick="toggleExpand('${p.id}')">···</button>`;
    return html;
  }

  // Simple: first 2 commands inline
  const primary = cmds.slice(0,2);
  primary.forEach(([key,cmd],i) => {
    const iid = `${p.id}__${key}`;
    const isRun = p.runningCommands?.includes(key);
    if (isRun) {
      html += `<button class="cbtn running-btn" onclick="openTab('${iid}')">📋 Logs</button>`;
      html += `<button class="cbtn stop-btn" onclick="stopCmd('${p.id}','${key}','${iid}')">■ Stop</button>`;
    } else {
      const cls = i===0?'primary':'';
      const tip = cmd.description ? ` title="${cmd.description.replace(/"/g,'&quot;')}"` : '';
      html += `<button class="cbtn ${cls}"${tip} onclick="launch('${p.id}','${key}','${iid}')">▶ ${cmd.label||key}</button>`;
    }
    if (cmd.port) html += portHtml(cmd.port);
  });

  if (cmds.length > 2) {
    html += `<button class="cbtn expand-btn ${expandedRows.has(p.id)?'open':''}"
      onclick="toggleExpand('${p.id}')">···</button>`;
  }
  return html;
}

function buildExpanded(p, cmds) {
  if (!cmds.length) return '';

  const subProj = p.subProjects || (p.source === 'multi' ? [] : []);
  if (p.source === 'multi' && subProj.length) {
    let html = '';
    // Docker commands at parent level
    const dockerCmds = cmds.filter(([k])=>k.startsWith('docker-'));
    if (dockerCmds.length) {
      html += `<div class="comp-group">
        <div class="comp-group-label">🐳 Orchestration</div>
        <div class="exp-cmd-list">${dockerCmds.map(([k,cmd])=>expCmdHtml(p,k,cmd)).join('')}</div>
      </div>`;
    }
    for (const comp of subProj) {
      const cc = cmds.filter(([k])=>k.startsWith(`${comp}-`));
      if (!cc.length) continue;
      html += `<div class="comp-group">
        <div class="comp-group-label">${comp}</div>
        <div class="exp-cmd-list">${cc.map(([k,cmd])=>expCmdHtml(p,k,cmd)).join('')}</div>
      </div>`;
    }
    return html;
  }

  // Simple: all commands
  return `<div class="exp-cmd-list">${cmds.map(([k,cmd])=>expCmdHtml(p,k,cmd)).join('')}</div>`;
}

function expCmdHtml(p, key, cmd) {
  const iid = `${p.id}__${key}`;
  const isRun = p.runningCommands?.includes(key);
  if (isRun) {
    return `<div class="exp-cmd is-running">
      <span class="ec-label">● ${cmd.label||key}</span>
      ${cmd.port?`<span class="ec-port">${portHtml(cmd.port)}</span>`:''}
      <div class="ec-actions">
        <button class="ec-logs" onclick="openTab('${iid}')">Logs</button>
        <button class="ec-stop" onclick="stopCmd('${p.id}','${key}','${iid}')">■ Stop</button>
      </div>
    </div>`;
  }
  const expTip = cmd.description ? ` title="${cmd.description.replace(/"/g,'&quot;')}"` : '';
  return `<div class="exp-cmd"${expTip} onclick="launch('${p.id}','${key}','${iid}')">
    <span style="color:var(--ac);opacity:.7">▶</span>
    <span class="ec-label">${cmd.label||key}</span>
    ${cmd.port?`<span class="ec-port">${portHtml(cmd.port)}</span>`:''}
  </div>`;
}

function toggleExpand(pid) {
  if (expandedRows.has(pid)) expandedRows.delete(pid);
  else expandedRows.add(pid);
  renderProjects();
}

// ══ Launch / Stop ══════════════════════════════════════════════════════════
async function launch(projectId, commandKey, iid) {
  try {
    const r = await fetch('/api/launch', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({projectId, commandKey})
    });
    const data = await r.json();
    if (!r.ok) { alert(data.error||t('common.error')); return; }
    await loadProjects();
    openTab(iid);
  } catch(e){ alert(e.message) }
}

async function stopCmd(projectId, commandKey, iid) {
  await fetch('/api/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({instanceId:iid})});
  setTimeout(loadProjects, 400);
}

// ══ Terminal ════════════════════════════════════════════════════════════════
function openTab(iid) {
  if (!terminalOpen) toggleTerminal();
  if (!tabs.has(iid)) {
    const project = allProjects.find(p => iid.startsWith(p.id+'__'));
    const cmdKey  = iid.replace((project?.id||'')+'__','');
    const cmd     = project?.commands?.[cmdKey];
    tabs.set(iid, {
      projectName: project?.name || iid,
      cmdLabel: cmd?.label || cmdKey,
      logs: [], es: null, running: true
    });
    startTabStream(iid);
  }
  activeTabId = iid;
  renderTabs();
  renderTermBody();
}

function startTabStream(iid) {
  const tab = tabs.get(iid);
  if (!tab) return;
  const es = new EventSource(`/api/logs/${iid}`);
  tab.es = es;
  es.onmessage = e => {
    const line = JSON.parse(e.data);
    tab.logs.push(line);
    if (activeTabId===iid) appendTermLine(line);
  };
  es.addEventListener('exit', e => {
    tab.running = false;
    renderTabs();
    setTimeout(loadProjects, 300);
    es.close();
  });
  es.onerror = () => { tab.running=false; es.close(); };
}

function renderTabs() {
  const wrap = document.getElementById('term-tabs');
  wrap.innerHTML = [...tabs.entries()].map(([id,t]) => `
    <button class="ttab ${id===activeTabId?'active':''}" onclick="event.stopPropagation();switchTab('${id}')">
      <span class="t-dot ${t.running?'':'dead'}"></span>
      ${t.projectName} · ${t.cmdLabel}
      <button class="t-close" onclick="event.stopPropagation();closeTab('${id}')">✕</button>
    </button>`).join('');
}

function switchTab(id) {
  activeTabId = id;
  renderTabs();
  renderTermBody();
}

function closeTab(id) {
  const t = tabs.get(id);
  if (t?.es) t.es.close();
  tabs.delete(id);
  if (activeTabId===id) {
    const keys = [...tabs.keys()];
    activeTabId = keys[keys.length-1]||null;
  }
  renderTabs();
  if (activeTabId) renderTermBody();
  else document.getElementById('term-body').innerHTML=`<div class="term-empty">${t('terminal.empty')}</div>`;
}

function renderTermBody() {
  const body = document.getElementById('term-body');
  const tab  = tabs.get(activeTabId);
  if (!tab) { body.innerHTML=`<div class="term-empty">${t('terminal.noLog')}</div>`; return; }
  body.innerHTML = tab.logs.map(l=>termLine(l)).join('');
  body.scrollTop = body.scrollHeight;
}

function appendTermLine(line) {
  const body = document.getElementById('term-body');
  const empty = body.querySelector('.term-empty');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.innerHTML = termLine(line);
  body.appendChild(div.firstChild||div);
  body.scrollTop = body.scrollHeight;
}

// Basic ANSI → HTML
function termLine(line) {
  const text = ansiToHtml(line.data.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));
  return `<div class="${line.type}">${text}</div>`;
}
function ansiToHtml(s) {
  const map = {
    '1':'a-bold','2':'a-dim',
    '30':'a-black','31':'a-red','32':'a-green','33':'a-yellow',
    '34':'a-blue','35':'a-magenta','36':'a-cyan','37':'a-white',
    '91':'a-bred','92':'a-bgreen','94':'a-bblue',
  };
  return s.replace(/\x1b\[([0-9;]*)m/g,(_, codes) => {
    if (!codes||codes==='0') return '</span><span>';
    const cls = codes.split(';').map(c=>map[c]).filter(Boolean).join(' ');
    return cls ? `<span class="${cls}">` : '';
  });
}

function clearTerminal() {
  if (!activeTabId) return;
  const tab = tabs.get(activeTabId);
  if (tab) { tab.logs=[]; renderTermBody(); }
}

function toggleTerminal() {
  terminalOpen = !terminalOpen;
  document.getElementById('terminal').classList.toggle('collapsed',!terminalOpen);
  document.getElementById('term-toggle').textContent = terminalOpen?'▼':'▲';
}

// ══ Scan ═══════════════════════════════════════════════════════════════════
function startScan() {
  const btn = document.getElementById('btn-scan');
  const overlay = document.getElementById('scan-overlay');
  const log = document.getElementById('so-log');
  const spinner = document.getElementById('so-spinner');
  const text = document.getElementById('so-text');
  const footer = document.getElementById('so-footer');
  const results = document.getElementById('so-results');

  log.innerHTML=''; footer.style.display='none';
  results.innerHTML=''; results.classList.remove('visible');
  spinner.className='so-spinner'; text.innerHTML=t('scan.inProgress');
  overlay.classList.add('open');
  btn.disabled=true; btn.classList.add('spinning');

  if (activeScanEs) activeScanEs.close();
  const es = new EventSource('/api/scan-stream');
  activeScanEs = es;
  let found = 0;

  es.onmessage = e => {
    const {type, message} = JSON.parse(e.data);
    if (type==='found') found++;
    if (type==='explore') text.innerHTML = `↳ <strong>${message.split('   ')[0]}</strong>`;
    if (type==='found')   text.innerHTML = `✅ <strong>${message.split('   ')[0]}</strong>`;
    const div = document.createElement('div');
    div.className = `l-${type}`;
    div.textContent = message;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  };

  es.addEventListener('projects', e => {
    const scanProjects = JSON.parse(e.data);
    const newCount = scanProjects.filter(p => !p.imported).length;
    spinner.className='so-spinner done';
    text.innerHTML=t('scan.done');
    footer.style.display='flex';
    document.getElementById('so-footer-text').innerHTML= t('scan.footer', {
        found: `<strong style="color:var(--tx)">${found}</strong>`,
        foundPlural: found!==1?'s':'',
        newPhrase: t(newCount===1?'scan.newOne':'scan.newMany', {
          count: `<strong style="color:${newCount>0?'var(--ac)':'var(--t2)'}">${newCount}</strong>`
        }),
      });
    const importAllBtn = document.getElementById('so-import-all');
    if (newCount > 0) importAllBtn.classList.add('visible');
    else importAllBtn.classList.remove('visible');
    btn.disabled=false; btn.classList.remove('spinning');
    renderScanResults(scanProjects);
    es.close();
  });

  es.onerror = () => {
    text.innerHTML=`<span style="color:var(--rd)">${t('scan.error')}</span>`;
    spinner.className='so-spinner done';
    btn.disabled=false; btn.classList.remove('spinning');
    es.close();
  };
}

// Store scan results for import actions
let lastScanResults = [];

function renderScanResults(scanProjectsList) {
  lastScanResults = scanProjectsList;
  const results = document.getElementById('so-results');
  if (!scanProjectsList.length) return;
  results.classList.add('visible');
  const newItems = scanProjectsList.filter(p => !p.imported);
  const importedItems = scanProjectsList.filter(p => p.imported);
  let html = '';
  if (newItems.length) {
    html += `<div class="so-results-header">${t('scan.newHeader', { count: newItems.length })}</div>`;
    html += newItems.map((p, _) => {
      const i = scanProjectsList.indexOf(p);
      const shortPath = p.path.replace(/.*\/dev\//, '~/dev/');
      return `<div class="so-result-item">
        <span class="so-ri-name" title="${escHtml(p.path)}">${escHtml(p.name)}</span>
        <span class="so-ri-path" title="${escHtml(p.path)}">${escHtml(shortPath)}</span>
        <button class="so-ri-btn" onclick="importFromScan(${i})">${t('scan.importBtn')}</button>
      </div>`;
    }).join('');
  }
  if (importedItems.length) {
    html += `<div class="so-results-header" style="margin-top:${newItems.length?'0':'0'}">${t('scan.alreadyHeader', { count: importedItems.length })}</div>`;
    html += importedItems.map(p => {
      const shortPath = p.path.replace(/.*\/dev\//, '~/dev/');
      return `<div class="so-result-item">
        <span class="so-ri-name" title="${escHtml(p.path)}">${escHtml(p.name)}</span>
        <span class="so-ri-path" title="${escHtml(p.path)}">${escHtml(shortPath)}</span>
        <span class="so-ri-badge imported">${t('scan.importedBadge')}</span>
      </div>`;
    }).join('');
  }
  results.innerHTML = html;
}

function importFromScan(idx) {
  const p = lastScanResults[idx];
  if (!p) return;
  closeScan();
  openImportPanel({ mode: 'new', prefill: p });
}

function importAllFromScan() {
  const newProjects = lastScanResults.filter(p => !p.imported);
  if (!newProjects.length) return;
  closeScan();
  // Open the first project to import (the rest will be handled manually)
  openImportPanel({ mode: 'new', prefill: newProjects[0] });
}

function onScanOverlayClick(e) {
  if (e.target === document.getElementById('scan-overlay')) closeScan();
}

async function openFolder(projectId) {
  await fetch('/api/open-folder', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ projectId })
  });
}

async function openEditor(projectId, ideId) {
  try {
    const r = await fetch('/api/open-editor', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ projectId, ideId }),
    });
    if (!r.ok) {
      const d = await r.json();
      const ide = idesList.find(i=>i.id===(ideId||defaultIdeId));
      alert(t('editor.cantOpen', { name: ide?.name||ide?.cmd||'code', error: d.error, cmd: ide?.cmd||'code' }));
    }
  } catch(e) { alert(e.message); }
}

let idePickerTarget = null;
function showIdePicker(projectId, anchor) {
  const picker = document.getElementById('ide-picker');
  closeIdePicker();
  if (!idesList.length) return;

  const proj = allProjects.find(p=>p.id===projectId);
  const currentId = proj?.ideId || defaultIdeId;

  picker.innerHTML = idesList.map(ide => `
    <div class="ide-pick-item ${ide.id===currentId?'current':''}"
         onclick="pickIde('${projectId}','${ide.id}')">
      ${ide.name}
      <span class="ide-settings-cmd" style="margin-left:4px">${ide.cmd}</span>
      ${ide.id===currentId?'<span class="ip-check">✓</span>':''}
    </div>
  `).join('') + `
    <div class="ide-pick-sep"></div>
    <div class="ide-pick-item" onclick="pickIde('${projectId}',null)" style="color:var(--t3);font-size:11px">
      ${t('ide.useDefault', { name: idesList.find(i=>i.id===defaultIdeId)?.name||defaultIdeId })}
    </div>
  `;

  const rect = anchor.getBoundingClientRect();
  picker.style.top  = (rect.bottom + 4) + 'px';
  picker.style.left = Math.min(rect.left, window.innerWidth - 180) + 'px';
  picker.classList.add('open');
  idePickerTarget = projectId;
}

async function pickIde(projectId, ideId) {
  closeIdePicker();
  const proj = allProjects.find(p=>p.id===projectId);
  if (proj) proj.ideId = ideId || undefined;
  renderProjects();
  await fetch(`/api/projects/${encodeURIComponent(projectId)}/ide`, {
    method:'PATCH', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ ideId }),
  });
}

function closeIdePicker() {
  document.getElementById('ide-picker').classList.remove('open');
  idePickerTarget = null;
}

function closeScan() {
  document.getElementById('scan-overlay').classList.remove('open');
  if (activeScanEs) { activeScanEs.close(); activeScanEs=null; }
  document.getElementById('btn-scan').disabled=false;
  document.getElementById('btn-scan').classList.remove('spinning');
}

// ══ Categories ════════════════════════════════════════════════════════════

const CAT_PALETTE = [
  '#6366f1','#8b5cf6','#ec4899','#f43f5e',
  '#f97316','#f59e0b','#22c55e','#10b981',
  '#06b6d4','#3b82f6','#64748b','#94a3b8',
];

let allCategories  = [];   // [ {id, name, color} ]
let catAssignments = {};   // { projectId: [catId, ...] }
let activeCatFilters = new Set();

async function loadCategories() {
  try {
    const r = await fetch('/api/categories');
    const data = await r.json();
    allCategories  = data.categories  || [];
    catAssignments = data.assignments || {};
    renderCatBar();
    renderSettingsCats();
  } catch(e) { console.warn(e); }
}

// ── Category filter bar ────────────────────────────────────────────────────
function renderCatBar() {
  const pills = document.getElementById('cat-pills');
  if (!pills) return;

  if (!allCategories.length) {
    pills.innerHTML = `<span class="cat-bar-empty">${t('cat.empty')}</span>`;
    document.getElementById('cat-bar-clear')?.classList.remove('visible');
    return;
  }

  // Count projects per category
  const counts = {};
  allProjects.forEach(p => {
    (catAssignments[p.id] || []).forEach(cid => { counts[cid] = (counts[cid]||0)+1; });
  });

  pills.innerHTML = allCategories.map(cat => {
    const cnt = counts[cat.id] || 0;
    const isActive = activeCatFilters.has(cat.id);
    const bg = hexToRgba(cat.color, .12);
    return `<button class="cfp ${isActive?'active':''}"
      style="--cat-color:${cat.color};--cat-bg:${bg}"
      onclick="toggleCatFilter('${cat.id}')">
      <span class="cfp-dot" style="background:${cat.color}"></span>
      ${escHtml(cat.name)}
      <span style="font-size:10px;opacity:.5">${cnt}</span>
    </button>`;
  }).join('');

  document.getElementById('cat-bar-clear')?.classList.toggle('visible', activeCatFilters.size > 0);
}

function toggleCatFilter(catId) {
  if (activeCatFilters.has(catId)) activeCatFilters.delete(catId);
  else activeCatFilters.add(catId);
  renderCatBar();
  renderProjects();
}

function clearCatFilters() {
  activeCatFilters.clear();
  renderCatBar();
  renderProjects();
}

// ── Category chips on project row ─────────────────────────────────────────
function catChipsHtml(projectId) {
  const assigned = (catAssignments[projectId] || [])
    .map(cid => allCategories.find(c => c.id === cid)).filter(Boolean);
  const chips = assigned.map(cat => {
    const bg = hexToRgba(cat.color, .15);
    return `<span class="cat-chip" style="background:${bg};color:${cat.color};border-color:${hexToRgba(cat.color,.3)}"
      onclick="event.stopPropagation();toggleCatFilter('${cat.id}')" title="${t('cat.filterBy', { name: escHtml(cat.name) })}">
      <span class="cat-chip-dot" style="background:${cat.color}"></span>
      ${escHtml(cat.name)}
    </span>`;
  }).join('');
  return `<span class="prow-cats">
    ${chips}
    <button class="cat-assign-btn" title="${t('cat.assignTitle')}"
      onclick="event.stopPropagation();openCatPopover('${projectId}',this)">+</button>
  </span>`;
}

// ── Category assignment popover ───────────────────────────────────────────
let popoverProjectId = null;

function openCatPopover(projectId, anchor) {
  popoverProjectId = projectId;
  const pop = document.getElementById('cat-popover');
  if (!pop) return;

  const assigned = new Set(catAssignments[projectId] || []);
  let html = '';

  if (!allCategories.length) {
    html = `<div class="cat-pop-empty">${t('cat.popEmpty').replace('\n','<br>')}</div>`;
  } else {
    html = allCategories.map(cat => {
      const isAssigned = assigned.has(cat.id);
      return `<div class="cat-pop-item ${isAssigned?'assigned':''}" onclick="toggleProjectCat('${projectId}','${cat.id}',${isAssigned})">
        <span style="width:8px;height:8px;border-radius:50%;background:${cat.color};flex-shrink:0;display:inline-block"></span>
        ${escHtml(cat.name)}
        ${isAssigned ? `<span class="check">✓</span>` : ''}
      </div>`;
    }).join('');
  }

  html += `<div class="cat-pop-sep"></div>
    <div class="cat-pop-new">
      <input id="pop-new-cat" type="text" placeholder="${t('cat.popPlaceholder')}" onkeydown="if(event.key==='Enter')quickCreateCat('${projectId}')"/>
      <button onclick="quickCreateCat('${projectId}')">+</button>
    </div>`;

  pop.innerHTML = html;

  // Position near anchor
  const rect = anchor.getBoundingClientRect();
  pop.style.top  = (rect.bottom + 6) + 'px';
  pop.style.left = Math.max(8, rect.left - 160) + 'px';
  pop.classList.add('open');

  setTimeout(() => document.getElementById('pop-new-cat')?.focus(), 50);
}

function closeCatPopover() {
  document.getElementById('cat-popover')?.classList.remove('open');
  popoverProjectId = null;
}

async function toggleProjectCat(projectId, catId, isAssigned) {
  const action = isAssigned ? 'remove' : 'add';
  await fetch('/api/categories/assign', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ projectId, categoryId: catId, action }),
  });
  await loadCategories();
  // Re-open popover
  const btn = document.querySelector(`[id="prow-${projectId}"] .cat-assign-btn`);
  if (btn) openCatPopover(projectId, btn);
  else closeCatPopover();
  renderProjects();
}

async function quickCreateCat(projectId) {
  const input = document.getElementById('pop-new-cat');
  const name = input?.value.trim();
  if (!name) return;
  // Pick a color not yet used
  const usedColors = new Set(allCategories.map(c => c.color));
  const color = CAT_PALETTE.find(c => !usedColors.has(c)) || CAT_PALETTE[allCategories.length % CAT_PALETTE.length];
  const r = await fetch('/api/categories', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ name, color }),
  });
  const data = await r.json();
  allCategories  = data.categories  || [];
  catAssignments = data.assignments || {};
  // Auto-assign to current project
  const newCat = allCategories.find(c => c.name === name);
  if (newCat) await toggleProjectCat(projectId, newCat.id, false);
  else { renderCatBar(); renderSettingsCats(); }
}

// ── Category management in settings ──────────────────────────────────────
function renderSettingsCats() {
  const list = document.getElementById('settings-cat-list');
  if (!list) return;
  if (!allCategories.length) {
    list.innerHTML = `<p style="font-size:11px;color:var(--t3)">${t('cat.noCategories')}</p>`;
    return;
  }
  list.innerHTML = allCategories.map(cat => `
    <div class="cat-settings-row" id="cat-row-${cat.id}">
      <span class="cat-settings-dot" style="background:${cat.color}" title="${t('cat.changeColor')}"
        onclick="openColorPicker('${cat.id}',this)"></span>
      <input class="cat-settings-name" value="${escHtml(cat.name)}"
        onblur="renameCat('${cat.id}',this.value)"
        onkeydown="if(event.key==='Enter')this.blur()"/>
      <button class="cat-settings-del" onclick="deleteCat('${cat.id}')" title="${t('ide.delete')}">✕</button>
    </div>`).join('');
}

async function addCategoryFromSettings() {
  const input = document.getElementById('new-cat-name');
  const name = input?.value.trim();
  if (!name) return;
  const usedColors = new Set(allCategories.map(c => c.color));
  const color = CAT_PALETTE.find(c => !usedColors.has(c)) || CAT_PALETTE[allCategories.length % CAT_PALETTE.length];
  const r = await fetch('/api/categories', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ name, color }),
  });
  const data = await r.json();
  allCategories  = data.categories  || [];
  catAssignments = data.assignments || {};
  input.value = '';
  renderCatBar();
  renderSettingsCats();
  renderProjects();
}

async function renameCat(id, newName) {
  if (!newName.trim()) return;
  const cat = allCategories.find(c => c.id === id);
  if (!cat || cat.name === newName.trim()) return;
  await fetch('/api/categories', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ id, name: newName.trim(), color: cat.color }),
  });
  await loadCategories();
  renderProjects();
}

async function deleteCat(id) {
  if (!confirm(t('confirm.deleteCat'))) return;
  await fetch(`/api/categories/${id}`, { method:'DELETE' });
  await loadCategories();
  activeCatFilters.delete(id);
  renderProjects();
}

let colorPickerCatId = null;
function openColorPicker(catId, anchor) {
  // Remove existing
  document.querySelectorAll('.cat-color-picker').forEach(el => el.remove());
  colorPickerCatId = catId;
  const cat = allCategories.find(c => c.id === catId);
  const picker = document.createElement('div');
  picker.className = 'cat-color-picker';
  picker.innerHTML = CAT_PALETTE.map(c =>
    `<span class="cat-swatch ${cat?.color===c?'sel':''}" style="background:${c}"
      onclick="applyColor('${catId}','${c}')"></span>`
  ).join('');
  const rect = anchor.getBoundingClientRect();
  picker.style.top  = (rect.bottom + 4) + 'px';
  picker.style.left = rect.left + 'px';
  document.body.appendChild(picker);
  setTimeout(() => document.addEventListener('click', closeColorPicker, { once:true }), 10);
}
async function applyColor(catId, color) {
  const cat = allCategories.find(c => c.id === catId);
  if (!cat) return;
  await fetch('/api/categories', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ id: catId, name: cat.name, color }),
  });
  await loadCategories();
  renderProjects();
}
function closeColorPicker() {
  document.querySelectorAll('.cat-color-picker').forEach(el => el.remove());
}

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

// ══ Settings panel ════════════════════════════════════════════════════════
async function openSettings() {
  document.getElementById('btn-settings').classList.add('active');
  document.getElementById('settings-overlay').classList.add('open');
  document.getElementById('settings-msg').className = 'settings-msg';
  await loadCategories();
  // Load current settings from server
  try {
    const r = await fetch('/api/settings');
    const s = await r.json();
    renderDevRoots(s.devRoots);
    document.getElementById('cfg-scanDepth').value  = s.scanDepth ?? 5;
    document.getElementById('cfg-ignoreDirs').value = (s.ignoreDirs || []).join(', ');
    // Load IDEs
    idesList      = s.ides      || idesList;
    defaultIdeId  = s.defaultIde || defaultIdeId;
    renderIdeSettings();
  } catch(e) { console.warn(e); }
  await populateLangSelector();
  // Version de l'application (About)
  try {
    const v = await fetch('/api/version').then(r => r.json());
    const el = document.getElementById('about-version');
    if (el) el.textContent = t('about.version', { version: v.version });
  } catch (e) { console.warn(e); }
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('open');
  document.getElementById('btn-settings').classList.remove('active');
}

function onSettingsOverlayClick(e) {
  if (e.target === document.getElementById('settings-overlay')) closeSettings();
}

async function saveSettings() {
  const btn = document.getElementById('settings-save');
  const msg = document.getElementById('settings-msg');
  msg.className = 'settings-msg';

  const devRoots = [...document.querySelectorAll('#cfg-devRoots-list .dev-root-input')]
    .map(i => i.value.trim()).filter(Boolean);
  const scanDepth = parseInt(document.getElementById('cfg-scanDepth').value, 10);
  const ignoreDirsRaw = document.getElementById('cfg-ignoreDirs').value;
  const ignoreDirs = ignoreDirsRaw.split(',').map(s => s.trim()).filter(Boolean);

  if (devRoots.length === 0) {
    document.querySelectorAll('#cfg-devRoots-list .dev-root-input').forEach(i => i.classList.add('error'));
    msg.textContent = t('error.devRootsEmpty');
    msg.className = 'settings-msg err';
    return;
  }
  document.querySelectorAll('#cfg-devRoots-list .dev-root-input').forEach(i => i.classList.remove('error'));

  btn.disabled = true;
  btn.textContent = t('common.saving');
  try {
    const r = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ devRoots, scanDepth, ignoreDirs, ides: idesList, defaultIde: defaultIdeId }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || t('common.serverError'));

    msg.textContent = t('settings.saved');
    msg.className = 'settings-msg ok';
    btn.textContent = t('settings.save');
    btn.disabled = false;

    // Rescan and close after short delay
    setTimeout(() => {
      closeSettings();
      startScan();
    }, 800);
  } catch(e) {
    msg.textContent = '✗ ' + e.message;
    msg.className = 'settings-msg err';
    btn.textContent = t('settings.save');
    btn.disabled = false;
  }
}

// ══ Native folder picker ══════════════════════════════════════════════════

function devRootRowHtml(value) {
  const v = escHtml(value || '');
  return `<div class="settings-input-row dev-root-row" style="margin-bottom:6px">
    <input class="settings-input dev-root-input" type="text" value="${v}" placeholder="~/dev" data-i18n-placeholder="settings.devRoots.placeholder" spellcheck="false"/>
    <button class="btn-pick-folder" type="button" onclick="pickFolderIntoRow(this)" data-i18n-title="settings.devRoots.browse" title="Browse…">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
    </button>
    <button class="btn-pick-folder" type="button" onclick="removeDevRootRow(this)" data-i18n-title="settings.devRoots.remove" title="Remove this root">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>`;
}

function renderDevRoots(roots) {
  const list = document.getElementById('cfg-devRoots-list');
  const arr = (Array.isArray(roots) && roots.length) ? roots : [''];
  list.innerHTML = arr.map(devRootRowHtml).join('');
  applyTranslations();
}

function addDevRootRow() {
  const list = document.getElementById('cfg-devRoots-list');
  list.insertAdjacentHTML('beforeend', devRootRowHtml(''));
  applyTranslations();
}

function removeDevRootRow(btn) {
  const list = document.getElementById('cfg-devRoots-list');
  const row = btn.closest('.dev-root-row');
  if (row) row.remove();
  if (!list.querySelector('.dev-root-row')) addDevRootRow(); // never leave zero rows
}

function pickFolderIntoRow(btn) {
  const input = btn.closest('.dev-root-row')?.querySelector('.dev-root-input');
  if (input) pickFolderIntoElement(input);
}

async function pickFolderIntoElement(input) {
  const current = input?.value?.trim() || '';
  try {
    const url = '/api/pick-folder' + (current ? '?current=' + encodeURIComponent(current) : '');
    const r = await fetch(url);
    if (!r.ok) {
      // Web mode: the native picker is not available, let the user type manually
      return;
    }
    const data = await r.json();
    if (!data.canceled && data.path) {
      input.value = data.path;
      input.dispatchEvent(new Event('input'));
    }
  } catch { /* silent */ }
}

function pickFolderInto(inputId) {
  pickFolderIntoElement(document.getElementById(inputId));
}

// ══ IDE Settings ══════════════════════════════════════════════════════════

function renderIdeSettings() {
  const list = document.getElementById('settings-ide-list');
  if (!list) return;
  if (!idesList.length) {
    list.innerHTML = `<div style="color:var(--t3);font-size:12px;padding:4px 0">${t('ide.noEditor')}</div>`;
    return;
  }
  list.innerHTML = idesList.map((ide, i) => `
    <div class="ide-settings-row ${ide.id === defaultIdeId ? 'is-default' : ''}">
      <div style="display:flex;flex-direction:column;flex:1;min-width:0">
        <span class="ide-settings-name">${ide.name}</span>
        <span class="ide-settings-cmd">${ide.cmd}</span>
      </div>
      <button class="ide-settings-star ${ide.id === defaultIdeId ? 'active' : ''}"
              onclick="setDefaultIde('${ide.id}')"
              title="${ide.id === defaultIdeId ? t('ide.isDefault') : t('ide.setDefault')}">★</button>
      <button class="ide-settings-del" onclick="removeIde(${i})" title="${t('ide.delete')}">✕</button>
    </div>
  `).join('');
}

function setDefaultIde(id) {
  defaultIdeId = id;
  renderIdeSettings();
}

function removeIde(index) {
  idesList.splice(index, 1);
  if (!idesList.find(i => i.id === defaultIdeId) && idesList.length) {
    defaultIdeId = idesList[0].id;
  }
  renderIdeSettings();
}

function onIdePresetChange() {
  const val = document.getElementById('ide-preset-select').value;
  const customRow = document.getElementById('ide-custom-row');
  customRow.style.display = val === 'custom' ? 'flex' : 'none';
}

function addIdeFromPreset() {
  const sel = document.getElementById('ide-preset-select');
  const val = sel.value;
  if (!val) return;

  let ide;
  if (val === 'custom') {
    const name = document.getElementById('ide-custom-name').value.trim();
    const cmd  = document.getElementById('ide-custom-cmd').value.trim();
    if (!name || !cmd) return;
    const id = 'custom_' + Date.now();
    ide = { id, name, cmd };
    document.getElementById('ide-custom-name').value = '';
    document.getElementById('ide-custom-cmd').value  = '';
    document.getElementById('ide-custom-row').style.display = 'none';
  } else {
    const preset = IDE_PRESETS[val];
    if (!preset) return;
    if (idesList.find(i => i.id === val)) { sel.value = ''; return; } // already present
    ide = { id: val, ...preset };
  }

  idesList.push(ide);
  if (idesList.length === 1) defaultIdeId = ide.id;
  sel.value = '';
  renderIdeSettings();
}

// ══ Import Panel ══════════════════════════════════════════════════════════

const IMPORT_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#f43f5e',
  '#f97316','#f59e0b','#22c55e','#10b981',
  '#06b6d4','#3b82f6','#64748b','#94a3b8',
];

let importState = {
  mode: 'new',
  projectId: null,
  selectedColor: null,
  selectedType: null,
  autoDetectedType: null,
  compatInfo: null,
  selectedComponents: new Set(),
  originalCategoryIds: new Set(),
};

function openImportPanel(opts = {}) {
  importState = {
    mode: opts.mode || 'new',
    projectId: opts.projectId || null,
    selectedColor: null,
    selectedType: null,
    autoDetectedType: null,
    compatInfo: null,
    selectedComponents: new Set(),
    originalCategoryIds: new Set(),
  };
  const overlay = document.getElementById('import-overlay');
  const title   = document.getElementById('import-title');
  const submit  = document.getElementById('import-submit');
  const detectSec = document.getElementById('import-detect-section');
  const pathDisplayWrap = document.getElementById('import-path-display-wrap');
  const form = document.getElementById('import-form');
  const dupWarn = document.getElementById('import-dup-warn');
  const msg = document.getElementById('import-msg');
  const pathInput = document.getElementById('import-path-input');

  // Reset
  msg.className = 'import-msg';
  dupWarn.classList.remove('visible');
  form.style.display = 'none';

  if (importState.mode === 'new') {
    title.textContent = t('import.title');
    submit.textContent = t('import.save');
    detectSec.style.display = '';
    pathDisplayWrap.style.display = 'none';
    pathInput.value = '';

    // Pre-fill if coming from scan
    if (opts.prefill) {
      fillImportForm(opts.prefill);
      form.style.display = '';
      detectSec.style.display = '';
      pathInput.value = opts.prefill.path || '';
      if (opts.prefill.alreadyImported) dupWarn.classList.add('visible');
    }
  } else {
    // Edit mode
    title.textContent = t('import.titleEdit');
    submit.textContent = t('import.saveEdit');
    detectSec.style.display = 'none';
    pathDisplayWrap.style.display = '';

    const project = allProjects.find(p => p.id === importState.projectId)
      || { name:'', description:'', tags:[], color:null, commands:{}, path:'' };
    document.getElementById('import-path-display').textContent = project.path || '';
    fillImportForm(project);
    form.style.display = '';
  }

  renderImportColorSwatches();
  overlay.classList.add('open');

  // Focus path input for new mode
  if (importState.mode === 'new' && !opts.prefill) {
    setTimeout(() => pathInput.focus(), 200);
  } else {
    setTimeout(() => document.getElementById('import-name').focus(), 200);
  }
}

function closeImportPanel() {
  document.getElementById('import-overlay').classList.remove('open');
}

function onImportOverlayClick(e) {
  if (e.target === document.getElementById('import-overlay')) closeImportPanel();
}

function fillImportForm(data) {
  document.getElementById('import-name').value        = data.name || '';
  document.getElementById('import-description').value = data.description || '';
  importState.selectedColor = data.color || IMPORT_COLORS[0];

  // Components
  const initialComps = data.components || data.tags || [];
  importState.selectedComponents = new Set(initialComps);

  // Initial categories (to detect changes in edit mode)
  const pid = importState.projectId;
  importState.originalCategoryIds = new Set(pid ? (catAssignments[pid] || []) : []);
  importState.pendingCatIds = new Set(importState.originalCategoryIds);

  // Type: compute compatible types and initialize selection
  importState.compatInfo       = computeCompatibleTypes({ ...data, components: initialComps });
  importState.autoDetectedType = importState.compatInfo.autoDetected;
  importState.selectedType     = data.type || data.typeOverride || importState.compatInfo.autoDetected;

  renderComponentPicker();
  renderImportCatPicker();
  renderImportColorSwatches();
  renderImportTypeGrid();
  renderImportCommands(data.commands || {});
}

function renderImportTypeGrid() {
  const grid = document.getElementById('import-type-grid');
  const warnEl = document.getElementById('import-type-warn');
  if (!grid || !importState.compatInfo) return;

  const { autoDetected, recommended, discouraged } = importState.compatInfo;
  const selected = importState.selectedType;

  // Render all types: recommended first, then discouraged
  const allOrdered = [
    ...recommended.filter(t => t !== 'unknown'),
    ...discouraged.filter(t => t !== 'unknown' && t !== 'multi'),
  ];

  grid.innerHTML = allOrdered.map(type => {
    const def = PROJECT_TYPES[type];
    if (!def) return '';
    const isSelected  = selected === type;
    const isAuto      = autoDetected === type;
    const isDisc      = discouraged.includes(type);
    const starHtml    = isAuto ? `<span class="type-sel-star" title="${t('type.autoDetected')}">●</span>` : '';
    const warnHtml    = isDisc && !isSelected ? `<span class="type-sel-warn-icon">⚠</span>` : '';
    const typeColor   = def.color;
    const typeBg      = def.bg;
    const label       = typeLabel(type);
    return `<button class="type-sel-btn ${isSelected?'active':''} ${isDisc?'discouraged':''}"
      style="--type-color:${typeColor};--type-bg:${typeBg}"
      title="${label}${isDisc?' — '+t('type.uncommonHint'):''}"
      onclick="selectImportType('${type}')">
      ${starHtml}
      <span style="color:${isSelected?typeColor:'var(--t3)'};">${def.svg}</span>
      ${label.split('/')[0].trim()}
      ${warnHtml}
    </button>`;
  }).join('');

  // Warning if selected type is discouraged
  if (discouraged.includes(selected) && selected !== 'unknown') {
    warnEl.textContent = t('type.uncommon', { type: typeLabel(selected) });
    warnEl.classList.add('visible');
  } else {
    warnEl.classList.remove('visible');
  }
}

function selectImportType(type) {
  importState.selectedType = type;
  renderImportTypeGrid();
}

function renderImportColorSwatches() {
  const row = document.getElementById('import-color-row');
  if (!row) return;
  row.innerHTML = IMPORT_COLORS.map(c =>
    `<span class="import-swatch ${importState.selectedColor===c?'sel':''}"
      style="background:${c}"
      onclick="importState.selectedColor='${c}';renderImportColorSwatches()"></span>`
  ).join('');
}

function renderImportCommands(commands) {
  const editor = document.getElementById('import-cmd-editor');
  if (!editor) return;
  editor.innerHTML = '';
  for (const [key, cmd] of Object.entries(commands)) {
    editor.appendChild(makeCommandRow({ key, label: cmd.label||'', cmd: cmd.cmd||'', port: cmd.port||'' }));
  }
}

function makeCommandRow(data = {}) {
  const row = document.createElement('div');
  row.className = 'cmd-row';
  row.innerHTML = `
    <input class="cmd-key"   placeholder="${t('cmd.key.placeholder')}"   value="${escHtml(data.key||'')}"   title="${t('cmd.key.title')}"/>
    <span class="cmd-row-sep">·</span>
    <input class="cmd-label" placeholder="label"    value="${escHtml(data.label||'')}" title="${t('cmd.label.title')}"/>
    <span class="cmd-row-sep">·</span>
    <input class="cmd-cmd"   placeholder="command"  value="${escHtml(data.cmd||'')}"   title="${t('cmd.cmd.title')}"/>
    <span class="cmd-row-sep">:</span>
    <input class="cmd-port"  placeholder="port"     value="${escHtml(String(data.port||''))}" title="${t('cmd.port.title')}" type="number" min="1" max="65535"/>
    <button class="cmd-del" onclick="this.closest('.cmd-row').remove()" title="${t('cmd.del.title')}">✕</button>`;
  return row;
}

function addImportCommand() {
  const editor = document.getElementById('import-cmd-editor');
  if (!editor) return;
  const row = makeCommandRow();
  editor.appendChild(row);
  row.querySelector('.cmd-key').focus();
}

function getImportFormData() {
  const name  = document.getElementById('import-name').value.trim();
  const desc  = document.getElementById('import-description').value.trim();
  const color = importState.selectedColor || IMPORT_COLORS[0];

  // Selected components
  const components = [...importState.selectedComponents];

  // Type: save only if different from the auto-detected one
  const type = (importState.selectedType && importState.selectedType !== importState.autoDetectedType)
    ? importState.selectedType
    : null;

  // Build commands from editor rows
  const commands = {};
  document.querySelectorAll('#import-cmd-editor .cmd-row').forEach(row => {
    const key   = row.querySelector('.cmd-key').value.trim();
    const label = row.querySelector('.cmd-label').value.trim();
    const cmd   = row.querySelector('.cmd-cmd').value.trim();
    const port  = parseInt(row.querySelector('.cmd-port').value, 10);
    if (key && cmd) {
      commands[key] = { label: label || cmd, cmd };
      if (port > 0) commands[key].port = port;
    }
  });

  return { name, description: desc, components, color, commands, type };
}

// ── Component picker ─────────────────────────────────────────────────────────

function renderComponentPicker() {
  const activeEl   = document.getElementById('import-comp-active');
  const presetsEl  = document.getElementById('import-comp-presets');
  if (!activeEl || !presetsEl) return;

  const selected = importState.selectedComponents;

  // Active chips (selected components)
  if (selected.size === 0) {
    activeEl.innerHTML = `<span class="comp-active-empty">${t('import.components.empty')}</span>`;
  } else {
    activeEl.innerHTML = [...selected].map(comp => {
      const kc = KNOWN_COMPONENTS[comp];
      const label = kc ? kc.label : comp;
      const color = kc ? kc.color : 'var(--t2)';
      return `<span class="comp-chip-active"
        style="color:${color};background:${color}18;border-color:${color}40"
        onclick="toggleComponent('${comp}')">
        ${label}
        <button class="cc-del" onclick="event.stopPropagation();toggleComponent('${comp}')" title="${t('cmd.remove.title')}">✕</button>
      </span>`;
    }).join('');
  }

  // Preset chips (not yet selected)
  presetsEl.innerHTML = COMPONENT_PICKER_ORDER.map(comp => {
    const kc = KNOWN_COMPONENTS[comp];
    const label = kc ? kc.label : comp;
    const alreadyIn = selected.has(comp);
    return `<span class="comp-chip-preset ${alreadyIn ? 'already' : ''}"
      onclick="toggleComponent('${comp}')" title="${label}">
      ${label}
    </span>`;
  }).join('');
}

function toggleComponent(comp) {
  if (importState.selectedComponents.has(comp)) {
    importState.selectedComponents.delete(comp);
  } else {
    importState.selectedComponents.add(comp);
  }
  // Recompute compatible types from updated component set
  importState.compatInfo = computeCompatibleTypes({
    components: [...importState.selectedComponents], commands: {}
  });
  importState.autoDetectedType = importState.compatInfo.autoDetected;
  // Keep current selection only if it's still in recommended list
  if (!importState.selectedType ||
      !importState.compatInfo.recommended.includes(importState.selectedType)) {
    importState.selectedType = importState.autoDetectedType;
  }
  renderComponentPicker();
  renderImportTypeGrid();
}

function addCustomComponent() {
  const input = document.getElementById('import-comp-custom');
  const val = input?.value.trim().toLowerCase().replace(/\s+/g, '-');
  if (!val) return;
  input.value = '';
  if (!importState.selectedComponents.has(val)) {
    toggleComponent(val);
  }
}

// ── Import category picker ────────────────────────────────────────────────────

function renderImportCatPicker() {
  const listEl = document.getElementById('import-cat-list');
  if (!listEl) return;

  if (!allCategories.length) {
    listEl.innerHTML = `<span style="font-size:11px;color:var(--t3);font-style:italic">${t('cat.noCategoriesImport')}</span>`;
    return;
  }

  const pid      = importState.projectId;
  const assigned = new Set(pid ? (catAssignments[pid] || []) : []);
  // Also include any pending toggles from the current form session
  const active   = importState.pendingCatIds || new Set(assigned);
  importState.pendingCatIds = active;

  listEl.innerHTML = allCategories.map(cat => {
    const isActive = active.has(cat.id);
    return `<span class="import-cat-chip ${isActive ? 'active' : ''}"
      style="${isActive ? `color:${cat.color};background:${cat.color}18;border-color:${cat.color}40` : ''}"
      onclick="toggleImportCat('${cat.id}')">
      <span class="import-cat-chip-dot" style="background:${cat.color}"></span>
      ${escHtml(cat.name)}
    </span>`;
  }).join('');
}

function toggleImportCat(catId) {
  if (!importState.pendingCatIds) {
    const pid = importState.projectId;
    importState.pendingCatIds = new Set(pid ? (catAssignments[pid] || []) : []);
  }
  if (importState.pendingCatIds.has(catId)) {
    importState.pendingCatIds.delete(catId);
  } else {
    importState.pendingCatIds.add(catId);
  }
  renderImportCatPicker();
}

async function detectImportProject() {
  const btn  = document.getElementById('import-detect-btn');
  const pathInput = document.getElementById('import-path-input');
  const form = document.getElementById('import-form');
  const dupWarn = document.getElementById('import-dup-warn');
  const msg  = document.getElementById('import-msg');

  const dirPath = pathInput.value.trim();
  if (!dirPath) { pathInput.focus(); return; }

  btn.disabled = true;
  btn.textContent = '…';
  msg.className = 'import-msg';
  dupWarn.classList.remove('visible');

  try {
    const r = await fetch('/api/projects/detect', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ path: dirPath }),
    });
    const data = await r.json();
    if (!r.ok) {
      msg.textContent = data.error || t('common.error');
      msg.className = 'import-msg err';
      return;
    }

    fillImportForm(data);
    form.style.display = '';
    if (data.alreadyImported) {
      dupWarn.classList.add('visible');
    }
    document.getElementById('import-name').focus();
  } catch(e) {
    msg.textContent = e.message;
    msg.className = 'import-msg err';
  } finally {
    btn.disabled = false;
    btn.textContent = t('import.detect');
  }
}

async function saveImport() {
  const submit = document.getElementById('import-submit');
  const msg    = document.getElementById('import-msg');

  const { name, description, components, color, commands, type } = getImportFormData();
  if (!name) {
    document.getElementById('import-name').focus();
    msg.textContent = t('import.nameRequired');
    msg.className = 'import-msg err';
    return;
  }

  submit.disabled = true;
  submit.textContent = '…';
  msg.className = 'import-msg';

  try {
    let savedProjectId = importState.projectId;

    if (importState.mode === 'new') {
      const dirPath = document.getElementById('import-path-input').value.trim();
      if (!dirPath) {
        msg.textContent = t('import.pathRequired');
        msg.className = 'import-msg err';
        return;
      }
      const r = await fetch('/api/projects', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ path: dirPath, name, description, components, color, commands, type }),
      });
      const data = await r.json();
      if (r.status === 409) {
        msg.textContent = data.error;
        msg.className = 'import-msg warn';
        document.getElementById('import-dup-warn').classList.add('visible');
        return;
      }
      if (!r.ok) throw new Error(data.error || t('common.serverError'));
      savedProjectId = data.id;
      msg.textContent = t('import.success');
      msg.className = 'import-msg ok';
    } else {
      const r = await fetch(`/api/projects/${importState.projectId}`, {
        method: 'PUT', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name, description, components, color, commands, type }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || t('common.serverError'));
      msg.textContent = t('import.updated');
      msg.className = 'import-msg ok';
    }

    // Apply category changes
    if (savedProjectId) {
      const original = importState.originalCategoryIds;
      const pending  = importState.pendingCatIds || new Set();
      const toAdd    = [...pending].filter(id => !original.has(id));
      const toRemove = [...original].filter(id => !pending.has(id));

      await Promise.all([
        ...toAdd.map(catId => fetch('/api/categories/assign', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ projectId: savedProjectId, categoryId: catId, action: 'add' }),
        })),
        ...toRemove.map(catId => fetch('/api/categories/assign', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ projectId: savedProjectId, categoryId: catId, action: 'remove' }),
        })),
      ]);
    }

    await loadProjects();
    await loadCategories();
    setTimeout(closeImportPanel, 900);
  } catch(e) {
    msg.textContent = '✗ ' + e.message;
    msg.className = 'import-msg err';
  } finally {
    submit.disabled = false;
    submit.textContent = importState.mode === 'new' ? t('import.save') : t('import.saveEdit');
  }
}

function editProject(projectId) {
  importState.projectId = projectId;
  openImportPanel({ mode: 'edit', projectId });
}

async function deleteProject(projectId, projectName, event) {
  event?.stopPropagation();
  if (!confirm(t('confirm.deleteProject', { name: projectName }))) return;
  try {
    const r = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
    if (!r.ok) { const d = await r.json(); alert(d.error || t('common.error')); return; }
    await loadProjects();
  } catch(e) { alert(e.message); }
}

// ══ Real-time sync (SSE) ══════════════════════════════════════════════════
function connectEvents() {
  const es = new EventSource('/api/events');

  es.addEventListener('favorites-changed', e => {
    favorites = new Set(JSON.parse(e.data));
    renderFilter();
    renderProjects();
  });

  es.addEventListener('project-ide-changed', e => {
    const { id, ideId } = JSON.parse(e.data);
    const proj = allProjects.find(p => p.id === id);
    if (proj) { proj.ideId = ideId || undefined; renderProjects(); }
  });

  // Reconnexion automatique si la connexion est perdue
  es.onerror = () => {
    es.close();
    setTimeout(connectEvents, 3000);
  };
}

// ══ Init ═══════════════════════════════════════════════════════════════════
async function initSettings() {
  try {
    const s = await fetch('/api/settings').then(r => r.json());
    idesList     = s.ides      || idesList;
    defaultIdeId = s.defaultIde || defaultIdeId;
  } catch(e) { console.warn(e); }
}

loadCategories();
initI18n()
  .catch(err => console.error('i18n boot failed', err))
  .then(() => initSettings())
  .then(() => loadFavorites())
  .then(() => loadProjects());
setInterval(loadProjects, 10000);
connectEvents();

document.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  if (tag==='INPUT') return;
  if ((e.key==='r'||e.key==='R') && !e.metaKey && !e.ctrlKey) startScan();
  if (e.key==='Escape') {
    closeScan();
    closeSettings();
    closeImportPanel();
    closeCatPopover();
    if (activeTypes.size > 0) { clearTypeFilters(); return; }
    if (activeCatFilters.size > 0) { clearCatFilters(); return; }
    document.getElementById('search').blur();
  }
  if ((e.metaKey||e.ctrlKey) && e.key===',') {
    e.preventDefault();
    openSettings();
  }
  if ((e.metaKey||e.ctrlKey) && e.key==='k') {
    e.preventDefault();
    document.getElementById('search').focus();
  }
});

// Close the categories popover
document.addEventListener('click', e => {
  // Close the categories popover
  const pop = document.getElementById('cat-popover');
  if (pop?.classList.contains('open') && !pop.contains(e.target) && !e.target.closest('.cat-assign-btn')) {
    closeCatPopover();
  }
});
