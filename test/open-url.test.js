const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SETTINGS = path.join(__dirname, '..', 'settings.json');
const BACKUP = SETTINGS + '.testbak';
const HAD = fs.existsSync(SETTINGS);
if (HAD) fs.copyFileSync(SETTINGS, BACKUP);

process.env.PORT = '4463';
const { server } = require('../server.js');
const BASE = 'http://127.0.0.1:4463';

async function post(url) {
  return fetch(BASE + '/api/open-url', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

test('rejects a non-loopback host', async () => {
  const r = await post('http://example.com');
  assert.strictEqual(r.status, 400);
  const b = await r.json();
  assert.notStrictEqual(b.error, 'native_unavailable');
});

test('rejects a non-http scheme', async () => {
  const r = await post('file:///etc/passwd');
  assert.strictEqual(r.status, 400);
});

test('rejects a missing url', async () => {
  const r = await fetch(BASE + '/api/open-url', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.strictEqual(r.status, 400);
});

test('valid loopback url with no Electron → native_unavailable', async () => {
  const r = await post('http://localhost:3000');
  assert.strictEqual(r.status, 400);
  const b = await r.json();
  assert.strictEqual(b.error, 'native_unavailable');
});

after(() => {
  if (HAD) { fs.copyFileSync(BACKUP, SETTINGS); fs.unlinkSync(BACKUP); }
  else if (fs.existsSync(SETTINGS)) fs.unlinkSync(SETTINGS);
  server.closeAllConnections();
  server.close();
});
