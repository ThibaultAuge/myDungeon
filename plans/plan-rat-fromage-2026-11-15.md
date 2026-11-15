# Implementation Plan — Gag du rat et du fromage

*Generated on 2026-11-15* — copie à enregistrer dans `plans/plan-rat-fromage-2026-11-15.md` au démarrage.

## Business Objective

Ajouter de la vie au donjon dans l'esprit des gags existants (baffe, squelettes, fantômes) :
de temps en temps un rat traverse un couloir, et parfois il vole le fromage de la taverne
et repart avec. Une commande console permet de déclencher les deux scènes pour les tester.

## Requirements Summary

### Functional Requirements
- **Traversée** : un rat sort d'un « trou » (bout de couloir sur le bord du donjon), court
  le long des couloirs (`corridorPath`) jusqu'à un autre trou à ≥ 4 m, et disparaît.
- **Vol** (décisions de l'utilisateur) : le fromage (`food_ingredient_cheese`, KayKit
  Restaurant Bits CC0, à importer) est posé en bout de la table du milieu de la taverne.
  Le rat entre par la porte ouest, passe entre deux tables, saute sur la table, prend le
  fromage dans la gueule, redescend, ressort et file vers un trou. Le fromage
  réapparaît sur la table quelques secondes après (≈ 8 s, petit grossissement d'apparition).
- **Fréquence** : un passage tiré entre 3 et 6 min ; 1 passage sur 4 est un vol.
  Un seul rat à la fois. Onglet masqué au moment du tirage → on reprogramme sans jouer.
- **Rat procédural** low-poly (aucun pack KayKit gratuit n'en a) : corps ovoïde, tête
  pointue, oreilles et queue roses, yeux noirs ; trottinement (petit rebond + roulis),
  queue qui ondule, saut en arc sur la table.
- **Commande console** (convention `agentOffice`, cf. `docs/commandes-console.md`) :
  `agentOffice.rat()` ou `agentOffice.rat('couloir')` = traversée ;
  `agentOffice.rat('fromage')` = vol. Annule le passage en cours (le fromage revient
  aussitôt s'il était emporté) et démarre le nouveau. Renvoie `true` si un rat part,
  `false` sinon (argument inconnu, mouvement réduit). Messages console en anglais
  (outil de développeur, comme `autel`, `boiler`).

### Non-Functional Requirements
- **Performance** : rat monté seulement pendant un passage (≈ 4 draw calls : fourrure,
  rose, yeux, queue) ; fromage = 1 maillage permanent. Géométries et matériaux partagés au
  niveau module. Pas d'ombre (objets < 0,3 m, règle existante).
- **Accessibilité** : rat et fromage ni cliquables ni sélectionnables (`raycast` désactivé,
  comme les fantômes), aucun texte. `prefers-reduced-motion` : aucun passage naturel, la
  commande renvoie `false` avec un message, un passage en cours disparaît et le fromage
  revient (comme les squelettes de l'embuscade).
- **i18n** : aucun texte affiché → aucune clé ajoutée.
- **Serveur** : aucun changement.

### Out of Scope
- Son de couinement ; interaction des agents avec le rat ; rat cliquable.

## Technical Approach

### Architecture
- `packages/web/src/scene/rat.ts` (pur, testé, sans three.js) :
  - constantes `RAT_SPEED` (~2,4 m/s), `HOP_HEIGHT`, `HOP_MS`, `PASS_MIN_MS` 180 000,
    `PASS_MAX_MS` 360 000, `THEFT_CHANCE` 0,25, `CHEESE_BACK_MS` 8 000 ;
  - `RAT_HOLES` : `WANDER_POINTS` (réutilisés depuis `ghost.ts`) situés sur le bord
    `BOUNDS` ;
  - `CHEESE_SPOT` : position monde calculée depuis `ROOM_BY_ID.get('taverne')` et la
    `longTable` du milieu (y = 0,75) ; `TAVERN_WAY` : porte (`doorOf`) → passage entre
    tables → pied de la table ;
  - `nextPassDelay(random)`, `pickPass(random)` → `'corridor' | 'cheese'` ;
  - `planRun(kind, random)` → suite de segments `{ from, to, hop?, carrying }` ;
    `sampleRun(run, ms)` → `{ x, y, z, heading, carrying, done }` ;
  - `installRatCommand(host, deps)` sur le modèle de `installAltarCommand`
    (`agentOffice` remplacé seulement s'il n'est pas un objet ; désinstallation qui ne
    touche que sa propre clé).
  - Réutilise `corridorPath`, `doorOf`, `inFootprint`, `ROOM_BY_ID`, `BOUNDS`
    (`layout.ts`) et `WANDER_POINTS`, `seededRandom` (`ghost.ts`) — rien de réécrit.
- `packages/web/src/scene/RatScene.tsx` : planificateur (setTimeout, `Math.random`),
  installation de la commande, `<Rat>` (maillages procéduraux, `useFrame` qui lit
  `sampleRun`) et `<Cheese>` (`useKitGLTF('restaurant', 'food_ingredient_cheese')`,
  posé sur la table, dans la gueule pendant le vol, caché puis réapparition).
- `Office.tsx` : un import + `<RatScene />` à côté de `<MishapProps />` (modif minimale).

### Files to Create/Modify
1. `packages/web/src/scene/rat.ts` — logique pure (nouveau)
2. `packages/web/src/scene/RatScene.tsx` — rendu et planificateur (nouveau)
3. `packages/web/test/rat.test.ts` — tests (nouveau)
4. `packages/web/src/scene/Office.tsx` — montage (2 lignes)
5. `packages/web/src/scene/kit-manifest.json` — `food_ingredient_cheese` dans `restaurant`
6. `packages/web/public/kaykit/restaurant/food_ingredient_cheese.{gltf,bin}` — via
   `node scripts/import-kaykit.mjs` (texture partagée déjà présente)
7. Docs : `docs/commandes-console.md` (ligne du tableau), `docs/personnages.md` ou
   `docs/lieux.md`, `docs/modeles-3d.md` (otis) ; `docs/ai/` + index `AGENTS.md` (curator).

### Tests (`rat.test.ts`)
- `RAT_HOLES` non vide, tous sur le bord ; traversée : départ/arrivée = trous distincts
  ≥ 4 m, tous les points sur un couloir.
- Vol : passe par la porte de la taverne, les segments au sol n'entrent dans aucune
  empreinte de meuble (`inFootprint`) sauf le saut final ; `carrying` faux avant le
  fromage, vrai après ; fin sur un trou.
- `sampleRun` : continu, `done` à la fin, `y` > 0 seulement pendant un saut.
- `nextPassDelay` dans [3, 6] min ; `pickPass` respecte `THEFT_CHANCE`.
- Commande : arguments valides/invalides, mouvement réduit → `false`, ne remplace pas
  les autres clés `agentOffice`, désinstallation propre.

## Work Breakdown

Single lot — main session.

## Performance Considerations
- **Expected bottlenecks** : aucun ; +1 draw call permanent (fromage), +~4 pendant un passage.
- **Optimizations planned** : géométries/matériaux partagés, rat démonté hors passage.

## Edge Cases & Error Handling
- Commande pendant un passage → le passage courant est remplacé, le fromage revient.
- Changement de route / démontage de la scène → minuteur annulé, commande désinstallée.
- Onglet masqué → pas de passage lancé ; `dt` plafonné pour éviter un saut de position.
- Mouvement réduit activé en cours → rat retiré, fromage remis.
- Agents assis à la table : le fromage est au bout libre de la table, hors des places.

## Verification
- `npm test`, `npm run typecheck`.
- Aperçu (procédure de `docs/ai/dungeon-scene.md` / `agent-lifecycle.md`, pane visible) :
  `agentOffice.rat()` puis `agentOffice.rat('fromage')`, captures du rat dans un couloir,
  sur la table, avec le fromage, et du fromage revenu ; puis vérifier qu'un passage
  naturel se déclenche (délai raccourci temporairement dans la console via la commande
  ou en attendant, sans modifier le code livré).
- Pipeline qualité : dexter (tests), hermione + timmy (rendu 3D, non cliquable, mouvement
  réduit) ; gatsby/neo sans objet sauf avis contraire ; curator (docs/ai) ; otis (docs).
- Fusion de `origin/main` avant la PR (autres gags touchent `Office.tsx`, `AGENTS.md`,
  `commandes-console.md`).

## Complexity Estimate

**Size:** M

**Justification:** un module pur + un composant 3D procédural + import d'un modèle, sans serveur, mais animation et tests de trajectoire à soigner.
