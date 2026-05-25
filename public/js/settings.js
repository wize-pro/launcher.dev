// ══ Settings panel ════════════════════════════════════════════════════════
async function openSettings() {
  document.getElementById('btn-settings').classList.add('active');
  document.getElementById('settings-overlay').classList.add('open');
  document.getElementById('settings-msg').className = 'settings-msg';
  await loadCategories();
  // Load current settings from server
  try {
    const r = await fetch('/api/settings');
    const s = await r.json();
    renderDevRoots(s.devRoots);
    document.getElementById('cfg-scanDepth').value  = s.scanDepth ?? 5;
    document.getElementById('cfg-ignoreDirs').value = (s.ignoreDirs || []).join(', ');
    // Load IDEs
    idesList      = s.ides      || idesList;
    defaultIdeId  = s.defaultIde || defaultIdeId;
    renderIdeSettings();
  } catch(e) { console.warn(e); }
  await populateLangSelector();
  // Version de l'application (About)
  try {
    const v = await fetch('/api/version').then(r => r.json());
    const el = document.getElementById('about-version');
    if (el) el.textContent = t('about.version', { version: v.version });
  } catch (e) { console.warn(e); }
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('open');
  document.getElementById('btn-settings').classList.remove('active');
}

function onSettingsOverlayClick(e) {
  if (e.target === document.getElementById('settings-overlay')) closeSettings();
}

async function saveSettings() {
  const btn = document.getElementById('settings-save');
  const msg = document.getElementById('settings-msg');
  msg.className = 'settings-msg';

  const devRoots = [...document.querySelectorAll('#cfg-devRoots-list .dev-root-input')]
    .map(i => i.value.trim()).filter(Boolean);
  const scanDepth = parseInt(document.getElementById('cfg-scanDepth').value, 10);
  const ignoreDirsRaw = document.getElementById('cfg-ignoreDirs').value;
  const ignoreDirs = ignoreDirsRaw.split(',').map(s => s.trim()).filter(Boolean);

  if (devRoots.length === 0) {
    document.querySelectorAll('#cfg-devRoots-list .dev-root-input').forEach(i => i.classList.add('error'));
    msg.textContent = t('error.devRootsEmpty');
    msg.className = 'settings-msg err';
    return;
  }
  document.querySelectorAll('#cfg-devRoots-list .dev-root-input').forEach(i => i.classList.remove('error'));

  btn.disabled = true;
  btn.textContent = t('common.saving');
  try {
    const r = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ devRoots, scanDepth, ignoreDirs, ides: idesList, defaultIde: defaultIdeId }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || t('common.serverError'));

    msg.textContent = t('settings.saved');
    msg.className = 'settings-msg ok';
    btn.textContent = t('settings.save');
    btn.disabled = false;

    // Rescan and close after short delay
    setTimeout(() => {
      closeSettings();
      startScan();
    }, 800);
  } catch(e) {
    msg.textContent = '✗ ' + e.message;
    msg.className = 'settings-msg err';
    btn.textContent = t('settings.save');
    btn.disabled = false;
  }
}

// ══ Native folder picker ══════════════════════════════════════════════════

function devRootRowHtml(value) {
  const v = escHtml(value || '');
  return `<div class="settings-input-row dev-root-row" style="margin-bottom:6px">
    <input class="settings-input dev-root-input" type="text" value="${v}" placeholder="~/dev" data-i18n-placeholder="settings.devRoots.placeholder" spellcheck="false"/>
    <button class="btn-pick-folder" type="button" onclick="pickFolderIntoRow(this)" data-i18n-title="settings.devRoots.browse" title="Browse…">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
    </button>
    <button class="btn-pick-folder" type="button" onclick="removeDevRootRow(this)" data-i18n-title="settings.devRoots.remove" title="Remove this root">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>`;
}

function renderDevRoots(roots) {
  const list = document.getElementById('cfg-devRoots-list');
  const arr = (Array.isArray(roots) && roots.length) ? roots : [''];
  list.innerHTML = arr.map(devRootRowHtml).join('');
  applyTranslations();
}

function addDevRootRow() {
  const list = document.getElementById('cfg-devRoots-list');
  list.insertAdjacentHTML('beforeend', devRootRowHtml(''));
  applyTranslations();
}

function removeDevRootRow(btn) {
  const list = document.getElementById('cfg-devRoots-list');
  const row = btn.closest('.dev-root-row');
  if (row) row.remove();
  if (!list.querySelector('.dev-root-row')) addDevRootRow(); // never leave zero rows
}

function pickFolderIntoRow(btn) {
  const input = btn.closest('.dev-root-row')?.querySelector('.dev-root-input');
  if (input) pickFolderIntoElement(input);
}

async function pickFolderIntoElement(input) {
  const current = input?.value?.trim() || '';
  try {
    const url = '/api/pick-folder' + (current ? '?current=' + encodeURIComponent(current) : '');
    const r = await fetch(url);
    if (!r.ok) {
      // Web mode: the native picker is not available, let the user type manually
      return;
    }
    const data = await r.json();
    if (!data.canceled && data.path) {
      input.value = data.path;
      input.dispatchEvent(new Event('input'));
    }
  } catch { /* silent */ }
}

function pickFolderInto(inputId) {
  pickFolderIntoElement(document.getElementById(inputId));
}

// ══ IDE Settings ══════════════════════════════════════════════════════════

function renderIdeSettings() {
  const list = document.getElementById('settings-ide-list');
  if (!list) return;
  if (!idesList.length) {
    list.innerHTML = `<div style="color:var(--t3);font-size:12px;padding:4px 0">${t('ide.noEditor')}</div>`;
    return;
  }
  list.innerHTML = idesList.map((ide, i) => `
    <div class="ide-settings-row ${ide.id === defaultIdeId ? 'is-default' : ''}">
      <div style="display:flex;flex-direction:column;flex:1;min-width:0">
        <span class="ide-settings-name">${ide.name}</span>
        <span class="ide-settings-cmd">${ide.cmd}</span>
      </div>
      <button class="ide-settings-star ${ide.id === defaultIdeId ? 'active' : ''}"
              onclick="setDefaultIde('${ide.id}')"
              title="${ide.id === defaultIdeId ? t('ide.isDefault') : t('ide.setDefault')}">★</button>
      <button class="ide-settings-del" onclick="removeIde(${i})" title="${t('ide.delete')}">✕</button>
    </div>
  `).join('');
}

function setDefaultIde(id) {
  defaultIdeId = id;
  renderIdeSettings();
}

function removeIde(index) {
  idesList.splice(index, 1);
  if (!idesList.find(i => i.id === defaultIdeId) && idesList.length) {
    defaultIdeId = idesList[0].id;
  }
  renderIdeSettings();
}

function onIdePresetChange() {
  const val = document.getElementById('ide-preset-select').value;
  const customRow = document.getElementById('ide-custom-row');
  customRow.style.display = val === 'custom' ? 'flex' : 'none';
}

function addIdeFromPreset() {
  const sel = document.getElementById('ide-preset-select');
  const val = sel.value;
  if (!val) return;

  let ide;
  if (val === 'custom') {
    const name = document.getElementById('ide-custom-name').value.trim();
    const cmd  = document.getElementById('ide-custom-cmd').value.trim();
    if (!name || !cmd) return;
    const id = 'custom_' + Date.now();
    ide = { id, name, cmd };
    document.getElementById('ide-custom-name').value = '';
    document.getElementById('ide-custom-cmd').value  = '';
    document.getElementById('ide-custom-row').style.display = 'none';
  } else {
    const preset = IDE_PRESETS[val];
    if (!preset) return;
    if (idesList.find(i => i.id === val)) { sel.value = ''; return; } // already present
    ide = { id: val, ...preset };
  }

  idesList.push(ide);
  if (idesList.length === 1) defaultIdeId = ide.id;
  sel.value = '';
  renderIdeSettings();
}

