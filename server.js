const express = require('express');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const config = require('./launcher.config');
const pkg = require('./package.json');
const i18n = require('./public/i18n.js');

// Where to persist user data (projects.json, settings.json, …). In a PACKAGED
// Electron build the source directory is read-only (inside the app bundle/asar),
// so we use Electron's per-user data dir. In every dev mode — standalone
// `node server.js` and unpackaged `npm run app` — we keep the project root for a
// zero-config experience, so existing data stays where it is.
let DATA_DIR = __dirname;
if (process.versions.electron) {
  try {
    const { app } = require('electron');
    if (app.isPackaged) DATA_DIR = app.getPath('userData');
  } catch {}
}

// ─── Locale catalogs ───────────────────────────────────────────────────────────
const LOCALES_DIR = path.join(__dirname, 'locales');

function loadCatalogs() {
  const catalogs = {};
  try {
    for (const f of fs.readdirSync(LOCALES_DIR)) {
      if (!f.endsWith('.json')) continue;
      const code = f.replace(/\.json$/, '');
      try {
        catalogs[code] = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, f), 'utf8'));
      } catch (e) {
        console.warn(`Failed to parse locale ${f}: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn(`Cannot read locales directory: ${e.message}`);
  }
  if (!catalogs.en) catalogs.en = {};
  return catalogs;
}

let catalogs = loadCatalogs();

// Translate a key using the given language (defaults to the active settings language).
// NOTE: relies on the module-level `settings` (declared later); must not be called during
// module initialization, only from request handlers. Call sites are added in Phase 2.
function t(key, lang, params) {
  return i18n.translate(catalogs, lang || settings.lang || 'en', key, params);
}

const app = express();
app.use(express.json());

// ─── Security ─────────────────────────────────────────────────────────────────
// ⚠️ This tool executes arbitrary shell commands (/api/launch). It must
// NEVER be exposed on the network. Two safeguards:
//   1. The server listens only on the loopback interface (see app.listen below).
//   2. Any request whose Host header does not refer to the local machine is
//      rejected — protects against DNS rebinding attacks (a malicious website
//      open in the browser cannot control the launcher).
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function hostnameOf(hostHeader) {
  const h = (hostHeader || '').trim();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1); // IPv6 literal: [::1]
  return h.split(':')[0];
}

app.use((req, res, next) => {
  if (!ALLOWED_HOSTS.has(hostnameOf(req.headers.host))) {
    return res.status(403).json({ error: t('error.forbidden') });
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/locales', express.static(LOCALES_DIR));

// ─── Settings (persisted in settings.json) ────────────────────────────────────

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Default values from launcher.config.js
const SETTINGS_DEFAULTS = {
  devRoot:    config.devRoot,
  scanDepth:  config.scanDepth,
  ignoreDirs: config.ignoreDirs,
  ides: [
    { id: 'vscode',   name: 'VS Code',   cmd: 'code'      },
    { id: 'cursor',   name: 'Cursor',    cmd: 'cursor'    },
    { id: 'windsurf', name: 'Windsurf',  cmd: 'windsurf'  },
  ],
  defaultIde: 'vscode',
  // Active UI/server language (locale code). null = not chosen yet → client detects it.
  lang: null,
  // Persisted data schema version (handles migrations). See runMigrations().
  schemaVersion: 1,
};

// Current data schema version. Increment on every change to the JSON file format,
// and add a corresponding step in MIGRATIONS below.
const CURRENT_SCHEMA_VERSION = SETTINGS_DEFAULTS.schemaVersion;

// Known per-platform candidate paths for each IDE
const HOME     = os.homedir();
const PLATFORM = process.platform; // 'darwin' | 'win32' | 'linux'
const PFILES   = process.env['ProgramFiles'] || 'C:\\Program Files';
const PFILES86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const LOCALAPP = process.env['LOCALAPPDATA'] || path.join(HOME, 'AppData', 'Local');

const IDE_CANDIDATES = {
  vscode: {
    darwin: ['/usr/local/bin/code', `${HOME}/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`, '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'],
    win32:  [`${LOCALAPP}\\Programs\\Microsoft VS Code\\bin\\code.cmd`, `${PFILES}\\Microsoft VS Code\\bin\\code.cmd`],
    linux:  ['/usr/bin/code', '/usr/local/bin/code', `${HOME}/.local/bin/code`],
  },
  cursor: {
    darwin: ['/usr/local/bin/cursor', `${HOME}/Applications/Cursor.app/Contents/MacOS/cursor`, '/Applications/Cursor.app/Contents/MacOS/cursor'],
    win32:  [`${LOCALAPP}\\Programs\\cursor\\Cursor.exe`],
    linux:  ['/usr/bin/cursor', '/usr/local/bin/cursor', `${HOME}/.local/bin/cursor`],
  },
  windsurf: {
    darwin: ['/usr/local/bin/windsurf', `${HOME}/Applications/Windsurf.app/Contents/MacOS/windsurf`, '/Applications/Windsurf.app/Contents/MacOS/windsurf'],
    win32:  [`${LOCALAPP}\\Programs\\windsurf\\Windsurf.exe`],
    linux:  ['/usr/bin/windsurf', '/usr/local/bin/windsurf', `${HOME}/.local/bin/windsurf`],
  },
  rider: {
    darwin: ['/usr/local/bin/rider', `${HOME}/Applications/Rider.app/Contents/MacOS/rider`, '/Applications/Rider.app/Contents/MacOS/rider'],
    win32:  [`${PFILES}\\JetBrains\\Rider\\bin\\rider64.exe`, `${PFILES86}\\JetBrains\\Rider\\bin\\rider64.exe`],
    linux:  ['/usr/local/bin/rider', `${HOME}/.local/share/JetBrains/Toolbox/scripts/rider`],
  },
  webstorm: {
    darwin: ['/usr/local/bin/webstorm', `${HOME}/Applications/WebStorm.app/Contents/MacOS/webstorm`, '/Applications/WebStorm.app/Contents/MacOS/webstorm'],
    win32:  [`${PFILES}\\JetBrains\\WebStorm\\bin\\webstorm64.exe`, `${PFILES86}\\JetBrains\\WebStorm\\bin\\webstorm64.exe`],
    linux:  ['/usr/local/bin/webstorm', `${HOME}/.local/share/JetBrains/Toolbox/scripts/webstorm`],
  },
  idea: {
    darwin: ['/usr/local/bin/idea', `${HOME}/Applications/IntelliJ IDEA.app/Contents/MacOS/idea`, '/Applications/IntelliJ IDEA.app/Contents/MacOS/idea'],
    win32:  [`${PFILES}\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe`, `${PFILES86}\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe`],
    linux:  ['/usr/local/bin/idea', `${HOME}/.local/share/JetBrains/Toolbox/scripts/idea`],
  },
  pycharm: {
    darwin: ['/usr/local/bin/pycharm', `${HOME}/Applications/PyCharm.app/Contents/MacOS/pycharm`, '/Applications/PyCharm.app/Contents/MacOS/pycharm'],
    win32:  [`${PFILES}\\JetBrains\\PyCharm\\bin\\pycharm64.exe`, `${PFILES86}\\JetBrains\\PyCharm\\bin\\pycharm64.exe`],
    linux:  ['/usr/local/bin/pycharm', `${HOME}/.local/share/JetBrains/Toolbox/scripts/pycharm`],
  },
  zed: {
    darwin: ['/usr/local/bin/zed', `${HOME}/Applications/Zed.app/Contents/MacOS/zed`, '/Applications/Zed.app/Contents/MacOS/zed'],
    win32:  [`${LOCALAPP}\\Zed\\zed.exe`],
    linux:  ['/usr/bin/zed', '/usr/local/bin/zed', `${HOME}/.local/bin/zed`],
  },
  sublime: {
    darwin: ['/usr/local/bin/subl', '/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl'],
    win32:  [`${PFILES}\\Sublime Text\\subl.exe`, `${PFILES86}\\Sublime Text\\subl.exe`],
    linux:  ['/usr/bin/subl', '/usr/local/bin/subl'],
  },
};

function resolveIdeExec(ide) {
  const platformCandidates = (IDE_CANDIDATES[ide.id] || {})[PLATFORM] || [];
  return platformCandidates.find(p => fs.existsSync(p)) || ide.cmd;
}

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      return { ...SETTINGS_DEFAULTS, ...raw };
    }
  } catch (e) {
    console.warn('⚠️  Cannot read settings.json:', e.message);
  }
  return { ...SETTINGS_DEFAULTS };
}

function saveSettings(data) {
  const toSave = {};
  for (const key of Object.keys(SETTINGS_DEFAULTS)) {
    if (data[key] !== undefined) toSave[key] = data[key];
  }
  // Validate ides
  if (toSave.ides && (!Array.isArray(toSave.ides) || toSave.ides.some(i => !i.id || !i.name || !i.cmd))) {
    delete toSave.ides;
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(toSave, null, 2), 'utf8');
  return toSave;
}

// Active settings (mutable at runtime)
let settings = loadSettings();

// ─── Categories (persisted in categories.json) ────────────────────────────────

const CATEGORIES_FILE = path.join(DATA_DIR, 'categories.json');

function loadCategories() {
  try {
    if (fs.existsSync(CATEGORIES_FILE))
      return JSON.parse(fs.readFileSync(CATEGORIES_FILE, 'utf8'));
  } catch (e) {
    console.warn('⚠️  Cannot read categories.json:', e.message);
  }
  return { categories: [], assignments: {} };
}

function persistCategories() {
  fs.writeFileSync(CATEGORIES_FILE, JSON.stringify(categoriesData, null, 2), 'utf8');
}

let categoriesData = loadCategories();

// ─── Project Registry (source of truth) ──────────────────────────────────────

const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');

function loadRegistry() {
  try {
    if (fs.existsSync(PROJECTS_FILE))
      return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
  } catch (e) {
    console.warn('⚠️  Cannot read projects.json:', e.message);
  }
  return [];
}

function saveRegistry() {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(registry, null, 2), 'utf8');
}

let registry = loadRegistry();

// ─── Data schema & migrations ─────────────────────────────────────────────────

// Normalizes a project to the current canonical schema:
//   components = tech stack · type = manual type · subProjects = sub-projects
// Absorbs legacy fields (tags, typeOverride, structural components of a multi-project).
// Idempotent: applying multiple times has no effect.
function normalizeProject(p) {
  const isOldMulti = p.source === 'multi' && !p.subProjects;
  const components = isOldMulti
    ? (p.tags || []).filter(t => t !== 'multi')
    : (p.components && !p.subProjects && p.tags ? p.tags : (p.components || p.tags || []));
  const subProjects = p.subProjects || (isOldMulti ? p.components || [] : []);
  const type = p.type || p.typeOverride || null;
  const { tags, typeOverride, ...rest } = p;
  return { ...rest, components, subProjects, type };
}

// Migration v1: rewrites the registry to the canonical schema (removes tags/typeOverride).
function migrateRegistryToCanonical() {
  let changed = false;
  registry = registry.map(p => {
    const n = normalizeProject(p);
    if (JSON.stringify(n) !== JSON.stringify(p)) changed = true;
    return n;
  });
  if (changed) saveRegistry();
}

const MIGRATIONS = {
  1: migrateRegistryToCanonical,
};

// Reads the schema version actually stored in settings.json (without merging defaults),
// to distinguish a legacy file from a fresh install.
function rawSchemaVersion() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      return Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : 0;
    }
  } catch {}
  return null; // no settings file
}

function runMigrations() {
  const rawV = rawSchemaVersion();
  let from;
  if (rawV === null) {
    // No settings.json: fresh install (nothing to migrate) unless a legacy projects.json
    // already exists → start from 0 to normalize it.
    from = fs.existsSync(PROJECTS_FILE) ? 0 : CURRENT_SCHEMA_VERSION;
  } else {
    from = rawV;
  }

  if (from < CURRENT_SCHEMA_VERSION) {
    console.log(`[migration] data schema ${from} → ${CURRENT_SCHEMA_VERSION}`);
    for (let v = from + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
      if (MIGRATIONS[v]) { MIGRATIONS[v](); console.log(`[migration] step v${v} applied`); }
    }
  }

  // Always stamp the current version into settings.json
  settings.schemaVersion = CURRENT_SCHEMA_VERSION;
  saveSettings(settings);
  settings = loadSettings();
}

runMigrations();

// ─── State ────────────────────────────────────────────────────────────────────

const instances = new Map();

// ─── Auto-detection of project types ─────────────────────────────────────────

// Infers the main project type from its technology components
function suggestProjectType(components) {
  const s = new Set(Array.isArray(components) ? components : []);
  if (s.has('multi'))                                                     return 'multi';
  if (s.has('electron') || s.has('tauri'))                               return 'desktop';
  if (s.has('react-native') || s.has('expo') || s.has('flutter'))        return 'mobile';
  if (s.has('node') || s.has('typescript')) {
    if (s.has('next') || s.has('vite') || s.has('react'))                return 'web';
    if (s.has('electron') || s.has('tauri'))                             return 'desktop';
    if (s.has('react-native') || s.has('expo'))                          return 'mobile';
    return 'api';
  }
  if (s.has('dotnet'))  return 'api';
  if (s.has('python'))  return 'script';
  if (s.has('go'))      return 'cli';
  if (s.has('rust'))    return 'cli';
  if (s.has('docker'))  return 'service';
  if (s.has('make'))    return 'script';
  return 'unknown';
}

// ─── Makefile parser ─────────────────────────────────────────────────────────
// Extracts exposed Make targets (.PHONY or simple targets) with their descriptions
// taken from ## comments on the same line or the preceding line.
function parseMakefileCommands(dir) {
  const makefile = path.join(dir, 'Makefile');
  if (!fs.existsSync(makefile)) return null;

  let content;
  try { content = fs.readFileSync(makefile, 'utf8'); } catch { return null; }

  const lines = content.split('\n');

  // Find declared .PHONY targets (handle multi-line declarations with \)
  const phonyTargets = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\.PHONY\s*:\s*(.+)/);
    if (!m) continue;
    let phonyLine = m[1];
    // Follow continuation lines
    while (phonyLine.trimEnd().endsWith('\\')) {
      phonyLine = phonyLine.trimEnd().slice(0, -1);
      i++;
      if (i < lines.length) phonyLine += ' ' + lines[i];
    }
    phonyLine.trim().split(/\s+/).filter(Boolean).forEach(t => phonyTargets.add(t));
  }

  const commands = {};
  const SKIP = new Set(['all', 'clean', 'install', 'help', '.PHONY']);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Make target: name followed by ':'  (no leading tab, no variable)
    const targetMatch = line.match(/^([a-zA-Z0-9_][a-zA-Z0-9_\-.]*):/);
    if (!targetMatch) continue;

    const target = targetMatch[1];
    if (SKIP.has(target)) continue;
    // If .PHONY is declared, restrict to those targets only
    if (phonyTargets.size > 0 && !phonyTargets.has(target)) continue;
    // Ignore internal targets (starting with _ or containing %)
    if (target.startsWith('_') || target.includes('%')) continue;

    // Description: ## comment on the same line or the preceding line
    let description = '';
    const inlineComment = line.match(/##\s*(.+)$/);
    if (inlineComment) {
      description = inlineComment[1].trim();
    } else if (i > 0) {
      const prevComment = lines[i - 1].match(/^##\s*(.+)$/);
      if (prevComment) description = prevComment[1].trim();
    }

    const entry = { label: `make ${target}`, cmd: `make ${target}` };
    if (description) entry.description = description;
    commands[`make-${target}`] = entry;
  }

  return Object.keys(commands).length > 0 ? commands : null;
}

function detectProject(dir, entries) {
  const names = new Set(entries.map(e => e.name));
  const components = [];
  const allCommands = {};
  let color = null;

  // .launcher.yml → handled separately (absolute priority)

  // Docker Compose — additive component (a project can be both web AND docker)
  if (names.has('docker-compose.yml') || names.has('docker-compose.yaml')) {
    const composeFile = names.has('docker-compose.yml') ? 'docker-compose.yml' : 'docker-compose.yaml';
    components.push('docker');
    Object.assign(allCommands, {
      up:         { label: 'Docker up',          cmd: `docker-compose -f ${composeFile} up` },
      'up-build': { label: 'Docker up --build',  cmd: `docker-compose -f ${composeFile} up --build` },
      down:       { label: 'Docker down',        cmd: `docker-compose -f ${composeFile} down` },
    });
    if (!color) color = '#0ea5e9';
  }

  // .NET — solution or project
  const slnFile  = entries.find(e => e.name.endsWith('.sln'));
  const csprojFile = entries.find(e => e.name.endsWith('.csproj'));
  if (slnFile || csprojFile) {
    const target = slnFile ? slnFile.name : csprojFile.name;
    components.push('dotnet');
    Object.assign(allCommands, {
      run:   { label: 'dotnet run',   cmd: `dotnet run --project "${target}"` },
      watch: { label: 'dotnet watch', cmd: `dotnet watch --project "${target}"` },
      build: { label: 'dotnet build', cmd: `dotnet build "${target}"` },
    });
    if (!color) color = '#7c3aed';
  }

  // Node.js / Front-end
  if (names.has('package.json')) {
    let pkgScripts = {};
    let pkgAllDeps = {};
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      pkgScripts = pkg.scripts || {};
      pkgAllDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    } catch {}

    const nodeCommands = {};
    const scriptPriority = ['dev', 'start', 'serve', 'build', 'preview', 'test'];
    for (const s of scriptPriority) {
      if (pkgScripts[s]) {
        const manager = names.has('yarn.lock') ? 'yarn' : names.has('pnpm-lock.yaml') ? 'pnpm' : 'npm';
        nodeCommands[s] = { label: `${manager} run ${s}`, cmd: `${manager} run ${s}` };
      }
    }
    if (Object.keys(nodeCommands).length === 0) {
      nodeCommands.install = { label: 'npm install', cmd: 'npm install' };
    }

    // Detect port for Vite / Next / etc.
    let port = null;
    if (pkgScripts.dev?.includes('vite') || names.has('vite.config.ts') || names.has('vite.config.js')) port = 5173;
    else if (names.has('next.config.js') || names.has('next.config.ts')) port = 3000;
    else if (pkgScripts.start?.includes('3000') || pkgScripts.dev?.includes('3000')) port = 3000;

    if (port && nodeCommands.dev)   nodeCommands.dev.port   = port;
    if (port && nodeCommands.start) nodeCommands.start.port = port;

    const isTypescript = names.has('tsconfig.json');
    const isNext = names.has('next.config.js') || names.has('next.config.ts');
    const isVite = names.has('vite.config.ts') || names.has('vite.config.js');

    components.push('node');
    if (isTypescript) components.push('typescript');
    if (isNext)       components.push('next');
    if (isVite)       components.push('vite');
    if (!isNext && !isVite && pkgAllDeps['react'])             components.push('react');
    if (pkgAllDeps['vue'])                                     components.push('vue');
    if (pkgAllDeps['electron'])                                components.push('electron');
    if (pkgAllDeps['@tauri-apps/api'] || pkgAllDeps['tauri']) components.push('tauri');
    if (pkgAllDeps['react-native'])                            components.push('react-native');
    if (pkgAllDeps['expo'])                                    components.push('expo');
    if (pkgAllDeps['tailwindcss'])                             components.push('tailwind');
    if (pkgAllDeps['@apollo/client'] || pkgAllDeps['graphql']) components.push('graphql');

    Object.assign(allCommands, nodeCommands);
    if (!color) color = '#f59e0b';
  }

  // Python
  if (names.has('requirements.txt') || names.has('pyproject.toml') || names.has('setup.py')) {
    const hasUvicorn = (() => {
      try {
        const req = fs.readFileSync(path.join(dir, 'requirements.txt'), 'utf8');
        return req.includes('uvicorn') || req.includes('fastapi');
      } catch { return false; }
    })();
    const pyCmd = hasUvicorn
      ? { run: { label: 'uvicorn (dev)', cmd: 'uvicorn main:app --reload', port: 8000 } }
      : { run: { label: 'python main.py', cmd: 'python main.py' } };
    components.push('python');
    Object.assign(allCommands, pyCmd);
    if (!color) color = '#22c55e';
  }

  // Go
  if (names.has('go.mod')) {
    components.push('go');
    Object.assign(allCommands, {
      run:   { label: 'go run .',  cmd: 'go run .' },
      build: { label: 'go build', cmd: 'go build .' },
    });
    if (!color) color = '#06b6d4';
  }

  // ── Makefile ───────────────────────────────────────────────────────────────
  if (names.has('Makefile')) {
    const makeCommands = parseMakefileCommands(dir);
    if (makeCommands) {
      components.push('make');
      // Make commands first, then the rest
      const reordered = { ...makeCommands, ...allCommands };
      Object.keys(allCommands).forEach(k => delete allCommands[k]);
      Object.assign(allCommands, reordered);
      if (!color) color = '#94a3b8';
    }
  }

  if (components.length === 0) return null;

  return {
    components,
    color,
    commands: allCommands,
    suggestedType: suggestProjectType(components),
  };
}

// ─── Scanner ──────────────────────────────────────────────────────────────────

// Generic folder names that should not be used as a project name
const GENERIC_NAMES = new Set([
  'src', 'app', 'source', 'lib', 'libs', 'core', 'main', 'pkg', 'packages',
  'server', 'client', 'web', 'api', 'code', 'project', 'solution',
]);

// Names that indicate a COMPONENT of a project (frontend/backend/etc.)
// Only these names trigger multi-component grouping.
// A folder grouping several independent projects will NOT be grouped, because its
// sub-folders have business names (e.g. PaymentService, DataPipeline…), not component names.
const COMPONENT_NAMES = new Set([
  'frontend', 'backend', 'api', 'web', 'client', 'server', 'mobile', 'app',
  'admin', 'worker', 'ui', 'bot', 'jobs', 'gateway', 'proxy', 'auth',
  'dashboard', 'landing', 'docs', 'storybook', 'e2e', 'functions', 'lambda',
]);

// Returns the best display name for a folder.
// If the name is generic, climbs up to the parent.
function smartName(dir) {
  const name = path.basename(dir);
  if (GENERIC_NAMES.has(name.toLowerCase())) {
    const parentName = path.basename(path.dirname(dir));
    // Don't climb up if the parent is the dev root or another generic name
    if (parentName && !GENERIC_NAMES.has(parentName.toLowerCase())) {
      return parentName;
    }
  }
  return name;
}

// Tries to resolve the config of a sub-folder (for multi-component grouping).
// Returns { name, components, commands, color, source } or null.
function resolveComponent(sdPath, sdName) {
  // .launcher.yml in the sub-folder
  const cfgPath = path.join(sdPath, config.configFile);
  if (fs.existsSync(cfgPath)) {
    try {
      const data = yaml.load(fs.readFileSync(cfgPath, 'utf8'));
      if (data && data.name) {
        return { name: sdName, label: data.name, commands: data.commands || {}, components: data.components || data.tags || [], color: data.color, source: 'launcher.yml' };
      }
    } catch {}
  }
  // Auto-detection
  let sdEntries;
  try { sdEntries = fs.readdirSync(sdPath, { withFileTypes: true }); } catch { return null; }
  const detected = detectProject(sdPath, sdEntries);
  if (detected) {
    return { name: sdName, label: sdName, commands: detected.commands, components: detected.components, color: detected.color, source: 'auto' };
  }
  return null;
}

// push(type, message) — types: 'info' | 'found' | 'explore' | 'warn' | 'done'
function scanProjects(push) {
  const projects = [];
  const emit = typeof push === 'function' ? push : () => {};

  if (!fs.existsSync(settings.devRoot)) {
    emit('warn', t('scan.log.devRootNotFound', undefined, { root: settings.devRoot }));
    return projects;
  }

  emit('info', t('scan.log.root', undefined, { root: settings.devRoot, depth: settings.scanDepth }));

  function walk(dir, depth) {
    if (depth > settings.scanDepth) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      emit('warn', t('scan.log.cannotRead', undefined, { dir: path.relative(settings.devRoot, dir), msg: e.message }));
      return;
    }

    const folderName  = path.basename(dir);
    const displayName = smartName(dir);           // ← smart name (climbs up if generic)
    const relDir      = path.relative(settings.devRoot, dir) || '.';
    const id          = Buffer.from(dir).toString('base64url');

    // ── 1. .launcher.yml (absolute priority) ─────────────────────────────────
    const configPath = path.join(dir, config.configFile);
    if (fs.existsSync(configPath)) {
      try {
        const data = yaml.load(fs.readFileSync(configPath, 'utf8'));
        if (data && data.name) {
          const launchComps = data.components || data.tags || [];
          emit('found', `${data.name}   [${launchComps.join(', ')}]   .launcher.yml   ${relDir}`);
          projects.push({ id, name: data.name, description: data.description || '', components: launchComps, color: data.color || null, commands: data.commands || {}, path: dir, source: 'launcher.yml' });
          return;
        }
        emit('warn', t('scan.log.nameMissing', undefined, { file: `${relDir}/.launcher.yml` }));
      } catch (e) {
        emit('warn', t('scan.log.parseError', undefined, { file: `${relDir}/.launcher.yml`, msg: e.message }));
      }
    }

    // ── 2. Direct auto-detection ──────────────────────────────────────────────
    const detected = detectProject(dir, entries);
    if (detected) {
      const nameNote = displayName !== folderName ? ` ${t('scan.log.folderNote', undefined, { name: folderName })}` : '';
      emit('found', `${displayName}   [${detected.components.join(', ')}]   auto   ${relDir}${nameNote}`);
      projects.push({ id, name: displayName, description: '', components: detected.components, color: detected.color || null, commands: detected.commands, path: dir, source: 'auto' });
      return;
    }

    // ── 3. Multi-component detection ─────────────────────────────────────────
    // If most sub-folders are recognized projects → one grouped project
    const subdirs = entries.filter(e => e.isDirectory() && !settings.ignoreDirs.includes(e.name) && !e.name.startsWith('.'));

    if (subdirs.length >= 2) {
      // Only group if sub-folders have recognized COMPONENT names
      // (frontend, backend, api…). This avoids grouping a "category" folder
      // that merely contains several unrelated projects.
      const componentCandidates = subdirs.filter(sd =>
        COMPONENT_NAMES.has(sd.name.toLowerCase())
      );

      const subComps = componentCandidates
        .map(sd => resolveComponent(path.join(dir, sd.name), sd.name))
        .filter(Boolean);

      const ratio = componentCandidates.length / subdirs.length;

      if (subComps.length >= 2 && ratio >= 0.5) {
        // Build grouped commands: "component-key"
        const commands = {};
        const allComponents = new Set(['multi']);

        for (const comp of subComps) {
          (comp.components || []).forEach(t => allComponents.add(t));
          for (const [key, cmd] of Object.entries(comp.commands)) {
            commands[`${comp.name}-${key}`] = {
              ...cmd,
              label: `${comp.name} · ${cmd.label || key}`,
              cwd: comp.name,  // relative to the parent folder
            };
          }
        }

        // If the parent also has a docker-compose, add it first
        const dcFile = entries.find(e => e.name === 'docker-compose.yml' || e.name === 'docker-compose.yaml');
        if (dcFile) {
          commands['docker-up']    = { label: '🐳 Docker Compose up', cmd: `docker-compose -f ${dcFile.name} up` };
          commands['docker-build'] = { label: '🐳 Docker Compose up --build', cmd: `docker-compose -f ${dcFile.name} up --build` };
          commands['docker-down']  = { label: '🐳 Docker Compose down', cmd: `docker-compose -f ${dcFile.name} down` };
          allComponents.add('docker');
          // Reorder: docker first
          const reordered = {};
          ['docker-up', 'docker-build', 'docker-down'].forEach(k => { reordered[k] = commands[k]; delete commands[k]; });
          Object.assign(reordered, commands);
          Object.assign(commands, reordered);
        }

        const compNames = subComps.map(c => c.name).join(' + ');
        emit('found', `${folderName}   [${[...allComponents].join(', ')}]   multi (${compNames})   ${relDir}`);
        projects.push({
          id,
          name: folderName,
          description: compNames,
          components: [...allComponents],
          color: '#ec4899',
          commands,
          path: dir,
          source: 'multi',
          subProjects: subComps.map(c => c.name),
        });
        return;
      }
    }

    // ── 4. Recurse normally ───────────────────────────────────────────────────
    if (subdirs.length > 0) {
      const subfolderKey = subdirs.length > 1 ? 'scan.log.subfoldersMany' : 'scan.log.subfoldersOne';
      emit('explore', t(subfolderKey, undefined, { dir: relDir, count: subdirs.length }));
    }
    for (const entry of subdirs) {
      walk(path.join(dir, entry.name), depth + 1);
    }
  }

  walk(settings.devRoot, 1);
  const doneKey = projects.length === 1 ? 'scan.log.doneOne' : 'scan.log.doneMany';
  emit('done', t(doneKey, undefined, { count: projects.length }));
  return projects;
}

// ─── Git detection ───────────────────────────────────────────────────────────

// ─── Last activity ────────────────────────────────────────────────────────────

// Short-TTL last-activity cache. getLastActivity runs a synchronous `git log`
// per project; without a cache, GET /api/projects blocks the event loop
// proportionally to the number of projects on every call.
const activityCache = new Map(); // dir -> { value, expires }
const ACTIVITY_TTL = 15000;      // 15 s

// Returns the timestamp (ms) of the last activity on the project.
// Priority: latest git commit > max mtime of top-level files.
function getLastActivity(dir, hasGit) {
  const cached = activityCache.get(dir);
  if (cached && cached.expires > Date.now()) return cached.value;
  const value = computeLastActivity(dir, hasGit);
  activityCache.set(dir, { value, expires: Date.now() + ACTIVITY_TTL });
  return value;
}

function computeLastActivity(dir, hasGit) {
  if (hasGit) {
    try {
      const r = spawnSync('git', ['-C', dir, 'log', '-1', '--format=%ct', 'HEAD'], {
        encoding: 'utf8', timeout: 3000,
      });
      const ts = parseInt((r.stdout || '').trim(), 10);
      if (ts > 0) return { ts: ts * 1000, source: 'git' };
    } catch {}
  }

  // Fallback: max mtime of direct entries (excluding ignoreDirs)
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let max = 0;
    for (const e of entries) {
      if (settings.ignoreDirs.includes(e.name) || e.name.startsWith('.')) continue;
      try {
        const m = fs.statSync(path.join(dir, e.name)).mtimeMs;
        if (m > max) max = m;
      } catch {}
    }
    if (max > 0) return { ts: max, source: 'fs' };
  } catch {}

  return { ts: null, source: null };
}

// Converts a git remote URL (SSH or HTTPS) into a navigable web URL
function remoteToWebUrl(remote, provider) {
  if (!remote) return null;

  // Already an HTTPS URL → strip the trailing .git
  if (remote.startsWith('https://') || remote.startsWith('http://')) {
    return remote.replace(/\.git$/, '');
  }

  // Azure SSH: git@ssh.dev.azure.com:v3/org/project/repo
  if (provider === 'azure' && remote.startsWith('git@ssh.dev.azure.com')) {
    const m = remote.match(/git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/(.+)/);
    if (m) return `https://dev.azure.com/${m[1]}/${m[2]}/_git/${m[3].replace(/\.git$/, '')}`;
  }

  // Standard SSH: git@host:user/repo.git  or  git@host:org/project/repo.git
  const sshMatch = remote.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    const [, host, repoPath] = sshMatch;
    return `https://${host}/${repoPath}`;
  }

  // SCP-like without git@: host:path
  const scpMatch = remote.match(/^([a-zA-Z0-9._-]+):(.+?)(?:\.git)?$/);
  if (scpMatch) return null; // likely a local path, not navigable

  return null;
}

function detectGit(dir) {
  const gitDir = path.join(dir, '.git');
  if (!fs.existsSync(gitDir)) return { hasGit: false };

  // Read remote origin URL from .git/config
  let remote = null;
  try {
    const cfg = fs.readFileSync(path.join(gitDir, 'config'), 'utf8');
    const m = cfg.match(/\[remote\s+"origin"\][^\[]*\burl\s*=\s*(.+)/);
    if (m) remote = m[1].trim();
  } catch {}

  if (!remote) return { hasGit: true, provider: 'local', remote: null, url: null };

  // Identify provider from URL
  let provider = 'git';
  const r = remote.toLowerCase();
  if (r.includes('github.com'))                                             provider = 'github';
  else if (r.includes('gitlab.com'))                                        provider = 'gitlab';
  else if (r.includes('dev.azure.com') || r.includes('visualstudio.com'))  provider = 'azure';
  else if (r.includes('bitbucket.org'))                                     provider = 'bitbucket';
  else if (r.includes('gitlab'))                                            provider = 'gitlab-self';

  // Convert raw remote (SSH or HTTPS) to a clickable web URL
  const url = remoteToWebUrl(remote, provider);

  return { hasGit: true, provider, remote, url };
}

// ─── API ──────────────────────────────────────────────────────────────────────

app.get('/api/projects', (req, res) => {
  try {
    const enriched = registry.map(p => {
      const git = detectGit(p.path);
      const activity = getLastActivity(p.path, git.hasGit);
      const assignedCatIds = categoriesData.assignments[p.id] || [];
      const categories = assignedCatIds
        .map(cid => categoriesData.categories.find(c => c.id === cid))
        .filter(Boolean);

      // Canonical schema is guaranteed by the startup migration; normalizeProject
      // is still applied here as a safety net (idempotent) in case an un-migrated
      // entry was added in the meantime.
      const np = normalizeProject(p);

      return {
        ...np,
        git,
        lastActivity: activity,
        categories,
        runningCommands: [...instances.keys()]
          .filter(k => k.startsWith(p.id + '__'))
          .map(k => k.replace(p.id + '__', '')),
      };
    });
    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// SSE: scan with real-time progress
app.get('/api/scan-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (type, message) => {
    res.write(`data: ${JSON.stringify({ type, message, ts: Date.now() })}\n\n`);
  };

  try {
    const projects = scanProjects(send);
    // Mark each project as imported or new
    const marked = projects.map(p => ({
      ...p,
      imported: registry.some(r => r.id === p.id || r.path === p.path),
      runningCommands: [...instances.keys()]
        .filter(k => k.startsWith(p.id + '__'))
        .map(k => k.replace(p.id + '__', '')),
    }));
    res.write(`event: projects\ndata: ${JSON.stringify(marked)}\n\n`);
  } catch (e) {
    send('warn', t('scan.log.unexpectedError', undefined, { msg: e.message }));
  }

  res.end();
});

app.post('/api/launch', (req, res) => {
  const { projectId, commandKey } = req.body;
  if (!projectId || !commandKey) return res.status(400).json({ error: t('error.projectIdAndCommandKeyRequired') });

  const instanceId = `${projectId}__${commandKey}`;
  if (instances.has(instanceId)) return res.status(409).json({ error: t('error.alreadyRunning'), instanceId });

  const project = registry.find(p => p.id === projectId);
  if (!project) return res.status(404).json({ error: t('error.projectNotFound') });

  const cmdConfig = project.commands[commandKey];
  if (!cmdConfig) return res.status(404).json({ error: t('error.commandNotFound') });

  const cwd = cmdConfig.cwd ? path.resolve(project.path, cmdConfig.cwd) : project.path;

  console.log(`[launch] ${project.name} → ${cmdConfig.cmd} (cwd: ${cwd})`);

  const proc = spawn(cmdConfig.cmd, [], {
    cwd,
    shell: true,
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  const instance = { process: proc, projectId, commandKey, startedAt: new Date().toISOString(), logs: [], sseClients: [] };
  instances.set(instanceId, instance);

  const pushLog = (type, data) => {
    const line = { type, data: data.toString(), ts: Date.now() };
    instance.logs.push(line);
    if (instance.logs.length > 500) instance.logs.shift();
    instance.sseClients.forEach(c => c.write(`data: ${JSON.stringify(line)}\n\n`));
  };

  proc.stdout.on('data', d => pushLog('stdout', d));
  proc.stderr.on('data', d => pushLog('stderr', d));
  proc.on('exit', code => {
    pushLog('system', `\n${t('launch.log.processExited', undefined, { code: code ?? 'signal' })}\n`);
    instances.delete(instanceId);
    instance.sseClients.forEach(c => { c.write(`event: exit\ndata: ${JSON.stringify({ code })}\n\n`); c.end(); });
  });
  proc.on('error', err => pushLog('system', `${t('launch.log.processError', undefined, { msg: err.message })}\n`));

  res.json({ instanceId, pid: proc.pid });
});

app.post('/api/stop', (req, res) => {
  const instance = instances.get(req.body.instanceId);
  if (!instance) return res.status(404).json({ error: t('error.instanceNotFound') });
  instance.process.kill('SIGTERM');
  setTimeout(() => { if (instances.has(req.body.instanceId)) instance.process.kill('SIGKILL'); }, 3000);
  res.json({ ok: true });
});

app.get('/api/logs/:instanceId', (req, res) => {
  const instance = instances.get(req.params.instanceId);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  if (!instance) { res.write(`event: exit\ndata: ${JSON.stringify({ code: null })}\n\n`); res.end(); return; }
  instance.logs.forEach(l => res.write(`data: ${JSON.stringify(l)}\n\n`));
  instance.sseClients.push(res);
  req.on('close', () => { instance.sseClients = instance.sseClients.filter(c => c !== res); });
});

// Open the folder in the file explorer (cross-platform)
app.post('/api/open-folder', (req, res) => {
  const { projectId } = req.body;
  const project = registry.find(p => p.id === projectId);
  if (!project) return res.status(404).json({ error: t('error.projectNotFound') });

  const platform = process.platform;
  const cmd  = platform === 'win32'  ? 'explorer'  :
               platform === 'darwin' ? 'open'       : 'xdg-open';
  const proc = spawn(cmd, [project.path], { detached: true, stdio: 'ignore' });
  proc.unref();
  console.log(`[finder] ${project.name} → ${project.path}`);
  res.json({ ok: true });
});

// Open a project in the editor
app.post('/api/open-editor', (req, res) => {
  const { projectId, ideId } = req.body;
  const project = registry.find(p => p.id === projectId);
  if (!project) return res.status(404).json({ error: t('error.projectNotFound') });

  const resolvedId = ideId || project.ideId || settings.defaultIde;
  const ide = settings.ides?.find(i => i.id === resolvedId) || settings.ides?.[0];
  if (!ide) return res.status(400).json({ error: t('error.noEditorConfigured') });

  const exec = resolveIdeExec(ide);
  const proc = spawn(exec, [project.path], { shell: true, detached: true, stdio: 'ignore' });
  proc.unref();

  console.log(`[editor] ${ide.name} → ${project.path}`);
  res.json({ ok: true });
});

// Set the preferred IDE for a project
app.patch('/api/projects/:id/ide', (req, res) => {
  const { ideId } = req.body;
  const project = registry.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: t('error.projectNotFound') });
  if (ideId) project.ideId = ideId;
  else delete project.ideId;
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(registry, null, 2));
  broadcast('project-ide-changed', { id: project.id, ideId: project.ideId ?? null });
  res.json({ ok: true });
});

// ─── Categories API ───────────────────────────────────────────────────────────

app.get('/api/categories', (req, res) => res.json(categoriesData));

// Create or update a category
app.post('/api/categories', (req, res) => {
  const { id, name, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: t('error.nameRequired') });
  if (id) {
    // Update
    const cat = categoriesData.categories.find(c => c.id === id);
    if (!cat) return res.status(404).json({ error: t('error.categoryNotFound') });
    cat.name  = name.trim();
    cat.color = color || cat.color;
  } else {
    // Create
    const newCat = { id: `cat_${Date.now()}`, name: name.trim(), color: color || '#6366f1' };
    categoriesData.categories.push(newCat);
  }
  persistCategories();
  res.json(categoriesData);
});

// Delete a category
app.delete('/api/categories/:id', (req, res) => {
  const { id } = req.params;
  categoriesData.categories = categoriesData.categories.filter(c => c.id !== id);
  // Clean up assignments
  for (const pid of Object.keys(categoriesData.assignments)) {
    categoriesData.assignments[pid] = categoriesData.assignments[pid].filter(cid => cid !== id);
    if (!categoriesData.assignments[pid].length) delete categoriesData.assignments[pid];
  }
  persistCategories();
  res.json(categoriesData);
});

// Assign / unassign a category to a project
app.post('/api/categories/assign', (req, res) => {
  const { projectId, categoryId, action } = req.body; // action: 'add' | 'remove'
  if (!projectId || !categoryId) return res.status(400).json({ error: t('error.projectIdAndCategoryIdRequired') });
  const current = categoriesData.assignments[projectId] || [];
  if (action === 'add' && !current.includes(categoryId)) {
    categoriesData.assignments[projectId] = [...current, categoryId];
  } else if (action === 'remove') {
    categoriesData.assignments[projectId] = current.filter(id => id !== categoryId);
    if (!categoriesData.assignments[projectId].length) delete categoriesData.assignments[projectId];
  }
  persistCategories();
  res.json(categoriesData.assignments[projectId] || []);
});

// ─── Registry API ─────────────────────────────────────────────────────────────

// Detect the properties of a path (without importing it)
app.post('/api/projects/detect', (req, res) => {
  let dirPath = (req.body.path || '').trim();
  if (!dirPath) return res.status(400).json({ error: t('error.pathRequired') });

  // Expand ~
  dirPath = dirPath.replace(/^~/, os.homedir());

  if (!fs.existsSync(dirPath)) return res.status(404).json({ error: t('error.folderNotFound') });
  if (!fs.statSync(dirPath).isDirectory()) return res.status(400).json({ error: t('error.notADirectory') });

  const id = Buffer.from(dirPath).toString('base64url');
  const alreadyImported = registry.some(r => r.id === id || r.path === dirPath);

  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); }
  catch (e) { return res.status(400).json({ error: t('error.cannotRead', undefined, { msg: e.message }) }); }

  // .launcher.yml absolute priority
  const cfgPath = path.join(dirPath, config.configFile);
  if (fs.existsSync(cfgPath)) {
    try {
      const data = yaml.load(fs.readFileSync(cfgPath, 'utf8'));
      if (data && data.name) {
        const launchComps = data.components || data.tags || [];
        return res.json({ id, path: dirPath, name: data.name, description: data.description || '',
          components: launchComps, suggestedType: suggestProjectType(launchComps),
          color: data.color || null, commands: data.commands || {},
          source: 'launcher.yml', alreadyImported });
      }
    } catch {}
  }

  // Auto-detection
  const detected = detectProject(dirPath, entries);
  const folderName = path.basename(dirPath);
  const displayName = smartName(dirPath);

  if (detected) {
    return res.json({ id, path: dirPath, name: displayName, description: '',
      components: detected.components || [], suggestedType: detected.suggestedType || 'unknown',
      color: detected.color || null, commands: detected.commands || {},
      source: 'auto', alreadyImported });
  }

  // Nothing detected — minimal info
  return res.json({ id, path: dirPath, name: folderName, description: '',
    components: [], suggestedType: 'unknown', color: null, commands: {}, source: 'manual', alreadyImported });
});

// Import a project into the registry
app.post('/api/projects', (req, res) => {
  let { path: dirPath, name, description, components, type, color, commands, source } = req.body;
  if (!dirPath || !name?.trim()) return res.status(400).json({ error: t('error.pathAndNameRequired') });

  dirPath = dirPath.replace(/^~/, os.homedir());
  const id = Buffer.from(dirPath).toString('base64url');

  const existing = registry.find(p => p.id === id || p.path === dirPath);
  if (existing) return res.status(409).json({ error: t('error.projectAlreadyImported'), project: existing });

  const newProject = {
    id,
    path: dirPath,
    name: name.trim(),
    description: (description || '').trim(),
    components: components || [],
    type: type || null,
    color: color || null,
    commands: commands || {},
    source: source || 'imported',
    importedAt: Date.now(),
  };

  registry.push(newProject);
  saveRegistry();
  res.status(201).json(newProject);
});

// Update a project in the registry
app.put('/api/projects/:id', (req, res) => {
  const { id } = req.params;
  const idx = registry.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: t('error.projectNotFound') });

  const { name, description, components, type, color, commands } = req.body;
  const updated = {
    ...registry[idx],
    name: (name || registry[idx].name).trim(),
    description: (description ?? registry[idx].description ?? '').trim(),
    components: components ?? registry[idx].components ?? registry[idx].tags ?? [],
    type: type !== undefined ? (type || null) : (registry[idx].type || registry[idx].typeOverride || null),
    color: color !== undefined ? color : registry[idx].color,
    commands: commands ?? registry[idx].commands,
    updatedAt: Date.now(),
  };

  registry[idx] = updated;
  saveRegistry();
  res.json(updated);
});

// Remove a project from the registry
app.delete('/api/projects/:id', (req, res) => {
  const { id } = req.params;
  const idx = registry.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: t('error.projectNotFound') });

  registry.splice(idx, 1);
  saveRegistry();

  // Clean up category assignments
  delete categoriesData.assignments[id];
  persistCategories();

  // Kill running instances for this project
  for (const [key, inst] of instances) {
    if (key.startsWith(id + '__')) {
      inst.process.kill('SIGTERM');
      instances.delete(key);
    }
  }

  res.json({ ok: true });
});

// ─── Native folder picker (Electron only) ─────────────────────────────────────

app.get('/api/pick-folder', async (req, res) => {
  let dialog;
  try { dialog = require('electron').dialog; } catch { /* web mode */ }
  if (!dialog) return res.status(400).json({ error: 'native_unavailable' });

  const defaultPath = req.query.current
    ? req.query.current.replace(/^~/, os.homedir())
    : os.homedir();

  const result = await dialog.showOpenDialog({
    title:       t('dialog.pickFolder.title'),
    defaultPath,
    properties:  ['openDirectory', 'createDirectory'],
    buttonLabel: t('dialog.pickFolder.button'),
  });

  if (result.canceled) return res.json({ canceled: true });
  res.json({ path: result.filePaths[0] });
});

// ─── Settings API ─────────────────────────────────────────────────────────────

app.get('/api/settings', (req, res) => {
  res.json(settings);
});

app.post('/api/settings', (req, res) => {
  try {
    const incoming = req.body;

    // Basic validation
    if (incoming.devRoot) {
      // Expand ~ if needed
      incoming.devRoot = incoming.devRoot.replace(/^~/, os.homedir());
      if (!path.isAbsolute(incoming.devRoot)) {
        return res.status(400).json({ error: t('error.devRootMustBeAbsolute') });
      }
    }
    if (incoming.scanDepth !== undefined) {
      incoming.scanDepth = Math.max(1, Math.min(10, parseInt(incoming.scanDepth, 10)));
      if (isNaN(incoming.scanDepth)) return res.status(400).json({ error: t('error.scanDepthInvalid') });
    }
    if (incoming.ignoreDirs !== undefined && !Array.isArray(incoming.ignoreDirs)) {
      return res.status(400).json({ error: t('error.ignoreDirsMustBeArray') });
    }
    if (incoming.lang !== undefined && incoming.lang !== null && !catalogs[incoming.lang]) {
      return res.status(400).json({ error: t('error.unknownLanguageCode') });
    }

    settings = { ...settings, ...saveSettings({ ...settings, ...incoming }) };
    res.json({ ok: true, settings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Check whether a port is in use
app.get('/api/port-check/:port', (req, res) => {
  const port = parseInt(req.params.port, 10);
  if (!port || port < 1 || port > 65535) return res.status(400).json({ error: t('error.invalidPort') });
  const net = require('net');
  const tester = net.createConnection({ port, host: '127.0.0.1' });
  tester.once('connect', () => { tester.destroy(); res.json({ inUse: true, port }); });
  tester.once('error',   () => { res.json({ inUse: false, port }); });
});

app.get('/api/locales', (req, res) => {
  res.json(Object.keys(catalogs).map(code => ({
    code,
    name: catalogs[code]['_meta.name'] || code,
  })));
});

app.get('/api/version', (req, res) => {
  res.json({ name: pkg.name, version: pkg.version, schemaVersion: CURRENT_SCHEMA_VERSION });
});

app.get('/api/status', (req, res) => {
  const status = {};
  instances.forEach((inst, id) => { status[id] = { projectId: inst.projectId, commandKey: inst.commandKey, startedAt: inst.startedAt, pid: inst.process.pid }; });
  res.json(status);
});

// ─── SSE broadcast (real-time data) ──────────────────────────────────────────

const broadcastClients = new Set();

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  // Heartbeat every 30s to keep the connection alive
  const hb = setInterval(() => res.write(': ping\n\n'), 30000);

  broadcastClients.add(res);
  req.on('close', () => { broadcastClients.delete(res); clearInterval(hb); });
});

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  broadcastClients.forEach(c => c.write(msg));
}

// ─── Favorites ───────────────────────────────────────────────────────────────

const FAVORITES_FILE = path.join(DATA_DIR, 'favorites.json');

function loadFavorites() {
  try {
    if (fs.existsSync(FAVORITES_FILE)) return new Set(JSON.parse(fs.readFileSync(FAVORITES_FILE, 'utf8')));
  } catch {}
  return new Set();
}

function saveFavorites(set) {
  fs.writeFileSync(FAVORITES_FILE, JSON.stringify([...set], null, 2));
}

app.get('/api/favorites', (req, res) => {
  res.json([...loadFavorites()]);
});

app.post('/api/favorites/:id', (req, res) => {
  const favs = loadFavorites();
  favs.add(req.params.id);
  saveFavorites(favs);
  broadcast('favorites-changed', [...favs]);
  res.json({ ok: true });
});

app.delete('/api/favorites/:id', (req, res) => {
  const favs = loadFavorites();
  favs.delete(req.params.id);
  saveFavorites(favs);
  broadcast('favorites-changed', [...favs]);
  res.json({ ok: true });
});

// ─── Start ────────────────────────────────────────────────────────────────────

// Listens ONLY on the loopback interface (never 0.0.0.0). Do not change without
// understanding that /api/launch executes arbitrary shell commands.
const server = app.listen(config.port, '127.0.0.1', () => {
  console.log(`\n🚀 Dev Launcher → http://localhost:${config.port}`);
  console.log(`📁 Registry: ${registry.length} project${registry.length !== 1 ? 's' : ''} imported`);
  if (registry.length > 0) {
    registry.forEach(p => console.log(`  ✅ ${p.name}   ${p.path}`));
  } else {
    console.log('  ℹ️  No projects in the registry — use "Add" or "Scan" to import projects.');
  }
  console.log('');
});

// ─── Graceful shutdown ───────────────────────────────────────────────────────
// Kills launched commands to avoid leaving orphan processes when the
// server (or Electron app) shuts down.
function killAllInstances(signal = 'SIGTERM') {
  for (const inst of instances.values()) {
    try { inst.process.kill(signal); } catch {}
  }
  instances.clear();
}

let shuttingDown = false;
function shutdownStandalone() {
  if (shuttingDown) return;
  shuttingDown = true;
  killAllInstances('SIGTERM');
  // Brief delay to let SIGTERM propagate before exiting.
  setTimeout(() => process.exit(0), 300).unref();
}

process.on('SIGINT',  shutdownStandalone);
process.on('SIGTERM', shutdownStandalone);

// Exported so Electron can clean up processes on app.before-quit.
module.exports = { killAllInstances, server };
