# Plan d'implémentation : Agent Office, un bureau 3D des agents Claude Code

*Rédigé le 2026-11-13. À copier dans `plans/plan-agent-office-2026-11-13.md` du projet une fois le plan validé.*

## Objectif

Les sessions, sous-agents et sous-sessions Claude Code se lisent mal dans des fenêtres de chat. On veut un petit bureau 3D où chaque agent est un personnage. On y voit qui travaille, sur quoi, qui attend une réponse et qui a fini, et on peut cliquer sur un agent pour savoir où il en est.

- **Une entreprise = un environnement** de l'app desktop, c'est-à-dire un nom et ses dossiers.
- On liste les environnements et on passe de l'un à l'autre.
- **Le poste local uniquement.** L'ouverture au réseau ou à l'extérieur fera l'objet d'un autre sujet.
- **Ce plan couvre une vue d'ambiance en lecture seule.** Répondre aux agents depuis la 3D viendra plus tard. L'architecture doit le permettre sans être refaite (voir la phase 4, hors périmètre).

## Faisabilité vérifiée

Ces points ont été vérifiés dans la doc officielle et sur ce poste.

- **Environnements.** Ils sont dans `%LOCALAPPDATA%\Claude-Data\claude_<id>\ccd-session-presets.json`, sous `byAccount.<acct>.presets[]` avec les champs `id`, `name`, `target.cwd` et `target.additionalFolders`. Il y en a 15 aujourd'hui.
- **Sessions de l'app desktop.**
  - Une par fichier : `…\claude-code-sessions\<acct>\<org>\local_<uuid>.json`.
  - On les rattache à un environnement par `startedFromEnvironmentId`, qui vaut l'`id` du preset.
  - Champs utiles : `title`, `cwd`, `originCwd`, `cliSessionId`, `isArchived`, `lastActivityAt`, `spawnedFrom` et `forkedFromSessionId`. Ces deux derniers donnent le lien parent → sous-session.
  - Archivées : listées dans `archived-sessions.idx`. Supprimées : fichiers `deleted_*`, à ignorer.
- **État vivant.** Un fichier par processus Claude Code vivant : `~/.claude/sessions/<pid>.json`. Il contient `status` (`busy` ou `idle`), `sessionId` (le `cliSessionId`) et `hostSessionId` (le `local_…`).
- **Transcripts.**
  - Session : `~/.claude/projects/<cwd-encodé>/<cliSessionId>.jsonl`.
  - Sous-agents : `…/<cliSessionId>/subagents/agent-<id>.jsonl`, avec un fichier `.meta.json` (`agentType`, `description`).
  - Le format est officiellement instable. On ne s'en sert que pour enrichir l'affichage, jamais comme source principale.
- **Hooks.**
  - Ils se déclenchent aussi pour les sessions de l'app desktop (doc officielle).
  - Il existe un type de hook `http` qui envoie le JSON en POST. Si le serveur est injoignable, Claude continue normalement (fail-open par défaut).
  - Les appels d'outil faits par un sous-agent portent `agent_id` et `agent_type`.
  - `SubagentStart` et `SubagentStop` portent `agent_id`, `agent_type` et `agent_transcript_path`.
  - `PermissionRequest` donne le signal « attend une permission » immédiatement. `Notification` n'arrive qu'environ 6 s plus tard.
  - `~/.claude/settings.json` n'a aucun hook aujourd'hui.
- **Outillage.**
  - Node 26 et npm 11 sont installés.
  - L'app desktop embarque Claude Code 2.1.321. Le CLI du PATH est en 2.1.286.
  - `F:\claudeworkshop` est vide et ce n'est pas un dépôt git.
- **Hors de portée.** Il n'existe pas d'API simple pour envoyer un nouveau prompt dans une session desktop déjà ouverte. Les « channels » sont en preview et non documentés côté desktop, et Remote Control n'a pas d'API publique. C'est pour ça que la phase 4 est sortie du plan.

## Exigences

### Fonctionnelles
- Lister les environnements et en choisir un, avec l'URL `/env/:id`. Changer d'environnement recharge la scène.
- Pour l'environnement choisi :
  - les sessions actives, chacune représentée par un personnage principal ;
  - leurs sous-agents, comme des collègues de la même couleur ;
  - les sessions terminées dans un panneau « Historique », sans personnage, pour éviter d'encombrer la scène.
- Trois états visibles :
  - travaille, en vert ;
  - attend ta réponse, en ambre, avec une bulle (événement `PermissionRequest`, ou `Stop` quand Claude a fini son tour et attend ton prompt) ;
  - terminé, en gris : le personnage va à la pause café, puis disparaît au bout de quelques minutes.
- Le personnage se déplace selon l'outil utilisé :
  - `Read`, `Grep`, `Glob`, `WebFetch`, `WebSearch` : Bibliothèque ;
  - `Edit`, `Write`, `NotebookEdit` : Atelier ;
  - `Bash`, `PowerShell` : Salle serveur ;
  - attente ou fin : Accueil.
- Un clic sur un agent ouvre un panneau de détail : titre de la session, type d'agent, description de la tâche, dernier outil et son argument principal, temps écoulé, dernier message de l'assistant (`last_assistant_message`). La caméra suit l'agent.
- Les sous-sessions sont reliées à leur session parente par `spawnedFrom` : un fil ou un badge dans le panneau.
- Recharger la page reconstruit l'état. Démarrer le serveur reconstruit l'état depuis l'inventaire des fichiers.

### Non fonctionnelles
- **Performance.** Ne jamais ralentir Claude : le serveur répond `{}` en moins de 50 ms et le hook a `timeout: 2`. La scène vise 60 images/s avec une dizaine d'agents.
- **Sécurité.**
  - Le serveur écoute sur `127.0.0.1` uniquement.
  - Les hooks HTTP envoient un jeton (header `X-Agent-Office-Token` via `allowedEnvVars`) et le serveur rejette tout appel sans jeton valide.
  - Les données de Claude sont lues en lecture seule.
  - On ne lit jamais `Claude-Data\…\config.json` (il contient des jetons OAuth) ni les fichiers `~/.claude/sessions/*.key`.
  - En phase 1 à 3, le serveur ne renvoie aucune décision aux hooks : il observe seulement.
- **UX.** Style de bureau miniature original, en formes simples d'abord (voir la maquette montrée). Caméra orbitale et interface en français.

### Hors périmètre
- Répondre aux agents depuis la 3D (phase 4, plan séparé).
- L'accès réseau ou externe.
- Les sessions cloud.
- Les vrais modèles 3D animés (phase 3, optionnelle dans ce plan).

## Approche technique

### Architecture

```
Claude Code (desktop et CLI)
  ├─ hooks http ──POST /hooks (jeton)──►┐
  └─ fichiers locaux (presets, local_*.json, sessions/<pid>.json, subagents/*.meta.json)
                                      ▼
                 Serveur Node (127.0.0.1:4777)
                 ├─ inventory : lit et surveille les fichiers ──► environnements et sessions
                 ├─ ingest    : reçoit les hooks, les rattache à la bonne session
                 ├─ store     : état en mémoire, mis à jour par un réducteur pur (événement → état)
                 └─ REST /api/* + WebSocket /ws (instantané complet, puis différences)
                                      ▼
                 Front Vite + React Three Fiber (servi par le même serveur)
```

- **Rattachement d'un événement de hook.**
  - Le `session_id` du hook est le `cliSessionId`.
  - Il mène au `hostSessionId` via `sessions/<pid>.json`, ou au `local_*.json` via `cliSessionId`.
  - Le `local_*.json` donne `startedFromEnvironmentId`.
  - Une session sans environnement est rattachée en comparant `originCwd` ou `cwd` au `target.cwd` des presets.
  - Une session CLI sans `local_` est rattachée de la même façon, par son `cwd`.
- **Inventaire.** `chokidar` surveille les fichiers, avec un rescan de secours toutes les 10 s. Le PID est vérifié vivant (`process.kill(pid, 0)`) pour écarter les fichiers de sessions mortes.
- **Le réducteur pur `reduce(state, event)`** est le cœur testable. Il gère :
  - la machine d'états de chaque agent (`working`, `waiting`, `done`) ;
  - la pièce cible de chaque agent ;
  - l'arrivée et le départ des sous-agents.

### Stack et outils
- **Monorepo** en workspaces npm et TypeScript.
- **Serveur :** Node 26, `fastify` et `@fastify/websocket`, `chokidar`, `zod` pour valider les payloads de hooks.
- **Front :** Vite, React, `@react-three/fiber`, `@react-three/drei` (OrbitControls et Html pour les étiquettes), `zustand`.
- **Tests :** `vitest` côté serveur et pour le réducteur.
- **API externes :** aucune. Les hooks sont locaux.

### Fichiers à créer (à la racine de `F:\claudeworkshop`)
1. `package.json` et `tsconfig.base.json` : workspaces et scripts `dev`, `build`, `test`.
2. `packages/shared/src/types.ts` : `Environment`, `Session`, `Agent`, `AgentState`, `HookEvent`, et les messages WebSocket.
3. `packages/server/src/paths.ts` : découverte de `Claude-Data\claude_*` et des dossiers `<acct>/<org>` qui contiennent des sessions.
4. `packages/server/src/inventory.ts` : lecture des presets, des sessions, de l'état vivant et des fichiers meta des sous-agents.
5. `packages/server/src/ingest.ts` : route `POST /hooks`, contrôle du jeton, validation zod, rattachement à une session, réponse `{}`.
6. `packages/server/src/reducer.ts` : la machine d'états et le tableau outil → pièce.
7. `packages/server/src/store.ts` et `ws.ts` : état en mémoire, puis instantané et différences diffusés par environnement.
8. `packages/server/src/index.ts` : démarrage, routes `/api/environments` et `/api/environments/:id`, service du front compilé.
9. `scripts/install-hooks.mjs` et `scripts/uninstall-hooks.mjs` :
   - sauvegardent `~/.claude/settings.json` (`.bak` horodaté) ;
   - fusionnent un bloc `hooks` marqué `agent-office`, sans écraser le reste ;
   - génèrent le jeton dans `.env.local`, ignoré par git ;
   - affichent la variable d'environnement à définir ;
   - permettent de tout désinstaller proprement.
10. `packages/web/src/scene/Office.tsx`, `Room.tsx`, `AgentFigure.tsx` : reprise de la maquette en composants, avec déplacement par le hub central et anneau d'état.
11. `packages/web/src/ui/EnvSwitcher.tsx`, `AgentPanel.tsx`, `History.tsx` : l'interface autour de la scène.
12. `packages/server/test/fixtures/*.json` et `*.test.ts` : des payloads de hooks réalistes et des fichiers de session anonymisés.

### Phases
- **Phase 0, le pré-requis.**
  - `git init` et une branche de travail (le dossier n'est pas un dépôt).
  - L'ossature du monorepo.
  - L'inventaire et l'API REST.
  - Une page de debug qui liste les environnements, les sessions et le flux brut des hooks.
  - L'installation des hooks.
  - **Critère de réussite :** lancer une session dans un environnement de l'app desktop, lui faire appeler un sous-agent, et voir chaque événement arriver, rattaché à la bonne session.
- **Phase 1, la scène 3D en formes simples.** Elle est branchée sur le WebSocket. On y retrouve les 4 pièces, les états et les déplacements.
- **Phase 2, les interactions de lecture.**
  - Le clic sur un agent, son panneau de détail et le suivi caméra.
  - Le changement d'environnement.
  - L'historique.
  - Le lien vers la session parente.
- **Phase 3, le polish (optionnel).**
  - Personnages glTF animés, issus de packs CC0 comme Kenney ou Quaternius.
  - Sons discrets.
  - Retrait automatique des agents terminés.

### Phase 4, hors de ce plan : interagir avec les agents
Les mécanismes sont confirmés dans la doc, mais pas tous testés dans l'app desktop.
- **Répondre à une permission.** Un hook `PermissionRequest` attend la décision de l'interface et renvoie `allow` ou `deny`. Dans l'app desktop, c'est « le premier qui répond gagne » face à la boîte de dialogue normale.
- **Répondre à une question.** Un hook `PreToolUse` sur `AskUserQuestion` renvoie `updatedInput.answers`.
- **Relancer après `Stop`.** Le hook renvoie `decision: block` avec une consigne dans `reason`.
- **Ce qu'on ne sait pas encore faire :** envoyer un prompt libre à une session au repos. Les options sont les channels (en preview) ou Remote Control (sans API publique). Ce point demandera sa propre étude de faisabilité.

## Points de vigilance sécurité
- Ajouter des hooks globaux modifie la configuration de Claude Code pour toutes les sessions. On ne le fait qu'avec un script réversible, avec sauvegarde, et en mode observation uniquement.
- Le jeton protège `/hooks` contre un autre processus local qui injecterait de faux événements. Ce sera indispensable en phase 4, quand le serveur pourra autoriser des outils.
- On n'affiche pas les contenus d'outils sensibles en entier. Le panneau tronque à environ 200 caractères.

## Performance
- **Goulot possible :** les rafales de `PreToolUse`/`PostToolUse` quand plusieurs sous-agents tournent en parallèle. Le serveur regroupe les différences toutes les 100 ms.
- **Cible :** un seul utilisateur local, au plus quelques dizaines d'agents à l'écran.
- **Optimisations :** géométries partagées, pas de lecture des transcripts à chaque événement (on lit seulement les `.meta.json`).

## Cas limites
- **Serveur arrêté pendant que Claude tourne.** Les hooks échouent sans bloquer Claude. Au redémarrage, l'inventaire reconstruit un état approximatif : busy ou idle, sans l'outil en cours.
- **Événement d'une session inconnue** (CLI hors environnement). On le range dans un environnement virtuel « Hors environnement ».
- **`SubagentStop` d'un agent interne** (`agent_type` vide ou égal au nom de la session). On l'ignore.
- **Sessions mortes sans `SessionEnd`** (crash). Le contrôle de PID les passe en terminé.
- **Format interne qui change avec une version de Claude Code.** Les lectures sont tolérantes : champs optionnels validés par zod, et un champ manquant ne fait pas planter le serveur.
- **Worktrees.** On rattache par `originCwd` et `folderPlace`, pas par `cwd`.

## Vérification
- **Phase 0.**
  - `npm test` : le réducteur et le rattachement, sur les fixtures.
  - `npm run dev`, puis `node scripts/install-hooks.mjs`.
  - Dans l'app desktop, ouvrir une session de l'environnement ClaudeWorkshop et lui demander une tâche qui lance un sous-agent Explore.
  - Sur la page de debug, voir `UserPromptSubmit`, puis `PreToolUse` (avec un `agent_id` pour le sous-agent), `SubagentStart/Stop` et `Stop`.
  - Arrêter le serveur et vérifier que Claude continue sans erreur bloquante.
  - `uninstall-hooks.mjs` remet `settings.json` à l'identique (comparaison avec la sauvegarde).
- **Phases 1 et 2.** Ouvrir `http://127.0.0.1:4777/env/<id>` dans le navigateur intégré et refaire le même scénario. Vérifier :
  - les déplacements entre pièces ;
  - la bulle ambre quand une permission est demandée ;
  - le panneau de détail ;
  - le changement d'environnement ;
  - la reconstruction de l'état après un rechargement de la page.
- **Pipeline qualité :**
  - `dexter` puis `hermione` ;
  - `timmy` et `gatsby` sur le front ;
  - `neo`, obligatoire : hooks, `settings.json`, serveur local, jeton ;
  - `otis` pour le README.

## Estimation de complexité

**Taille : L.** Le projet combine deux intégrations locales (fichiers de l'app desktop et hooks), un serveur temps réel et une scène 3D, avec une part d'incertitude sur des formats internes non documentés. Les phases 0 à 2 représentent l'essentiel. La phase 3 est optionnelle.
