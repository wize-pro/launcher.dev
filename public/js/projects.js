// ══ Load ═══════════════════════════════════════════════════════════════════
async function loadProjects() {
  try {
    const r = await fetch('/api/projects');
    allProjects = await r.json();
    // Sync categories from enriched project data
    allProjects.forEach(p => {
      if (p.categories?.length) {
        catAssignments[p.id] = p.categories.map(c => c.id);
      }
    });
    computePortConflicts();
    renderFilter();
    renderTypeBar();
    renderCatBar();
    updateSortButtons();
    renderProjects();
  } catch(e){ console.warn(e) }
}

// ══ Port conflict detection ════════════════════════════════════════════════
function computePortConflicts() {
  const portToProjects = new Map();
  allProjects.forEach(p => {
    const seen = new Set();
    Object.values(p.commands||{}).forEach(cmd => {
      if (cmd.port && !seen.has(cmd.port)) {
        seen.add(cmd.port);
        if (!portToProjects.has(cmd.port)) portToProjects.set(cmd.port, []);
        portToProjects.get(cmd.port).push(p.id);
      }
    });
  });
  portConflicts = new Map([...portToProjects].filter(([,ids]) => ids.length > 1));
}

// ══ Port filter ════════════════════════════════════════════════════════════
function filterByPort(port) {
  if (activePortFilter === port) {
    activePortFilter = null;
  } else {
    activePortFilter = port;
    activeFilter = 'all';
  }
  updatePortFilterBanner();
  renderProjects();
}

function clearPortFilter() {
  activePortFilter = null;
  updatePortFilterBanner();
  renderProjects();
}

// ══ Sort ═══════════════════════════════════════════════════════════════════
function setSort(key) {
  if (sortBy === key) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortBy  = key;
    sortDir = key === 'recent' ? 'desc' : 'asc';
  }
  updateSortButtons();
  renderProjects();
}

function updateSortButtons() {
  ['name','recent'].forEach(k => {
    const btn   = document.getElementById(`sort-${k}`);
    const arrow = document.getElementById(`sort-${k}-arrow`);
    if (!btn) return;
    const isActive = sortBy === k;
    btn.classList.toggle('active', isActive);
    arrow.textContent = isActive ? (sortDir === 'asc' ? '↑' : '↓') : '';
    arrow.style.opacity = isActive ? '1' : '0';
  });
}

function applySort(list) {
  return [...list].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'name') {
      cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    } else {
      const ta = a.lastActivity?.ts ?? 0;
      const tb = b.lastActivity?.ts ?? 0;
      cmp = ta - tb;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });
}

// ══ Favorites ══════════════════════════════════════════════════════════════
async function toggleFavorite(id) {
  const wasFav = favorites.has(id);
  // Immediate optimistic update
  wasFav ? favorites.delete(id) : favorites.add(id);
  renderFilter();
  renderProjects();
  // Server-side persistence (shared between web and Electron)
  try {
    await fetch(`/api/favorites/${encodeURIComponent(id)}`, {
      method: wasFav ? 'DELETE' : 'POST',
    });
  } catch {
    // On network error, roll back the optimistic update
    wasFav ? favorites.add(id) : favorites.delete(id);
    renderFilter();
    renderProjects();
  }
}

// ══ Relative date ══════════════════════════════════════════════════════════
function relativeDate(ts) {
  if (!ts) return null;
  const diff = Date.now() - ts;
  const m  = Math.floor(diff / 60000);
  const h  = Math.floor(diff / 3600000);
  const d  = Math.floor(diff / 86400000);
  const w  = Math.floor(d / 7);
  const mo = Math.floor(d / 30);
  const y  = Math.floor(d / 365);
  if (m < 1)   return { label: t('date.justNow'),                  recent: true };
  if (m < 60)  return { label: t('date.minutesAgo', { m }),        recent: true };
  if (h < 24)  return { label: t('date.hoursAgo', { h }),          recent: true };
  if (d < 2)   return { label: t('date.yesterday'),                 recent: true };
  if (d < 7)   return { label: t('date.daysAgo', { d }),           recent: false };
  if (w < 5)   return { label: t('date.weeksAgo', { w }),          recent: false };
  if (mo < 12) return { label: t('date.monthsAgo', { mo }),        recent: false };
  return       { label: t('date.yearsAgo', { y, yearPlural: y>1?'s':'' }), recent: false };
}

function updatePortFilterBanner() {
  const bar   = document.getElementById('port-filter-bar');
  const label = document.getElementById('port-filter-label');
  if (activePortFilter !== null) {
    label.textContent = t('port.filterActive', { port: activePortFilter, count: portConflicts.get(activePortFilter)?.length || '?' });
    bar.classList.add('visible');
  } else {
    bar.classList.remove('visible');
  }
}

// ══ Port check ═════════════════════════════════════════════════════════════
async function checkPort(port, btn) {
  btn.classList.add('checking');
  const dot = btn.querySelector('.port-dot');
  dot.className = 'port-dot';
  try {
    const r = await fetch(`/api/port-check/${port}`);
    const { inUse } = await r.json();
    btn.classList.remove('checking');
    dot.className = `port-dot ${inUse ? 'in-use' : 'free'}`;
    btn.title = inUse ? t('port.inUse', { port }) : t('port.free', { port });
  } catch {
    btn.classList.remove('checking');
    dot.className = 'port-dot';
  }
}

