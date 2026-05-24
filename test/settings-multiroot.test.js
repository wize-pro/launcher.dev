const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SETTINGS = path.join(__dirname, '..', 'settings.json');
const BACKUP = SETTINGS + '.testbak';
const HAD_SETTINGS = fs.existsSync(SETTINGS);
if (HAD_SETTINGS) fs.copyFileSync(SETTINGS, BACKUP);

process.env.PORT = '4462';
const { server, scanProjects } = require('../server.js');
const BASE = 'http://127.0.0.1:4462';

// Build two temp roots, each containing one detectable Node project.
function makeRoot(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dl-root-${label}-`));
  const proj = path.join(root, `proj-${label}`);
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: `proj-${label}` }));
  return { root, proj };
}

test('scan finds projects across multiple roots', async () => {
  const a = makeRoot('a');
  const b = makeRoot('b');

  const r = await fetch(BASE + '/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ devRoots: [a.root, b.root], scanDepth: 5 }),
  });
  assert.strictEqual(r.status, 200);

  const projects = scanProjects(() => {});
  const paths = projects.map(p => p.path);
  assert.ok(paths.includes(a.proj), 'project from root A is present');
  assert.ok(paths.includes(b.proj), 'project from root B is present');
});

test('POST /api/settings rejects non-array devRoots', async () => {
  const r = await fetch(BASE + '/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ devRoots: '/tmp/x' }),
  });
  assert.strictEqual(r.status, 400);
});

test('POST /api/settings rejects a relative path in devRoots', async () => {
  const r = await fetch(BASE + '/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ devRoots: ['relative/path'] }),
  });
  assert.strictEqual(r.status, 400);
});

test('POST /api/settings rejects an all-empty devRoots array', async () => {
  const r = await fetch(BASE + '/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ devRoots: ['', '   '] }),
  });
  assert.strictEqual(r.status, 400);
});

test('POST /api/settings expands ~ and keeps absolute roots', async () => {
  const r = await fetch(BASE + '/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ devRoots: ['~/dev', '/tmp/abs', ''] }),
  });
  assert.strictEqual(r.status, 200);
  const { settings } = await r.json();
  assert.ok(!settings.devRoots.includes(''), 'empty entry dropped');
  assert.ok(settings.devRoots.every(p => p.startsWith('/')), 'all roots absolute');
});

after(() => {
  if (HAD_SETTINGS) {
    fs.copyFileSync(BACKUP, SETTINGS);
    fs.unlinkSync(BACKUP);
  } else if (fs.existsSync(SETTINGS)) {
    fs.unlinkSync(SETTINGS);
  }
  server.closeAllConnections();
  server.close();
});
