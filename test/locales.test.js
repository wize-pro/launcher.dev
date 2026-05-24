const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'locales');

function load(code) {
  return JSON.parse(fs.readFileSync(path.join(DIR, code + '.json'), 'utf8'));
}

test('en.json exists and has a _meta.name', () => {
  const en = load('en');
  assert.ok(en['_meta.name'], 'en.json must define _meta.name');
});

test('every non-English locale has exactly the same keys as en.json', () => {
  const en = load('en');
  const enKeys = Object.keys(en).sort();
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.json') || f === 'en.json') continue;
    const other = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    assert.deepStrictEqual(Object.keys(other).sort(), enKeys, `${f} keys must match en.json`);
  }
});
