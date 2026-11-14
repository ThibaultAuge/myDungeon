# Plan d'implémentation : arrivée par le sentier et mort aux mains des squelettes

*Généré le 2026-11-14*

## Contexte

Aujourd'hui, l'agent principal d'une session apparaît sur place sans transition. Il disparaît d'un coup dès que la session s'arrête (`visibleAgents` dans `Office.tsx` ne garde que les sessions `live`). La forêt, le pont-levis et le sentier existent déjà, mais aucune figure n'en sort ni n'y entre.

L'objectif est de donner une vie visible aux sessions :
- une nouvelle session voit son chevalier arriver par le sentier depuis la forêt, passer le pont et entrer dans le donjon ;
- quand la session est supprimée, le chevalier ressort, se fait tuer par des squelettes surgis de terre, et son corps s'enfonce dans le sol.

Les sous-agents gardent le cycle actuel : ils partent de la taverne et y retournent.

## Exigences

### Fonctionnelles
1. **Ne concerne que l'agent principal** (`<session>#main`). Les sous-agents ne changent pas.
2. **Entrée.** Une session qui apparaît dans un snapshot après le premier snapshot de la route fait naître son chevalier sur le sentier, quelques mètres au-delà de la limite de pan de la caméra. Il marche sentier → pont → porte → couloir x=5, puis va à sa destination (taverne, poste, autel). Au chargement de la page ou d'un environnement, les agents présents restent à leur place, comme aujourd'hui.
3. **Session arrêtée mais encore présente** (`live:false`) : le chevalier reste visible et dort à la taverne. Choix utilisateur : il ne meurt pas tant que la session existe. Aujourd'hui, il disparaît dans ce cas.
4. **Mort.** Une session qui disparaît du snapshot de la route déclenche la mort de son chevalier. Cela couvre la suppression, l'archivage, la purge des sessions terminal après 60 min, et la sortie de l'historique des 30 sessions. Le déroulé :
   1. le chevalier sort par la porte et le pont jusqu'à un point de mise à mort sur le sentier, visible dans la limite de pan ;
   2. des squelettes sortent de terre autour de lui (`Spawn_Ground`) et l'attaquent (`Use_Item` avec un élan procédural vers la cible, à valider visuellement, car le pack gratuit n'a pas de clip d'attaque) ;
   3. le chevalier joue `Hit_A` puis `Death_A`, et reste figé sur la dernière image ;
   4. le corps s'enfonce dans le sol puis est retiré de la scène.
5. **Les squelettes.** Il y en a au plus 3 à la fois dehors. Après la mise à mort, chacun choisit au hasard (graine = id de la victime) :
   - soit il marche jusqu'à l'arbre proche le plus près (`scatterTrees().near`) et s'y fond (échelle et opacité vers 0 au pied du tronc) ;
   - soit il retourne sous terre (`Spawn_Ground` joué à l'envers et descente en y).

   On ne les voit jamais flâner : ils n'existent qu'en action.
6. **Plusieurs morts en même temps.** Les 3 squelettes se répartissent entre les victimes, au moins un par victime. Une victime sans squelette libre attend debout sur le sentier, un peu décalée des autres, jusqu'à ce qu'un squelette se libère. Une victime seule a droit aux 3.
7. **Session absorbée** (`cli:X` fusionnée dans `local_…`). Ce n'est ni une mort ni une arrivée. Le client relie les deux sessions grâce à `cliSessionIds`.

### Non fonctionnelles
- **Performance.** Les squelettes réutilisent le pipeline `Character` (clone `SkeletonUtils`, géométrie et matériaux partagés) et ne sont montés que pendant une mise à mort. Les props d'`AgentFigure` restent stables, pour que `React.memo` continue d'éviter le re-rendu de l'horloge.
- **Accessibilité.** Avec `prefers-reduced-motion`, il n'y a ni marche depuis la forêt ni combat. Le chevalier apparaît en place, et à la mort il disparaît en fondu.
- **i18n.** Aucun nouveau texte affiché n'est prévu. Si une annonce live-region s'avère nécessaire, elle passera par `packages/web/src/i18n` en FR, DE et EN.
- **Sécurité.** Côté serveur, rien ne change hormis les données déjà envoyées. Les nouveaux GLB passent par `checkGlb` (`scripts/import-kaykit.mjs`).

### Hors périmètre
- Les sous-agents, la taverne au repos par type, l'autel.
- Les ennemis permanents qui patrouillent.
- Le son, les particules, le sang.
- La caméra qui suit la victime au-delà de la limite de pan.

## Approche technique

### Logique pure et testée (pas de three.js)
1. **`packages/web/src/scene/forest.ts`**
   - `groundY(p)` : 0 à l'intérieur d'`OUTER`, pente linéaire sur `BRIDGE` (la même que `Drawbridge` dans `Forest.tsx`), `GROUND_Y` ailleurs. `AgentFigure` et les squelettes l'appliquent à chaque frame. Sans ça, la figure flotterait de 30 cm dehors.
   - `GATE_ROUTE` : le point du couloir `(5, 9.5)`, l'axe de la porte vers `(5.5, 10.5)`, puis le bout du pont `(5.5, 14)`.
   - `ENTRY_SPOT` et `KILL_SPOT` : deux indices fixes dans `pathPoints()`. Le premier est au-delà de `BOUNDS.z1 + PAN_MARGIN`, le second en deçà, sur le sentier. Les valeurs exactes seront calculées et vérifiées par un test (dedans / dehors du clamp), pas devinées.
   - `forestRouteIn()` et `forestRouteOut()` : la portion de `pathPoints` entre ces deux points, plus `GATE_ROUTE`, dans le bon sens.
2. **`packages/web/src/scene/layout.ts`**
   - `routeBetween` accepte un départ hors château : quand `from` est `ENTRY_SPOT`, la route devient la route d'entrée, puis `corridorPath` depuis `(5, 9.5)`, puis l'entrée de la pièce.
   - `reroute` fonctionne déjà, parce que `(5, 9.5)` est un point de couloir : la route d'entrée est conservée jusqu'à lui. Un test le vérifie.
   - `routeToKill(from)` : la route inverse (pièce → couloir → `(5, 9.5)` → porte → sentier → `KILL_SPOT`, avec un décalage pour les victimes en attente).
3. **`packages/web/src/scene/tavern.ts`**
   - `startOrigins` gagne une origine `'forest'` pour un agent principal inconnu après `loaded`. Une session absorbée (son id `cli:X` figure dans les `cliSessionIds` d'une session du snapshot précédent) reste `'seat'`.
   - Nouvelle fonction `departures(prev, next)` : la liste des sessions disparues, absorptions exclues.
4. **Nouveau `packages/web/src/scene/ambush.ts`**
   - La machine à états d'une mise à mort, en phases : `walking → waiting → rising → attacking → dying → sinking → gone`, et pour chaque squelette `rising → attacking → leaving(tree | ground) → gone`.
   - `assignSkeletons(victims, free)` : la règle de l'exigence 6.
   - `skeletonSpawns(victim, n)` : des points autour de la victime, hors du sentier, de la douve et du pont.
   - `nearestTree(p, near)` et `exitChoice(seed)`.
   - Les durées, constantes nommées, s'appuient sur les durées réelles des clips, lues au chargement comme `spawnLeft`.
5. **`packages/web/src/scene/characters.ts`**
   - Ajouter `Hit_A`, `Death_A`, `Use_Item` à `CLIPS`. Assouplir la règle « seul `Spawn_Ground` est non bouclé » du test en une liste explicite des clips one-shot.
   - `clipFor` gagne les états `dying` (hit puis death, maintenu) et `attacking`.
   - `Look` gagne un champ `pack`, pour `adventurers` ou `skeletons`.
   - Nouveau look squelette : un corps choisi parmi `Skeleton_Warrior/Minion/Rogue` selon l'index, et une arme tenue (`Skeleton_Blade` ou `Skeleton_Axe`) via `PROP_GRIP`.

### Rendu
6. **`packages/web/src/scene/Office.tsx`**
   - `visibleAgents` garde aussi le chevalier des sessions `live:false` non archivées, au repos à la taverne. Le serveur l'y place déjà via `markSessionDone`. Il garde la couleur de sa session pour rester reconnaissable parmi les figures neutres de la taverne. Ce point est à confirmer visuellement.
   - Nouvel état `leaving` : une `Map` de l'id de session vers son dernier `Placed` et la position de départ, alimentée par `departures`. Elle est vidée au changement de route, sur le modèle du set `arrived`.
   - Les chevaliers sortants sont rendus en dehors de `assignSpots`. Ils libèrent donc leur siège tout de suite.
   - `useStarts` donne `ENTRY_SPOT` comme départ aux origines `'forest'`.
   - Monte `<Ambush victims=… />`.
7. **`packages/web/src/scene/AgentFigure.tsx`**
   - Il applique `groundY` à `position.y`, ce qui couvre aussi le pont.
   - `Character` lit `look.pack` au lieu du `'adventurers'` codé en dur.
   - Une prop optionnelle `exit` (route de sortie et callbacks de phase) pilote la marche vers `KILL_SPOT`, puis donne la main à l'embuscade : les clips `dying`, puis la descente en y et le retrait.
   - Le badge de destination et l'étiquette sont masqués pendant la mort. L'agent sortant n'est pas sélectionnable.
8. **Nouveau `packages/web/src/scene/Ambush.tsx`**
   - Un composant unique qui fait avancer la machine d'`ambush.ts` dans `useFrame`. Il rend jusqu'à 3 `SkeletonFigure` : `Character` avec le look squelette, sans étiquette, `shadow` comme les agents.
   - Il les retire à la fin de la phase `gone`.

### Assets
9. **`packages/web/src/scene/kit-manifest.json`**
   - Pack `skeletons` (glb) : `Skeleton_Warrior`, `Skeleton_Minion`, `Skeleton_Rogue`.
   - Pack `skeletons_props` (gltf avec `skeleton_texture.png`) : `Skeleton_Blade`, `Skeleton_Axe`.
   - Mettre à jour les tests de liste de packs dans `dungeon.test.ts`.
   - Lancer `npm run kaykit:import` depuis une copie dont `assets-src/` contient `skeletons/` (pour l'instant seulement `F:/claudeworkshop/assets-src`, puisque l'import échoue si un pack listé manque). Committer le résultat dans `packages/web/public/kaykit/`.

### Fichiers à modifier ou créer
- `packages/web/src/scene/forest.ts`, `layout.ts`, `tavern.ts`, `characters.ts` : la logique pure.
- `packages/web/src/scene/ambush.ts` (nouveau) et `Ambush.tsx` (nouveau).
- `packages/web/src/scene/Office.tsx`, `AgentFigure.tsx`.
- `packages/web/src/scene/kit-manifest.json`, `packages/web/public/kaykit/skeletons*/`.
- Tests : `packages/web/test/{forest,layout,tavern,characters,dungeon}.test.ts`, plus le nouveau `ambush.test.ts`.
- Le serveur ne change pas.
- Docs : `docs/ai/agent-lifecycle.md`, `night-forest.md` et `dungeon-scene.md` passent par `curator`. Les docs humaines en français, dont `docs/lieux-et-personnages.md`, passent par `otis`.

## Considérations de performance
- Il y a au plus 3 squelettes et quelques victimes en même temps. Chaque squelette coûte un clone skinné, soit une texture d'os, libérée au démontage comme aujourd'hui.
- `groundY` est un test de rectangles, sans coût mesurable par frame.
- Les props de `AgentFigure` restent stables pour les figures qui ne sortent pas. `leaving` est une référence stable par victime.

## Cas limites
- **Session disparue pendant que son chevalier marche encore vers l'intérieur.** Il fait demi-tour depuis sa position courante.
- **Session réapparue pendant la mise à mort** (désarchivage, par exemple). La mort se termine, puis un nouveau chevalier arrive par le sentier.
- **Onglet masqué.** Les animations sont pilotées par les deltas de frame et reprennent au retour. Si plusieurs victimes se sont accumulées, la file des squelettes les traite à la suite.
- **Changement d'environnement ou de route.** `leaving` est vidé et rien n'est rejoué, comme avec `loaded`.
- **Reconnexion WebSocket.** Comme pour les arrivées actuelles, les sessions disparues pendant la coupure meurent au retour du snapshot. Ce comportement est voulu.
- **Plus de 30 sessions arrêtées.** Le serveur n'en envoie que 30. La plus ancienne qui sort de l'historique meurt. La taverne déborde en sièges « scatter », un mécanisme déjà testé.
- **Agent sélectionné qui meurt.** La sélection est déjà effacée quand la session quitte le snapshot (`store.ts`).

## Vérification
1. `npm test` et `npm run typecheck`, avec les nouveaux tests purs :
   - `groundY` ;
   - la route d'entrée et de sortie passe entre les montants de la porte, et ses points hors château sont à moins de `PATH_HALF_WIDTH` du sentier ;
   - `ENTRY_SPOT` est hors du clamp et `KILL_SPOT` dedans ;
   - `reroute` conserve la portion forêt ;
   - `departures` ignore les absorptions ;
   - `assignSkeletons` ;
   - les phases d'`ambush` ;
   - les clips présents dans les GLB.
2. Scène réelle, selon le Usage de `docs/ai/agent-lifecycle.md` :
   - build web, second serveur sur un autre port avec `AGENT_OFFICE_TOKEN`, Browser pane affiché ;
   - POST d'un `SessionStart` factice : le chevalier arrive par le sentier (capture d'écran) ;
   - attendre la fin (`live:false`, environ 30 à 40 s) : il dort à la taverne ;
   - la suppression d'une session `cli:` prend 60 min. Pour le test, on raccourcit `DONE_CLI_SESSION_TTL_MS` par variable d'environnement locale non committée, ou on vide l'état serveur par redémarrage : le chevalier sort, les squelettes surgissent, il meurt et s'enfonce (captures d'écran) ;
   - trois sessions factices supprimées ensemble : file des squelettes.
3. Vérifier `prefers-reduced-motion` avec `resize_window colorScheme` et l'émulation, ou avec un test de `clipFor`.

## Complexité
**Taille : L**. Le changement touche le cycle de vie, le routage, le rendu et l'import d'assets, avec une machine à états nouvelle et un réglage visuel à itérer (animation d'attaque, points de mise à mort).
