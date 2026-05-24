const { test, after, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SETTINGS = path.join(__dirname, '..', 'settings.json');
const BACKUP = SETTINGS + '.testbak';
const HAD_SETTINGS = fs.existsSync(SETTINGS);

before(() => {
  if (HAD_SETTINGS) fs.copyFileSync(SETTINGS, BACKUP);
  // Seed a legacy v1 settings file with the old scalar devRoot.
  fs.writeFileSync(SETTINGS, JSON.stringify({
    devRoot: '/tmp/legacy-root',
    scanDepth: 5,
    schemaVersion: 1,
  }, null, 2));
});

// Requiring the server triggers runMigrations() at startup.
process.env.PORT = '4461';
require('../server.js');

test('schema-v2 migration converts legacy devRoot to devRoots', () => {
  const saved = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  assert.deepStrictEqual(saved.devRoots, ['/tmp/legacy-root']);
  assert.strictEqual(saved.devRoot, undefined);
  assert.strictEqual(saved.schemaVersion, 2);
});

after(() => {
  const { server } = require('../server.js');
  if (HAD_SETTINGS) {
    fs.copyFileSync(BACKUP, SETTINGS);
    fs.unlinkSync(BACKUP);
  } else if (fs.existsSync(SETTINGS)) {
    fs.unlinkSync(SETTINGS);
  }
  server.closeAllConnections();
  server.close();
});
