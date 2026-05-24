# Dev Launcher — CLAUDE.md

Outil de gestion de projets locaux. Deux modes de lancement : application web pure (`npm start`) ou application Electron avec icône tray (`npm run app`). L'objectif du projet est **la simplicité** — éviter la sur-ingénierie.

## Lancer le projet

```bash
npm start          # serveur web seul → http://localhost:4242
npm run dev        # serveur web avec --watch (rechargement auto)
npm run app        # Electron (tray + fenêtre flottante)
npm run app:dev    # Electron en mode dev (DevTools ouverts)
```

## Architecture

```
Launcher/
├── main.js              # Electron : tray, BrowserWindow, positionnement
├── server.js            # Express : toute la logique backend + API REST + SSE
├── launcher.config.js   # Config statique (devRoot, port 4242, scanDepth, ignoreDirs)
├── public/
│   └── index.html       # Frontend complet — CSS + JS inline, single-file
├── assets/
│   ├── icon-launch.png      # Icône tray 16×16 (1x)
│   └── icon-launch@2x.png   # Icône tray 32×32 (Retina)
├── example.launcher.yml # Exemple de config projet
│
# Fichiers JSON persistés (créés automatiquement, ne pas commiter)
├── projects.json        # Registre des projets (path, name, ideId, …)
├── favorites.json       # Liste des IDs favoris
├── categories.json      # Catégories fonctionnelles
└── settings.json        # Paramètres utilisateur (devRoot, ides, …)
```

## Principe de fonctionnement

**Electron** charge `server.js` directement via `require('./server.js')` dans le processus principal — pas de sous-processus. La fenêtre charge `http://localhost:4242`. L'icône tray toggle la fenêtre.

**server.js** est autonome : il peut tourner seul (`node server.js`) ou dans Electron. Il ne dépend d'aucune API Electron *sauf* `/api/pick-folder` qui fait `require('electron').dialog` avec un try/catch pour dégrader silencieusement en mode web.

**Le frontend** (`public/index.html`) est un fichier unique — tout le CSS et le JS sont inline. Pas de bundler, pas de framework. Modifier ce fichier directement.

## API REST (server.js)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/projects` | Liste des projets du registre |
| POST | `/api/projects` | Ajouter un projet manuellement |
| PATCH | `/api/projects/:id` | Modifier un projet |
| DELETE | `/api/projects/:id` | Supprimer du registre |
| PATCH | `/api/projects/:id/ide` | Définir l'IDE préféré d'un projet |
| POST | `/api/detect` | Auto-détecter un projet depuis un chemin |
| POST | `/api/scan` | Scanner le devRoot (SSE stream) |
| POST | `/api/launch` | Démarrer une commande d'un projet |
| POST | `/api/stop` | Arrêter une commande |
| GET | `/api/logs/:tabId` | Logs d'une commande (SSE stream) |
| GET | `/api/events` | Flux SSE temps réel (favoris, IDE, …) |
| GET | `/api/favorites` | Liste des IDs favoris |
| POST | `/api/favorites` | Ajouter un favori |
| DELETE | `/api/favorites/:id` | Retirer un favori |
| POST | `/api/open-editor` | Ouvrir dans l'IDE (prend `projectId`, `ideId` optionnel) |
| POST | `/api/open-folder` | Ouvrir dans l'explorateur (cross-platform) |
| GET | `/api/pick-folder` | Sélecteur de dossier natif Electron |
| GET | `/api/settings` | Lire les paramètres |
| POST | `/api/settings` | Sauvegarder + rescanner |
| GET/POST/… | `/api/categories` | CRUD catégories |

## Sync temps réel (SSE)

Le serveur maintient un `Set` de clients SSE connectés sur `/api/events`. La fonction `broadcast(event, data)` pousse à tous les clients connectés. Événements émis :

- `favorites-changed` — payload : `[...ids]`
- `project-ide-changed` — payload : `{ id, ideId }`

Le frontend reconnecte automatiquement toutes les 3 secondes si la connexion est perdue.

## Persistance

Tout est en JSON à la racine du projet. Le pattern est identique pour chaque fichier :

```js
// Lecture avec fallback sur valeur par défaut
if (fs.existsSync(FILE)) data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
// Écriture
fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
```

`settings.json` est mergé avec `SETTINGS_DEFAULTS` à la lecture — les nouvelles clés de config sont donc rétrocompatibles.

## IDEs

La liste des IDEs est configurable par l'utilisateur dans les Paramètres (stockée dans `settings.json` → `ides[]`). Chaque IDE a `{ id, name, cmd }`.

`resolveIdeExec(ide)` cherche le binaire dans `IDE_CANDIDATES[ide.id][platform]` (chemins connus par OS), puis tombe en fallback sur `ide.cmd` (doit être dans le PATH). Plateforme détectée via `process.platform` (`darwin` / `win32` / `linux`).

Chaque projet peut avoir un `ideId` qui override le `defaultIde` global.

## Electron — points importants

- `app.dock.hide()` et `icon.setTemplateImage(true)` sont guardés `if (process.platform === 'darwin')`
- `positionNearTray()` détecte le bord de l'écran où se trouve la taskbar (haut/bas/gauche/droite) en comparant `workArea` et `bounds` de l'écran — compatible macOS, Windows, Linux
- La fenêtre se masque au `blur` (sauf si DevTools ouverts en mode dev)
- `app.on('window-all-closed', e => e.preventDefault())` — l'app reste vivante dans le tray

## Ouverture de dossier (cross-platform)

```js
const cmd = platform === 'win32' ? 'explorer' : platform === 'darwin' ? 'open' : 'xdg-open';
spawn(cmd, [project.path], { detached: true, stdio: 'ignore' });
```

## Format .launcher.yml

Fichier optionnel placé à la racine d'un projet pour définir ses commandes. Voir `example.launcher.yml`. Le scan auto-détecte également les projets sans ce fichier (via `package.json`, `*.csproj`, `Makefile`, `docker-compose.yml`, `*.py`, etc.).

## Conventions

- **Pas de bundler** — le frontend est un fichier HTML unique avec CSS/JS inline
- **Pas de framework frontend** — vanilla JS avec template literals pour le HTML dynamique
- **Simplicité avant tout** — éviter d'ajouter des dépendances inutiles
- Le thème (dark/light) est le seul état conservé dans `localStorage` (`dlTheme`) — tout le reste est côté serveur
- Les classes CSS utilisent des variables CSS (`--bg`, `--tx`, `--ac`, etc.) pour le theming
- Le port est `4242` (défini dans `launcher.config.js`)
