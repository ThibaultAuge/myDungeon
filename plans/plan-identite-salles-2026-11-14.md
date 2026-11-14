# Plan d'implémentation : identité visuelle des salles

*Généré le 2026-11-14* · copié dans `plans/plan-identite-salles-2026-11-14.md` au démarrage

## Contexte

Les 15 salles se ressemblent : même mur aléatoire, mêmes bannières, beaucoup de meubles faits
de boîtes colorées (étagères, cage, chaudière, cheminée, canapé…). Chaque salle doit se
reconnaître d'un coup d'œil, par ses objets, ses murs et sa lumière.

Décisions de l'utilisateur :
- ton **médiéval avec quelques clins d'œil modernes** (guitare, console portable, chaise gamer…) ;
- **les 15 salles en une seule branche / PR** ;
- Claude télécharge les packs depuis GitHub ;
- **instanciation des props dans la même PR**, en fin de chantier, avec une mesure avant/après.

Licences : tout est en CC0 (Kay Lousberg). Le `License.txt` de chaque pack est copié avec ses
fichiers, comme aujourd'hui. Seuls les paliers gratuits sont utilisés. Les objets visibles sur
les images d'aperçu mais absents du zip gratuit (arcade, servante, lampes à lave, bonsaïs…)
sont EXTRA, donc exclus.

## Étape 0 : récupérer les packs

À l'approbation de ce plan, Claude télécharge depuis GitHub (organisation
`KayKit-Game-Assets`, branche `main`, licence CC0 vérifiée dans `README.md` / `LICENSE.txt`)
les archives des dépôts suivants. Les tailles sont celles des dépôts complets :
- `KayKit-Furniture-Bits-1.0` (~3,5 Mo)
- `KayKit-Halloween-Bits-1.0` (~5,4 Mo)
- `KayKit-Restaurant-Bits-1.0` (~9,8 Mo)

Les archives vont chacune dans un dossier neuf de `F:\claudeworkshop\assets-src\` (gitignoré).
Rien n'y est exécuté. Seuls `Assets/gltf/*.gltf|.bin`, la texture et `LICENSE.txt` passent par
`npm run kaykit:import`, qui garde ses contrôles.

**Board Game Bits** n'est pas sur GitHub. S'il est souhaité (dés, cartes, pions), l'utilisateur
dépose le zip gratuit d'itch.io dans `assets-src`. Sinon, la salle de détente garde les dés
générés.

Nouveaux packs du manifeste (`.gltf` + texture, sauf Skeletons en `.glb`) : `furniture`,
`halloween`, `restaurant`, `resources` (Resource Bits), `nature` (Forest), `mixed1`, `mixed2`,
`skeletons`. Chaque pack ne liste que les modèles utilisés.

## Leviers communs

1. **Murs par salle.** `RoomDef.walls?: [model, weight][]` remplace, pour cette salle, le tirage
   global `WALL_VARIANTS` dans `dungeon.ts` (`wallLayout`), qui reste le défaut. Par exemple
   `wall_shelves` pour la bibliothèque, `wall_archedwindow_open` pour l'observatoire,
   `wall_scaffold` pour l'atelier, `wall_cracked` pour le concierge.
2. **Décor mural par salle.** `RoomDef.wallDecor?` choisit entre torche, bannière et
   `banner_shield` / `banner_thin` / `banner_triple`. Les objets accrochés (cadres, toiles
   d'araignée, chaînes, `keyring_hanging`) passent par la règle `wallIsFree` existante, avec
   la même ancre de cutaway que les torches.
3. **Lumière d'ambiance.** Une `pointLight` sans ombre par salle (`RoomDef.light: { color,
   intensity }`), placée au-dessus de la salle, avec une portée limitée. Si le coût mesuré est
   trop élevé, on la remplace par une tache lumineuse additive au sol, sans vraie lumière.
4. **Décor posé.** Les nouveaux `PropKind` de décoration, sans poste, suivent les règles
   existantes : ils ne couvrent ni sièges ni entrée (testé).

## Salle par salle

Les meubles fonctionnels gardent leur `post` et leurs sièges. Seuls leurs modèles changent.

| Salle | Ambiance / lumière | Changements |
|---|---|---|
| Observatoire | nuit, bleu froid | fenêtres en arc ; table d'étoiles avec `map_rolled`, `drafting_compass` ; télescope généré mais affiné (laiton) |
| Pigeonnier | grenier, blanc chaud | herbes et petits rochers Forest sur la terre ; sacs `Textiles` ; volière rhabillée de bois KayKit et de `chicken_plushie` en clin d'œil |
| Cartes | jaune papier | `map_rolled`, `blueprint_stacked`, `trunk_*`, `banner_shield` ; globe conservé |
| Bibliothèque | vert, chandelles | étagères généré → `shelf_B_large_decorated`, `shelf_A_big` (Furniture) + `wall_shelves` ; `book_set` sur les tables ; `book_mimic` caché |
| Scriptorium | chandelles | `candle_melted`, `pencil_*`, `journal_closed` sur les pupitres ; tapis `rug_rectangle_A` (Furniture) |
| Atelier | brun, bois | `anvil`, `grindstone`, `Wood_Planks_Stack_*`, `Wood_Log_Stack`, `Pallet_Wood` ; murs `wall_scaffold` |
| Autel | rouge sombre | `shrine_candles` / `plaque_candles` (Halloween) autour de l'autel ; `pillar_decorated` ; `banner_triple` |
| Machines | orange, grille | chaudière → `woodstove` ; `Parts_Cog`, `Parts_Pile_*`, `Fuel_*_Barrels`, `chain_hanging_*` ; `Iron_Bars_Stack` |
| Arithmétique | or | `Gold_Bars_Stack_*`, `Silver_Bars_Stack_*`, `coin_stack_*` ; boulier et ardoise générés conservés |
| Détente | rouge, salon | canapé généré → `couch_pillows` + `armchair` (Furniture) ; `rug_oval_A` ; `guitar_A`, `puzzlecube`, `handheld_console`, `gamer_chair_A` (clins d'œil) ; dés Board Game si fournis |
| Concierge | terne | `cobweb_*` ; `bucket_metal` ; `Textiles_Stack_Small` ; murs `wall_cracked` ; balais générés conservés |
| Garde | bleu acier | `sword_shield`, `chain_shackle`, `beartrap_A`, `keyring_hanging` ; boucliers `Skeleton_Shield_*` au mur |
| Épreuves | vert labo | labo : `pot_large` / `stew_pot` (Restaurant) en chaudron, `jar_*`, fioles ; relecture : `ouija_board` en clin d'œil ; un squelette `Skeleton_Minion` en pose figée comme mannequin d'essai |
| Héraut | jaune | `frame_A/B/C` (tableau d'annonces), `ornate_mirror`, `banner_shield` |
| Taverne | feu orange | cheminée générée → pierre KayKit + `Wood_Log_Stack` ; `keg` / `keg_decorated` (Dungeon) ; `food_stew`, `food_dinner`, `crate_*` (Restaurant) ; vestiaires conservés |

Le squelette mannequin utilise `Rig_Medium_General` (même squelette que les Adventurers) avec une
pose figée. Il n'a ni poste, ni cible, ni gestionnaire de clic.

## Instanciation (fin de chantier)

- Mesure avant / après : `renderer.info.render.calls` et la fréquence d'images, en Playwright,
  vue d'ensemble.
- **Décor sans poste** (caisses, tonneaux, lingots, herbes, toiles…) : regroupé par modèle sur
  toute la carte et rendu par `<KitInstances>` (déjà utilisé pour murs et sols). La géométrie
  vient d'une fonction pure `decorPlacement(rooms): Placement` dans `dungeon.ts`, testée.
- **Formes générées** (`Box`, cylindres) : regroupées par géométrie + couleur via drei
  `<Instances>`, d'abord pour le décor.
- **Postes** : leurs meubles restent des `<Kit>` séparés, car le surlignage (`setHighlight`)
  échange les matériaux par mesh.
- Les petites pièces gardent la règle « pas d'ombre sous 0,3 m ».

## Fichiers touchés

- `packages/web/src/scene/kit-manifest.json` : nouveaux packs et modèles.
- `scripts/import-kaykit.mjs` : seulement si un pack a une arborescence nouvelle (dépôts
  GitHub : `addons/kaykit_*/Assets/gltf`). Les contrôles restent identiques.
- `packages/web/src/scene/layout.ts` : `walls`, `wallDecor`, `light`, nouveaux décors.
- `packages/web/src/scene/dungeon.ts` : variantes de murs par salle, décor mural,
  `decorPlacement`.
- `packages/web/src/scene/props.tsx` : nouveaux `PropKind` et meubles rhabillés.
- `packages/web/src/scene/Structure.tsx`, `Room.tsx`, `Office.tsx` : décor instancié et lumières.
- Tests : `dungeon.test.ts`, `layout.test.ts`, test du manifeste (chaque modèle cité existe).
- Aucun nouveau texte affiché : pas de clé i18n (aucun titre de salle, décor non cliquable).

## Performance

- Goulot attendu : le nombre d'appels de rendu (~700 aujourd'hui) et 15 lumières ponctuelles
  calculées par fragment.
- Cible : ne pas dépasser l'état actuel une fois l'instanciation faite, idéalement descendre
  nettement en dessous.
- Le poids des nouveaux modèles est surveillé : on n'importe que les modèles utilisés.

## Cas limites

- Un modèle trop grand ou mal orienté : calage `scale` / `rot` dans `PROPS`, vérifié à l'œil.
- Un nœud de modèle portant le nom d'un os du squelette (règle existante) : vérifié pour le
  mannequin squelette et tout objet tenu.
- Les matériaux partagés par pack ne sont jamais modifiés. Les postes rhabillés doivent
  toujours briller au survol (vérifié en Playwright).
- `core.autocrlf` : restaurer les `.gltf` existants réécrits par l'import.

## Vérification

- `npm run typecheck`, `npm test`.
- Playwright sur Vite (port 5174, worktree) : capture de chaque salle avant / après, survol
  d'un poste rhabillé par salle, comptage des appels de rendu avant / après.
- Pipeline : dexter, hermione, timmy si le panneau change (normalement non), neo (nouveaux
  fichiers externes et import), hancock (formes remplacées), curator (`docs/ai/dungeon-scene.md`),
  otis (crédits du README).

## Complexité

**Taille : L.** Elle touche 15 salles, 8 nouveaux packs, la logique des murs et l'instanciation,
avec beaucoup de calage visuel.
