// ══ Categories ════════════════════════════════════════════════════════════

const CAT_PALETTE = [
  '#6366f1','#8b5cf6','#ec4899','#f43f5e',
  '#f97316','#f59e0b','#22c55e','#10b981',
  '#06b6d4','#3b82f6','#64748b','#94a3b8',
];

let allCategories  = [];   // [ {id, name, color} ]
let catAssignments = {};   // { projectId: [catId, ...] }
let activeCatFilters = new Set();

async function loadCategories() {
  try {
    const r = await fetch('/api/categories');
    const data = await r.json();
    allCategories  = data.categories  || [];
    catAssignments = data.assignments || {};
    renderCatBar();
    renderSettingsCats();
  } catch(e) { console.warn(e); }
}

// ── Category filter bar ────────────────────────────────────────────────────
function renderCatBar() {
  const pills = document.getElementById('cat-pills');
  if (!pills) return;

  if (!allCategories.length) {
    pills.innerHTML = `<span class="cat-bar-empty">${t('cat.empty')}</span>`;
    document.getElementById('cat-bar-clear')?.classList.remove('visible');
    return;
  }

  // Count projects per category
  const counts = {};
  allProjects.forEach(p => {
    (catAssignments[p.id] || []).forEach(cid => { counts[cid] = (counts[cid]||0)+1; });
  });

  pills.innerHTML = allCategories.map(cat => {
    const cnt = counts[cat.id] || 0;
    const isActive = activeCatFilters.has(cat.id);
    const bg = hexToRgba(cat.color, .12);
    return `<button class="cfp ${isActive?'active':''}"
      style="--cat-color:${cat.color};--cat-bg:${bg}"
      onclick="toggleCatFilter('${cat.id}')">
      <span class="cfp-dot" style="background:${cat.color}"></span>
      ${escHtml(cat.name)}
      <span style="font-size:10px;opacity:.5">${cnt}</span>
    </button>`;
  }).join('');

  document.getElementById('cat-bar-clear')?.classList.toggle('visible', activeCatFilters.size > 0);
}

function toggleCatFilter(catId) {
  if (activeCatFilters.has(catId)) activeCatFilters.delete(catId);
  else activeCatFilters.add(catId);
  renderCatBar();
  renderProjects();
}

function clearCatFilters() {
  activeCatFilters.clear();
  renderCatBar();
  renderProjects();
}

// ── Category chips on project row ─────────────────────────────────────────
function catChipsHtml(projectId) {
  const assigned = (catAssignments[projectId] || [])
    .map(cid => allCategories.find(c => c.id === cid)).filter(Boolean);
  const chips = assigned.map(cat => {
    const bg = hexToRgba(cat.color, .15);
    return `<span class="cat-chip" style="background:${bg};color:${cat.color};border-color:${hexToRgba(cat.color,.3)}"
      onclick="event.stopPropagation();toggleCatFilter('${cat.id}')" title="${t('cat.filterBy', { name: escHtml(cat.name) })}">
      <span class="cat-chip-dot" style="background:${cat.color}"></span>
      ${escHtml(cat.name)}
    </span>`;
  }).join('');
  return `<span class="prow-cats">
    ${chips}
    <button class="cat-assign-btn" title="${t('cat.assignTitle')}"
      onclick="event.stopPropagation();openCatPopover('${projectId}',this)">+</button>
  </span>`;
}

// ── Category assignment popover ───────────────────────────────────────────
let popoverProjectId = null;

function openCatPopover(projectId, anchor) {
  popoverProjectId = projectId;
  const pop = document.getElementById('cat-popover');
  if (!pop) return;

  const assigned = new Set(catAssignments[projectId] || []);
  let html = '';

  if (!allCategories.length) {
    html = `<div class="cat-pop-empty">${t('cat.popEmpty').replace('\n','<br>')}</div>`;
  } else {
    html = allCategories.map(cat => {
      const isAssigned = assigned.has(cat.id);
      return `<div class="cat-pop-item ${isAssigned?'assigned':''}" onclick="toggleProjectCat('${projectId}','${cat.id}',${isAssigned})">
        <span style="width:8px;height:8px;border-radius:50%;background:${cat.color};flex-shrink:0;display:inline-block"></span>
        ${escHtml(cat.name)}
        ${isAssigned ? `<span class="check">✓</span>` : ''}
      </div>`;
    }).join('');
  }

  html += `<div class="cat-pop-sep"></div>
    <div class="cat-pop-new">
      <input id="pop-new-cat" type="text" placeholder="${t('cat.popPlaceholder')}" onkeydown="if(event.key==='Enter')quickCreateCat('${projectId}')"/>
      <button onclick="quickCreateCat('${projectId}')">+</button>
    </div>`;

  pop.innerHTML = html;

  // Position near anchor
  const rect = anchor.getBoundingClientRect();
  pop.style.top  = (rect.bottom + 6) + 'px';
  pop.style.left = Math.max(8, rect.left - 160) + 'px';
  pop.classList.add('open');

  setTimeout(() => document.getElementById('pop-new-cat')?.focus(), 50);
}

function closeCatPopover() {
  document.getElementById('cat-popover')?.classList.remove('open');
  popoverProjectId = null;
}

async function toggleProjectCat(projectId, catId, isAssigned) {
  const action = isAssigned ? 'remove' : 'add';
  await fetch('/api/categories/assign', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ projectId, categoryId: catId, action }),
  });
  await loadCategories();
  // Re-open popover
  const btn = document.querySelector(`[id="prow-${projectId}"] .cat-assign-btn`);
  if (btn) openCatPopover(projectId, btn);
  else closeCatPopover();
  renderProjects();
}

async function quickCreateCat(projectId) {
  const input = document.getElementById('pop-new-cat');
  const name = input?.value.trim();
  if (!name) return;
  // Pick a color not yet used
  const usedColors = new Set(allCategories.map(c => c.color));
  const color = CAT_PALETTE.find(c => !usedColors.has(c)) || CAT_PALETTE[allCategories.length % CAT_PALETTE.length];
  const r = await fetch('/api/categories', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ name, color }),
  });
  const data = await r.json();
  allCategories  = data.categories  || [];
  catAssignments = data.assignments || {};
  // Auto-assign to current project
  const newCat = allCategories.find(c => c.name === name);
  if (newCat) await toggleProjectCat(projectId, newCat.id, false);
  else { renderCatBar(); renderSettingsCats(); }
}

// ── Category management in settings ──────────────────────────────────────
function renderSettingsCats() {
  const list = document.getElementById('settings-cat-list');
  if (!list) return;
  if (!allCategories.length) {
    list.innerHTML = `<p style="font-size:11px;color:var(--t3)">${t('cat.noCategories')}</p>`;
    return;
  }
  list.innerHTML = allCategories.map(cat => `
    <div class="cat-settings-row" id="cat-row-${cat.id}">
      <span class="cat-settings-dot" style="background:${cat.color}" title="${t('cat.changeColor')}"
        onclick="openColorPicker('${cat.id}',this)"></span>
      <input class="cat-settings-name" value="${escHtml(cat.name)}"
        onblur="renameCat('${cat.id}',this.value)"
        onkeydown="if(event.key==='Enter')this.blur()"/>
      <button class="cat-settings-del" onclick="deleteCat('${cat.id}')" title="${t('ide.delete')}">✕</button>
    </div>`).join('');
}

async function addCategoryFromSettings() {
  const input = document.getElementById('new-cat-name');
  const name = input?.value.trim();
  if (!name) return;
  const usedColors = new Set(allCategories.map(c => c.color));
  const color = CAT_PALETTE.find(c => !usedColors.has(c)) || CAT_PALETTE[allCategories.length % CAT_PALETTE.length];
  const r = await fetch('/api/categories', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ name, color }),
  });
  const data = await r.json();
  allCategories  = data.categories  || [];
  catAssignments = data.assignments || {};
  input.value = '';
  renderCatBar();
  renderSettingsCats();
  renderProjects();
}

async function renameCat(id, newName) {
  if (!newName.trim()) return;
  const cat = allCategories.find(c => c.id === id);
  if (!cat || cat.name === newName.trim()) return;
  await fetch('/api/categories', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ id, name: newName.trim(), color: cat.color }),
  });
  await loadCategories();
  renderProjects();
}

async function deleteCat(id) {
  if (!confirm(t('confirm.deleteCat'))) return;
  await fetch(`/api/categories/${id}`, { method:'DELETE' });
  await loadCategories();
  activeCatFilters.delete(id);
  renderProjects();
}

let colorPickerCatId = null;
function openColorPicker(catId, anchor) {
  // Remove existing
  document.querySelectorAll('.cat-color-picker').forEach(el => el.remove());
  colorPickerCatId = catId;
  const cat = allCategories.find(c => c.id === catId);
  const picker = document.createElement('div');
  picker.className = 'cat-color-picker';
  picker.innerHTML = CAT_PALETTE.map(c =>
    `<span class="cat-swatch ${cat?.color===c?'sel':''}" style="background:${c}"
      onclick="applyColor('${catId}','${c}')"></span>`
  ).join('');
  const rect = anchor.getBoundingClientRect();
  picker.style.top  = (rect.bottom + 4) + 'px';
  picker.style.left = rect.left + 'px';
  document.body.appendChild(picker);
  setTimeout(() => document.addEventListener('click', closeColorPicker, { once:true }), 10);
}
async function applyColor(catId, color) {
  const cat = allCategories.find(c => c.id === catId);
  if (!cat) return;
  await fetch('/api/categories', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ id: catId, name: cat.name, color }),
  });
  await loadCategories();
  renderProjects();
}
function closeColorPicker() {
  document.querySelectorAll('.cat-color-picker').forEach(el => el.remove());
}

