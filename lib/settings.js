const fs = require('fs');
const config = require('../launcher.config');
const { normalizeProject } = require('./registry.js');

const SETTINGS_DEFAULTS = {
  devRoots:   [config.devRoot],
  scanDepth:  config.scanDepth,
  ignoreDirs: config.ignoreDirs,
  ides: [
    { id: 'vscode',   name: 'VS Code',   cmd: 'code'      },
    { id: 'cursor',   name: 'Cursor',    cmd: 'cursor'    },
    { id: 'windsurf', name: 'Windsurf',  cmd: 'windsurf'  },
  ],
  defaultIde: 'vscode',
  lang: null,
  schemaVersion: 2,
};
const CURRENT_SCHEMA_VERSION = SETTINGS_DEFAULTS.schemaVersion;

function loadSettings(file) {
  try { if (fs.existsSync(file)) return { ...SETTINGS_DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch (e) { console.warn('⚠️  Cannot read settings.json:', e.message); }
  return { ...SETTINGS_DEFAULTS };
}

function saveSettings(file, data) {
  const toSave = {};
  for (const key of Object.keys(SETTINGS_DEFAULTS)) if (data[key] !== undefined) toSave[key] = data[key];
  if (toSave.ides && (!Array.isArray(toSave.ides) || toSave.ides.some(i => !i.id || !i.name || !i.cmd))) delete toSave.ides;
  fs.writeFileSync(file, JSON.stringify(toSave, null, 2), 'utf8');
  return toSave;
}

function migrateRegistryToCanonical(ctx) {
  let changed = false;
  ctx.store.registry = ctx.store.registry.map(p => {
    const n = normalizeProject(p);
    if (JSON.stringify(n) !== JSON.stringify(p)) changed = true;
    return n;
  });
  if (changed) ctx.saveRegistry();
}

function migrateSettingsToMultiRoot(ctx) {
  let raw = {};
  try { if (fs.existsSync(ctx.paths.SETTINGS_FILE)) raw = JSON.parse(fs.readFileSync(ctx.paths.SETTINGS_FILE, 'utf8')); } catch {}
  if (typeof raw.devRoot === 'string' && !Array.isArray(raw.devRoots)) {
    ctx.store.settings.devRoots = [raw.devRoot];
    delete ctx.store.settings.devRoot;
    ctx.saveSettings(ctx.store.settings);
  }
}

const MIGRATIONS = { 1: migrateRegistryToCanonical, 2: migrateSettingsToMultiRoot };

function rawSchemaVersion(file) {
  try { if (fs.existsSync(file)) { const raw = JSON.parse(fs.readFileSync(file, 'utf8')); return Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : 0; } }
  catch {}
  return null;
}

function runMigrations(ctx) {
  const rawV = rawSchemaVersion(ctx.paths.SETTINGS_FILE);
  let from;
  if (rawV === null) from = fs.existsSync(ctx.paths.PROJECTS_FILE) ? 0 : CURRENT_SCHEMA_VERSION;
  else from = rawV;
  if (from < CURRENT_SCHEMA_VERSION) {
    console.log(`[migration] data schema ${from} → ${CURRENT_SCHEMA_VERSION}`);
    for (let v = from + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
      if (MIGRATIONS[v]) { MIGRATIONS[v](ctx); console.log(`[migration] step v${v} applied`); }
    }
  }
  ctx.store.settings.schemaVersion = CURRENT_SCHEMA_VERSION;
  ctx.saveSettings(ctx.store.settings);
  ctx.store.settings = loadSettings(ctx.paths.SETTINGS_FILE);
}

module.exports = { SETTINGS_DEFAULTS, CURRENT_SCHEMA_VERSION, loadSettings, saveSettings, runMigrations };
