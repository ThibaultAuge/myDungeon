# Plan d'implémentation : un look par rôle de sous-agent

*Généré le 2026-11-14*

## Contexte

Tous les sous-agents sont des Rogue_Hooded identiques, alors on ne voit pas qui fait quoi.
Chaque type de sous-agent (dexter, hermione, Explore…) doit avoir un look qui évoque son
rôle. Le pack KayKit Adventurers ne fournit que 5 corps pour les sous-agents (Barbarian,
Mage, Ranger, Rogue, Rogue_Hooded) ; le chevalier reste réservé à l'agent principal. Le
rôle se lit donc à **corps + objet tenu en main**.

Les objets s'accrochent aux os `handslot.r` / `handslot.l` du squelette. Ils viennent :

- des accessoires du pack Adventurers, conçus pour être tenus en main ;
- des outils du pack RPG Tools, déjà importé, mais qu'il faudra caler un par un.

Les figurines au repos dans la taverne prennent aussi le look de leur type.

Décisions de l'utilisateur :

- objets du pack **et** outils ;
- type inconnu : **corps tiré au hasard de façon stable**, sans objet.

## Table proposée (modifiable avant validation)

| Type | Corps | Main droite | Main gauche | Idée |
|---|---|---|---|---|
| hermione (relecture) | Mage | grimoire ouvert | — | lit et relit |
| dexter (tests, labo) | Rogue | fiole (smokebomb) | — | expériences |
| neo (sécurité) | Barbarian | épée | bouclier à pointes | garde |
| hancock (nettoyage) | Barbarian | hache à deux mains | — | taille le code mort |
| timmy (accessibilité) | Ranger | loupe (outil) | — | inspecte |
| gatsby (SEO) | Rogue | bouclier à blason | — | visibilité, image de marque |
| oracle (recherche) | Mage | bâton | — | devin |
| curator (doc IA) | Mage | grimoire fermé | — | archiviste |
| otis (doc humaine) | Rogue_Hooded | journal ouvert (outil) | — | écrit |
| turing (calcul) | Mage | compas (outil) | — | géomètre |
| samuel-morse (API) | Ranger | arc | — | envoie des messages |
| barbapapa (gabarits) | Rogue | marteau (outil) | — | fabrique |
| butt-stallion (idées) | Barbarian | chope pleine | — | remue-méninges de taverne |
| Explore | Ranger | carte (outil) | — | explorateur |
| Plan | Rogue_Hooded | plan (blueprint, outil) | — | architecte |
| general-purpose | Rogue_Hooded | dague | — | homme à tout faire |
| claude-code-guide | Rogue_Hooded | lanterne (outil) | — | guide, éclaire le chemin |
| statusline-setup | Rogue | clé (outil) | — | réglages |

Les clés sont en minuscules, comme `STATIONS` dans `layout.ts`.

## Approche technique

### Assets
- `kit-manifest.json` reçoit un nouveau pack `adventurers_props` au format gltf (`.gltf`,
  `.bin` et textures partagées, comme les autres packs) :
  - source : `adventurers/KayKit_Adventurers_2.0_FREE/Assets/gltf` ;
  - textures : `knight_texture.png`, `barbarian_texture.png`, `mage_texture.png`,
    `ranger_texture.png`, `rogue_texture.png` ;
  - modèles : seulement ceux de la table.
- Le pack `adventurers` reçoit Barbarian, Mage, Ranger et Rogue en plus.
- Les outils viennent du pack `tools` déjà présent (`magnifying_glass`, `map`,
  `journal_open`, `drafting_compass`, `blueprint`, `hammer`, `lantern`, `wrench_A`).
- Import avec `npm run kaykit:import`, puis restaurer les fins de ligne des anciens
  `.gltf`.

### Logique pure (`characters.ts`)
- `CHARACTERS` / `characterFor(kind, id)` laissent la place à `lookFor(kind, agentType)`,
  qui renvoie `{ body, right?, left? }` :
  - agent principal : Knight, les mains vides ;
  - sous-agent : `LOOKS[type.toLowerCase()]` ;
  - sinon `SUB_BODIES[hash(type) % 5]`, sans objet.

  Le hachage se fait sur le **type**, pas sur l'id : tous les sous-agents d'un même type
  se ressemblent, y compris la figurine au repos `rest:<type>`.
- `PropRef = { pack: 'adventurers_props' | 'tools'; model }`.
- `PROP_GRIP` : position, rotation et échelle par objet. Les valeurs par défaut sont
  neutres pour les accessoires du pack. Les outils sont calés à l'œil.

### Rendu (`AgentFigure.tsx`)
- `Character` reçoit le look :
  1. il charge le corps avec `useKitGLTF` ;
  2. il clone l'objet (`scene.clone()`, qui partage géométrie et matériaux) ;
  3. il l'attache à l'os `handslotr` / `handslotl` (noms nettoyés par GLTFLoader) en
     appliquant `PROP_GRIP` ;
  4. il active `castShadow` sur l'objet.
- Le reste ne change pas : animations, `Suspense`, error boundary, retour au départ après
  un masquage par Suspense.
- `Office.tsx` passe `agent.agentType`, qui existe déjà sur `AgentView`. Les figurines au
  repos ont déjà un `agentType`.

### Fichiers
1. `packages/web/src/scene/kit-manifest.json` : pack `adventurers_props`, corps en plus.
2. `packages/web/public/kaykit/adventurers*/` : fichiers importés.
3. `packages/web/src/scene/characters.ts` : `LOOKS`, `lookFor`, `PROP_GRIP`, `SUB_BODIES`.
4. `packages/web/src/scene/AgentFigure.tsx` : corps selon le look, objets accrochés aux mains.
5. `packages/web/test/characters.test.ts` et `dungeon.test.ts` :
   - chaque entrée de `LOOKS` pointe vers un corps et des modèles présents dans le manifeste ;
   - le repli est stable et reste dans `SUB_BODIES` ;
   - le type est insensible à la casse ;
   - le nouveau pack est validé par les tests du manifeste.

## Cas limites
- **Type inconnu :** corps stable, mains vides.
- **Type vide ou absent :** repli sur le corps `SUB_BODIES[0]`.
- **Os de main introuvable :** l'objet n'est pas affiché, avec un avertissement en
  développement, et le corps s'affiche quand même.
- **Objet qui ne charge pas :** l'error boundary existante bascule toute la figurine sur
  la capsule de secours. Je garde ce comportement, c'est le plus simple.

## Performance
Un objet compte 1 à 3 maillages par figurine, avec la géométrie partagée : négligeable.
Le préchargement couvre automatiquement les nouveaux modèles du manifeste.

## Vérification
- `npm test` et `npm run typecheck`.
- `npm run kaykit:import` réussit.
- Playwright : une figurine de test par type, posée en ligne dans la taverne. Je la monte
  en local, en passant par le store ou par de faux hooks, comme le décrit
  `docs/ai/agent-lifecycle.md`. Je fais une capture rapprochée par groupe pour caler les
  outils (`PROP_GRIP`), puis une capture finale de la galerie.
- Pipeline :
  - dexter, hermione, neo (le nouveau pack passe par l'import), curator (`dungeon-scene.md`,
    `agent-lifecycle.md`) et otis (README, `docs/lieux-et-personnages.md`) ;
  - timmy n'est utile que si le DOM change, ce qui n'est pas prévu ;
  - gatsby est sauté.

## Complexité
**Taille :** M.

**Justification :** la logique est simple et testable. L'essentiel du travail est le calage
visuel des outils, qui n'ont pas été conçus pour être tenus, et la mise en place d'une
galerie de test.

## Après approbation
Copier ce plan dans `plans/plan-skins-sous-agents-2026-11-14.md`. Créer la branche
`feat/subagent-looks` depuis `main`.
