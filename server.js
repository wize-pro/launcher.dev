const express = require('express');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const config = require('./launcher.config');
const pkg = require('./package.json');
const i18n = require('./public/i18n.js');
const { loadCatalogs } = require('./lib/i18n.js');
const { resolveIdeExec } = require('./lib/ides.js');
const gitLib = require('./lib/git.js');
const scanner = require('./lib/scanner.js');
const registryLib  = require('./lib/registry.js');
const categoriesLib = require('./lib/categories.js');
const favoritesLib  = require('./lib/favorites.js');

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

let catalogs = loadCatalogs(LOCALES_DIR);

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
  devRoots:   [config.devRoot],
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
  schemaVersion: 2,
};

// Current data schema version. Increment on every change to the JSON file format,
// and add a corresponding step in MIGRATIONS below.
const CURRENT_SCHEMA_VERSION = SETTINGS_DEFAULTS.schemaVersion;

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

let categoriesData = categoriesLib.loadCategories(CATEGORIES_FILE);
const persistCategories = () => categoriesLib.saveCategories(CATEGORIES_FILE, categoriesData);

// ─── Project Registry (source of truth) ──────────────────────────────────────

const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const normalizeProject = registryLib.normalizeProject;
let registry = registryLib.loadRegistry(PROJECTS_FILE);
const saveRegistry = () => registryLib.saveRegistry(PROJECTS_FILE, registry);

// ─── Data schema & migrations ─────────────────────────────────────────────────

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

// Migration v2: replaces the legacy scalar `devRoot` with a `devRoots` array.
function migrateSettingsToMultiRoot() {
  let raw = {};
  try {
    if (fs.existsSync(SETTINGS_FILE)) raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {}
  if (typeof raw.devRoot === 'string' && !Array.isArray(raw.devRoots)) {
    settings.devRoots = [raw.devRoot];
    delete settings.devRoot;
    saveSettings(settings);
  }
}

const MIGRATIONS = {
  1: migrateRegistryToCanonical,
  2: migrateSettingsToMultiRoot,
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

// ─── API ──────────────────────────────────────────────────────────────────────

app.get('/api/projects', (req, res) => {
  try {
    const enriched = registry.map(p => {
      const git = gitLib.detectGit(p.path);
      const activity = gitLib.getLastActivity(p.path, git.hasGit, { ignoreDirs: settings.ignoreDirs });
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
    const projects = scanner.scanProjects(send, { settings, t });
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
  saveRegistry();
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
          components: launchComps, suggestedType: scanner.suggestProjectType(launchComps),
          color: data.color || null, commands: data.commands || {},
          source: 'launcher.yml', alreadyImported });
      }
    } catch {}
  }

  // Auto-detection
  const detected = scanner.detectProject(dirPath, entries);
  const folderName = path.basename(dirPath);
  const displayName = scanner.smartName(dirPath);

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
    if (incoming.devRoots !== undefined) {
      if (!Array.isArray(incoming.devRoots)) {
        return res.status(400).json({ error: t('error.devRootsMustBeArray') });
      }
      const cleaned = incoming.devRoots
        .map(p => String(p).trim().replace(/^~/, os.homedir()))
        .filter(Boolean);
      if (cleaned.length === 0) {
        return res.status(400).json({ error: t('error.devRootsEmpty') });
      }
      if (cleaned.some(p => !path.isAbsolute(p))) {
        return res.status(400).json({ error: t('error.devRootMustBeAbsolute') });
      }
      incoming.devRoots = cleaned;
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
const loadFavorites = () => favoritesLib.loadFavorites(FAVORITES_FILE);
const saveFavorites = (set) => favoritesLib.saveFavorites(FAVORITES_FILE, set);

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

// Thin wrapper preserving the one-arg signature expected by tests and Electron.
const scanProjects = (push) => scanner.scanProjects(push, { settings, t });

// Exported so Electron can clean up processes on app.before-quit.
module.exports = { killAllInstances, server, scanProjects };
