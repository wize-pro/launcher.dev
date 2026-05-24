const fs = require('fs');

function loadFavorites(file) {
  try { if (fs.existsSync(file)) return new Set(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch {}
  return new Set();
}

function saveFavorites(file, set) {
  fs.writeFileSync(file, JSON.stringify([...set], null, 2));
}

module.exports = { loadFavorites, saveFavorites };
