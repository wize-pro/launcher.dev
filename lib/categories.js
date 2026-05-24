const fs = require('fs');

function loadCategories(file) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.warn('⚠️  Cannot read categories.json:', e.message); }
  return { categories: [], assignments: {} };
}

function saveCategories(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = { loadCategories, saveCategories };
