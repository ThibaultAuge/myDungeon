# Plan d'implémentation — Nom et couleur du donjon dans la 3D

*Généré le 2026-11-15*

## Objectif

Aujourd'hui, tous les donjons se ressemblent dans la scène 3D. Seules les sessions qui s'y
promènent changent. On peut donc croire surveiller « Maison » alors qu'on est dans
« Mediaset ». L'idée est de rendre le donjon reconnaissable dans la scène elle-même :
- un **panneau en bois** au bout du pont-levis, avec le nom peint dessus ;
- une **couleur propre au donjon**, portée par des oriflammes à l'extérieur du château.

## Exigences

### Fonctionnelles
- Un panneau en bois planté à côté du chemin, juste au bout du pont-levis, face à la caméra
  par défaut. Le nom du donjon est peint sur la planche.
- Le nom affiché est celui que donne `envName(env, t)` (`packages/web/src/format.ts`). Le
  donjon virtuel « hors environnement » passe donc par sa traduction. Si l'environnement est
  inconnu (`env` introuvable), pas de panneau.
- Deux oriflammes, une de chaque côté de l'arrivée du pont-levis : un mât et une étoffe à la
  couleur du donjon. Le panneau porte aussi un petit fanion de cette couleur.
- La couleur est calculée à partir de l'**identifiant** du donjon (choix de l'utilisateur :
  elle ne change pas si on le renomme). Elle est tirée d'une palette fixe de 10 teintes bien
  distinctes la nuit. Le donjon virtuel est en gris neutre, pour qu'on le reconnaisse comme
  « pas un vrai donjon ».
- L'intérieur ne change pas : les bannières gardent la couleur propre à chaque salle (choix
  de l'utilisateur).

### Non fonctionnelles
- **Performance :** quelques boîtes et plans de plus, une texture canvas, **aucune nouvelle
  lumière**. La lisibilité de nuit vient d'un `emissiveMap` faible, pas d'une `pointLight`.
- **Sécurité :** le nom vient du serveur (presets de l'app). Il est dessiné sur un canvas
  avec `fillText`, jamais interprété comme du HTML.
- **UX / accessibilité :** le nom est déjà annoncé par le `h1` sr-only de `EnvPage`. Le
  panneau est décoratif et ne réagit pas au pointeur. Pas d'animation : les oriflammes sont
  statiques, ce qui règle aussi le mouvement réduit.

### Hors périmètre
- Couleur du donjon sur les bannières intérieures, les torches ou la lumière ambiante.
- Couleur choisie par l'utilisateur (les presets ne sont pas à nous).
- Variation de la déco intérieure selon le donjon.

## Approche technique

### Architecture
1. **`packages/web/src/scene/heraldry.ts`** (nouveau, pur, sans three.js) :
   - `DUNGEON_PALETTE` : 10 couleurs hexadécimales. `VIRTUAL_COLOR` : gris.
   - `dungeonColor(envId, virtual)` : hash FNV-1a de l'id, puis modulo la palette. Renvoie
     `VIRTUAL_COLOR` si `virtual`.
   - `fitLabel(text, maxWidth, measure)` : choisit la taille de police (de la plus grande à
     la plus petite) pour que le texte tienne sur la planche. Sous la taille minimale, coupe
     le texte avec « … ». La fonction `measure(text, size)` est injectée, ce qui la rend
     testable sans canvas.
   - Positions `SIGN` et `PENNANTS`, calculées depuis `BRIDGE` et `PATH_HALF_WIDTH`
     (`forest.ts`). Le panneau se trouve à environ 2 m à l'est du chemin, juste après
     `BRIDGE.z1`, et regarde vers +z. Les oriflammes encadrent `BRIDGE.z1` à environ 0,4 m de
     chaque bord.
2. **`forest.ts`** : `treeAllowed` (et donc `scatterUndergrowth`) exclut aussi un petit
   dégagement autour de `SIGN` et des `PENNANTS`, pour qu'aucun arbre ni buisson ne les
   traverse.
3. **`packages/web/src/scene/DungeonSign.tsx`** (nouveau) :
   - Deux poteaux et une planche, plus un fanion, en primitives box et plane.
   - La texture de la planche est un `CanvasTexture` : un fond de bois peint, et le nom en
     serif clair dimensionné avec `fitLabel`.
   - La texture est recréée quand le nom change et libérée (`dispose`) au démontage, comme
     pour `useGeometry`.
   - Le matériau de la planche est un `MeshStandardMaterial` dont `map` et `emissiveMap`
     utilisent ce canvas, avec une intensité émissive faible : on lit le nom la nuit sans
     ajouter de lumière.
   - `Pennants` : un mât et une étoffe pour chaque oriflamme, avec un émissif faible de la
     couleur du donjon.
   - Ces objets sont près du château, donc ils ne passent pas par `nightify`, comme le
     château lui-même.
   - `raycast` est neutralisé pour que le curseur et le cutaway les ignorent.
4. **Câblage** :
   - `EnvPage` (`App.tsx`) passe `name` et `color` à `<OfficeScene />`. La couleur est
     calculée avec `dungeonColor(env.id, env.virtual)`.
   - `OfficeScene` (`Office.tsx`) monte `<DungeonSign name color />` à côté de `<Forest />`.
     Rien n'est monté si `env` est introuvable.

### Fichiers à créer ou modifier
1. `packages/web/src/scene/heraldry.ts` — palette, hash, ajustement du texte, positions.
2. `packages/web/src/scene/DungeonSign.tsx` — rendu du panneau et des oriflammes.
3. `packages/web/src/scene/forest.ts` — exclusions de `treeAllowed`.
4. `packages/web/src/scene/Office.tsx` — props `name` et `color`, montage du panneau.
5. `packages/web/src/App.tsx` — calcul et transmission depuis `EnvPage`.
6. `packages/web/test/heraldry.test.ts` (nouveau) et `forest.test.ts` (dégagement).
7. `packages/web/public/images/castle-gate.jpg` — à recapturer, car les abords de la porte
   changent. La recapture suit `docs/ai/ui-theme.md`, **panneau masqué** par le hook
   temporaire, pour que l'accueil n'affiche le nom d'aucun projet. Les oriflammes peuvent
   rester visibles.

## Découpage du travail

Single lot — main session.

## Performance
- Pour l'affichage, environ 6 à 8 maillages et une texture canvas de 1024×256 en plus, sans
  nouvelle lumière ni ombre.
- La texture n'est redessinée que si le nom change.

## Cas limites
- **Nom très long :** on réduit la police, puis on coupe avec « … ».
- **Nom vide :** cela n'arrive pas pour un preset. Par prudence, on n'affiche pas le
  panneau.
- **Changement de donjon sans rechargement :** `EnvPage` se met à jour, la texture est
  recréée et l'ancienne libérée.
- **Les agents qui arrivent par le chemin et l'embuscade des squelettes :** le panneau et
  les oriflammes restent hors de la bande du chemin (`PATH_HALF_WIDTH`). Il faut relancer
  `outside.test.ts`.
- **Collisions de couleur :** au-delà de 10 donjons, deux donjons peuvent tomber sur la même
  couleur. C'est accepté, puisque le panneau porte le nom.

## Branche
On travaille sur la branche de ce worktree (`claude/dungeon-visual-differentiation-f23827`),
après y avoir fusionné `main` à jour (`git pull` sur main, puis merge).

## Vérification
- `npm test` (heraldry, forest, outside) et `npm run typecheck`.
- Aperçu de la scène (procédure dans `docs/ai/dungeon-scene.md`), sur deux donjons
  différents :
  - le panneau est lisible depuis la caméra par défaut ;
  - les couleurs sont différentes d'un donjon à l'autre ;
  - le donjon « hors environnement » est en gris, avec son nom traduit (FR/DE/EN) ;
  - aucun arbre ne traverse le panneau ;
  - pas d'erreur dans la console.
- Captures d'écran pour preuve, puis recapture de `castle-gate.jpg`.
- Mises à jour de la documentation : `docs/ai/night-forest.md` par curator, et la doc
  utilisateur (`docs/lieux.md` ou `utilisation.md`) par otis.

## Estimation

**Taille :** S

**Justification :** deux nouveaux fichiers et trois retouches, sans backend ni nouvel asset ;
le gros du travail est le réglage visuel et la recapture.
