# Implementation Plan — Vue FPS dans le donjon

*Generated on 2026-11-15*

## Business Objective

Pouvoir se promener dans le donjon à hauteur d'homme, comme un visiteur : un autre angle de
caméra sur les agents au travail, sans représenter le joueur.

## Requirements Summary

### Functional Requirements
- **Maj+F** (page d'un environnement uniquement, ignoré quand le focus est dans un champ de
  saisie, sans Ctrl/Alt/Méta, sans auto-repeat) bascule en vue FPS : la caméra est
  « téléportée » sur le sentier, quelques mètres après le pont-levis, regard vers la porte.
- Déplacement par **touches physiques** `KeyW/KeyA/KeyS/KeyD` (`event.code`) : ZQSD sur
  AZERTY, WASD sur QWERTY/QWERTZ ; flèches en plus. Maj maintenue = course (×2).
- Orientation à la souris via **Pointer Lock** (`movementX/Y`) : lacet libre, tangage
  borné à ±1.4 rad.
- **Échap quitte** : le navigateur libère la souris (`pointerlockchange`), la vue FPS se
  ferme et la caméra d'ensemble revient exactement où elle était (position + cible).
- **Collisions avec les murs uniquement** : murs de pièces, murs extérieurs, piliers (coins,
  portes, jambages de la porte du château) et tours d'angle. Aucun obstacle pour meubles,
  agents, arbres, douves. Portes et porte du château franchissables.
- Pas de bouton : raccourci seul (décision utilisateur).
- Pendant la vue FPS : murs tous debout (cutaway désactivé), OrbitControls et suivi de
  l'agent sélectionné désactivés, événements pointeur R3F désactivés (pas de sélection ni
  de survol involontaires, pas de désélection par `onPointerMissed`).
- Petit bandeau traduit FR/DE/EN pendant la vue FPS rappelant les commandes (lettres fixes
  par langue : ZQSD en FR, WASD en DE/EN — limite acceptée).
- En FPS, les étiquettes `<Html>` (noms, destination, requête, ghost, héraut) sont masquées
  par une classe CSS `office__scene--fps` (décision utilisateur).
- Champ de vision 70° en FPS (42° en vue d'ensemble), restauré à la sortie.
- `preventDefault` sur les touches de déplacement en FPS (le panneau latéral focusable ne
  défile pas).

### Non-Functional Requirements
- **Performance:** collisions en 2D contre ~quelques centaines de boîtes, une fois par frame
  : négligeable. Aucun rendu supplémentaire.
- **Security:** aucune donnée, aucun appel externe. Ne rien enregistrer.
- **UX/UI:** invariant i18n respecté (bandeau, `aria`). Le bandeau est `role="status"`.

### Out of Scope
- Représenter le joueur, sauter, gravité, plafond.
- Collisions avec meubles / agents / arbres ; empêcher de marcher sur les douves.
- Interaction avec les agents en vue FPS (clic, baffe…).
- Support tactile / mobile.

### Success Criteria
- Maj+F place la caméra sur le sentier face à la porte ; ZQSD + souris permettent d'entrer
  par la porte, de suivre les couloirs et d'entrer dans une pièce par sa porte.
- Impossible de traverser un mur, un pilier ou une tour, même en avançant en continu contre
  un angle.
- Échap rend la vue d'ensemble d'avant, cutaway et clics de nouveau actifs.
- `npm test` et `npm run typecheck` passent.

## Assumptions

- Un `keydown` (hors Échap) est une activation utilisateur suffisante pour
  `requestPointerLock()` dans Chromium et Firefox. Vérification : essai dans le Browser pane.
  Repli prévu si refusé : on reste en FPS, le bandeau affiche « Cliquez dans la scène pour
  capturer la souris », un clic sur le canvas redemande le verrou, Échap (keydown) quitte.
- Les modèles KayKit `wall` / `pillar` sont centrés sur leur origine, donc les empreintes au
  sol des murs dessinés sont celles des `WallRun` (`a`→`b`, `thick`) et des appels à
  `pillar()` (`wx` × `wz`). Le test automatique ne vérifie que la **complétude** (une boîte
  par run et par pilier, aucune pour linteau ni décor) ; l'adéquation au mesh se vérifie à
  la main en longeant : un mur intérieur, un mur extérieur, une variante à relief
  (`wall_shelves`/`wall_arched`), un jambage de la porte, une tour.
- Échap sous verrou ne devrait pas arriver à la page en `keydown` ; si c'est le cas, il est
  absorbé (voir §3). Chromium peut refuser un re-verrouillage juste après une sortie par
  Échap : on tombe alors dans le repli « cliquez pour capturer ».
- Hauteur des yeux 1.5 m sous le linteau de la porte (`GATE_H` 2.2) : passe.

## Technical Approach

### Architecture
1. **Empreintes des murs, à la source** — `dungeon.ts` : `WallLayout` gagne
   `blockers: Box[]` (`Box = { x0, x1, z0, z1 }`). `placeRun` y ajoute la boîte du run,
   `pillar()` celle du pilier (coins, portes, coins de carte, jambages via `gate()`). Ainsi
   la collision suit toujours ce qui est dessiné. Les tours (`TOWERS`, rayon `TOWER_R`) sont
   ajoutées comme **cercles** côté module FPS (distance < `TOWER_R + PLAYER_R`).
2. **Module pur `scene/fps.ts`** (sans three, testable) :
   - mini-store externe `isFps() / setFps(on) / onFpsChange(cb)` (même patron que
     `altarForce` : lu dans `useFrame` sans re-rendu, et via `useSyncExternalStore` par l'UI) ;
   - constantes `EYE_HEIGHT 1.5`, `PLAYER_R 0.3`, `WALK_SPEED 3`, `RUN_FACTOR 2`,
     `PITCH_MAX 1.4`, `MAX_DT 0.1` ;
   - `FPS_START` : point de `PATH` ~4 m après le bout du pont (`BRIDGE.z1`), lacet tourné
     vers le milieu de la porte ;
   - `fpsBlockers()` : `wallLayout().blockers` + tours, mémorisé ;
   - `moveVector(pressed: Set<string>, yaw, run)` → (dx, dz) normalisé ;
   - `moveWithCollision(pos, dx, dz, boxes, r)` : sous-pas ≤ r/2 (pas de traversée sur un
     pic de dt), axe X puis axe Z, cercle contre boîte avec expulsion → glisse le long des
     murs ;
   - `clampToWorld(p)` : `BOUNDS ± PAN_MARGIN` ;
   - `isShortcut(e)` / `isTypingTarget(target)`.
3. **`scene/FpsControls.tsx`** (dans le Canvas) : écoute clavier/souris/`pointerlockchange`
   sur `window`/`document`. Entrée : sauvegarde caméra + cible d'OrbitControls,
   `setEvents({ enabled: false })`, `setFps(true)`, place la caméra, `requestPointerLock`.
   `useFrame` : applique déplacement + collisions, `y = groundY(p) + EYE_HEIGHT`,
   rotation ordre `YXZ`, `fov` 70.
   **Cycle de vie** : machine à états `off → requesting → locked | fallback → off`.
   `requestPointerLock()` : promesse capturée (`.catch`) + écoute de `pointerlockerror` →
   `fallback` (bandeau « cliquez pour capturer », un clic sur le canvas redemande).
   **Sortie idempotente** (ne fait rien si déjà `off`), déclenchée par la perte du verrou,
   un `keydown` Échap (écouteur `window` en phase de capture qui fait aussi
   `stopImmediatePropagation`, pour que cartes et dialogue ne se ferment pas) ou le démontage :
   restaure position, cible et `fov`, appelle `controls.update()` une fois avant de
   réactiver les contrôles (amortissement résiduel consommé), réactive les événements R3F,
   vide les touches, `setFps(false)`. `blur` de la fenêtre vide les touches enfoncées.
4. **`Office.tsx`** : `<FpsControls />`, `OrbitControls enabled={!fps}`, `CameraFollow`
   inactif en FPS, `onPointerMissed` ignoré en FPS.
5. **Cutaway** : `Structure.tsx` (`CutawayKit`) et `Towers.tsx` : cible = 1 (debout) quand
   `isFps()`.
6. **`ui/FpsHint.tsx`** dans `.office__scene` (`App.tsx`) : bandeau `role="status"` affiché
   en FPS, texte `t.fps.hint` (+ `t.fps.capture` si la souris n'est pas capturée).
   FR « ZQSD : se déplacer · Souris : regarder · Maj : courir · Échap : quitter » ; DE et EN
   avec WASD. Style dans `styles.css` (jetons du thème, `docs/ai/ui-theme.md`).
   `App.tsx` ajoute `office__scene--fps` à `.office__scene` en FPS ; `styles.css` y masque
   `.agent-tag-anchor` et les autres ancres `<Html>` de figures.

### Stack & Tools
- **Frontend:** React 19, @react-three/fiber 9, three 0.171, Pointer Lock API native. Aucune
  dépendance ajoutée (pas de `PointerLockControls` de drei : on a besoin de la collision et
  de la restauration de caméra, et ses `onUnlock` ne gèrent pas notre état).
- **Backend:** aucun changement.

### Files to Create/Modify
1. `packages/web/src/scene/dungeon.ts` — `Box`, `WallLayout.blockers`, remplis par `placeRun` et `pillar`.
2. `packages/web/src/scene/fps.ts` — nouveau, logique pure (store, start, collisions, clavier).
3. `packages/web/src/scene/FpsControls.tsx` — nouveau, branchement R3F/DOM.
4. `packages/web/src/scene/Office.tsx` — montage, OrbitControls/CameraFollow/onPointerMissed.
5. `packages/web/src/scene/Structure.tsx`, `packages/web/src/scene/Towers.tsx` — cutaway coupé en FPS.
6. `packages/web/src/ui/FpsHint.tsx` — nouveau ; `packages/web/src/App.tsx` — montage.
7. `packages/web/src/i18n/fr.ts`, `de.ts`, `en.ts` — clés `fps.hint`, `fps.capture`.
8. `packages/web/src/styles.css` — style du bandeau.
9. `packages/web/test/fps.test.ts` — tests (via `dexter`).
10. Docs : `docs/ai/dungeon-scene.md` (via `curator`), `README.md` mention du raccourci (via `otis`).

## Work Breakdown

Single lot — main session

## Alternatives Considered

- **Collision par raycast three.js contre les meshes des murs** — exact au polygone près
  mais lourd (instances, cutaway qui écrase les murs), et non testable sans three. Les
  empreintes 2D issues du layout suffisent pour des murs droits.
- **drei `PointerLockControls`** — gère le verrou, mais ni le déplacement, ni la collision,
  ni la restauration de la vue d'ensemble ; on écrirait autant de code autour.
- **Sortie par une touche dédiée en gardant Échap = pause** — écarté par l'utilisateur.

- **Regard par glisser (bouton maintenu) au lieu du Pointer Lock** — supprime les aléas du
  verrou (geste, refus, Échap), mais le regard continu est plus naturel pour « se promener » ;
  le repli clic couvre les refus. Gagnerait si le verrou s'avérait capricieux à l'usage.

## Performance Considerations

- **Expected bottlenecks:** aucun ; boucle sur ~300 boîtes × quelques sous-pas par frame.
- **Optimizations planned:** boîtes calculées une seule fois (module-level memo).

## Edge Cases & Error Handling

- Pointer lock refusé ou indisponible → repli « cliquez pour capturer », Échap quitte.
- Onglet en arrière-plan / pic de dt → `dt` borné à `MAX_DT` + sous-pas.
- Perte de focus avec une touche enfoncée → touches vidées sur `blur`.
- Changement de route pendant le FPS → démontage : sortie propre, verrou relâché.
- Maj+F pendant la saisie dans un champ → ignoré.
- Maj+F déjà en FPS → ignoré (sortie = Échap).
- Carte de poste / dialogue d'agent ouverts : restent affichés et ne se ferment pas sur
  l'Échap de sortie (absorbé en phase de capture).
- Maj+F juste après une sortie (re-verrou refusé) → repli clic, pas d'erreur non gérée.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Une empreinte ne correspond pas au mur dessiné (mur à relief, piliers) | medium | on frôle/traverse un bout de mur | boîtes produites là où les murs sont posés + test runs↔boîtes + promenade de contrôle |
| `requestPointerLock` refusé depuis un keydown | low | souris non capturée | repli clic sur le canvas |
| Les gags (baffe, etc.) s'appuient sur la caméra d'ensemble | low | rendu étrange en FPS | gags non pilotables en FPS (événements coupés) ; contrôle visuel |

## Reversibility & Rollback

- **Hard-to-undo decisions:** none.
- **Rollback:** revert du commit.

## Complexity Estimate

**Size:** M

**Justification:** nouveau mode caméra + module de collision + i18n + touches à 3 composants
existants, sans backend.

## Objections Considered

| Objection | Severity | Resolution |
|---|---|---|
| Cycle de vie du Pointer Lock non spécifié (erreur, refus de re-verrou, Échap en double) | 🟡 | accepted — machine à états, sortie idempotente, `pointerlockerror` + `.catch`, Échap absorbé en capture |
| Le test boîtes↔runs est circulaire | 🟡 | accepted — test présenté comme complétude seulement, contrôle visuel explicite listé dans Assumptions |
| Étiquettes `<Html>` visibles à travers les murs | 🟡 | asked — utilisateur : masquer en FPS |
| Flèches qui font défiler le panneau focusable | 🟡 | accepted — `preventDefault` sur les touches de déplacement |
| Tours en boîtes carrées | 🔵 | accepted — collision cercle |
| Lettres du bandeau fixes par langue, pas par disposition clavier | 🔵 | rejected — limite acceptée, `getLayoutMap` est Chromium seul et ne vaut pas la complexité |
| FOV 42° étroit, amortissement résiduel au retour | 🔵 | accepted — FOV 70° en FPS restauré, `controls.update()` avant réactivation |

**Verdict:** SOUND WITH RESERVATIONS (1 run ; l'approche technique n'a pas changé).
