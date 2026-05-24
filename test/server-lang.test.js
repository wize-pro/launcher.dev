const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Use an isolated backup so we never lose the developer's real settings.json.
const SETTINGS = path.join(__dirname, '..', 'settings.json');
const BACKUP = SETTINGS + '.testbak';
if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, BACKUP);

process.env.PORT = '4457';
const { server } = require('../server.js');
const BASE = 'http://localhost:4457';

test('POST /api/settings accepts a known language', async () => {
  const r = await fetch(BASE + '/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang: 'fr' }),
  });
  assert.strictEqual(r.status, 200);
  const { settings } = await r.json();
  assert.strictEqual(settings.lang, 'fr');
});

test('POST /api/settings rejects an unknown language', async () => {
  const r = await fetch(BASE + '/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang: 'zz' }),
  });
  assert.strictEqual(r.status, 400);
});

after(() => {
  // Restore the developer's settings.json, then shut the server down cleanly.
  if (fs.existsSync(BACKUP)) { fs.copyFileSync(BACKUP, SETTINGS); fs.unlinkSync(BACKUP); }
  server.close();
  server.closeAllConnections();
});
