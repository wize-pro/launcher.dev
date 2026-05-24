const express = require('express');
const os = require('os');
const path = require('path');

module.exports = (ctx) => {
  const r = express.Router();

  r.get('/api/settings', (req, res) => {
    res.json(ctx.store.settings);
  });

  r.post('/api/settings', (req, res) => {
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
  r.get('/api/port-check/:port', (req, res) => {
    const port = parseInt(req.params.port, 10);
    if (!port || port < 1 || port > 65535) return res.status(400).json({ error: ctx.t('error.invalidPort') });
    const net = require('net');
    const tester = net.createConnection({ port, host: '127.0.0.1' });
    tester.once('connect', () => { tester.destroy(); res.json({ inUse: true, port }); });
    tester.once('error',   () => { res.json({ inUse: false, port }); });
  });

  r.get('/api/locales', (req, res) => {
    res.json(Object.keys(ctx.store.catalogs).map(code => ({
      code,
      name: ctx.store.catalogs[code]['_meta.name'] || code,
    })));
  });

  r.get('/api/version', (req, res) => {
    res.json({ name: ctx.pkg.name, version: ctx.pkg.version, schemaVersion: ctx.CURRENT_SCHEMA_VERSION });
  });

  // ─── SSE broadcast (real-time data) ──────────────────────────────────────────

  r.get('/api/events', (req, res) => {
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();

    // Heartbeat every 30s to keep the connection alive
    const hb = setInterval(() => res.write(': ping\n\n'), 30000);

    ctx.store.broadcastClients.add(res);
    req.on('close', () => { ctx.store.broadcastClients.delete(res); clearInterval(hb); });
  });

  return r;
};
