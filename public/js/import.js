// ══ Import Panel ══════════════════════════════════════════════════════════

const IMPORT_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#f43f5e',
  '#f97316','#f59e0b','#22c55e','#10b981',
  '#06b6d4','#3b82f6','#64748b','#94a3b8',
];

let importState = {
  mode: 'new',
  projectId: null,
  selectedColor: null,
  selectedType: null,
  autoDetectedType: null,
  compatInfo: null,
  selectedComponents: new Set(),
  originalCategoryIds: new Set(),
};

function openImportPanel(opts = {}) {
  importState = {
    mode: opts.mode || 'new',
    projectId: opts.projectId || null,
    selectedColor: null,
    selectedType: null,
    autoDetectedType: null,
    compatInfo: null,
    selectedComponents: new Set(),
    originalCategoryIds: new Set(),
  };
  const overlay = document.getElementById('import-overlay');
  const title   = document.getElementById('import-title');
  const submit  = document.getElementById('import-submit');
  const detectSec = document.getElementById('import-detect-section');
  const pathDisplayWrap = document.getElementById('import-path-display-wrap');
  const form = document.getElementById('import-form');
  const dupWarn = document.getElementById('import-dup-warn');
  const msg = document.getElementById('import-msg');
  const pathInput = document.getElementById('import-path-input');

  // Reset
  msg.className = 'import-msg';
  dupWarn.classList.remove('visible');
  form.style.display = 'none';

  if (importState.mode === 'new') {
    title.textContent = t('import.title');
    submit.textContent = t('import.save');
    detectSec.style.display = '';
    pathDisplayWrap.style.display = 'none';
    pathInput.value = '';

    // Pre-fill if coming from scan
    if (opts.prefill) {
      fillImportForm(opts.prefill);
      form.style.display = '';
      detectSec.style.display = '';
      pathInput.value = opts.prefill.path || '';
      if (opts.prefill.alreadyImported) dupWarn.classList.add('visible');
    }
  } else {
    // Edit mode
    title.textContent = t('import.titleEdit');
    submit.textContent = t('import.saveEdit');
    detectSec.style.display = 'none';
    pathDisplayWrap.style.display = '';

    const project = allProjects.find(p => p.id === importState.projectId)
      || { name:'', description:'', tags:[], color:null, commands:{}, path:'' };
    document.getElementById('import-path-display').textContent = project.path || '';
    fillImportForm(project);
    form.style.display = '';
  }

  renderImportColorSwatches();
  overlay.classList.add('open');

  // Focus path input for new mode
  if (importState.mode === 'new' && !opts.prefill) {
    setTimeout(() => pathInput.focus(), 200);
  } else {
    setTimeout(() => document.getElementById('import-name').focus(), 200);
  }
}

function closeImportPanel() {
  document.getElementById('import-overlay').classList.remove('open');
}

function onImportOverlayClick(e) {
  if (e.target === document.getElementById('import-overlay')) closeImportPanel();
}

function fillImportForm(data) {
  document.getElementById('import-name').value        = data.name || '';
  document.getElementById('import-description').value = data.description || '';
  importState.selectedColor = data.color || IMPORT_COLORS[0];

  // Components
  const initialComps = data.components || data.tags || [];
  importState.selectedComponents = new Set(initialComps);

  // Initial categories (to detect changes in edit mode)
  const pid = importState.projectId;
  importState.originalCategoryIds = new Set(pid ? (catAssignments[pid] || []) : []);
  importState.pendingCatIds = new Set(importState.originalCategoryIds);

  // Type: compute compatible types and initialize selection
  importState.compatInfo       = computeCompatibleTypes({ ...data, components: initialComps });
  importState.autoDetectedType = importState.compatInfo.autoDetected;
  importState.selectedType     = data.type || data.typeOverride || importState.compatInfo.autoDetected;

  renderComponentPicker();
  renderImportCatPicker();
  renderImportColorSwatches();
  renderImportTypeGrid();
  renderImportCommands(data.commands || {});
}

function renderImportTypeGrid() {
  const grid = document.getElementById('import-type-grid');
  const warnEl = document.getElementById('import-type-warn');
  if (!grid || !importState.compatInfo) return;

  const { autoDetected, recommended, discouraged } = importState.compatInfo;
  const selected = importState.selectedType;

  // Render all types: recommended first, then discouraged
  const allOrdered = [
    ...recommended.filter(t => t !== 'unknown'),
    ...discouraged.filter(t => t !== 'unknown' && t !== 'multi'),
  ];

  grid.innerHTML = allOrdered.map(type => {
    const def = PROJECT_TYPES[type];
    if (!def) return '';
    const isSelected  = selected === type;
    const isAuto      = autoDetected === type;
    const isDisc      = discouraged.includes(type);
    const starHtml    = isAuto ? `<span class="type-sel-star" title="${t('type.autoDetected')}">●</span>` : '';
    const warnHtml    = isDisc && !isSelected ? `<span class="type-sel-warn-icon">⚠</span>` : '';
    const typeColor   = def.color;
    const typeBg      = def.bg;
    const label       = typeLabel(type);
    return `<button class="type-sel-btn ${isSelected?'active':''} ${isDisc?'discouraged':''}"
      style="--type-color:${typeColor};--type-bg:${typeBg}"
      title="${label}${isDisc?' — '+t('type.uncommonHint'):''}"
      onclick="selectImportType('${type}')">
      ${starHtml}
      <span style="color:${isSelected?typeColor:'var(--t3)'};">${def.svg}</span>
      ${label.split('/')[0].trim()}
      ${warnHtml}
    </button>`;
  }).join('');

  // Warning if selected type is discouraged
  if (discouraged.includes(selected) && selected !== 'unknown') {
    warnEl.textContent = t('type.uncommon', { type: typeLabel(selected) });
    warnEl.classList.add('visible');
  } else {
    warnEl.classList.remove('visible');
  }
}

function selectImportType(type) {
  importState.selectedType = type;
  renderImportTypeGrid();
}

function renderImportColorSwatches() {
  const row = document.getElementById('import-color-row');
  if (!row) return;
  row.innerHTML = IMPORT_COLORS.map(c =>
    `<span class="import-swatch ${importState.selectedColor===c?'sel':''}"
      style="background:${c}"
      onclick="importState.selectedColor='${c}';renderImportColorSwatches()"></span>`
  ).join('');
}

function renderImportCommands(commands) {
  const editor = document.getElementById('import-cmd-editor');
  if (!editor) return;
  editor.innerHTML = '';
  for (const [key, cmd] of Object.entries(commands)) {
    editor.appendChild(makeCommandRow({ key, label: cmd.label||'', cmd: cmd.cmd||'', port: cmd.port||'' }));
  }
}

function makeCommandRow(data = {}) {
  const row = document.createElement('div');
  row.className = 'cmd-row';
  row.innerHTML = `
    <input class="cmd-key"   placeholder="${t('cmd.key.placeholder')}"   value="${escHtml(data.key||'')}"   title="${t('cmd.key.title')}"/>
    <span class="cmd-row-sep">·</span>
    <input class="cmd-label" placeholder="label"    value="${escHtml(data.label||'')}" title="${t('cmd.label.title')}"/>
    <span class="cmd-row-sep">·</span>
    <input class="cmd-cmd"   placeholder="command"  value="${escHtml(data.cmd||'')}"   title="${t('cmd.cmd.title')}"/>
    <span class="cmd-row-sep">:</span>
    <input class="cmd-port"  placeholder="port"     value="${escHtml(String(data.port||''))}" title="${t('cmd.port.title')}" type="number" min="1" max="65535"/>
    <button class="cmd-del" onclick="this.closest('.cmd-row').remove()" title="${t('cmd.del.title')}">✕</button>`;
  return row;
}

function addImportCommand() {
  const editor = document.getElementById('import-cmd-editor');
  if (!editor) return;
  const row = makeCommandRow();
  editor.appendChild(row);
  row.querySelector('.cmd-key').focus();
}

function getImportFormData() {
  const name  = document.getElementById('import-name').value.trim();
  const desc  = document.getElementById('import-description').value.trim();
  const color = importState.selectedColor || IMPORT_COLORS[0];

  // Selected components
  const components = [...importState.selectedComponents];

  // Type: save only if different from the auto-detected one
  const type = (importState.selectedType && importState.selectedType !== importState.autoDetectedType)
    ? importState.selectedType
    : null;

  // Build commands from editor rows
  const commands = {};
  document.querySelectorAll('#import-cmd-editor .cmd-row').forEach(row => {
    const key   = row.querySelector('.cmd-key').value.trim();
    const label = row.querySelector('.cmd-label').value.trim();
    const cmd   = row.querySelector('.cmd-cmd').value.trim();
    const port  = parseInt(row.querySelector('.cmd-port').value, 10);
    if (key && cmd) {
      commands[key] = { label: label || cmd, cmd };
      if (port > 0) commands[key].port = port;
    }
  });

  return { name, description: desc, components, color, commands, type };
}

// ── Component picker ─────────────────────────────────────────────────────────

function renderComponentPicker() {
  const activeEl   = document.getElementById('import-comp-active');
  const presetsEl  = document.getElementById('import-comp-presets');
  if (!activeEl || !presetsEl) return;

  const selected = importState.selectedComponents;

  // Active chips (selected components)
  if (selected.size === 0) {
    activeEl.innerHTML = `<span class="comp-active-empty">${t('import.components.empty')}</span>`;
  } else {
    activeEl.innerHTML = [...selected].map(comp => {
      const kc = KNOWN_COMPONENTS[comp];
      const label = kc ? kc.label : comp;
      const color = kc ? kc.color : 'var(--t2)';
      return `<span class="comp-chip-active"
        style="color:${color};background:${color}18;border-color:${color}40"
        onclick="toggleComponent('${comp}')">
        ${label}
        <button class="cc-del" onclick="event.stopPropagation();toggleComponent('${comp}')" title="${t('cmd.remove.title')}">✕</button>
      </span>`;
    }).join('');
  }

  // Preset chips (not yet selected)
  presetsEl.innerHTML = COMPONENT_PICKER_ORDER.map(comp => {
    const kc = KNOWN_COMPONENTS[comp];
    const label = kc ? kc.label : comp;
    const alreadyIn = selected.has(comp);
    return `<span class="comp-chip-preset ${alreadyIn ? 'already' : ''}"
      onclick="toggleComponent('${comp}')" title="${label}">
      ${label}
    </span>`;
  }).join('');
}

function toggleComponent(comp) {
  if (importState.selectedComponents.has(comp)) {
    importState.selectedComponents.delete(comp);
  } else {
    importState.selectedComponents.add(comp);
  }
  // Recompute compatible types from updated component set
  importState.compatInfo = computeCompatibleTypes({
    components: [...importState.selectedComponents], commands: {}
  });
  importState.autoDetectedType = importState.compatInfo.autoDetected;
  // Keep current selection only if it's still in recommended list
  if (!importState.selectedType ||
      !importState.compatInfo.recommended.includes(importState.selectedType)) {
    importState.selectedType = importState.autoDetectedType;
  }
  renderComponentPicker();
  renderImportTypeGrid();
}

function addCustomComponent() {
  const input = document.getElementById('import-comp-custom');
  const val = input?.value.trim().toLowerCase().replace(/\s+/g, '-');
  if (!val) return;
  input.value = '';
  if (!importState.selectedComponents.has(val)) {
    toggleComponent(val);
  }
}

// ── Import category picker ────────────────────────────────────────────────────

function renderImportCatPicker() {
  const listEl = document.getElementById('import-cat-list');
  if (!listEl) return;

  if (!allCategories.length) {
    listEl.innerHTML = `<span style="font-size:11px;color:var(--t3);font-style:italic">${t('cat.noCategoriesImport')}</span>`;
    return;
  }

  const pid      = importState.projectId;
  const assigned = new Set(pid ? (catAssignments[pid] || []) : []);
  // Also include any pending toggles from the current form session
  const active   = importState.pendingCatIds || new Set(assigned);
  importState.pendingCatIds = active;

  listEl.innerHTML = allCategories.map(cat => {
    const isActive = active.has(cat.id);
    return `<span class="import-cat-chip ${isActive ? 'active' : ''}"
      style="${isActive ? `color:${cat.color};background:${cat.color}18;border-color:${cat.color}40` : ''}"
      onclick="toggleImportCat('${cat.id}')">
      <span class="import-cat-chip-dot" style="background:${cat.color}"></span>
      ${escHtml(cat.name)}
    </span>`;
  }).join('');
}

function toggleImportCat(catId) {
  if (!importState.pendingCatIds) {
    const pid = importState.projectId;
    importState.pendingCatIds = new Set(pid ? (catAssignments[pid] || []) : []);
  }
  if (importState.pendingCatIds.has(catId)) {
    importState.pendingCatIds.delete(catId);
  } else {
    importState.pendingCatIds.add(catId);
  }
  renderImportCatPicker();
}

async function detectImportProject() {
  const btn  = document.getElementById('import-detect-btn');
  const pathInput = document.getElementById('import-path-input');
  const form = document.getElementById('import-form');
  const dupWarn = document.getElementById('import-dup-warn');
  const msg  = document.getElementById('import-msg');

  const dirPath = pathInput.value.trim();
  if (!dirPath) { pathInput.focus(); return; }

  btn.disabled = true;
  btn.textContent = '…';
  msg.className = 'import-msg';
  dupWarn.classList.remove('visible');

  try {
    const r = await fetch('/api/projects/detect', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ path: dirPath }),
    });
    const data = await r.json();
    if (!r.ok) {
      msg.textContent = data.error || t('common.error');
      msg.className = 'import-msg err';
      return;
    }

    fillImportForm(data);
    form.style.display = '';
    if (data.alreadyImported) {
      dupWarn.classList.add('visible');
    }
    document.getElementById('import-name').focus();
  } catch(e) {
    msg.textContent = e.message;
    msg.className = 'import-msg err';
  } finally {
    btn.disabled = false;
    btn.textContent = t('import.detect');
  }
}

async function saveImport() {
  const submit = document.getElementById('import-submit');
  const msg    = document.getElementById('import-msg');

  const { name, description, components, color, commands, type } = getImportFormData();
  if (!name) {
    document.getElementById('import-name').focus();
    msg.textContent = t('import.nameRequired');
    msg.className = 'import-msg err';
    return;
  }

  submit.disabled = true;
  submit.textContent = '…';
  msg.className = 'import-msg';

  try {
    let savedProjectId = importState.projectId;

    if (importState.mode === 'new') {
      const dirPath = document.getElementById('import-path-input').value.trim();
      if (!dirPath) {
        msg.textContent = t('import.pathRequired');
        msg.className = 'import-msg err';
        return;
      }
      const r = await fetch('/api/projects', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ path: dirPath, name, description, components, color, commands, type }),
      });
      const data = await r.json();
      if (r.status === 409) {
        msg.textContent = data.error;
        msg.className = 'import-msg warn';
        document.getElementById('import-dup-warn').classList.add('visible');
        return;
      }
      if (!r.ok) throw new Error(data.error || t('common.serverError'));
      savedProjectId = data.id;
      msg.textContent = t('import.success');
      msg.className = 'import-msg ok';
    } else {
      const r = await fetch(`/api/projects/${importState.projectId}`, {
        method: 'PUT', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name, description, components, color, commands, type }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || t('common.serverError'));
      msg.textContent = t('import.updated');
      msg.className = 'import-msg ok';
    }

    // Apply category changes
    if (savedProjectId) {
      const original = importState.originalCategoryIds;
      const pending  = importState.pendingCatIds || new Set();
      const toAdd    = [...pending].filter(id => !original.has(id));
      const toRemove = [...original].filter(id => !pending.has(id));

      await Promise.all([
        ...toAdd.map(catId => fetch('/api/categories/assign', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ projectId: savedProjectId, categoryId: catId, action: 'add' }),
        })),
        ...toRemove.map(catId => fetch('/api/categories/assign', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ projectId: savedProjectId, categoryId: catId, action: 'remove' }),
        })),
      ]);
    }

    await loadProjects();
    await loadCategories();
    setTimeout(closeImportPanel, 900);
  } catch(e) {
    msg.textContent = '✗ ' + e.message;
    msg.className = 'import-msg err';
  } finally {
    submit.disabled = false;
    submit.textContent = importState.mode === 'new' ? t('import.save') : t('import.saveEdit');
  }
}

function editProject(projectId) {
  importState.projectId = projectId;
  openImportPanel({ mode: 'edit', projectId });
}

async function deleteProject(projectId, projectName, event) {
  event?.stopPropagation();
  if (!confirm(t('confirm.deleteProject', { name: projectName }))) return;
  try {
    const r = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
    if (!r.ok) { const d = await r.json(); alert(d.error || t('common.error')); return; }
    await loadProjects();
  } catch(e) { alert(e.message); }
}

