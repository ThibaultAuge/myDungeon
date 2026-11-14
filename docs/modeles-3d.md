# Modèles 3D

La carte utilise des packs gratuits de Kay Lousberg (www.kaylousberg.com). Ce document liste les packs, explique la licence, et décrit comment ajouter un modèle.

## Packs utilisés

| Pack | Dossier sous `assets-src/` | Contenu utilisé |
|---|---|---|
| Dungeon Pack 1.1 | `dungeon/` | Sols, murs, arches, meubles, torches, bannières |
| RPG Tools Bits 1.0 | `rpg-tools/` | Outils et objets (carte, lanterne, marteau…) |
| Fantasy Weapons Bits 1.0 | `weapons/` | Armes et boucliers |
| Forest Nature Pack 1.0 | `forest/` | Arbres, buissons et rochers de la forêt de nuit ; touffes d'herbe et rocher du décor des pièces |
| Furniture Bits 1.0 | `gh-furniture/repo/` | Canapé, tapis, livres, cadres |
| Halloween Bits 1.0 | `gh-halloween/repo/` | Autel de bougies, ossements |
| Restaurant Bits 1.0 | `gh-restaurant/repo/` | Plats, bocaux, caisses de légumes |
| Resource Bits 1.0 | `resourcebits/` | Lingots, bois, barils, pièces mécaniques, tissus |
| Mixed Bag 1 et 2 | `mixed_bag/` | Poêle à bois, chaînes, peluches, guitare, toiles d'araignée, piège, coin gamer |
| Skeletons 1.1 | `skeletons/` | Squelette animé et bouclier |
| Adventurers 2.0 | `adventurers/` | Personnages animés et leurs accessoires |

Les modèles utilisés sont déjà dans le dépôt.

## Licence

Les personnages utilisent KayKit Adventurers 2.0. Tous ces packs sont sous licence CC0 : le crédit n'est pas obligatoire, on le donne quand même (voir `packages/web/public/kaykit/LICENSE.txt`).

Le dépôt est public : on n'y met que des paliers gratuits en CC0. Les paliers payants (EXTRA, SOURCE) ne peuvent pas être redistribués. Les images d'aperçu des Mixed Bag montrent des objets EXTRA (borne d'arcade, lampes à lave…) absents du zip gratuit : ne les ajoute pas.

Le style reste cohérent parce que tous les modèles viennent de KayKit. Les autres familles d'assets ne sont pas utilisées. La licence se vérifie pack par pack : par exemple, *Characters – Fantasy Races* de Quaternius n'est pas en CC0.

## Ajouter un modèle

1. Télécharge le pack sur https://kaylousberg.itch.io/ (prix libre, 0 € convient). Les packs Furniture, Halloween et Restaurant sont sur GitHub, dans les dépôts `KayKit-Game-Assets/KayKit-<Nom>-Bits-1.0` : télécharge l'archive ZIP du dépôt. Les versions utilisées sont les commits `96d5930` (Furniture), `6dc69bf` (Halloween) et `153c8a7` (Restaurant).
2. Décompresse-le dans son propre dossier sous `assets-src/` : le dossier du tableau ci-dessus. Ce dossier n'est pas versionné. Par exemple, `KayKit_Adventurers_2.0_FREE.zip` se décompresse dans `assets-src/adventurers/`.
   - Le contenu d'une archive GitHub (dossier `addons/` compris) va directement dans `repo/`. L'archive ne contient pas `LICENSE.txt` : copie-le dans ce même dossier `repo/`.
   - Les deux zips Mixed Bag se décompressent tous deux dans `mixed_bag/`.
3. Ajoute le nom du modèle dans `packages/web/src/scene/kit-manifest.json`.
4. Lance la copie vers `packages/web/public/kaykit/` :

```bash
npm run kaykit:import
```

## Format `.glb`

Un pack peut être en `"format": "glb"` : ses modèles sont alors des fichiers `.glb` autonomes, sans texture séparée (`"textures": []`). L'import refuse un `.glb` qui pointe vers des fichiers externes, qui utilise une extension (comme Draco) ou dont les blocs internes (chunks) sont inattendus.

## Fins de ligne sous Windows

Sous Windows, l'import peut faire apparaître des `.gltf` comme modifiés, à cause des fins de ligne seulement. Pour les restaurer :

```bash
git checkout -- packages/web/public/kaykit/dungeon packages/web/public/kaykit/tools packages/web/public/kaykit/weapons packages/web/public/kaykit/adventurers_props packages/web/public/kaykit/forest packages/web/public/kaykit/furniture packages/web/public/kaykit/halloween packages/web/public/kaykit/restaurant packages/web/public/kaykit/resources packages/web/public/kaykit/mixed1 packages/web/public/kaykit/mixed2 packages/web/public/kaykit/skeleton_props
```

Cette commande couvre tous les dossiers de packs au format `.gltf`. Les packs au format `.glb` (`adventurers`, `adventurers_anim`, `skeletons`) ne sont pas concernés.

## Voir aussi

- [Personnages](personnages.md) : les tenues tirées des packs.
- [Conception](conception.md) : pourquoi KayKit a été retenu.
