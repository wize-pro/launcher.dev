const { test } = require('node:test');
const assert = require('node:assert');
const { translate, detectLang } = require('../public/i18n.js');

test('translate returns the value for an existing key in the active language', () => {
  const cat = { en: { greeting: 'Hello' }, fr: { greeting: 'Bonjour' } };
  assert.strictEqual(translate(cat, 'fr', 'greeting'), 'Bonjour');
});

test('translate falls back to English when the key is missing in the active language', () => {
  const cat = { en: { greeting: 'Hello' }, fr: {} };
  assert.strictEqual(translate(cat, 'fr', 'greeting'), 'Hello');
});

test('translate falls back to the raw key when missing everywhere', () => {
  const cat = { en: {}, fr: {} };
  assert.strictEqual(translate(cat, 'fr', 'missing.key'), 'missing.key');
});

test('translate interpolates {placeholders}', () => {
  const cat = { en: { found: '{count} projects found' } };
  assert.strictEqual(translate(cat, 'en', 'found', { count: 3 }), '3 projects found');
});

test('translate handles an unknown active language by using English', () => {
  const cat = { en: { greeting: 'Hello' } };
  assert.strictEqual(translate(cat, 'zz', 'greeting'), 'Hello');
});

test('translate falls back to the raw key when catalogs is null', () => {
  assert.strictEqual(translate(null, 'en', 'missing.key'), 'missing.key');
});

test('translate interpolates multiple placeholders', () => {
  const cat = { en: { x: '{a} and {b}' } };
  assert.strictEqual(translate(cat, 'en', 'x', { a: 1, b: 2 }), '1 and 2');
});

test('translate leaves the placeholder untouched for a null/undefined param', () => {
  const cat = { en: { x: '{a}' } };
  assert.strictEqual(translate(cat, 'en', 'x', { a: undefined }), '{a}');
});

test('detectLang falls back to English with an empty supported list', () => {
  assert.strictEqual(detectLang('fr', []), 'en');
});

test('detectLang picks the supported base language', () => {
  assert.strictEqual(detectLang('fr-FR', ['en', 'fr']), 'fr');
});

test('detectLang falls back to English for unsupported languages', () => {
  assert.strictEqual(detectLang('de-DE', ['en', 'fr']), 'en');
});

test('detectLang handles empty/undefined input', () => {
  assert.strictEqual(detectLang(undefined, ['en', 'fr']), 'en');
});
