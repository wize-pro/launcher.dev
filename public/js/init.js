// ══ Real-time sync (SSE) ══════════════════════════════════════════════════
function connectEvents() {
  const es = new EventSource('/api/events');

  es.addEventListener('favorites-changed', e => {
    favorites = new Set(JSON.parse(e.data));
    renderFilter();
    renderProjects();
  });

  es.addEventListener('project-ide-changed', e => {
    const { id, ideId } = JSON.parse(e.data);
    const proj = allProjects.find(p => p.id === id);
    if (proj) { proj.ideId = ideId || undefined; renderProjects(); }
  });

  // Reconnexion automatique si la connexion est perdue
  es.onerror = () => {
    es.close();
    setTimeout(connectEvents, 3000);
  };
}

// ══ Init ═══════════════════════════════════════════════════════════════════
async function initSettings() {
  try {
    const s = await fetch('/api/settings').then(r => r.json());
    idesList     = s.ides      || idesList;
    defaultIdeId = s.defaultIde || defaultIdeId;
  } catch(e) { console.warn(e); }
}

loadCategories();
initI18n()
  .catch(err => console.error('i18n boot failed', err))
  .then(() => initSettings())
  .then(() => loadFavorites())
  .then(() => loadProjects());
setInterval(loadProjects, 10000);
connectEvents();

document.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  if (tag==='INPUT') return;
  if ((e.key==='r'||e.key==='R') && !e.metaKey && !e.ctrlKey) startScan();
  if (e.key==='Escape') {
    closeScan();
    closeSettings();
    closeImportPanel();
    closeCatPopover();
    if (activeTypes.size > 0) { clearTypeFilters(); return; }
    if (activeCatFilters.size > 0) { clearCatFilters(); return; }
    document.getElementById('search').blur();
  }
  if ((e.metaKey||e.ctrlKey) && e.key===',') {
    e.preventDefault();
    openSettings();
  }
  if ((e.metaKey||e.ctrlKey) && e.key==='k') {
    e.preventDefault();
    document.getElementById('search').focus();
  }
});

// Close the categories popover
document.addEventListener('click', e => {
  // Close the categories popover
  const pop = document.getElementById('cat-popover');
  if (pop?.classList.contains('open') && !pop.contains(e.target) && !e.target.closest('.cat-assign-btn')) {
    closeCatPopover();
  }
});
