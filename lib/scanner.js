const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const config = require('../launcher.config');

// Infers the main project type from its technology components
function suggestProjectType(components) {
  const s = new Set(Array.isArray(components) ? components : []);
  if (s.has('multi'))                                                     return 'multi';
  if (s.has('electron') || s.has('tauri'))                               return 'desktop';
  if (s.has('react-native') || s.has('expo') || s.has('flutter'))        return 'mobile';
  if (s.has('node') || s.has('typescript')) {
    if (s.has('next') || s.has('vite') || s.has('react'))                return 'web';
    if (s.has('electron') || s.has('tauri'))                             return 'desktop';
    if (s.has('react-native') || s.has('expo'))                          return 'mobile';
    return 'api';
  }
  if (s.has('dotnet'))  return 'api';
  if (s.has('python'))  return 'script';
  if (s.has('go'))      return 'cli';
  if (s.has('rust'))    return 'cli';
  if (s.has('docker'))  return 'service';
  if (s.has('make'))    return 'script';
  return 'unknown';
}

// Extracts exposed Make targets (.PHONY or simple targets) with their descriptions
// taken from ## comments on the same line or the preceding line.
function parseMakefileCommands(dir) {
  const makefile = path.join(dir, 'Makefile');
  if (!fs.existsSync(makefile)) return null;

  let content;
  try { content = fs.readFileSync(makefile, 'utf8'); } catch { return null; }

  const lines = content.split('\n');

  // Find declared .PHONY targets (handle multi-line declarations with \)
  const phonyTargets = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\.PHONY\s*:\s*(.+)/);
    if (!m) continue;
    let phonyLine = m[1];
    // Follow continuation lines
    while (phonyLine.trimEnd().endsWith('\\')) {
      phonyLine = phonyLine.trimEnd().slice(0, -1);
      i++;
      if (i < lines.length) phonyLine += ' ' + lines[i];
    }
    phonyLine.trim().split(/\s+/).filter(Boolean).forEach(t => phonyTargets.add(t));
  }

  const commands = {};
  const SKIP = new Set(['all', 'clean', 'install', 'help', '.PHONY']);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Make target: name followed by ':'  (no leading tab, no variable)
    const targetMatch = line.match(/^([a-zA-Z0-9_][a-zA-Z0-9_\-.]*):/);
    if (!targetMatch) continue;

    const target = targetMatch[1];
    if (SKIP.has(target)) continue;
    // If .PHONY is declared, restrict to those targets only
    if (phonyTargets.size > 0 && !phonyTargets.has(target)) continue;
    // Ignore internal targets (starting with _ or containing %)
    if (target.startsWith('_') || target.includes('%')) continue;

    // Description: ## comment on the same line or the preceding line
    let description = '';
    const inlineComment = line.match(/##\s*(.+)$/);
    if (inlineComment) {
      description = inlineComment[1].trim();
    } else if (i > 0) {
      const prevComment = lines[i - 1].match(/^##\s*(.+)$/);
      if (prevComment) description = prevComment[1].trim();
    }

    const entry = { label: `make ${target}`, cmd: `make ${target}` };
    if (description) entry.description = description;
    commands[`make-${target}`] = entry;
  }

  return Object.keys(commands).length > 0 ? commands : null;
}

function detectProject(dir, entries) {
  const names = new Set(entries.map(e => e.name));
  const components = [];
  const allCommands = {};
  let color = null;

  // .launcher.yml → handled separately (absolute priority)

  // Docker Compose — additive component (a project can be both web AND docker)
  if (names.has('docker-compose.yml') || names.has('docker-compose.yaml')) {
    const composeFile = names.has('docker-compose.yml') ? 'docker-compose.yml' : 'docker-compose.yaml';
    components.push('docker');
    Object.assign(allCommands, {
      up:         { label: 'Docker up',          cmd: `docker-compose -f ${composeFile} up` },
      'up-build': { label: 'Docker up --build',  cmd: `docker-compose -f ${composeFile} up --build` },
      down:       { label: 'Docker down',        cmd: `docker-compose -f ${composeFile} down` },
    });
    if (!color) color = '#0ea5e9';
  }

  // .NET — solution or project
  const slnFile  = entries.find(e => e.name.endsWith('.sln'));
  const csprojFile = entries.find(e => e.name.endsWith('.csproj'));
  if (slnFile || csprojFile) {
    const target = slnFile ? slnFile.name : csprojFile.name;
    components.push('dotnet');
    Object.assign(allCommands, {
      run:   { label: 'dotnet run',   cmd: `dotnet run --project "${target}"` },
      watch: { label: 'dotnet watch', cmd: `dotnet watch --project "${target}"` },
      build: { label: 'dotnet build', cmd: `dotnet build "${target}"` },
    });
    if (!color) color = '#7c3aed';
  }

  // Node.js / Front-end
  if (names.has('package.json')) {
    let pkgScripts = {};
    let pkgAllDeps = {};
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      pkgScripts = pkg.scripts || {};
      pkgAllDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    } catch {}

    const nodeCommands = {};
    const scriptPriority = ['dev', 'start', 'serve', 'build', 'preview', 'test'];
    for (const s of scriptPriority) {
      if (pkgScripts[s]) {
        const manager = names.has('yarn.lock') ? 'yarn' : names.has('pnpm-lock.yaml') ? 'pnpm' : 'npm';
        nodeCommands[s] = { label: `${manager} run ${s}`, cmd: `${manager} run ${s}` };
      }
    }
    if (Object.keys(nodeCommands).length === 0) {
      nodeCommands.install = { label: 'npm install', cmd: 'npm install' };
    }

    // Detect port for Vite / Next / etc.
    let port = null;
    if (pkgScripts.dev?.includes('vite') || names.has('vite.config.ts') || names.has('vite.config.js')) port = 5173;
    else if (names.has('next.config.js') || names.has('next.config.ts')) port = 3000;
    else if (pkgScripts.start?.includes('3000') || pkgScripts.dev?.includes('3000')) port = 3000;

    if (port && nodeCommands.dev)   nodeCommands.dev.port   = port;
    if (port && nodeCommands.start) nodeCommands.start.port = port;

    const isTypescript = names.has('tsconfig.json');
    const isNext = names.has('next.config.js') || names.has('next.config.ts');
    const isVite = names.has('vite.config.ts') || names.has('vite.config.js');

    components.push('node');
    if (isTypescript) components.push('typescript');
    if (isNext)       components.push('next');
    if (isVite)       components.push('vite');
    if (!isNext && !isVite && pkgAllDeps['react'])             components.push('react');
    if (pkgAllDeps['vue'])                                     components.push('vue');
    if (pkgAllDeps['electron'])                                components.push('electron');
    if (pkgAllDeps['@tauri-apps/api'] || pkgAllDeps['tauri']) components.push('tauri');
    if (pkgAllDeps['react-native'])                            components.push('react-native');
    if (pkgAllDeps['expo'])                                    components.push('expo');
    if (pkgAllDeps['tailwindcss'])                             components.push('tailwind');
    if (pkgAllDeps['@apollo/client'] || pkgAllDeps['graphql']) components.push('graphql');

    Object.assign(allCommands, nodeCommands);
    if (!color) color = '#f59e0b';
  }

  // Python
  if (names.has('requirements.txt') || names.has('pyproject.toml') || names.has('setup.py')) {
    const hasUvicorn = (() => {
      try {
        const req = fs.readFileSync(path.join(dir, 'requirements.txt'), 'utf8');
        return req.includes('uvicorn') || req.includes('fastapi');
      } catch { return false; }
    })();
    const pyCmd = hasUvicorn
      ? { run: { label: 'uvicorn (dev)', cmd: 'uvicorn main:app --reload', port: 8000 } }
      : { run: { label: 'python main.py', cmd: 'python main.py' } };
    components.push('python');
    Object.assign(allCommands, pyCmd);
    if (!color) color = '#22c55e';
  }

  // Go
  if (names.has('go.mod')) {
    components.push('go');
    Object.assign(allCommands, {
      run:   { label: 'go run .',  cmd: 'go run .' },
      build: { label: 'go build', cmd: 'go build .' },
    });
    if (!color) color = '#06b6d4';
  }

  // ── Makefile ───────────────────────────────────────────────────────────────
  if (names.has('Makefile')) {
    const makeCommands = parseMakefileCommands(dir);
    if (makeCommands) {
      components.push('make');
      // Make commands first, then the rest
      const reordered = { ...makeCommands, ...allCommands };
      Object.keys(allCommands).forEach(k => delete allCommands[k]);
      Object.assign(allCommands, reordered);
      if (!color) color = '#94a3b8';
    }
  }

  if (components.length === 0) return null;

  return {
    components,
    color,
    commands: allCommands,
    suggestedType: suggestProjectType(components),
  };
}

// Generic folder names that should not be used as a project name
const GENERIC_NAMES = new Set([
  'src', 'app', 'source', 'lib', 'libs', 'core', 'main', 'pkg', 'packages',
  'server', 'client', 'web', 'api', 'code', 'project', 'solution',
]);

// Names that indicate a COMPONENT of a project (frontend/backend/etc.)
// Only these names trigger multi-component grouping.
// A folder grouping several independent projects will NOT be grouped, because its
// sub-folders have business names (e.g. PaymentService, DataPipeline…), not component names.
const COMPONENT_NAMES = new Set([
  'frontend', 'backend', 'api', 'web', 'client', 'server', 'mobile', 'app',
  'admin', 'worker', 'ui', 'bot', 'jobs', 'gateway', 'proxy', 'auth',
  'dashboard', 'landing', 'docs', 'storybook', 'e2e', 'functions', 'lambda',
]);

// Returns the best display name for a folder.
// If the name is generic, climbs up to the parent.
function smartName(dir) {
  const name = path.basename(dir);
  if (GENERIC_NAMES.has(name.toLowerCase())) {
    const parentName = path.basename(path.dirname(dir));
    // Don't climb up if the parent is the dev root or another generic name
    if (parentName && !GENERIC_NAMES.has(parentName.toLowerCase())) {
      return parentName;
    }
  }
  return name;
}

// Tries to resolve the config of a sub-folder (for multi-component grouping).
// Returns { name, components, commands, color, source } or null.
function resolveComponent(sdPath, sdName) {
  // .launcher.yml in the sub-folder
  const cfgPath = path.join(sdPath, config.configFile);
  if (fs.existsSync(cfgPath)) {
    try {
      const data = yaml.load(fs.readFileSync(cfgPath, 'utf8'));
      if (data && data.name) {
        return { name: sdName, label: data.name, commands: data.commands || {}, components: data.components || data.tags || [], color: data.color, source: 'launcher.yml' };
      }
    } catch {}
  }
  // Auto-detection
  let sdEntries;
  try { sdEntries = fs.readdirSync(sdPath, { withFileTypes: true }); } catch { return null; }
  const detected = detectProject(sdPath, sdEntries);
  if (detected) {
    return { name: sdName, label: sdName, commands: detected.commands, components: detected.components, color: detected.color, source: 'auto' };
  }
  return null;
}

// push(type, message) — types: 'info' | 'found' | 'explore' | 'warn' | 'done'
function scanProjects(push, { settings, t }) {
  const projects = [];
  const emit = typeof push === 'function' ? push : () => {};

  function walk(dir, depth, root) {
    if (depth > settings.scanDepth) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      emit('warn', t('scan.log.cannotRead', undefined, { dir: path.relative(root, dir), msg: e.message }));
      return;
    }

    const folderName  = path.basename(dir);
    const displayName = smartName(dir);           // ← smart name (climbs up if generic)
    const relDir      = path.relative(root, dir) || '.';
    const id          = Buffer.from(dir).toString('base64url');

    // ── 1. .launcher.yml (absolute priority) ─────────────────────────────────
    const configPath = path.join(dir, config.configFile);
    if (fs.existsSync(configPath)) {
      try {
        const data = yaml.load(fs.readFileSync(configPath, 'utf8'));
        if (data && data.name) {
          const launchComps = data.components || data.tags || [];
          emit('found', `${data.name}   [${launchComps.join(', ')}]   .launcher.yml   ${relDir}`);
          projects.push({ id, name: data.name, description: data.description || '', components: launchComps, color: data.color || null, commands: data.commands || {}, path: dir, source: 'launcher.yml' });
          return;
        }
        emit('warn', t('scan.log.nameMissing', undefined, { file: `${relDir}/.launcher.yml` }));
      } catch (e) {
        emit('warn', t('scan.log.parseError', undefined, { file: `${relDir}/.launcher.yml`, msg: e.message }));
      }
    }

    // ── 2. Direct auto-detection ──────────────────────────────────────────────
    const detected = detectProject(dir, entries);
    if (detected) {
      const nameNote = displayName !== folderName ? ` ${t('scan.log.folderNote', undefined, { name: folderName })}` : '';
      emit('found', `${displayName}   [${detected.components.join(', ')}]   auto   ${relDir}${nameNote}`);
      projects.push({ id, name: displayName, description: '', components: detected.components, color: detected.color || null, commands: detected.commands, path: dir, source: 'auto' });
      return;
    }

    // ── 3. Multi-component detection ─────────────────────────────────────────
    // If most sub-folders are recognized projects → one grouped project
    const subdirs = entries.filter(e => e.isDirectory() && !settings.ignoreDirs.includes(e.name) && !e.name.startsWith('.'));

    if (subdirs.length >= 2) {
      // Only group if sub-folders have recognized COMPONENT names
      // (frontend, backend, api…). This avoids grouping a "category" folder
      // that merely contains several unrelated projects.
      const componentCandidates = subdirs.filter(sd =>
        COMPONENT_NAMES.has(sd.name.toLowerCase())
      );

      const subComps = componentCandidates
        .map(sd => resolveComponent(path.join(dir, sd.name), sd.name))
        .filter(Boolean);

      const ratio = componentCandidates.length / subdirs.length;

      if (subComps.length >= 2 && ratio >= 0.5) {
        // Build grouped commands: "component-key"
        const commands = {};
        const allComponents = new Set(['multi']);

        for (const comp of subComps) {
          (comp.components || []).forEach(t => allComponents.add(t));
          for (const [key, cmd] of Object.entries(comp.commands)) {
            commands[`${comp.name}-${key}`] = {
              ...cmd,
              label: `${comp.name} · ${cmd.label || key}`,
              cwd: comp.name,  // relative to the parent folder
            };
          }
        }

        // If the parent also has a docker-compose, add it first
        const dcFile = entries.find(e => e.name === 'docker-compose.yml' || e.name === 'docker-compose.yaml');
        if (dcFile) {
          commands['docker-up']    = { label: '🐳 Docker Compose up', cmd: `docker-compose -f ${dcFile.name} up` };
          commands['docker-build'] = { label: '🐳 Docker Compose up --build', cmd: `docker-compose -f ${dcFile.name} up --build` };
          commands['docker-down']  = { label: '🐳 Docker Compose down', cmd: `docker-compose -f ${dcFile.name} down` };
          allComponents.add('docker');
          // Reorder: docker first
          const reordered = {};
          ['docker-up', 'docker-build', 'docker-down'].forEach(k => { reordered[k] = commands[k]; delete commands[k]; });
          Object.assign(reordered, commands);
          Object.assign(commands, reordered);
        }

        const compNames = subComps.map(c => c.name).join(' + ');
        emit('found', `${folderName}   [${[...allComponents].join(', ')}]   multi (${compNames})   ${relDir}`);
        projects.push({
          id,
          name: folderName,
          description: compNames,
          components: [...allComponents],
          color: '#ec4899',
          commands,
          path: dir,
          source: 'multi',
          subProjects: subComps.map(c => c.name),
        });
        return;
      }
    }

    // ── 4. Recurse normally ───────────────────────────────────────────────────
    if (subdirs.length > 0) {
      const subfolderKey = subdirs.length > 1 ? 'scan.log.subfoldersMany' : 'scan.log.subfoldersOne';
      emit('explore', t(subfolderKey, undefined, { dir: relDir, count: subdirs.length }));
    }
    for (const entry of subdirs) {
      walk(path.join(dir, entry.name), depth + 1, root);
    }
  }

  const roots = Array.isArray(settings.devRoots) ? settings.devRoots : [];
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      emit('warn', t('scan.log.devRootNotFound', undefined, { root }));
      continue;
    }
    emit('info', t('scan.log.root', undefined, { root, depth: settings.scanDepth }));
    walk(root, 1, root);
  }
  const doneKey = projects.length === 1 ? 'scan.log.doneOne' : 'scan.log.doneMany';
  emit('done', t(doneKey, undefined, { count: projects.length }));
  return projects;
}

module.exports = { scanProjects, detectProject, suggestProjectType, smartName };
