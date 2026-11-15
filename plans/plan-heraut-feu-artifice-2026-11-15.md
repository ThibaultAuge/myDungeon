# Plan d'implémentation : héraut sur les tours et feu d'artifice

*Rédigé le 2026-11-15. Sera copié dans `plans/plan-heraut-feu-artifice-2026-11-15.md` dès l'approbation (Plan mode n'autorise que ce fichier).*

## Objectif

C'est un des cinq gags « humour du donjon ». Une commande git réussie fait sonner la trompette à un héraut, posté en haut d'une petite tour d'angle du château. Une suite de tests réussie fait partir un petit feu d'artifice dans le ciel nocturne. Comme la baffe et l'embuscade, ce gag doit à la fois faire sourire et dire quelque chose de vrai : « ça vient d'être poussé », « les tests passent ».

## Exigences

### Fonctionnelles
- **Héraut** : il se déclenche sur un `PostToolUse` (succès uniquement, jamais `PostToolUseFailure`) d'un outil `Bash` ou `PowerShell`, quand la commande contient `git … commit` ou `git … push`.
  - **commit** : une sonnerie courte (environ 2,5 s).
  - **push** : une fanfare longue (environ 6 s) avec un fanion pendu à la trompette. Si une même commande fait commit puis push, c'est le push qui l'emporte.
- **Tours** : quatre petites tours cylindriques, une à chaque angle du château. Le héraut prend une tour libre au hasard. Si les 4 tours sont occupées, l'événement est ignoré : ce n'est qu'un gag.
- **Feu d'artifice** : il se déclenche sur un `PostToolUse` réussi d'une commande de lanceur de tests (voir Détection). Plusieurs fusées éclatent en gerbes colorées au-dessus du château, pendant environ 4 s.
- **Portée** : seuls les événements de l'environnement affiché déclenchent quelque chose (`event.envId === route.envId`).
- **Commande de test**, disponible en permanence (choix de l'utilisateur), y compris dans le build de production : `iaia.heraut('commit' | 'push')` et `iaia.feuArtifice()` dans la console du navigateur. L'autre voie de test, côté serveur, existe déjà : POST d'un faux hook `PostToolUse` sur `/hooks`.

### Non fonctionnelles
- **Sécurité** : le serveur classe la commande et n'ajoute à l'événement qu'un type énuméré (`celebrations?: ('commit' | 'push' | 'tests')[]`), jamais le texte de la commande. La classification se fait sans regex à retour arrière, sur une entrée tronquée.
- **i18n** : aucun texte nouveau. Les notes ♪ et le fanion sont des symboles `aria-hidden`, le héraut et le feu d'artifice sont en 3D seulement. Aucun fichier i18n n'est touché.
- **Mouvement réduit** : avec `prefers-reduced-motion`, le héraut apparaît immobile (sans spawn ni notes animées) puis disparaît. Le feu d'artifice devient une gerbe figée, montrée environ 1,5 s.
- **Fichiers partagés avec les 4 sessions sœurs** : `packages/shared/src/index.ts` (un champ optionnel), `reducer.ts` (un appel dans `summarize`), `store.ts` côté web (deux lignes). C'est tout.

### Hors périmètre
- Le son (le projet n'a pas d'audio).
- L'annonce en région live : même parti pris que l'embuscade et les fantômes, effet en 3D seulement, limite acceptée.
- La détection des tests qui échouent : c'est le gag de la session chaudière/fiole.

## Approche technique

### Détection côté serveur : `packages/server/src/celebration.ts` (nouveau, pur)
- `celebrationsFor(ev: HookEvent): Celebration[]`. Elle ne fait rien si `hook_event_name !== 'PostToolUse'` ou si l'outil n'est ni `Bash` ni `PowerShell`, ou si `tool_input.command` n'est pas une chaîne. La commande est tronquée à 4 Ko.
- **Découpage** en segments sur `&&`, `||`, `;`, `|`, `&` et les retours à la ligne. Pour chaque segment, on retire les affectations `VAR=x` et les préfixes `npx`, `pnpm exec`, `bunx`, puis on découpe en mots par espaces (pas de regex sur la commande entière).
- **git** : le premier mot vaut `git` ou `git.exe`. On saute les options globales (`-C <dir>`, `-c <k=v>`, `--no-pager`, `--git-dir=…`). Le premier mot non-option qui reste est la sous-commande, `commit` ou `push`.
- **tests**, sous-commande reconnue :
  - `npm|pnpm|yarn|bun` suivi de `test`, `t`, `run test`, ou `run test:*` / `test:*`
  - `vitest` (sans `watch` / `--watch`), `jest`, `playwright test`, `pytest`, `python -m pytest`
  - `mvn|mvnw … test|verify`, `gradle|gradlew … test|check`
  - `cargo test`, `go test`, `dotnet test`, `node --test`
- **Garde-fou contre les sorties masquées** (`npm test | tail`, `|| true`) : si `tool_response` contient un texte (stdout ou stderr, les 64 derniers Ko) qui matche le motif linéaire `/\b[1-9]\d* (?:failed|failing)\b|\bFAIL\b|Tests failed/`, alors pas de `tests`.
- **Câblage** : `summarize()` (`reducer.ts`) ajoute `celebrations` quand le tableau n'est pas vide. `HookEventSummary` gagne `celebrations?: Celebration[]` et le type `Celebration` est exporté depuis `packages/shared/src/index.ts`. Les événements sont déjà envoyés à tous les abonnés (`OfficeStore.ingestHook`), donc aucun changement de transport.

### Client
- **Nouveau `packages/web/src/scene/celebrate.ts`** (pur, sans three.js), un bus sur le modèle de `slap.ts` :
  - `celebrate(kind)`, `onCelebrate(cb)`, `installConsoleCommands()` qui définit `window.iaia`.
  - Constantes de durée : `HERALD_COMMIT_MS`, `HERALD_PUSH_MS`, `FIREWORKS_MS`.
  - `TowerPool` : 4 tours, `claim(rng)` renvoie un indice libre ou `null`, `release(i)`. Le générateur aléatoire est injecté pour les tests.
  - La phase du héraut dans le temps, `heraldPhase(elapsed, kind)` : `rising → trumpeting → sinking → gone`. Les durées des clips viennent des longueurs mesurées dans `characters.ts`.
  - Le plan de tir du feu d'artifice : `fireworkBursts(seed)`, qui donne positions, couleurs et retards.
- **`store.ts`** : dans `onMessage`, sur un `event` dont `celebrations` est présent et dont l'`envId` correspond à la route, on appelle `celebrate(k)` pour chaque type.
- **Tours, dans `dungeon.ts`** (placement pur et testé) :
  - `TOWERS` : centre décalé de 0,2 m vers l'extérieur depuis chaque coin de `OUTER`, rayon 0,8, hauteur 3,8 m (les murs font 3 m), plus des créneaux.
  - L'emprise intérieure ne dépasse pas `PERIMETER_INNER`, donc aucun chevauchement avec le décor ni les places des salles. Un test le vérifie.
  - Au sud, le fût descend jusqu'à `WATER_Y`, pour que la tour sorte des douves.
  - L'ancre de coupe est le coin de la carte. La logique d'enfoncement est extraite en fonction pure `cutHeight(prev, target, dt, reduced)`, réutilisée par `CutawayKit` (`Structure.tsx`, sans changer son comportement), par les tours et par le héraut, qui reste posé sur le sommet de la tour pendant qu'elle s'enfonce.
- **`scene/Towers.tsx`** (nouveau) : cylindres et créneaux procéduraux, géométries et matériau pierre partagés au niveau du module. Ils se montent dans `Office.tsx` à côté de `Walls`.
- **`scene/Herald.tsx`** (nouveau) :
  - Reprend `Character` avec un `Look` (corps `Rogue`) et `Motion.scripted`, sur le modèle de `SkeletonFigure` : `Spawn_Ground` pour monter par la trappe, `Use_Item` en boucle pour sonner, `Spawn_Ground` à l'envers pour redescendre.
  - Une trompette procédurale (tube et pavillon dorés) montée par portail dans `handslotr`.
  - Pour un push, un fanion (plan coloré) pend à la trompette.
  - Des notes ♪ en HTML et CSS (`<Html>` `aria-hidden`), qui flottent.
  - Le héraut regarde vers l'extérieur de la tour.
- **`scene/Fireworks.tsx`** (nouveau) :
  - Un `Points` par gerbe, en mélange additif, `toneMapped=false`. Les particules suivent une trajectoire balistique avec une gravité légère et s'estompent.
  - Une traînée de montée avant chaque explosion.
  - Positions réglées pour être visibles avec la caméra par défaut, au-dessus du château ou juste derrière lui au nord. À ajuster sur capture d'écran.
- **`main.tsx`** : appel de `installConsoleCommands()`.

### Fichiers
1. `packages/server/src/celebration.ts` (nouveau) et `packages/server/test/celebration.test.ts`
2. `packages/server/src/reducer.ts` : une ligne dans `summarize`
3. `packages/shared/src/index.ts` : `Celebration` et le champ optionnel
4. `packages/web/src/scene/celebrate.ts` (nouveau) et `packages/web/test/celebrate.test.ts`
5. `packages/web/src/scene/dungeon.ts` (`TOWERS`, `cutHeight`), `Structure.tsx` (utilise `cutHeight`), `packages/web/test/dungeon.test.ts`
6. `packages/web/src/scene/Towers.tsx`, `Herald.tsx`, `Fireworks.tsx` (nouveaux), `Office.tsx` (montage)
7. `packages/web/src/store.ts` et `packages/web/src/main.tsx`
8. Docs : `docs/ai/` via curator (probablement `night-forest.md` et `dungeon-scene.md`), et la doc humaine via otis (`docs/utilisation.md` pour la commande `iaia`, `docs/lieux.md` pour les tours)

### Branche
`git fetch` puis une branche `feat/heraut-feu-artifice` créée depuis `origin/main`. `main` est extrait dans un autre worktree, d'où le `fetch` plutôt qu'un `checkout main && pull`.

## Répartition du travail

Un seul lot, dans la session principale. Le changement est petit et couplé, et il touche des fichiers partagés sensibles.

## Coordination
Après approbation, je laisse une note dans le dossier de notes partagé : la session chaudière/fiole pourra réutiliser la détection des lanceurs de tests de `celebration.ts`, exportée sous le nom `isTestCommand`, au lieu d'en dupliquer une.

## Performances
- Le héraut ajoute un personnage cloné seulement pendant la célébration. Les tours ajoutent environ 8 draw calls.
- Le feu d'artifice fait quelques centaines de points, démontés à la fin.
- La classification coûte un découpage linéaire par `PostToolUse` Bash.

## Cas limites
- **Commit et tests dans une même commande** : les deux célébrations partent.
- **Rafales** : un héraut par tour libre au maximum, le reste est ignoré. Le feu d'artifice en cours est relancé, pas empilé.
- **Le mouvement réduit s'active pendant une célébration** : on bascule sur la version figée.
- **Changement de route ou démontage pendant une célébration** : la tour est libérée au démontage.
- **`git commit --dry-run`, `git push --dry-run`** : on les ignore.
- **`git -C x push`** : il compte.
- **`echo git push`** : il ne compte pas, car le premier mot du segment est `echo`.

## Vérification
- `npm test` et `npm run typecheck`. Tests unitaires de `celebrationsFor` (git, tests, échecs masqués, faux positifs), du bus et du `TowerPool`, de `TOWERS` dans l'emprise, de `cutHeight`.
- Dans l'aperçu (second serveur sur un autre port, faux hooks) :
  - POST d'un `PostToolUse` Bash `git commit -m x` puis `git push`, puis `npm test` : je vérifie le héraut sur une tour et le feu d'artifice, avec captures.
  - `iaia.heraut('push')` et `iaia.feuArtifice()` dans la console.
  - Contrôle visuel des 4 tours avec la coupe (le curseur fait descendre une tour et son héraut).
  - Mouvement réduit via `resize_window` / l'émulation.

## Complexité
**Taille : M.** Client et serveur, trois nouveaux composants 3D, des modules purs testés, sans dépendance externe.
