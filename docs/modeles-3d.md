# Modèles 3D

La carte utilise des packs gratuits de Kay Lousberg (www.kaylousberg.com). Ce document liste les packs, explique la licence, et décrit comment ajouter un modèle.

## Packs utilisés

| Pack | Dossier sous `assets-src/` | Contenu utilisé |
|---|---|---|
| Dungeon Pack 1.1 | `dungeon/` | Sols, murs, arches, meubles, torches, bannières |
| RPG Tools Bits 1.0 | `rpg-tools/` | Outils et objets (carte, lanterne, marteau…) |
| Fantasy Weapons Bits 1.0 | `weapons/` | Armes et boucliers |
| Forest Nature Pack 1.0 | `forest/` | Arbres, buissons et rochers de la forêt de nuit |
| Adventurers 2.0 | `adventurers/` | Personnages animés et leurs accessoires |

Les modèles utilisés sont déjà dans le dépôt.

## Licence

Les personnages utilisent KayKit Adventurers 2.0. Ces packs sont sous licence CC0 : le crédit n'est pas obligatoire, on le donne quand même (voir `packages/web/public/kaykit/LICENSE.txt`).

Le style reste cohérent parce que tous les modèles viennent de KayKit. Les autres familles d'assets ne sont pas utilisées. La licence se vérifie pack par pack : par exemple, *Characters – Fantasy Races* de Quaternius n'est pas en CC0.

## Ajouter un modèle

1. Télécharge le pack sur https://kaylousberg.itch.io/ (prix libre, 0 € convient).
2. Décompresse-le dans son propre dossier sous `assets-src/` (`dungeon/`, `rpg-tools/`, `weapons/`, `adventurers/` ou `forest/`). Ce dossier n'est pas versionné. Par exemple, `KayKit_Adventurers_2.0_FREE.zip` se décompresse dans `assets-src/adventurers/`.
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
git checkout -- packages/web/public/kaykit/dungeon packages/web/public/kaykit/tools packages/web/public/kaykit/weapons packages/web/public/kaykit/adventurers_props packages/web/public/kaykit/forest
```

Cette commande couvre tous les dossiers de packs au format `.gltf`. Les packs au format `.glb` (`adventurers`, `adventurers_anim`) ne sont pas concernés.

## Voir aussi

- [Personnages](personnages.md) : les tenues tirées des packs.
- [Conception](conception.md) : pourquoi KayKit a été retenu.
