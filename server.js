const express = require('express');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const config = require('./launcher.config');
const pkg = require('./package.json');
const i18n = require('./public/i18n.js');
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
  getLastActivity: (dir, hasGit) => gitLib.getLastActivity(dir, hasGit, { ignoreDirs: store.settings.ignoreDirs }),
  resolveIdeExec,
  saveSettings: (data) => settingsLib.saveSettings(SETTINGS_FILE, data),
  reloadSettings: () => { store.settings = settingsLib.loadSettings(SETTINGS_FILE); return store.settings; },
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

app.get('/api/projects', (req, res) => {
  try {
    const enriched = ctx.store.registry.map(p => {
      const git = ctx.detectGit(p.path);
      const activity = ctx.getLastActivity(p.path, git.hasGit);
      const assignedCatIds = ctx.store.categories.assignments[p.id] || [];
      const categories = assignedCatIds
        .map(cid => ctx.store.categories.categories.find(c => c.id === cid))
        .filter(Boolean);

      // Canonical schema is guaranteed by the startup migration; normalizeProject
      // is still applied here as a safety net (idempotent) in case an un-migrated
      // entry was added in the meantime.
      const np = ctx.normalizeProject(p);

      return {
        ...np,
        git,
        lastActivity: activity,
        categories,
        runningCommands: [...ctx.store.instances.keys()]
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
    const projects = ctx.scanProjects(send);
    // Mark each project as imported or new
    const marked = projects.map(p => ({
      ...p,
      imported: ctx.store.registry.some(r => r.id === p.id || r.path === p.path),
      runningCommands: [...ctx.store.instances.keys()]
        .filter(k => k.startsWith(p.id + '__'))
        .map(k => k.replace(p.id + '__', '')),
    }));
    res.write(`event: projects\ndata: ${JSON.stringify(marked)}\n\n`);
  } catch (e) {
    send('warn', ctx.t('scan.log.unexpectedError', undefined, { msg: e.message }));
  }

  res.end();
});

app.post('/api/launch', (req, res) => {
  const { projectId, commandKey } = req.body;
  if (!projectId || !commandKey) return res.status(400).json({ error: ctx.t('error.projectIdAndCommandKeyRequired') });

  const instanceId = `${projectId}__${commandKey}`;
  if (ctx.store.instances.has(instanceId)) return res.status(409).json({ error: ctx.t('error.alreadyRunning'), instanceId });

  const project = ctx.store.registry.find(p => p.id === projectId);
  if (!project) return res.status(404).json({ error: ctx.t('error.projectNotFound') });

  const cmdConfig = project.commands[commandKey];
  if (!cmdConfig) return res.status(404).json({ error: ctx.t('error.commandNotFound') });

  const cwd = cmdConfig.cwd ? path.resolve(project.path, cmdConfig.cwd) : project.path;

  console.log(`[launch] ${project.name} → ${cmdConfig.cmd} (cwd: ${cwd})`);

  const proc = spawn(cmdConfig.cmd, [], {
    cwd,
    shell: true,
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  const instance = { process: proc, projectId, commandKey, startedAt: new Date().toISOString(), logs: [], sseClients: [] };
  ctx.store.instances.set(instanceId, instance);

  const pushLog = (type, data) => {
    const line = { type, data: data.toString(), ts: Date.now() };
    instance.logs.push(line);
    if (instance.logs.length > 500) instance.logs.shift();
    instance.sseClients.forEach(c => c.write(`data: ${JSON.stringify(line)}\n\n`));
  };

  proc.stdout.on('data', d => pushLog('stdout', d));
  proc.stderr.on('data', d => pushLog('stderr', d));
  proc.on('exit', code => {
    pushLog('system', `\n${ctx.t('launch.log.processExited', undefined, { code: code ?? 'signal' })}\n`);
    ctx.store.instances.delete(instanceId);
    instance.sseClients.forEach(c => { c.write(`event: exit\ndata: ${JSON.stringify({ code })}\n\n`); c.end(); });
  });
  proc.on('error', err => pushLog('system', `${ctx.t('launch.log.processError', undefined, { msg: err.message })}\n`));

  res.json({ instanceId, pid: proc.pid });
});

app.post('/api/stop', (req, res) => {
  const instance = ctx.store.instances.get(req.body.instanceId);
  if (!instance) return res.status(404).json({ error: ctx.t('error.instanceNotFound') });
  instance.process.kill('SIGTERM');
  setTimeout(() => { if (ctx.store.instances.has(req.body.instanceId)) instance.process.kill('SIGKILL'); }, 3000);
  res.json({ ok: true });
});

app.get('/api/logs/:instanceId', (req, res) => {
  const instance = ctx.store.instances.get(req.params.instanceId);
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
  const project = ctx.store.registry.find(p => p.id === projectId);
  if (!project) return res.status(404).json({ error: ctx.t('error.projectNotFound') });

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
  const project = ctx.store.registry.find(p => p.id === projectId);
  if (!project) return res.status(404).json({ error: ctx.t('error.projectNotFound') });

  const resolvedId = ideId || project.ideId || ctx.store.settings.defaultIde;
  const ide = ctx.store.settings.ides?.find(i => i.id === resolvedId) || ctx.store.settings.ides?.[0];
  if (!ide) return res.status(400).json({ error: ctx.t('error.noEditorConfigured') });

  const exec = ctx.resolveIdeExec(ide);
  const proc = spawn(exec, [project.path], { shell: true, detached: true, stdio: 'ignore' });
  proc.unref();

  console.log(`[editor] ${ide.name} → ${project.path}`);
  res.json({ ok: true });
});

// Set the preferred IDE for a project
app.patch('/api/projects/:id/ide', (req, res) => {
  const { ideId } = req.body;
  const project = ctx.store.registry.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: ctx.t('error.projectNotFound') });
  if (ideId) project.ideId = ideId;
  else delete project.ideId;
  ctx.saveRegistry();
  ctx.broadcast('project-ide-changed', { id: project.id, ideId: project.ideId ?? null });
  res.json({ ok: true });
});

// ─── Categories API ───────────────────────────────────────────────────────────

app.get('/api/categories', (req, res) => res.json(ctx.store.categories));

// Create or update a category
app.post('/api/categories', (req, res) => {
  const { id, name, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: ctx.t('error.nameRequired') });
  if (id) {
    // Update
    const cat = ctx.store.categories.categories.find(c => c.id === id);
    if (!cat) return res.status(404).json({ error: ctx.t('error.categoryNotFound') });
    cat.name  = name.trim();
    cat.color = color || cat.color;
  } else {
    // Create
    const newCat = { id: `cat_${Date.now()}`, name: name.trim(), color: color || '#6366f1' };
    ctx.store.categories.categories.push(newCat);
  }
  ctx.saveCategories();
  res.json(ctx.store.categories);
});

// Delete a category
app.delete('/api/categories/:id', (req, res) => {
  const { id } = req.params;
  ctx.store.categories.categories = ctx.store.categories.categories.filter(c => c.id !== id);
  // Clean up assignments
  for (const pid of Object.keys(ctx.store.categories.assignments)) {
    ctx.store.categories.assignments[pid] = ctx.store.categories.assignments[pid].filter(cid => cid !== id);
    if (!ctx.store.categories.assignments[pid].length) delete ctx.store.categories.assignments[pid];
  }
  ctx.saveCategories();
  res.json(ctx.store.categories);
});

// Assign / unassign a category to a project
app.post('/api/categories/assign', (req, res) => {
  const { projectId, categoryId, action } = req.body; // action: 'add' | 'remove'
  if (!projectId || !categoryId) return res.status(400).json({ error: ctx.t('error.projectIdAndCategoryIdRequired') });
  const current = ctx.store.categories.assignments[projectId] || [];
  if (action === 'add' && !current.includes(categoryId)) {
    ctx.store.categories.assignments[projectId] = [...current, categoryId];
  } else if (action === 'remove') {
    ctx.store.categories.assignments[projectId] = current.filter(id => id !== categoryId);
    if (!ctx.store.categories.assignments[projectId].length) delete ctx.store.categories.assignments[projectId];
  }
  ctx.saveCategories();
  res.json(ctx.store.categories.assignments[projectId] || []);
});

// ─── Registry API ─────────────────────────────────────────────────────────────

// Detect the properties of a path (without importing it)
app.post('/api/projects/detect', (req, res) => {
  let dirPath = (req.body.path || '').trim();
  if (!dirPath) return res.status(400).json({ error: ctx.t('error.pathRequired') });

  // Expand ~
  dirPath = dirPath.replace(/^~/, os.homedir());

  if (!fs.existsSync(dirPath)) return res.status(404).json({ error: ctx.t('error.folderNotFound') });
  if (!fs.statSync(dirPath).isDirectory()) return res.status(400).json({ error: ctx.t('error.notADirectory') });

  const id = Buffer.from(dirPath).toString('base64url');
  const alreadyImported = ctx.store.registry.some(r => r.id === id || r.path === dirPath);

  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); }
  catch (e) { return res.status(400).json({ error: ctx.t('error.cannotRead', undefined, { msg: e.message }) }); }

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
  if (!dirPath || !name?.trim()) return res.status(400).json({ error: ctx.t('error.pathAndNameRequired') });

  dirPath = dirPath.replace(/^~/, os.homedir());
  const id = Buffer.from(dirPath).toString('base64url');

  const existing = ctx.store.registry.find(p => p.id === id || p.path === dirPath);
  if (existing) return res.status(409).json({ error: ctx.t('error.projectAlreadyImported'), project: existing });

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

  ctx.store.registry.push(newProject);
  ctx.saveRegistry();
  res.status(201).json(newProject);
});

// Update a project in the registry
app.put('/api/projects/:id', (req, res) => {
  const { id } = req.params;
  const idx = ctx.store.registry.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: ctx.t('error.projectNotFound') });

  const { name, description, components, type, color, commands } = req.body;
  const updated = {
    ...ctx.store.registry[idx],
    name: (name || ctx.store.registry[idx].name).trim(),
    description: (description ?? ctx.store.registry[idx].description ?? '').trim(),
    components: components ?? ctx.store.registry[idx].components ?? ctx.store.registry[idx].tags ?? [],
    type: type !== undefined ? (type || null) : (ctx.store.registry[idx].type || ctx.store.registry[idx].typeOverride || null),
    color: color !== undefined ? color : ctx.store.registry[idx].color,
    commands: commands ?? ctx.store.registry[idx].commands,
    updatedAt: Date.now(),
  };

  ctx.store.registry[idx] = updated;
  ctx.saveRegistry();
  res.json(updated);
});

// Remove a project from the registry
app.delete('/api/projects/:id', (req, res) => {
  const { id } = req.params;
  const idx = ctx.store.registry.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: ctx.t('error.projectNotFound') });

  ctx.store.registry.splice(idx, 1);
  ctx.saveRegistry();

  // Clean up category assignments
  delete ctx.store.categories.assignments[id];
  ctx.saveCategories();

  // Kill running instances for this project
  for (const [key, inst] of ctx.store.instances) {
    if (key.startsWith(id + '__')) {
      inst.process.kill('SIGTERM');
      ctx.store.instances.delete(key);
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
    title:       ctx.t('dialog.pickFolder.title'),
    defaultPath,
    properties:  ['openDirectory', 'createDirectory'],
    buttonLabel: ctx.t('dialog.pickFolder.button'),
  });

  if (result.canceled) return res.json({ canceled: true });
  res.json({ path: result.filePaths[0] });
});

// ─── Settings API ─────────────────────────────────────────────────────────────

app.get('/api/settings', (req, res) => {
  res.json(ctx.store.settings);
});

app.post('/api/settings', (req, res) => {
  try {
    const incoming = req.body;

    // Basic validation
    if (incoming.devRoots !== undefined) {
      if (!Array.isArray(incoming.devRoots)) {
        return res.status(400).json({ error: ctx.t('error.devRootsMustBeArray') });
      }
      const cleaned = incoming.devRoots
        .map(p => String(p).trim().replace(/^~/, os.homedir()))
        .filter(Boolean);
      if (cleaned.length === 0) {
        return res.status(400).json({ error: ctx.t('error.devRootsEmpty') });
      }
      if (cleaned.some(p => !path.isAbsolute(p))) {
        return res.status(400).json({ error: ctx.t('error.devRootMustBeAbsolute') });
      }
      incoming.devRoots = cleaned;
    }
    if (incoming.scanDepth !== undefined) {
      incoming.scanDepth = Math.max(1, Math.min(10, parseInt(incoming.scanDepth, 10)));
      if (isNaN(incoming.scanDepth)) return res.status(400).json({ error: ctx.t('error.scanDepthInvalid') });
    }
    if (incoming.ignoreDirs !== undefined && !Array.isArray(incoming.ignoreDirs)) {
      return res.status(400).json({ error: ctx.t('error.ignoreDirsMustBeArray') });
    }
    if (incoming.lang !== undefined && incoming.lang !== null && !ctx.store.catalogs[incoming.lang]) {
      return res.status(400).json({ error: ctx.t('error.unknownLanguageCode') });
    }

    ctx.store.settings = { ...ctx.store.settings, ...ctx.saveSettings({ ...ctx.store.settings, ...incoming }) };
    res.json({ ok: true, settings: ctx.store.settings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Check whether a port is in use
app.get('/api/port-check/:port', (req, res) => {
  const port = parseInt(req.params.port, 10);
  if (!port || port < 1 || port > 65535) return res.status(400).json({ error: ctx.t('error.invalidPort') });
  const net = require('net');
  const tester = net.createConnection({ port, host: '127.0.0.1' });
  tester.once('connect', () => { tester.destroy(); res.json({ inUse: true, port }); });
  tester.once('error',   () => { res.json({ inUse: false, port }); });
});

app.get('/api/locales', (req, res) => {
  res.json(Object.keys(ctx.store.catalogs).map(code => ({
    code,
    name: ctx.store.catalogs[code]['_meta.name'] || code,
  })));
});

app.get('/api/version', (req, res) => {
  res.json({ name: ctx.pkg.name, version: ctx.pkg.version, schemaVersion: ctx.CURRENT_SCHEMA_VERSION });
});

app.get('/api/status', (req, res) => {
  const status = {};
  ctx.store.instances.forEach((inst, id) => { status[id] = { projectId: inst.projectId, commandKey: inst.commandKey, startedAt: inst.startedAt, pid: inst.process.pid }; });
  res.json(status);
});

// ─── SSE broadcast (real-time data) ──────────────────────────────────────────

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  // Heartbeat every 30s to keep the connection alive
  const hb = setInterval(() => res.write(': ping\n\n'), 30000);

  ctx.store.broadcastClients.add(res);
  req.on('close', () => { ctx.store.broadcastClients.delete(res); clearInterval(hb); });
});

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
