const express = require('express');
const path = require('path');
const { spawn } = require('child_process');

module.exports = (ctx) => {
  const r = express.Router();

  r.post('/api/launch', (req, res) => {
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

  r.post('/api/stop', (req, res) => {
    const instance = ctx.store.instances.get(req.body.instanceId);
    if (!instance) return res.status(404).json({ error: ctx.t('error.instanceNotFound') });
    instance.process.kill('SIGTERM');
    setTimeout(() => { if (ctx.store.instances.has(req.body.instanceId)) instance.process.kill('SIGKILL'); }, 3000);
    res.json({ ok: true });
  });

  r.get('/api/logs/:instanceId', (req, res) => {
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

  r.get('/api/status', (req, res) => {
    const status = {};
    ctx.store.instances.forEach((inst, id) => { status[id] = { projectId: inst.projectId, commandKey: inst.commandKey, startedAt: inst.startedAt, pid: inst.process.pid }; });
    res.json(status);
  });

  return r;
};
