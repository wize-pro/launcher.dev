# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/). While in
`0.x`, minor versions may include breaking changes.

## [Unreleased]

## [0.1.0] — 2026-05-24

First public release.

### Added
- Local dev-project launcher: scan a dev folder and auto-detect project types
  (Node, .NET, Python, Go, Docker, Makefile), then run commands, open the IDE,
  or open the folder in one click.
- Two run modes: a pure web app (`npm start`) and a system-tray Electron app
  (`npm run app`).
- Real-time scan progress and per-command logs streamed over SSE.
- Project registry with favorites, functional categories, and a per-project IDE
  override.
- Internationalization (i18n): English (default) and French, with system-language
  detection on first launch and live switching. New languages can be added by
  dropping a `locales/<code>.json` file — no code change.
- `PORT` environment variable override; persisted-data schema versioning with
  startup migrations.

### Security
- The server binds to the loopback interface only (`127.0.0.1`) and rejects
  requests whose `Host` header is not local (DNS-rebinding protection), since
  `/api/launch` runs shell commands and the app has no authentication.

### Build
- `electron-builder` packaging (`.dmg`/`.zip`, NSIS `.exe`, `.AppImage`) with a
  custom app icon. In packaged builds, user data is stored in the OS per-user data
  directory.
- Continuous integration runs the test suite (`node --test`) on Node 18, 20, 22.
- `ROADMAP.md` is generated from issues and milestones and kept up to date
  automatically.
