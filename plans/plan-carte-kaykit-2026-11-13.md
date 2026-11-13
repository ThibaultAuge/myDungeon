# Plan d'implémentation : carte du donjon en assets KayKit

*Rédigé le 2026-11-13. Après approbation, ce plan est copié dans `plans/plan-carte-kaykit-2026-11-13.md`.*

## Objectif

La carte 3D est aujourd'hui faite de cubes, de cylindres et de sphères colorés (`packages/web/src/scene/Room.tsx`). On la refait avec les packs CC0 de Kay Lousberg pour qu'elle « ait de la gueule » : sols en dalles, murs en pierre avec arches et fenêtres, vrais meubles, objets de décoration, ombres douces. On garde l'esprit « jouet » coloré et joyeux décrit dans `docs/lieux-et-personnages.md`.

## Décisions prises

- **Assets** : KayKit, version gratuite. Packs utilisés : Dungeon Pack 1.1, RPG Tools Bits 1.0 et Fantasy Weapons Bits 1.0. Les zips sont déjà dans `assets-src/`.
- **Murs** : coupe dynamique. Les murs sont pleine hauteur. Ceux qui font face à la caméra s'abaissent tout seuls quand on tourne la vue, et il reste alors un muret bas.
- **Lumière** : jour clair, avec des ombres portées douces.
- **Identité des salles** : sols en matières naturelles (pierre, bois, terre). La couleur propre à chaque salle passe par ses bannières et ses tapis.

## Ce que les mesures ont montré

Les mesures viennent des fichiers glTF eux-mêmes.

- Le pack est dessiné environ 1,33 fois plus grand que notre scène. Un agent mesure 1,64 m. Une table KayKit fait 1 m de haut, contre 0,78 m chez nous. On applique donc une **échelle uniforme S = 0,75** à tous les modèles.
- Dimensions après cette mise à l'échelle :

  | Pièce | Dimensions après ×0,75 |
  |---|---|
  | Petite dalle | 1,5 m de côté |
  | Mur | 3 m de long, 3 m de haut, 0,75 m d'épaisseur |
  | Muret `barrier` | 0,83 m de haut |
  | Table | 0,75 m de haut |
  | Chaise | 0,92 m de haut |

- Toutes les pièces d'un même pack partagent **un seul matériau** et une seule petite texture : un atlas de dégradés de 16 Ko. C'est ce qui permet d'afficher des centaines de pièces sans ralentir.

## Exigences

### Fonctionnelles

- **Sols** : dalles KayKit dans chaque salle et dans les couloirs, avec une matière choisie par salle.
- **Murs** : pièces KayKit qui gardent **la même emprise au sol qu'aujourd'hui** (0,25 m d'épaisseur, retrait de 0,15 m). L'ouverture de porte reste la même.
  - On les varie : fenêtres, arches, étagères murales, murs fissurés.
  - Des piliers aux angles cachent les jointures.
- **Coupe dynamique** : pour chaque orientation de mur (N, S, E, O), on calcule si elle fait face à la caméra.
  - Les murs qui font face s'enfoncent en environ 0,3 s.
  - Les murets bas `barrier`, placés en permanence dans l'épaisseur du mur, restent alors visibles.
  - Avec `reducedMotion`, la bascule est instantanée.
- **Meubles et objets** : chaque `PropKind` existant est reconstruit à partir de pièces KayKit quand le pack en a. Sinon, il garde une forme simple, recolorée dans la palette KayKit. Le tableau des correspondances est plus bas.
- **Décoration** :
  - torches murales et bannières sur les murs hauts, aux couleurs de la salle ;
  - quelques objets posés : tonneaux, caisses, bougies, pièces d'or.
- **Ombres** : la lumière directionnelle projette des ombres. Les meubles, les murs et les agents en projettent et en reçoivent.

### Non fonctionnelles

- **Performance** : on vise 60 images/s sur un portable.
  - Les dalles et les murs (plusieurs centaines) passent par de l'*instancing* : la carte graphique dessine N copies d'un même modèle en un seul appel.
  - Objectif : moins de 150 appels de dessin (`renderer.info.render.calls`).
- **Comportement inchangé** : `layout.ts` (salles, sièges, couloirs, chemins) ne bouge pas, sauf l'ajout de deux champs de décor par salle. Tous les tests existants doivent continuer à passer.
  - En particulier, aucun siège ne doit se retrouver dans l'emprise d'un meuble (`layout.test.ts:766`).
  - Chaque meuble reconstruit tient dans son emprise actuelle (`FOOTPRINTS`).
- **Licence** : CC0, aucune attribution obligatoire. On crédite quand même Kay Lousberg dans le README et dans `public/kaykit/LICENSE.txt`.

### Hors périmètre

- Les personnages : les agents restent des capsules, leur refonte est la phase suivante.
- Les plafonds et les escaliers.
- Le packs payants « Extra ».
- La modification du plan des salles.

## Approche technique

### 1. Import des assets (reproductible)

- `assets-src/` est ajouté au `.gitignore`. Les zips restent hors du dépôt.
- On crée le script `scripts/import-kaykit.mjs` :
  - il lit une liste explicite de modèles ;
  - il copie depuis `assets-src/<pack>/…/Assets/gltf/` les fichiers `.gltf` + `.bin`, plus la texture de chaque pack, vers `packages/web/public/kaykit/{dungeon,tools,weapons}/` ;
  - il copie aussi la licence.
- Taille : environ 2 à 3 Mo commités (environ 60 modèles sur 290).
- Le script ne fait que lire et copier des fichiers. Il n'exécute rien qui provienne des zips.

### 2. Chargement et instancing (nouveau `scene/kit.ts` + `scene/KitInstances.tsx`)

- `useKit(pack, name)` charge un modèle avec `useGLTF` de drei, sous `<Suspense>`.
  - Il aplatit la scène du modèle en une liste de pièces : géométrie, matériau partagé, matrice locale.
  - Il active `castShadow` et `receiveShadow`.
- `<KitInstances pack name transforms={[…]}>` crée un `InstancedMesh` par pièce de modèle.
  - Ses entrées sont la position, la rotation Y et l'échelle non uniforme. L'échelle non uniforme sert à étirer une dalle ou un mur pour combler exactement une longueur.
- `<Kit pack name pos rot scale>` place un objet seul, en partageant la géométrie (`<Clone>` de drei). Il sert pour les meubles, qui sont peu nombreux.
- Les modèles sont préchargés avec `useGLTF.preload` pour éviter un « pop » à l'écran.

### 3. Sols (`scene/Floors.tsx`)

- Dans `RoomDef`, le champ `floor: string` (une couleur) est remplacé par :
  - `floorKind: 'stone' | 'wood' | 'woodDark' | 'dirt' | 'grate'` ;
  - `accent: 'red' | 'blue' | 'green' | 'yellow' | 'white' | 'brown'`, qui donne la couleur des bannières et des tapis.
  - `Room.tsx` est le seul endroit qui lit `floor`.
- Chaque salle est pavée de petites dalles (1,5 m). Le nombre de dalles est `round(w / 1,5)` × `round(d / 1,5)`. On étire légèrement les dalles (±12 % au maximum) pour couvrir exactement la salle.
  - Quelques variantes sont tirées au hasard de façon déterministe, avec la graine = id de la salle : `_broken`, `_weeds`, `_decorated`.
- Les couloirs sont pavés de grandes dalles de pierre sur une grille de 3 m couvrant `BOUNDS`. Les cases dont le centre tombe dans une salle sont sautées.
  - Les sols des salles sont surélevés de 0,02 m pour couvrir les raccords sans scintillement.
- Bordure extérieure : pièces `floor_foundation_*` tout autour de `BOUNDS`. Le donjon ressemble ainsi à une maquette posée sur un socle.
- Matières proposées :

  | Matière | Salles |
  |---|---|
  | Bois | Salle des cartes, Taverne, Détente, Héraut |
  | Bois foncé | Bibliothèque, Observatoire |
  | Pierre | Autel, Garde, Épreuves, Arithmétique |
  | Grilles + pierre | Machines |
  | Terre | Pigeonnier, Concierge |
  | Pierre décorée | Atelier |

### 4. Murs et coupe dynamique (`scene/Walls.tsx`)

- La logique de `WallRun` et `RoomWalls` est reprise : mêmes segments, même trou de porte.
- Chaque segment est découpé en tronçons d'environ 3 m.
  - Chaque tronçon est une pièce `wall`, ou une variante tirée de façon déterministe (`wall_window_open`, `wall_arched`, `wall_shelves`, `wall_cracked`).
  - L'échelle est (longueur/4, 0,75, 0,25), pour garder l'épaisseur de 0,25 m.
- On ajoute `wall_endcap` de chaque côté d'une porte et un `pillar` réduit à chaque angle.
- Sous chaque segment, on place un muret `barrier` mis à l'échelle (0,83 m de haut, 0,25 m d'épaisseur). Il est invisible tant que le mur haut est levé.
- Les murs hauts sont regroupés en **4 groupes d'orientation**, selon la normale extérieure du mur par rapport à sa salle.
  - Le composant `useCutaway()` lit à chaque image la direction horizontale caméra → cible.
  - Un groupe est abaissé quand `dot(normale, dirCaméra) > 0,25`. Son échelle Y est alors amortie vers 0, et on le cache sous 0,02.
  - Les torches et les bannières sont enfants du groupe de leur mur : elles descendent avec lui.

### 5. Meubles : correspondances (`scene/props.tsx`, qui remplace la table `PROPS` de `Room.tsx`)

| PropKind | Nouveau rendu |
|---|---|
| `altar` | Bloc de pierre (forme maison) + `table_medium_tablecloth` + `candle_triple` + bannière à la couleur de la salle |
| `pew` | Forme maison en bois, recolorée |
| `candles` | `candle_triple` sur `column` réduite |
| `mapTable` | `table_long` + `map` (outils) + `drafting_compass` |
| `globe` | Forme maison, sur pied en bois |
| `bench` | `table_medium` + `hammer`, `saw`, `wrench_A`, `handplane` |
| `toolRack` | `shelf_large` × 2 + outils posés (`pickaxe`, `shovel`, `axe`) |
| `easel` | Forme maison + `blueprint` |
| `bookcase` | `shelves` sur un caisson en bois + `journal_closed` alignés |
| `readingTable` | `table_small` / `table_medium` + `journal_open` + `candle_lit` |
| `lectern` | Forme maison + `journal_open` |
| `telescope` | Forme maison en laiton + `magnifying_glass` |
| `starTable` | `table_medium_tablecloth` + `map_empty` + `compass_base` |
| `aviary` | Forme maison (cage en laiton) |
| `boiler`, `engine` | Forme maison + `barrel_large`, `bucket_metal` |
| `abacus`, `slate` | Forme maison |
| `portcullis` | `wall_gated` mis à l'échelle de l'emprise |
| `weaponRack` | Barre en bois (forme maison) + `sword_A`, `axe_A`, `spear_A`, `shield_A`, `halberd` |
| `lantern` | `column` + `lantern` (outils) |
| `guardTable` | `table_small` + `keyring` + `coin_stack_small` |
| `alchemyBench` | `table_long_decorated_A` + `bottle_*` + `candle_lit` (les lumières qui clignotent sont gardées) |
| `stage` | Estrade en `floor_wood_small` + `banner_triple_<accent>` |
| `inspectionDesk` | `table_small` + `magnifying_glass` |
| `couch` | Forme maison recolorée |
| `diceTable` | `table_small` + `stool` × 2 |
| `posters` | `banner_patternA/B/C_<accent>` |
| `brooms` | Forme maison + `bucket_metal` |
| `cart` | Forme maison + `box_small` |
| `longTable` | `table_long` + `plate_food_A/B` + `keg` |
| `fireplace` | Forme maison en pierre (lumière qui clignote gardée) |
| `barrel` | `barrel_small` |
| `lockers` | `trunk_large_A/B/C` empilés |
| `rug` | Plan coloré `<accent>` avec une bordure |

- Les formes maison gardent les composants `Box`, `Cyl`, `Ball` et `Blink` de `Room.tsx`.
  - Elles passent en `meshStandardMaterial` (rugosité 1), comme les modèles KayKit.
  - Leurs couleurs sont recalées sur l'atlas KayKit : brun bois, gris pierre, laiton.
- Chaque meuble reconstruit est ajusté pour tenir dans l'emprise `FOOTPRINTS` existante.

### 6. Décoration supplémentaire

Un nouveau champ facultatif `decor: Prop[]` est ajouté à `RoomDef`. Il est rendu mais ignoré par la logique des sièges.

- **Décor mural** : torches et bannières. Il n'a pas d'emprise au sol et suit son mur pour la coupe dynamique.
- **Décor posé** : caisses, tonneaux, pièces d'or. Il est placé dans les angles, avec une emprise.
  - Un test vérifie qu'aucun siège ni chemin d'entrée ne le traverse.

### 7. Lumière (`Office.tsx`)

- `<Canvas shadows>`.
- Une `directionalLight` qui projette des ombres :
  - carte d'ombre de 2048 px ;
  - caméra d'ombre orthographique couvrant `BOUNDS` ;
  - léger `bias` pour éviter les rayures.
- `hemisphereLight` est conservée.
- `<SoftShadows>` de drei pour les bords doux. Si cela coûte trop cher, on revient aux ombres PCF douces natives.
- Contrôle visuel du *tone mapping* : c'est l'étape qui convertit les couleurs calculées en couleurs affichables. Si les couleurs KayKit paraissent ternes avec le réglage par défaut (ACES), on passe à `NeutralToneMapping`.
- Les agents (`AgentFigure.tsx`) reçoivent `castShadow`.

### Fichiers

1. `.gitignore` : ajouter `assets-src/`.
2. `scripts/import-kaykit.mjs` : copie de la sélection de modèles et des licences (nouveau).
3. `packages/web/public/kaykit/**` : modèles, textures et licence (nouveaux, commités).
4. `packages/web/src/scene/kit.ts` et `KitInstances.tsx` : chargement et instancing (nouveaux).
5. `packages/web/src/scene/Floors.tsx`, `Walls.tsx`, `props.tsx` : rendu de la carte (nouveaux).
6. `packages/web/src/scene/Room.tsx` : réduit à l'assemblage (sols, murs, meubles, panneaux des salles).
7. `packages/web/src/scene/layout.ts` : `floor` devient `floorKind` + `accent`, et on ajoute `decor`.
8. `packages/web/src/scene/Office.tsx` : ombres et lumière.
9. `packages/web/src/scene/AgentFigure.tsx` : `castShadow`.
10. `packages/web/test/` : tests du découpage en dalles et en tronçons, de la coupe dynamique (fonction pure), du décor qui ne bloque aucun siège, et de l'existence de chaque fichier du manifeste.
11. `README.md` : crédits KayKit et commande d'import des assets.

## Performance

- **Points sensibles** : le nombre d'appels de dessin (géré par l'instancing) et la carte d'ombre (une seule lumière qui projette des ombres).
- **Optimisations** :
  - un matériau par pack ;
  - l'instancing pour les sols et les murs ;
  - le préchargement des modèles ;
  - `dpr` reste plafonné à 2.

## Cas limites

- **Modèle introuvable** : un `ErrorBoundary` autour de la carte affiche les formes simples actuelles plutôt qu'un écran vide. Le test du manifeste attrape ce cas avant l'exécution.
- **Caméra presque à la verticale** : aucun groupe n'est abaissé tant que l'angle polaire est faible. On ne voit alors que le haut des murs, ce qui est lisible.
- **Scriptorium (zone dans la Bibliothèque)** : pas de murs, un tapis seulement, comme aujourd'hui.
- **Porte proche d'un angle** : les tronçons de moins de 0,4 m sont remplacés par un `wall_endcap`.

## Vérification

1. Lancer `npm test` : tous les tests passent, anciens et nouveaux.
2. Lancer `preview_start agent-office`, puis contrôler :
   - la console : aucune erreur 404 ni erreur de chargement glTF ;
   - `renderer.info.render.calls` < 150 (lu avec `javascript_tool`) ;
   - des captures d'écran sous 4 angles de caméra : coupe dynamique, ombres, aucun agent qui passe à travers un mur ou un meuble ;
   - une capture avec un agent qui marche d'une salle à l'autre.
3. Lancer `npm run build` : le build passe et le dossier `kaykit/` est bien copié dans `dist`.

## Pipeline qualité prévu

| Étape | Agent | Rôle |
|---|---|---|
| Tests | dexter | Écrit les tests ; j'exécute la suite |
| Revue | hermione | Revue du code |
| Sécurité | neo | Le script d'import lit des fichiers téléchargés, et de nouveaux assets statiques sont ajoutés |
| Nettoyage | hancock | Anciennes formes et anciennes constantes de `Room.tsx` |
| Doc | otis | README |
| Contexte IA | curator | Uniquement si `docs/ai` ou `CLAUDE.md` évoluent |

gatsby et timmy ne sont pas concernés : on ne change que du rendu WebGL, pas de HTML.

## Complexité

**Taille : L.** Le changement est transversal à toute la scène, avec une nouvelle chaîne de chargement d'assets, l'instancing, la coupe dynamique, environ 35 meubles à reconstruire et des réglages visuels itératifs.
