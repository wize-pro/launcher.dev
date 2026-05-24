const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SETTINGS = path.join(__dirname, '..', 'settings.json');
const BACKUP = SETTINGS + '.testbak3';
const HAD_SETTINGS = fs.existsSync(SETTINGS);
if (HAD_SETTINGS) fs.copyFileSync(SETTINGS, BACKUP);

process.env.PORT = '4458';
const { server } = require('../server.js');
const BASE = 'http://localhost:4458';

async function setLang(lang) {
  await fetch(BASE + '/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang }),
  });
}

test('404 project-not-found message is French when lang=fr', async () => {
  await setLang('fr');
  const r = await fetch(BASE + '/api/projects/__nope__', { method: 'DELETE' });
  assert.strictEqual(r.status, 404);
  assert.strictEqual((await r.json()).error, 'Projet introuvable');
});

test('404 project-not-found message is English when lang=en', async () => {
  await setLang('en');
  const r = await fetch(BASE + '/api/projects/__nope__', { method: 'DELETE' });
  assert.strictEqual(r.status, 404);
  assert.strictEqual((await r.json()).error, 'Project not found');
});

after(() => {
  if (HAD_SETTINGS) { fs.copyFileSync(BACKUP, SETTINGS); fs.unlinkSync(BACKUP); }
  else if (fs.existsSync(SETTINGS)) fs.unlinkSync(SETTINGS);
  server.closeAllConnections();
  server.close();
});
