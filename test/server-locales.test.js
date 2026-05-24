const { test, after } = require('node:test');
const assert = require('node:assert');

process.env.PORT = '4456';
const { server } = require('../server.js'); // starts listening on 127.0.0.1:4456

const BASE = 'http://127.0.0.1:4456';

async function get(path) {
  const r = await fetch(BASE + path);
  return { status: r.status, body: await r.json() };
}

test('GET /api/locales lists available languages with names', async () => {
  const { status, body } = await get('/api/locales');
  assert.strictEqual(status, 200);
  const codes = body.map(l => l.code).sort();
  assert.deepStrictEqual(codes, ['en', 'fr']);
  const fr = body.find(l => l.code === 'fr');
  assert.strictEqual(fr.name, 'Français');
});

test('GET /locales/fr.json is served statically', async () => {
  const r = await fetch(BASE + '/locales/fr.json');
  assert.strictEqual(r.status, 200);
  const json = await r.json();
  assert.strictEqual(json['settings.title'], 'Paramètres');
});

after(() => { server.closeAllConnections(); server.close(); });
