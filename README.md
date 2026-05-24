# Dev Launcher

> **Status: active development (pre-1.0).** The tool is functional but not yet
> stabilized: the data format and some APIs may change in breaking ways before
> `1.0.0`. Versioning follows [SemVer](https://semver.org/) — while in `0.x`,
> treat every minor version as potentially breaking.

A lightweight tool to **manage and launch your local development projects** from a single interface. Scans your dev folder, auto-detects each project type (Node, .NET, Python, Go, Docker, Makefile, ...), and lets you start commands, open your IDE, or browse the folder in one click.

Two modes:

- **Web** (`npm start`) — a simple page at `http://localhost:4242`.
- **Electron** (`npm run app`) — a system-tray icon with a floating window.

> Project philosophy: **simplicity**. No bundler, no frontend framework, no database. Everything lives in local JSON files and plain vanilla JS.

## Requirements

- [Node.js](https://nodejs.org/) 18 or higher
- npm

## Installation

```bash
git clone https://github.com/<your-username>/dev-launcher.git
cd dev-launcher
npm install
```

## Usage

```bash
npm start          # web server only → http://localhost:4242
npm run dev        # web server with auto-reload (--watch)
npm run app        # Electron app (tray + floating window)
npm run app:dev    # Electron in dev mode (DevTools open)
```

On first launch, open **Settings** to add one or more root folders (`devRoots`) where your projects live, then run a **Scan** to detect them automatically. You can also add a project manually by path.

### Per-project configuration (optional)

Place a `.launcher.yml` file at the root of a project to describe its commands. See [`example.launcher.yml`](./example.launcher.yml). Without this file, the project is still detected automatically via `package.json`, `*.csproj`, `Makefile`, `docker-compose.yml`, etc.

## Security

Dev Launcher **executes shell commands** on your machine — that is its purpose. For this reason:

- The server listens **only on the loopback interface** (`127.0.0.1`). It is intentionally **not** reachable from the network.
- A DNS-rebinding guard rejects any request whose `Host` header does not refer to the local machine.

**Do not modify this behavior to expose the launcher on the network.** It has no authentication: exposing it would be equivalent to offering remote command execution.

## Local data

All data is stored as JSON at the project root and is **not versioned** (see `.gitignore`):

| File | Contents |
|---|---|
| `projects.json` | Registry of imported projects |
| `favorites.json` | IDs of favorite projects |
| `categories.json` | Categories and assignments |
| `settings.json` | Settings (devRoots, IDEs, scan depth, ...) |

The default port is `4242` (overridable via the `PORT` environment variable; defined in `launcher.config.js`).

## Architecture

```
Launcher/
├── main.js              # Electron: tray, window, positioning
├── server.js            # Express: backend logic + REST API + SSE
├── launcher.config.js   # Static config (devRoot, port, scan depth, ...)
├── public/index.html    # Complete frontend (CSS + JS inline, single-file)
├── public/i18n.js       # Shared translate/detectLang module (server + browser)
├── locales/             # Translation catalogs (en.json base, fr.json, ...)
└── assets/              # Tray icons
```

- **Electron** loads `server.js` directly (`require`) in the main process — no subprocess.
- **server.js** is self-contained: it runs standalone (`node server.js`) or inside Electron.
- **The frontend** is a single HTML file, no build step.

## Build installers

Packaging uses [electron-builder](https://www.electron.build/):

```bash
npm run pack   # unpacked app in dist/ (fast, for testing)
npm run dist   # installers: .dmg/.zip (macOS), NSIS .exe (Windows), .AppImage (Linux)
```

Build for the current OS by default; cross-building has the usual electron-builder
platform requirements. In a packaged build, user data (`projects.json`, `settings.json`,
…) is stored in the OS per-user data directory — not next to the app — since the app
bundle is read-only. Builds are unsigned by default; configure code signing via
electron-builder if you distribute them. A custom app icon can be added at
`build/icon.icns` / `build/icon.ico` / `build/icon.png` (512×512).

## Contribution

Contributions are welcome. Open an issue to discuss a significant change before sending a pull request. Please respect the project's philosophy of simplicity (avoid unnecessary dependencies and abstractions).

## License

[MIT](./LICENSE) © wize-pro
