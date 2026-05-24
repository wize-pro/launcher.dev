const fs = require('fs');
const path = require('path');
const i18n = require('../public/i18n.js');

function loadCatalogs(localesDir) {
  const catalogs = {};
  try {
    for (const f of fs.readdirSync(localesDir)) {
      if (!f.endsWith('.json')) continue;
      const code = f.replace(/\.json$/, '');
      try {
        catalogs[code] = JSON.parse(fs.readFileSync(path.join(localesDir, f), 'utf8'));
      } catch (e) {
        console.warn(`Failed to parse locale ${f}: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn(`Cannot read locales directory: ${e.message}`);
  }
  if (!catalogs.en) catalogs.en = {};
  return catalogs;
}

// Returns a t(key, lang, params) bound to a live store (reads store.settings.lang + store.catalogs).
function makeT(store) {
  return (key, lang, params) =>
    i18n.translate(store.catalogs, lang || store.settings.lang || 'en', key, params);
}

module.exports = { loadCatalogs, makeT };
