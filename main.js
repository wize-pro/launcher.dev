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
let server = null;   // exports from server.js (killAllInstances)

// ── Express server — loaded directly in the Electron process ────────────────
// Electron is a Node.js environment: require() works without a subprocess.
function startServer() {
  server = require('./server.js');
}

// ── Wait for the server to be ready ──────────────────────────────────────
function waitForServer(retries = 30, delay = 300) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      http.get(`http://localhost:${PORT}`, () => resolve())
        .on('error', () => {
          if (n <= 0) return reject(new Error(`Server not available on port ${PORT}.`));
          setTimeout(() => attempt(n - 1), delay);
        });
    };
    attempt(retries);
  });
}

// ── Floating BrowserWindow ─────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width:       820,
    height:      620,
    minWidth:    600,
    minHeight:   400,
    frame:       false,
    transparent: false,
    resizable:   true,
    show:        false,      // shown only on tray click
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
    },
  });

  win.loadURL(`http://localhost:${PORT}`);

  // Make the header draggable without touching the existing HTML/CSS
  win.webContents.on('did-finish-load', () => {
    win.webContents.insertCSS(`
      header { -webkit-app-region: drag; }
      header button,
      header input,
      header a { -webkit-app-region: no-drag; }
    `);
  });

  // Hide on blur (Toolbox-style behaviour) — except when DevTools are open
  win.on('blur', () => {
    if (!DEV || !win.webContents.isDevToolsOpened()) win.hide();
  });

  if (DEV) win.webContents.openDevTools({ mode: 'detach' });
}

// ── Position near the tray icon (cross-platform) ──────────────────────────
// macOS   : menu bar at top → window below
// Windows : taskbar at bottom/right/left/top → detect edge
// Linux   : varies by DE, fall back to workArea corner
function positionNearTray() {
  const tb = tray.getBounds();
  const { width: ww, height: wh } = win.getBounds();
  const wa = screen.getDisplayNearestPoint({ x: tb.x, y: tb.y }).workArea;
  const disp = screen.getDisplayNearestPoint({ x: tb.x, y: tb.y }).bounds;

  // Detect which edge the taskbar is on by comparing workArea and display bounds
  const gapTop    = wa.y - disp.y;
  const gapBottom = (disp.y + disp.height) - (wa.y + wa.height);
  const gapLeft   = wa.x - disp.x;
  const gapRight  = (disp.x + disp.width) - (wa.x + wa.width);
  const maxGap    = Math.max(gapTop, gapBottom, gapLeft, gapRight);

  let x, y;

  if (maxGap === gapBottom) {
    // Taskbar at bottom (typical Windows, Linux)
    x = Math.round(tb.x + tb.width / 2 - ww / 2);
    y = Math.round(tb.y - wh - 4);
  } else if (maxGap === gapTop) {
    // Bar at top (macOS, some Linux)
    x = Math.round(tb.x + tb.width / 2 - ww / 2);
    y = Math.round(tb.y + tb.height + 4);
  } else if (maxGap === gapRight) {
    // Taskbar on the right
    x = Math.round(tb.x - ww - 4);
    y = Math.round(tb.y + tb.height / 2 - wh / 2);
  } else {
    // Taskbar on the left
    x = Math.round(tb.x + tb.width + 4);
    y = Math.round(tb.y + tb.height / 2 - wh / 2);
  }

  // Keep within the work area
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width  - ww));
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - wh));

  win.setPosition(x, y, false);
}

// ── Toggle show / hide ────────────────────────────────────────────────────
function toggleWindow() {
  if (win.isVisible() && win.isFocused()) {
    win.hide();
  } else {
    positionNearTray();
    win.show();
    win.focus();
  }
}

// ── Tray ──────────────────────────────────────────────────────────────────
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
    { label: 'Open',                   click: () => { positionNearTray(); win.show(); win.focus(); } },
    { label: 'Open in browser', click: () => shell.openExternal(`http://localhost:${PORT}`) },
    { type: 'separator' },
    { label: 'Quit',                   click: () => app.quit() },
  ]));
}

// ── App lifecycle ─────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Hide the macOS Dock icon — the app lives exclusively in the system tray
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

// Keep the app alive even when the window is closed
app.on('window-all-closed', (e) => e.preventDefault());

// Kill launched commands before quitting (no orphan processes)
app.on('before-quit', () => {
  if (server && typeof server.killAllInstances === 'function') {
    server.killAllInstances('SIGTERM');
  }
});
