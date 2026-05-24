'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, screen } = require('electron');
const http = require('http');
const path = require('path');

const config = require('./launcher.config');
const pkg    = require('./package.json');
const PORT   = config.port;
const DEV    = process.env.NODE_ENV === 'development';

let tray = null;
let win  = null;
let server = null;   // exports de server.js (killAllInstances)

// ── Serveur Express — chargé directement dans le process Electron ──────────
// Electron est un environnement Node.js : require() fonctionne sans subprocess.
function startServer() {
  server = require('./server.js');
}

// ── Attendre que le serveur soit prêt ─────────────────────────────────────
function waitForServer(retries = 30, delay = 300) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      http.get(`http://localhost:${PORT}`, () => resolve())
        .on('error', () => {
          if (n <= 0) return reject(new Error(`Serveur non disponible sur le port ${PORT}.`));
          setTimeout(() => attempt(n - 1), delay);
        });
    };
    attempt(retries);
  });
}

// ── BrowserWindow flottante ────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width:       820,
    height:      620,
    minWidth:    600,
    minHeight:   400,
    frame:       false,
    transparent: false,
    resizable:   true,
    show:        false,      // affiché uniquement au clic tray
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
    },
  });

  win.loadURL(`http://localhost:${PORT}`);

  // Rendre le header draggable sans toucher au HTML/CSS existant
  win.webContents.on('did-finish-load', () => {
    win.webContents.insertCSS(`
      header { -webkit-app-region: drag; }
      header button,
      header input,
      header a { -webkit-app-region: no-drag; }
    `);
  });

  // Masquer au blur (comportement Toolbox) — sauf si DevTools ouverts
  win.on('blur', () => {
    if (!DEV || !win.webContents.isDevToolsOpened()) win.hide();
  });

  if (DEV) win.webContents.openDevTools({ mode: 'detach' });
}

// ── Positionnement près de l'icône tray (cross-platform) ──────────────────
// macOS  : barre en haut → fenêtre en dessous
// Windows : taskbar en bas/droite/gauche/haut → détecter le bord
// Linux  : varie selon DE, on se rabat sur le coin workArea
function positionNearTray() {
  const tb = tray.getBounds();
  const { width: ww, height: wh } = win.getBounds();
  const wa = screen.getDisplayNearestPoint({ x: tb.x, y: tb.y }).workArea;
  const disp = screen.getDisplayNearestPoint({ x: tb.x, y: tb.y }).bounds;

  // Détecter le bord où se trouve la taskbar en comparant workArea et display
  const gapTop    = wa.y - disp.y;
  const gapBottom = (disp.y + disp.height) - (wa.y + wa.height);
  const gapLeft   = wa.x - disp.x;
  const gapRight  = (disp.x + disp.width) - (wa.x + wa.width);
  const maxGap    = Math.max(gapTop, gapBottom, gapLeft, gapRight);

  let x, y;

  if (maxGap === gapBottom) {
    // Taskbar en bas (Windows typique, Linux)
    x = Math.round(tb.x + tb.width / 2 - ww / 2);
    y = Math.round(tb.y - wh - 4);
  } else if (maxGap === gapTop) {
    // Barre en haut (macOS, certains Linux)
    x = Math.round(tb.x + tb.width / 2 - ww / 2);
    y = Math.round(tb.y + tb.height + 4);
  } else if (maxGap === gapRight) {
    // Taskbar à droite
    x = Math.round(tb.x - ww - 4);
    y = Math.round(tb.y + tb.height / 2 - wh / 2);
  } else {
    // Taskbar à gauche
    x = Math.round(tb.x + tb.width + 4);
    y = Math.round(tb.y + tb.height / 2 - wh / 2);
  }

  // Garder dans la zone de travail
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width  - ww));
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - wh));

  win.setPosition(x, y, false);
}

// ── Toggle show / hide ─────────────────────────────────────────────────────
function toggleWindow() {
  if (win.isVisible() && win.isFocused()) {
    win.hide();
  } else {
    positionNearTray();
    win.show();
    win.focus();
  }
}

// ── Tray ───────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon-launch.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (process.platform === 'darwin') icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip(`Dev Launcher v${pkg.version}`);
  tray.on('click', toggleWindow);

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Dev Launcher v${pkg.version}`, enabled: false },
    { type: 'separator' },
    { label: 'Ouvrir',                   click: () => { positionNearTray(); win.show(); win.focus(); } },
    { label: 'Ouvrir dans le navigateur', click: () => shell.openExternal(`http://localhost:${PORT}`) },
    { type: 'separator' },
    { label: 'Quitter',                   click: () => app.quit() },
  ]));
}

// ── Cycle de vie ───────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Cacher le Dock macOS — l'app vit uniquement dans la barre système
  if (process.platform === 'darwin') app.dock.hide();

  startServer();

  try {
    await waitForServer();
  } catch (err) {
    console.error('[Dev Launcher]', err.message);
    app.quit();
    return;
  }

  createWindow();
  createTray();
});

// Garder l'app vivante même quand la fenêtre est fermée
app.on('window-all-closed', (e) => e.preventDefault());

// Tuer les commandes lancées avant de quitter (pas de processus orphelins)
app.on('before-quit', () => {
  if (server && typeof server.killAllInstances === 'function') {
    server.killAllInstances('SIGTERM');
  }
});
