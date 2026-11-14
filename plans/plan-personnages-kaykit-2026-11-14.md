# Plan d'implémentation : personnages KayKit pour les agents

*Généré le 2026-11-14*

## Objectif

Les agents sont aujourd'hui des capsules surmontées d'une sphère. On les remplace par des
personnages animés KayKit Adventurers 2.0 (CC0), dans le style de la carte, pour qu'on
lise d'un coup d'œil qui fait quoi : qui marche, qui travaille, qui attend, qui a terminé.

## Exigences

### Fonctionnelles
- Les agents principaux sont des **Knight**, les sous-agents des **Rogue_Hooded**. Le
  sous-agent garde l'échelle 0.85 qu'il a aujourd'hui.
- Animations du rig partagé `Rig_Medium`, choisies selon l'état et le mouvement :
  - marche : `Walking_A`, puis `Running_A` au-dessus d'un seuil de vitesse, avec une
    vitesse de lecture proportionnelle à `speed` pour que les pieds ne glissent pas. Le
    seuil et la foulée sont calibrés à l'œil ;
  - `working` : `Interact` en boucle ;
  - `waiting` : `Idle_B` en boucle (il regarde autour de lui). La bulle actuelle reste ;
  - `done` : **pose figée et calme** (`Idle_A` arrêté sur une frame), sans transparence ;
  - apparition d'un sous-agent : `Spawn_Ground` joué une fois au début, puis la marche.
  - Les changements d'animation se font en fondu court (crossfade).
- Le lien avec la couleur de session est conservé de **deux** façons :
  - un **disque au sol** de la couleur de session, à l'intérieur de l'anneau d'état ;
  - l'**étiquette du nom** bordée de cette couleur, avec une variable CSS
    `--session-color`. Le contour `--selected` reste distinct.
- Le personnage tourne en douceur dans les virages, en réutilisant le lissage en arc
  court déjà appliqué à `spot.facing`. Cela traite la suggestion de la revue précédente.
- Le sous-agent agenouillé à l'autel garde son abaissement `kneel`.
- Mouvement réduit : la position bouge toujours, car c'est une information. Les boucles
  d'ambiance (idle, travail) s'arrêtent sur une pose fixe. La marche reste une pose fixe
  qui glisse.

### Non fonctionnelles
- **Performance :** un clone `SkeletonUtils.clone` par agent et un `AnimationMixer` par
  agent. Le matériel est partagé entre les clones et la géométrie n'est pas dupliquée.
  Les modèles et les clips sont préchargés comme le kit.
- **Sécurité :** le script d'import accepte maintenant les `.glb`, avec les mêmes
  garanties que pour les `.gltf` (voir plus bas).
- **i18n :** aucun texte nouveau. Le nom vient déjà de `agentName` et passe par l'i18n.

### Hors périmètre
- Les armes et accessoires du pack (bouclier, livre…) en main.
- Un personnage différent par agent.
- Les autres personnages : Barbarian, Mage, Ranger et Rogue ne sont pas importés.

## Approche technique

### Import des assets
- Décompresser le zip dans `assets-src/adventurers/` (le dossier est gitignoré) pour
  suivre la convention des autres packs.
- `kit-manifest.json` reçoit deux nouveaux packs, avec un champ `format: "glb"` :
  - `adventurers` : source `Characters/gltf`, modèles `Knight` et `Rogue_Hooded`, aucune
    texture séparée puisqu'elle est intégrée au `.glb` ;
  - `adventurers_anim` : source `Animations/gltf/Rig_Medium`, modèles
    `Rig_Medium_General` et `Rig_Medium_MovementBasic`.

  Les deux reprennent le `License.txt` du pack.
- `scripts/import-kaykit.mjs` : nouvelle branche `.glb`.
  - Lire l'en-tête binaire : magic `glTF`, version 2, premier chunk JSON.
  - Refuser tout fichier dont le JSON déclare des extensions, un `buffer` avec `uri` ou
    une `image` avec `uri`. Une `image` doit référencer un `bufferView`, donc rester
    intégrée.
  - Copier le fichier tel quel.
  - Les contrôles existants restent : noms sûrs, pas de `..`, pas de lien symbolique.
- `kit.ts` : `kitUrl` prend l'extension du champ `format` du pack, `.gltf` par défaut.
  `preloadKit` couvre donc automatiquement les nouveaux packs.

### Rendu
- Nouveau fichier `packages/web/src/scene/characters.ts`, pur et sans three.js, donc
  testable en node :
  - `characterFor(kind)` donne `Knight` ou `Rogue_Hooded` ;
  - `clipFor({ walking, speed, state, spawning, reducedMotion })` donne
    `{ name, loop, timeScale, frozen }`.
- `AgentFigure.tsx` :
  - remplacer la capsule, la tête et la visière par le personnage, chargé avec
    `useGLTF`, cloné avec `SkeletonUtils.clone` et mis à l'échelle `KIT_SCALE` ;
  - charger les clips des deux `.glb` d'animation et les jouer avec `useAnimations` de
    drei sur le clone. Les pistes visent les os par leur nom, et les 23 os sont
    identiques dans les 8 fichiers (vérifié) ;
  - supprimer le `bob` vertical, que les animations remplacent ;
  - l'anneau d'état, la bulle, le disque de couleur, `kneel` et `agentPositions` sont
    inchangés ou ajoutés ;
  - régler la hauteur de l'étiquette `<Html>` sur le nouveau gabarit, chapeaux compris.
- `Office.tsx` : passe déjà `color`, rien à changer.
- `styles.css` : `.agent-tag` reçoit la bordure `var(--session-color)`.
- Les ombres (`castShadow`) sont activées sur les maillages du personnage.

### Fichiers à créer ou modifier
1. `scripts/import-kaykit.mjs` : prise en charge des `.glb` avec les contrôles de sécurité.
2. `packages/web/src/scene/kit-manifest.json` : packs `adventurers` et `adventurers_anim`.
3. `packages/web/public/kaykit/adventurers*/` : fichiers produits par l'import (commités).
4. `packages/web/src/scene/kit.ts` : URL selon le format.
5. `packages/web/src/scene/characters.ts` (nouveau) : choix du personnage et du clip.
6. `packages/web/src/scene/AgentFigure.tsx` : personnage animé, disque, rotation lissée.
7. `packages/web/src/styles.css` : bordure de l'étiquette.
8. `packages/web/test/characters.test.ts` (nouveau), et `dungeon.test.ts` pour les
   règles du manifeste sur les nouveaux packs.

## Performance
- **Goulots possibles :** un mixer et 7 à 9 maillages skinnés par agent, soit quelques
  dizaines de draw calls de plus pour une vingtaine d'agents. C'est négligeable face
  aux quelque 700 draw calls actuels.
- **Optimisations :** clips chargés une seule fois et partagés, matériel partagé.

## Cas limites
- **Reroute en pleine marche :** l'animation reste `Walking`/`Running`, seule la vitesse
  de lecture suit `speed`.
- **Sous-agent qui apparaît en `done` :** pas de `Spawn_Ground`, la pose figée
  s'applique directement.
- **Changement d'état pendant le spawn :** le spawn se termine d'abord (une fois), puis
  le clip de l'état prend le relais.
- **Pack non importé (dossier absent) :** l'import échoue avec son message habituel. À
  l'exécution, `useGLTF` suspend comme pour le kit.

## Vérification
- `npm test` et `npm run typecheck`, avec de nouveaux tests sur `characterFor`,
  `clipFor` et les règles du manifeste.
- `npm run kaykit:import` doit réussir. Un `.glb` modifié à la main avec une `uri`
  externe ou une extension doit être refusé (testé sur une copie dans le scratchpad).
- Navigateur : sur le Vite déjà ouvert (port 5173), vérifier dans la scène :
  - le chevalier et le voleur encapuchonné à leurs postes ;
  - la console sans erreur de chargement ;
  - un échantillon de positions et de `mixer` pendant un vrai trajet si un agent bouge,
    sinon une capture des poses de travail, d'attente et de fin ;
  - mobile et mouvement réduit.
- Pipeline : dexter, hermione, timmy (étiquette et contraste de la bordure),
  neo (script d'import), curator (`dungeon-scene.md`), otis (README, section import des
  modèles). gatsby est sauté : pas de métadonnées ni de page.

## Complexité
**Taille :** M.

**Justification :** un nouveau format d'import sécurisé, des personnages skinnés clonés
avec des clips partagés et une logique d'animation par état, sur plusieurs fichiers.
Une calibration visuelle est nécessaire.

## Après approbation
Copier ce plan dans `plans/plan-personnages-kaykit-2026-11-14.md`. Créer la branche
`feat/agent-characters` depuis `main`.
