// ══ Launch / Stop ══════════════════════════════════════════════════════════
async function openUrl(url) {
  try {
    const r = await fetch('/api/open-url', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!r.ok) { window.open(url, '_blank'); }   // web mode / native unavailable → new tab
  } catch { window.open(url, '_blank'); }
}

async function launch(projectId, commandKey, iid) {
  try {
    const r = await fetch('/api/launch', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({projectId, commandKey})
    });
    const data = await r.json();
    if (!r.ok) { alert(data.error||t('common.error')); return; }
    await loadProjects();
    openTab(iid);
  } catch(e){ alert(e.message) }
}

async function stopCmd(projectId, commandKey, iid) {
  await fetch('/api/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({instanceId:iid})});
  setTimeout(loadProjects, 400);
}

// ══ Terminal ════════════════════════════════════════════════════════════════
function openTab(iid) {
  if (!terminalOpen) toggleTerminal();
  if (!tabs.has(iid)) {
    const project = allProjects.find(p => iid.startsWith(p.id+'__'));
    const cmdKey  = iid.replace((project?.id||'')+'__','');
    const cmd     = project?.commands?.[cmdKey];
    tabs.set(iid, {
      projectName: project?.name || iid,
      cmdLabel: cmd?.label || cmdKey,
      logs: [], es: null, running: true
    });
    startTabStream(iid);
  }
  activeTabId = iid;
  renderTabs();
  renderTermBody();
}

function startTabStream(iid) {
  const tab = tabs.get(iid);
  if (!tab) return;
  const es = new EventSource(`/api/logs/${iid}`);
  tab.es = es;
  es.onmessage = e => {
    const line = JSON.parse(e.data);
    tab.logs.push(line);
    if (activeTabId===iid) appendTermLine(line);
  };
  es.addEventListener('exit', e => {
    tab.running = false;
    renderTabs();
    setTimeout(loadProjects, 300);
    es.close();
  });
  es.onerror = () => { tab.running=false; es.close(); };
}

function renderTabs() {
  const wrap = document.getElementById('term-tabs');
  wrap.innerHTML = [...tabs.entries()].map(([id,t]) => `
    <button class="ttab ${id===activeTabId?'active':''}" onclick="event.stopPropagation();switchTab('${id}')">
      <span class="t-dot ${t.running?'':'dead'}"></span>
      ${t.projectName} · ${t.cmdLabel}
      <button class="t-close" onclick="event.stopPropagation();closeTab('${id}')">✕</button>
    </button>`).join('');
}

function switchTab(id) {
  activeTabId = id;
  renderTabs();
  renderTermBody();
}

function closeTab(id) {
  const t = tabs.get(id);
  if (t?.es) t.es.close();
  tabs.delete(id);
  if (activeTabId===id) {
    const keys = [...tabs.keys()];
    activeTabId = keys[keys.length-1]||null;
  }
  renderTabs();
  if (activeTabId) renderTermBody();
  else document.getElementById('term-body').innerHTML=`<div class="term-empty">${t('terminal.empty')}</div>`;
}

function renderTermBody() {
  const body = document.getElementById('term-body');
  const tab  = tabs.get(activeTabId);
  if (!tab) { body.innerHTML=`<div class="term-empty">${t('terminal.noLog')}</div>`; return; }
  body.innerHTML = tab.logs.map(l=>termLine(l)).join('');
  body.scrollTop = body.scrollHeight;
}

function appendTermLine(line) {
  const body = document.getElementById('term-body');
  const empty = body.querySelector('.term-empty');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.innerHTML = termLine(line);
  body.appendChild(div.firstChild||div);
  body.scrollTop = body.scrollHeight;
}

// Basic ANSI → HTML
function termLine(line) {
  const text = ansiToHtml(line.data.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));
  return `<div class="${line.type}">${text}</div>`;
}
function ansiToHtml(s) {
  const map = {
    '1':'a-bold','2':'a-dim',
    '30':'a-black','31':'a-red','32':'a-green','33':'a-yellow',
    '34':'a-blue','35':'a-magenta','36':'a-cyan','37':'a-white',
    '91':'a-bred','92':'a-bgreen','94':'a-bblue',
  };
  return s.replace(/\x1b\[([0-9;]*)m/g,(_, codes) => {
    if (!codes||codes==='0') return '</span><span>';
    const cls = codes.split(';').map(c=>map[c]).filter(Boolean).join(' ');
    return cls ? `<span class="${cls}">` : '';
  });
}

function clearTerminal() {
  if (!activeTabId) return;
  const tab = tabs.get(activeTabId);
  if (tab) { tab.logs=[]; renderTermBody(); }
}

function toggleTerminal() {
  terminalOpen = !terminalOpen;
  document.getElementById('terminal').classList.toggle('collapsed',!terminalOpen);
  document.getElementById('term-toggle').textContent = terminalOpen?'▼':'▲';
}

