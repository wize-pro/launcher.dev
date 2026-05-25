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
      ${isRunning ? `<span class="run-badge" title="${t('project.running')}">● ${t('project.running')}${(() => { const rp = (p.runningCommands||[]).map(k => p.commands?.[k]?.port).find(Boolean); return rp ? ' :' + rp : ''; })()}</span>` : ''}
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
        if (cmd.port) html += `<button class="cbtn open-btn" title="${t('cmd.open.title',{port:cmd.port})}" onclick="openUrl('http://localhost:${cmd.port}')">↗ ${t('cmd.open.label')}</button>`;
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
      if (cmd.port) html += `<button class="cbtn open-btn" title="${t('cmd.open.title',{port:cmd.port})}" onclick="openUrl('http://localhost:${cmd.port}')">↗ ${t('cmd.open.label')}</button>`;
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
        ${cmd.port?`<button class="ec-logs" title="${t('cmd.open.title',{port:cmd.port})}" onclick="openUrl('http://localhost:${cmd.port}')">↗ ${t('cmd.open.label')}</button>`:''}
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

