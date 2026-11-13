# Agent Office

Un petit bureau en 3D où chaque agent Claude Code du poste local est un personnage. On voit qui travaille, sur quoi, qui attend une réponse et qui a fini.

- **Une entreprise par environnement** de l'app desktop Claude (un nom et ses dossiers). On passe de l'une à l'autre.
- **Un donjon de 14 lieux**, reliés par des couloirs (le plan est dans [docs/lieux-et-personnages.md](docs/lieux-et-personnages.md)). Les agents passent par les portes et les couloirs, jamais à travers un mur.
  - **L'agent principal et les sous-agents génériques** (Explore, general-purpose…) vont dans la pièce de l'outil qu'ils utilisent :
    - **Bibliothèque** : lecture et recherche (`Read`, `Grep`, `Glob`) ;
    - **Observatoire** : web (`WebFetch`, `WebSearch`) ;
    - **Atelier** : écriture (`Edit`, `Write`, `NotebookEdit`) ;
    - **Salle des machines** : commandes (`Bash`, `PowerShell`) ;
    - **Salle des cartes** : planification (`EnterPlanMode`, `ExitPlanMode`, `TodoWrite`), et à chaque nouveau prompt.
  - **Les sous-agents spécialisés** restent à leur poste quel que soit l'outil : Hermione et Dexter en salle des épreuves, Oracle à l'observatoire, Turing au cabinet de l'arithméticien, Curator et Otis au Scriptorium, etc. Hancock quitte son réduit pour l'atelier quand il modifie du code.
  - **L'autel des requêtes**, au centre : tout agent qui t'attend (permission, question, prochain message) y fait la queue, le plus ancien en tête, à genoux. La file avance quand il repart, et contourne la nef par les couloirs si elle s'allonge.
  - **La taverne** : les nouveaux sous-agents sortent de ses casiers, et ceux qui ont fini y retournent avant de disparaître.
  - Chaque pièce a ses places. Un agent garde la sienne tant qu'il reste dans la pièce ; quand elle est pleine, les suivants se tiennent le long des murs.
- **Trois états.**
  - Vert : il travaille.
  - Ambre : il attend ton prochain message. La bulle devient rouge quand il attend ta permission ou ta réponse, ou qu'il est bloqué par une erreur.
  - Gris : il a terminé.
- **Les sous-agents** apparaissent comme des collègues de la même couleur que leur session.
- **Un clic sur un personnage**, ou sur sa ligne dans la liste, affiche sa tâche, son outil, le temps écoulé et son dernier message. La liste latérale est l'équivalent complet de la vue 3D au clavier et au lecteur d'écran.
- **L'historique** liste les sessions terminées.
- **`/debug`** montre le flux brut des événements reçus.

## Prérequis

- Windows, avec Node.js 22 ou plus récent (testé avec Node 26).
- L'app desktop Claude et/ou Claude Code en ligne de commande.

## Installation

```bash
npm install
```

```bash
npm run build
```

```bash
npm run hooks:install
```

```bash
npm start
```

Ouvre ensuite http://127.0.0.1:4777.

Si le port 4777 est déjà pris (par exemple par une autre session), la configuration `agent-office-test` de `.claude/launch.json` lance un second serveur sur le port 4778. Elle ne contient pas de jeton : sans `AGENT_OFFICE_TOKEN` dans l'environnement, elle affiche l'inventaire mais refuse les hooks.

Pour le développement, `npm run dev` lance le serveur et Vite (http://127.0.0.1:5173, qui relaie `/api` et `/ws` vers le port 4777).

## Comment ça marche

```
Claude Code (app desktop, CLI)
  ├─ hooks ──► ~/.claude/agent-office/hook-relay.mjs ──POST /hooks (jeton)──►┐
  └─ fichiers locaux de l'app desktop ─────────────────────────────────────►┤
                                              Serveur Node (127.0.0.1:4777)
                                              état en mémoire ──WebSocket──► page 3D
```

- **Les hooks** donnent le temps réel : prompt envoyé, outil utilisé, permission demandée, sous-agent lancé ou terminé, fin de tour, fin de session.
- **L'inventaire** relit les fichiers de l'app desktop (au fil de leurs modifications, et toutes les 10 s). Il fournit les environnements, les sessions, leur titre et leur session parente, et indique si une session tourne. Au démarrage du serveur, il reconstruit l'état même sans hooks.
- **Le navigateur** reçoit un instantané complet de l'environnement affiché, au plus toutes les 100 ms. Une reconnexion suffit donc à tout resynchroniser.

### Langues

L'interface existe en français, en allemand et en anglais. Les boutons `FR | DE | EN`, en haut à droite, changent la langue à la volée, sur toutes les pages. À la première visite, la page suit la langue du navigateur, ou le français s'il n'est réglé sur aucune des trois. Le choix est ensuite mémorisé dans le navigateur.

Les titres de sessions, noms d'environnements, tâches et messages des agents s'affichent tels qu'ils ont été écrits. Les journaux du serveur restent en français.

## Ce que l'installation des hooks modifie

`npm run hooks:install` :

- **ajoute un hook pour 12 événements** dans le `settings.json` **global** de Claude Code (`~/.claude/settings.json`, ou `CLAUDE_CONFIG_DIR`). Tous les événements concernent donc toutes tes sessions ;
- **sauvegarde d'abord** ce fichier dans `settings.json.agent-office-<date>.bak` ;
- **copie le relais** dans `~/.claude/agent-office/hook-relay.mjs`, avec `relay.env` (jeton et port). Le relais ne s'exécute jamais depuis le dépôt ;
- **ne touche à aucun autre réglage**, ni à aucun autre hook.

Les hooks sont des commandes **asynchrones** : ils ne ralentissent jamais Claude. Le relais transmet l'événement au serveur, **ignore sa réponse**, n'affiche rien et se termine toujours sans erreur. Le serveur ne peut donc jamais influencer Claude : il observe seulement. Si le serveur est arrêté, rien ne change pour Claude.

- `npm run hooks:install -- --rotate` régénère le jeton.
- Après une modification de `scripts/hook-relay.mjs`, relance l'installation pour recopier le relais.
- Redémarre le serveur après une installation, pour qu'il prenne le jeton.
- `npm run hooks:uninstall` retire les hooks (avec une sauvegarde) et supprime `~/.claude/agent-office`.

## Données lues

Tout est lu en lecture seule. Seuls ces fichiers sont ouverts :

- `%LOCALAPPDATA%\Claude-Data\claude_*\ccd-session-presets.json` : les environnements ;
- `…\claude-code-sessions\<compte>\<org>\local_*.json` et `archived-sessions.idx` : les sessions de l'app desktop ;
- `~/.claude/sessions/<pid>.json` : les processus Claude Code en cours (occupé ou au repos).

Le serveur n'ouvre jamais `config.json` de l'app desktop (il contient des jetons de connexion) ni les fichiers `*.key`.

Ces formats sont internes à Claude et peuvent changer d'une version à l'autre. Les lectures sont tolérantes : un champ manquant est ignoré, et un fichier en cours d'écriture ne fait pas disparaître une session.

## Sécurité

- Le serveur écoute sur `127.0.0.1` uniquement. Il refuse un en-tête `Host` ou `Origin` inconnu, ce qui protège contre le DNS rebinding et les pages web malveillantes.
- `POST /hooks` exige le jeton, vérifié avant même la lecture de la requête.
- Les pages ne peuvent pas être intégrées dans une iframe (`X-Frame-Options: DENY`, `frame-ancestors 'none'`).
- **Limite connue.** L'API de lecture (`/api/*`) et le WebSocket ne demandent pas d'authentification. Tout programme local peut donc lire les titres, dossiers, prompts et commandes (tronqués). Une authentification par session est prévue avant toute fonction qui permettrait d'agir sur les agents.
- **Sur un poste partagé**, restreins les droits du dossier du projet. Un lecteur secondaire comme `F:\` donne souvent le contrôle total aux « Utilisateurs authentifiés ». Dans une invite de commandes administrateur :

```bash
icacls "C:\chemin\vers\agent-office" /inheritance:r /grant:r "%USERNAME%:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F"
```

## Variables d'environnement

| Variable | Rôle | Défaut |
|---|---|---|
| `AGENT_OFFICE_PORT` | Port du serveur | `4777` (ou `relay.env`) |
| `AGENT_OFFICE_TOKEN` | Jeton des hooks (32 caractères minimum) | `relay.env` |
| `AGENT_OFFICE_DESKTOP_DATA` | Dossier `Claude-Data\claude_*` de l'app desktop | détecté |
| `AGENT_OFFICE_RELAY_DIR` | Dossier du relais et de `relay.env` | `~/.claude/agent-office` |
| `AGENT_OFFICE_SETTINGS` | Fichier `settings.json` à modifier | `~/.claude/settings.json` |
| `CLAUDE_CONFIG_DIR` | Dossier de configuration de Claude Code | `~/.claude` |

## Tests

```bash
npm test
```

```bash
npm run typecheck
```

## Limites et suite

- Les personnages sont des formes simples. Des modèles glTF animés viendront ensuite (packs CC0 comme Kenney ou Quaternius). Des assets Unreal ne seraient utilisables que si leur licence Fab autorise un usage hors Unreal Engine.
- Répondre aux agents depuis la 3D (permission, question) fera l'objet d'une phase distincte, qui demandera une authentification forte du serveur. Envoyer un prompt libre à une session déjà ouverte n'a pas encore de solution officielle.
- Le plan complet se trouve dans [plans/plan-agent-office-2026-11-13.md](plans/plan-agent-office-2026-11-13.md).
