const fs = require('fs');

function loadRegistry(file) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.warn('⚠️  Cannot read projects.json:', e.message); }
  return [];
}

function saveRegistry(file, registry) {
  fs.writeFileSync(file, JSON.stringify(registry, null, 2));
}

// Normalizes a project to the current canonical schema:
//   components = tech stack · type = manual type · subProjects = sub-projects
// Absorbs legacy fields (tags, typeOverride, structural components of a multi-project).
// Idempotent: applying multiple times has no effect.
function normalizeProject(p) {
  const isOldMulti = p.source === 'multi' && !p.subProjects;
  const components = isOldMulti
    ? (p.tags || []).filter(t => t !== 'multi')
    : (p.components && !p.subProjects && p.tags ? p.tags : (p.components || p.tags || []));
  const subProjects = p.subProjects || (isOldMulti ? p.components || [] : []);
  const type = p.type || p.typeOverride || null;
  const { tags, typeOverride, ...rest } = p;
  return { ...rest, components, subProjects, type };
}

module.exports = { loadRegistry, saveRegistry, normalizeProject };
