const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const yaml = require('js-yaml');
const scanner = require('../lib/scanner.js');
const config = require('../launcher.config');

module.exports = (ctx) => {
  const r = express.Router();

  r.get('/api/projects', (req, res) => {
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
  r.get('/api/scan-stream', (req, res) => {
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

  // Open the folder in the file explorer (cross-platform)
  r.post('/api/open-folder', (req, res) => {
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
  r.post('/api/open-editor', (req, res) => {
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
  r.patch('/api/projects/:id/ide', (req, res) => {
    const { ideId } = req.body;
    const project = ctx.store.registry.find(p => p.id === req.params.id);
    if (!project) return res.status(404).json({ error: ctx.t('error.projectNotFound') });
    if (ideId) project.ideId = ideId;
    else delete project.ideId;
    ctx.saveRegistry();
    ctx.broadcast('project-ide-changed', { id: project.id, ideId: project.ideId ?? null });
    res.json({ ok: true });
  });

  // ─── Registry API ─────────────────────────────────────────────────────────────

  // Detect the properties of a path (without importing it)
  r.post('/api/projects/detect', (req, res) => {
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
  r.post('/api/projects', (req, res) => {
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
  r.put('/api/projects/:id', (req, res) => {
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
  r.delete('/api/projects/:id', (req, res) => {
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

  // ─── Open a loopback URL in the external browser (Electron only) ─────────────

  r.post('/api/open-url', (req, res) => {
    const { url } = req.body || {};
    let parsed;
    try { parsed = new URL(String(url)); } catch { return res.status(400).json({ error: ctx.t('error.invalidUrl') }); }
    const loopback = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
    if (!['http:', 'https:'].includes(parsed.protocol) || !loopback.has(parsed.hostname)) {
      return res.status(400).json({ error: ctx.t('error.invalidUrl') });
    }
    let shell;
    try { shell = require('electron').shell; } catch { /* web mode */ }
    if (!shell) return res.status(400).json({ error: 'native_unavailable' });
    shell.openExternal(parsed.href);
    res.json({ ok: true });
  });

  // ─── Native folder picker (Electron only) ─────────────────────────────────────

  r.get('/api/pick-folder', async (req, res) => {
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

  return r;
};
