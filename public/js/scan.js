// ══ Scan ═══════════════════════════════════════════════════════════════════
function startScan() {
  const btn = document.getElementById('btn-scan');
  const overlay = document.getElementById('scan-overlay');
  const log = document.getElementById('so-log');
  const spinner = document.getElementById('so-spinner');
  const text = document.getElementById('so-text');
  const footer = document.getElementById('so-footer');
  const results = document.getElementById('so-results');

  log.innerHTML=''; footer.style.display='none';
  results.innerHTML=''; results.classList.remove('visible');
  spinner.className='so-spinner'; text.innerHTML=t('scan.inProgress');
  overlay.classList.add('open');
  btn.disabled=true; btn.classList.add('spinning');

  if (activeScanEs) activeScanEs.close();
  const es = new EventSource('/api/scan-stream');
  activeScanEs = es;
  let found = 0;

  es.onmessage = e => {
    const {type, message} = JSON.parse(e.data);
    if (type==='found') found++;
    if (type==='explore') text.innerHTML = `↳ <strong>${message.split('   ')[0]}</strong>`;
    if (type==='found')   text.innerHTML = `✅ <strong>${message.split('   ')[0]}</strong>`;
    const div = document.createElement('div');
    div.className = `l-${type}`;
    div.textContent = message;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  };

  es.addEventListener('projects', e => {
    const scanProjects = JSON.parse(e.data);
    const newCount = scanProjects.filter(p => !p.imported).length;
    spinner.className='so-spinner done';
    text.innerHTML=t('scan.done');
    footer.style.display='flex';
    document.getElementById('so-footer-text').innerHTML= t('scan.footer', {
        found: `<strong style="color:var(--tx)">${found}</strong>`,
        foundPlural: found!==1?'s':'',
        newPhrase: t(newCount===1?'scan.newOne':'scan.newMany', {
          count: `<strong style="color:${newCount>0?'var(--ac)':'var(--t2)'}">${newCount}</strong>`
        }),
      });
    const importAllBtn = document.getElementById('so-import-all');
    if (newCount > 0) importAllBtn.classList.add('visible');
    else importAllBtn.classList.remove('visible');
    btn.disabled=false; btn.classList.remove('spinning');
    renderScanResults(scanProjects);
    es.close();
  });

  es.onerror = () => {
    text.innerHTML=`<span style="color:var(--rd)">${t('scan.error')}</span>`;
    spinner.className='so-spinner done';
    btn.disabled=false; btn.classList.remove('spinning');
    es.close();
  };
}

// Store scan results for import actions
let lastScanResults = [];

function renderScanResults(scanProjectsList) {
  lastScanResults = scanProjectsList;
  const results = document.getElementById('so-results');
  if (!scanProjectsList.length) return;
  results.classList.add('visible');
  const newItems = scanProjectsList.filter(p => !p.imported);
  const importedItems = scanProjectsList.filter(p => p.imported);
  let html = '';
  if (newItems.length) {
    html += `<div class="so-results-header">${t('scan.newHeader', { count: newItems.length })}</div>`;
    html += newItems.map((p, _) => {
      const i = scanProjectsList.indexOf(p);
      const shortPath = p.path.replace(/.*\/dev\//, '~/dev/');
      return `<div class="so-result-item">
        <span class="so-ri-name" title="${escHtml(p.path)}">${escHtml(p.name)}</span>
        <span class="so-ri-path" title="${escHtml(p.path)}">${escHtml(shortPath)}</span>
        <button class="so-ri-btn" onclick="importFromScan(${i})">${t('scan.importBtn')}</button>
      </div>`;
    }).join('');
  }
  if (importedItems.length) {
    html += `<div class="so-results-header" style="margin-top:${newItems.length?'0':'0'}">${t('scan.alreadyHeader', { count: importedItems.length })}</div>`;
    html += importedItems.map(p => {
      const shortPath = p.path.replace(/.*\/dev\//, '~/dev/');
      return `<div class="so-result-item">
        <span class="so-ri-name" title="${escHtml(p.path)}">${escHtml(p.name)}</span>
        <span class="so-ri-path" title="${escHtml(p.path)}">${escHtml(shortPath)}</span>
        <span class="so-ri-badge imported">${t('scan.importedBadge')}</span>
      </div>`;
    }).join('');
  }
  results.innerHTML = html;
}

function importFromScan(idx) {
  const p = lastScanResults[idx];
  if (!p) return;
  closeScan();
  openImportPanel({ mode: 'new', prefill: p });
}

function importAllFromScan() {
  const newProjects = lastScanResults.filter(p => !p.imported);
  if (!newProjects.length) return;
  closeScan();
  // Open the first project to import (the rest will be handled manually)
  openImportPanel({ mode: 'new', prefill: newProjects[0] });
}

function onScanOverlayClick(e) {
  if (e.target === document.getElementById('scan-overlay')) closeScan();
}

async function openFolder(projectId) {
  await fetch('/api/open-folder', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ projectId })
  });
}

async function openEditor(projectId, ideId) {
  try {
    const r = await fetch('/api/open-editor', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ projectId, ideId }),
    });
    if (!r.ok) {
      const d = await r.json();
      const ide = idesList.find(i=>i.id===(ideId||defaultIdeId));
      alert(t('editor.cantOpen', { name: ide?.name||ide?.cmd||'code', error: d.error, cmd: ide?.cmd||'code' }));
    }
  } catch(e) { alert(e.message); }
}

let idePickerTarget = null;
function showIdePicker(projectId, anchor) {
  const picker = document.getElementById('ide-picker');
  closeIdePicker();
  if (!idesList.length) return;

  const proj = allProjects.find(p=>p.id===projectId);
  const currentId = proj?.ideId || defaultIdeId;

  picker.innerHTML = idesList.map(ide => `
    <div class="ide-pick-item ${ide.id===currentId?'current':''}"
         onclick="pickIde('${projectId}','${ide.id}')">
      ${ide.name}
      <span class="ide-settings-cmd" style="margin-left:4px">${ide.cmd}</span>
      ${ide.id===currentId?'<span class="ip-check">✓</span>':''}
    </div>
  `).join('') + `
    <div class="ide-pick-sep"></div>
    <div class="ide-pick-item" onclick="pickIde('${projectId}',null)" style="color:var(--t3);font-size:11px">
      ${t('ide.useDefault', { name: idesList.find(i=>i.id===defaultIdeId)?.name||defaultIdeId })}
    </div>
  `;

  const rect = anchor.getBoundingClientRect();
  picker.style.top  = (rect.bottom + 4) + 'px';
  picker.style.left = Math.min(rect.left, window.innerWidth - 180) + 'px';
  picker.classList.add('open');
  idePickerTarget = projectId;
}

async function pickIde(projectId, ideId) {
  closeIdePicker();
  const proj = allProjects.find(p=>p.id===projectId);
  if (proj) proj.ideId = ideId || undefined;
  renderProjects();
  await fetch(`/api/projects/${encodeURIComponent(projectId)}/ide`, {
    method:'PATCH', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ ideId }),
  });
}

function closeIdePicker() {
  document.getElementById('ide-picker').classList.remove('open');
  idePickerTarget = null;
}

function closeScan() {
  document.getElementById('scan-overlay').classList.remove('open');
  if (activeScanEs) { activeScanEs.close(); activeScanEs=null; }
  document.getElementById('btn-scan').disabled=false;
  document.getElementById('btn-scan').classList.remove('spinning');
}

