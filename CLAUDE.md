# Dev Launcher — CLAUDE.md

A local project management tool. Two launch modes: pure web app (`npm start`) or Electron app with a system-tray icon (`npm run app`). The project goal is **simplicity** — avoid over-engineering.

## Running the project

```bash
npm start          # web server only → http://localhost:4242
npm run dev        # web server with --watch (auto-reload)
npm run app        # Electron (tray + floating window)
npm run app:dev    # Electron in dev mode (DevTools open)
npm test           # run all tests (node --test, no extra deps)
```

## Architecture

```
Launcher/
├── main.js              # Electron: tray, BrowserWindow, positioning
├── server.js            # Express: all backend logic + REST API + SSE
├── launcher.config.js   # Static config (devRoot, port 4242, scanDepth, ignoreDirs)
├── public/
│   ├── index.html       # Complete frontend — CSS + JS inline, single-file
│   └── i18n.js          # Shared translate/detectLang module (server + browser)
├── locales/
│   ├── en.json          # Base language (English) — source of truth for keys
│   └── fr.json          # French translation
├── test/                # Test files (node --test runner)
├── assets/
│   ├── icon-launch.png      # Tray icon 16x16 (1x)
│   └── icon-launch@2x.png   # Tray icon 32x32 (Retina)
├── example.launcher.yml # Example project config
│
# Persisted JSON files (auto-created, gitignored — do NOT commit)
├── projects.json        # Project registry (path, name, ideId, ...)
├── favorites.json       # List of favorite project IDs
├── categories.json      # Functional categories
└── settings.json        # User settings (devRoot, ides, lang, schemaVersion, ...)
```

## How it works

**Electron** loads `server.js` directly via `require('./server.js')` in the main process — no subprocess. The window loads `http://localhost:4242`. The tray icon toggles the window.

**server.js** is self-contained: it can run standalone (`node server.js`) or inside Electron. It depends on no Electron API *except* `/api/pick-folder`, which does `require('electron').dialog` with a try/catch to degrade silently in web mode.

**The frontend** (`public/index.html`) is a single file — all CSS and JS are inline. No bundler, no framework. Edit this file directly.

## Security model

**IMPORTANT:** `/api/launch` executes arbitrary shell commands. Two safeguards prevent network exposure:

1. The server listens **only on `127.0.0.1`** (loopback). It never binds to `0.0.0.0`.
2. A **Host-header guard** rejects any request whose `Host` does not resolve to the local machine — this blocks DNS-rebinding attacks (a malicious website in the browser cannot control the launcher).

The allowed hosts are: `localhost`, `127.0.0.1`, `[::1]`, `::1`.

**Never expose the launcher on the network.** It has no authentication. Doing so would be equivalent to offering unauthenticated remote code execution.

The port defaults to `4242` and is overridable via the `PORT` environment variable (see `launcher.config.js`).

## REST API (server.js)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/projects` | List projects in the registry (enriched with git, activity, categories) |
| POST | `/api/projects` | Import a project into the registry |
| PUT | `/api/projects/:id` | Update a project in the registry |
| DELETE | `/api/projects/:id` | Remove a project from the registry |
| PATCH | `/api/projects/:id/ide` | Set the preferred IDE for a project |
| POST | `/api/projects/detect` | Auto-detect a project from a path (without importing) |
| GET | `/api/scan-stream` | Scan devRoot with real-time progress (SSE stream) |
| POST | `/api/launch` | Start a project command |
| POST | `/api/stop` | Stop a running command |
| GET | `/api/logs/:instanceId` | Log stream for a running command (SSE) |
| GET | `/api/events` | Real-time SSE broadcast (favorites, IDE changes, ...) |
| GET | `/api/favorites` | List favorite project IDs |
| POST | `/api/favorites/:id` | Add a favorite |
| DELETE | `/api/favorites/:id` | Remove a favorite |
| POST | `/api/open-editor` | Open project in IDE (body: `projectId`, optional `ideId`) |
| POST | `/api/open-folder` | Open project folder in file explorer (cross-platform) |
| GET | `/api/pick-folder` | Native folder picker dialog (Electron only) |
| GET | `/api/settings` | Read current settings |
| POST | `/api/settings` | Save settings (also reloads catalogs) |
| GET | `/api/categories` | Get all categories and assignments |
| POST | `/api/categories` | Create or update a category |
| DELETE | `/api/categories/:id` | Delete a category |
| POST | `/api/categories/assign` | Assign/unassign a category to a project |
| GET | `/api/locales` | List available locales (code + display name) |
| GET | `/api/version` | App name, version, and schemaVersion |
| GET | `/api/status` | Map of all running command instances |
| GET | `/api/port-check/:port` | Check whether a local port is in use |

## Real-time sync (SSE)

The server maintains a `Set` of SSE clients connected on `/api/events`. The `broadcast(event, data)` function pushes to all connected clients. Events emitted:

- `favorites-changed` — payload: `[...ids]`
- `project-ide-changed` — payload: `{ id, ideId }`

The frontend auto-reconnects every 3 seconds if the connection is lost.

## Persistence

All data is in JSON at the project root. The pattern is the same for each file:

```js
// Read with fallback to default value
if (fs.existsSync(FILE)) data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
// Write
fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
```

`settings.json` is merged with `SETTINGS_DEFAULTS` on read — new config keys are therefore backward-compatible. `settings.json` now includes a `schemaVersion` field. On startup, `runMigrations()` compares the stored version against `CURRENT_SCHEMA_VERSION` and runs any pending migration steps (currently: registry schema normalization at v1). The JSON data files are gitignored and must not be committed.

## i18n system

Translations live in `locales/en.json` (the base / source of truth) and `locales/fr.json`. The module `public/i18n.js` exports `translate(catalogs, lang, key, params)` and `detectLang(navLang, supported)` — it is a **shared module** loaded by both the server (`require('./public/i18n.js')`) and the browser (`<script src="/i18n.js">`).

The server exposes a `t(key, lang, params)` helper used in request handlers and scan logs. The frontend exposes `t(key, params)` (uses the active language) and `applyTranslations()` (updates `data-i18n` elements in the DOM). A language selector in the UI writes the choice to `settings.json` (`lang` field) and also caches it in `localStorage` (`dlLang`). On first launch with no stored preference, the frontend detects the browser language via `navigator.language` (`detectLang`), applies it, and POSTs the chosen language to `/api/settings` so the server can localize its own messages.

English is the base — every key must exist in `en.json`. French (`fr.json`) is a translation. To add a language, drop `locales/<code>.json` (include a `_meta.name` key for the display name) — no code change required. The server's `/api/locales` endpoint auto-discovers all files in `locales/`.

**Repository source (comments, logs, docs) is English-only.** French exists only as a runtime locale file.

## IDEs

The IDE list is configurable by the user in Settings (stored in `settings.json` -> `ides[]`). Each IDE entry is `{ id, name, cmd }`.

`resolveIdeExec(ide)` looks for the binary in `IDE_CANDIDATES[ide.id][platform]` (known per-OS paths), then falls back to `ide.cmd` (must be in the PATH). Platform detected via `process.platform` (`darwin` / `win32` / `linux`).

Each project can have an `ideId` that overrides the global `defaultIde`.

## Electron — key points

- `app.dock.hide()` and `icon.setTemplateImage(true)` are guarded with `if (process.platform === 'darwin')`
- `positionNearTray()` detects the screen edge where the taskbar is (top/bottom/left/right) by comparing `workArea` and `bounds` — compatible with macOS, Windows, Linux
- The window hides on `blur` (except when DevTools are open in dev mode)
- `app.on('window-all-closed', e => e.preventDefault())` — the app stays alive in the tray

## Folder opening (cross-platform)

```js
const cmd = platform === 'win32' ? 'explorer' : platform === 'darwin' ? 'open' : 'xdg-open';
spawn(cmd, [project.path], { detached: true, stdio: 'ignore' });
```

## .launcher.yml format

Optional file placed at the root of a project to define its commands. See `example.launcher.yml`. The scan also auto-detects projects without this file (via `package.json`, `*.csproj`, `Makefile`, `docker-compose.yml`, `*.py`, etc.).

## Tests

Tests live in `test/` and use Node's built-in `node --test` runner — no test framework dependency. Run with `npm test`. The `locales.test.js` file enforces key parity between `en.json` and `fr.json` (all English keys must exist in French, and vice versa).

## Conventions

- **No bundler** — the frontend is a single HTML file with inline CSS/JS
- **No frontend framework** — vanilla JS with template literals for dynamic HTML
- **Simplicity first** — avoid adding unnecessary dependencies
- The theme (dark/light) and language preference are the two client-cached prefs: `localStorage` keys `dlTheme` and `dlLang`. Language is also backed by `settings.json` (`lang`). Everything else is server-side.
- CSS classes use CSS variables (`--bg`, `--tx`, `--ac`, etc.) for theming
- The port is `4242` (defined in `launcher.config.js`, overridable via `PORT` env var)
