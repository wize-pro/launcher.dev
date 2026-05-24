# Dev Launcher

> ⚠️ **Statut : en développement actif (pré-1.0).** L'outil est fonctionnel mais
> pas encore stabilisé : le format des données et certaines API peuvent évoluer de
> façon cassante avant la `1.0.0`. Le versioning suit [SemVer](https://semver.org/lang/fr/) —
> tant qu'on est en `0.x`, considère chaque version mineure comme potentiellement cassante.

Un outil léger pour **gérer et lancer tes projets de développement locaux** depuis une seule interface. Scanne ton dossier de dev, détecte automatiquement le type de chaque projet (Node, .NET, Python, Go, Docker, Makefile…), et te permet de démarrer les commandes, ouvrir l'IDE ou le dossier en un clic.

Deux modes :

- **Web** (`npm start`) — une simple page sur `http://localhost:4242`.
- **Electron** (`npm run app`) — une icône dans la barre système (tray) avec une fenêtre flottante.

> Philosophie du projet : **la simplicité**. Pas de bundler, pas de framework frontend, pas de base de données. Tout est en JSON local et en vanilla JS.

## Prérequis

- [Node.js](https://nodejs.org/) 18 ou supérieur
- npm

## Installation

```bash
git clone https://github.com/<ton-utilisateur>/dev-launcher.git
cd dev-launcher
npm install
```

## Utilisation

```bash
npm start          # serveur web seul → http://localhost:4242
npm run dev        # serveur web avec rechargement auto (--watch)
npm run app        # application Electron (tray + fenêtre flottante)
npm run app:dev    # Electron en mode dev (DevTools ouverts)
```

Au premier lancement, ouvre les **Paramètres** pour définir le dossier racine (`devRoot`) où se trouvent tes projets, puis lance un **Scan** pour les détecter automatiquement. Tu peux aussi ajouter un projet manuellement par son chemin.

### Configuration par projet (optionnel)

Place un fichier `.launcher.yml` à la racine d'un projet pour décrire ses commandes. Voir [`example.launcher.yml`](./example.launcher.yml). Sans ce fichier, le projet est tout de même détecté automatiquement via `package.json`, `*.csproj`, `Makefile`, `docker-compose.yml`, etc.

## 🔒 Sécurité — à lire

Dev Launcher **exécute des commandes shell** sur ta machine (c'est sa raison d'être). Pour cette raison :

- Le serveur écoute **uniquement sur la loopback** (`127.0.0.1`). Il n'est volontairement **pas** accessible depuis le réseau.
- Une protection anti-DNS-rebinding rejette toute requête dont l'en-tête `Host` ne désigne pas la machine locale.

**Ne modifie pas ce comportement pour exposer le launcher sur le réseau.** Il n'intègre aucune authentification : l'exposer reviendrait à offrir une exécution de commandes à distance.

## Données locales

Toutes les données sont stockées en JSON à la racine du projet et **ne sont pas versionnées** (voir `.gitignore`) :

| Fichier | Contenu |
|---|---|
| `projects.json` | Registre des projets importés |
| `favorites.json` | IDs des projets favoris |
| `categories.json` | Catégories et assignations |
| `settings.json` | Paramètres (devRoot, IDEs, profondeur de scan…) |

Le port par défaut est `4242` (modifiable dans `launcher.config.js`).

## Architecture

```
Launcher/
├── main.js              # Electron : tray, fenêtre, positionnement
├── server.js            # Express : logique backend + API REST + SSE
├── launcher.config.js   # Config statique (devRoot, port, profondeur de scan…)
├── public/index.html    # Frontend complet (CSS + JS inline, single-file)
└── assets/              # Icônes du tray
```

- **Electron** charge `server.js` directement (`require`) dans le processus principal — pas de sous-processus.
- **server.js** est autonome : il tourne seul (`node server.js`) ou dans Electron.
- **Le frontend** est un fichier HTML unique, sans build.

## Contribution

Les contributions sont les bienvenues. Ouvre une *issue* pour discuter d'un changement important avant d'envoyer une *pull request*. Merci de respecter la philosophie de simplicité du projet (éviter les dépendances et l'abstraction inutiles).

## Licence

[MIT](./LICENSE) © Hassan Rihan
