const express = require('express');
const path = require('path');
const config = require('./launcher.config');
const pkg = require('./package.json');
const { loadCatalogs, makeT } = require('./lib/i18n.js');
const { resolveIdeExec } = require('./lib/ides.js');
const gitLib = require('./lib/git.js');
const scanner = require('./lib/scanner.js');
const registryLib  = require('./lib/registry.js');
const categoriesLib = require('./lib/categories.js');
const settingsLib = require('./lib/settings.js');
const { SETTINGS_DEFAULTS, CURRENT_SCHEMA_VERSION } = settingsLib;
const { normalizeProject } = registryLib;

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

// ─── File paths ───────────────────────────────────────────────────────────────
const SETTINGS_FILE   = path.join(DATA_DIR, 'settings.json');
const PROJECTS_FILE   = path.join(DATA_DIR, 'projects.json');
const CATEGORIES_FILE = path.join(DATA_DIR, 'categories.json');
const FAVORITES_FILE  = path.join(DATA_DIR, 'favorites.json');
const LOCALES_DIR     = path.join(__dirname, 'locales');

// ─── Assembled context ────────────────────────────────────────────────────────

const store = {
  settings:         settingsLib.loadSettings(SETTINGS_FILE),
  registry:         registryLib.loadRegistry(PROJECTS_FILE),
  categories:       categoriesLib.loadCategories(CATEGORIES_FILE),
  catalogs:         loadCatalogs(LOCALES_DIR),
  instances:        new Map(),
  broadcastClients: new Set(),
};

const t = makeT(store);
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  store.broadcastClients.forEach(c => c.write(msg));
}

const ctx = {
  config, pkg,
  paths: { SETTINGS_FILE, PROJECTS_FILE, CATEGORIES_FILE, FAVORITES_FILE, LOCALES_DIR },
  store,
  SETTINGS_DEFAULTS, CURRENT_SCHEMA_VERSION,
  t, broadcast,
  scanProjects: (push) => scanner.scanProjects(push, { settings: store.settings, t }),
  detectGit: gitLib.detectGit,
  getGitStatus: gitLib.getGitStatus,
  getLastActivity: (dir, hasGit) => gitLib.getLastActivity(dir, hasGit, { ignoreDirs: store.settings.ignoreDirs }),
  resolveIdeExec,
  saveSettings: (data) => settingsLib.saveSettings(SETTINGS_FILE, data),
  saveRegistry: () => registryLib.saveRegistry(PROJECTS_FILE, store.registry),
  saveCategories: () => categoriesLib.saveCategories(CATEGORIES_FILE, store.categories),
  normalizeProject,
};

settingsLib.runMigrations(ctx);

// ─── Express app ──────────────────────────────────────────────────────────────

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
    return res.status(403).json({ error: ctx.t('error.forbidden') });
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/locales', express.static(LOCALES_DIR));

// ─── API ──────────────────────────────────────────────────────────────────────

app.use(require('./routes/projects.js')(ctx));
app.use(require('./routes/launch.js')(ctx));
app.use(require('./routes/categories.js')(ctx));

app.use(require('./routes/settings.js')(ctx));

app.use(require('./routes/favorites.js')(ctx));

// ─── Start ────────────────────────────────────────────────────────────────────

// Listens ONLY on the loopback interface (never 0.0.0.0). Do not change without
// understanding that /api/launch executes arbitrary shell commands.
const server = app.listen(config.port, '127.0.0.1', () => {
  console.log(`\n🚀 Dev Launcher → http://localhost:${config.port}`);
  console.log(`📁 Registry: ${ctx.store.registry.length} project${ctx.store.registry.length !== 1 ? 's' : ''} imported`);
  if (ctx.store.registry.length > 0) {
    ctx.store.registry.forEach(p => console.log(`  ✅ ${p.name}   ${p.path}`));
  } else {
    console.log('  ℹ️  No projects in the registry — use "Add" or "Scan" to import projects.');
  }
  console.log('');
});

// ─── Graceful shutdown ───────────────────────────────────────────────────────
// Kills launched commands to avoid leaving orphan processes when the
// server (or Electron app) shuts down.
function killAllInstances(signal = 'SIGTERM') {
  for (const inst of ctx.store.instances.values()) {
    try { inst.process.kill(signal); } catch {}
  }
  ctx.store.instances.clear();
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
module.exports = { killAllInstances, server, scanProjects: ctx.scanProjects };
