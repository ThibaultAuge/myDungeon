# Implementation Plan — Socle des clips KayKit Character Animations 1.1

*Generated on 2026-11-15*

## Business Objective

Préparer le terrain commun pour utiliser les 139 clips `Rig_Medium` du pack CC0 « KayKit
Character Animations 1.1 », afin que cinq branches parallèles (autel, embuscade, hérauts,
gestes de travail, bonus) ajoutent chacune leurs clips sans conflit de fusion. Aucun
comportement nouveau.

## Requirements Summary

### Functional Requirements
- Les 8 fichiers `Rig_Medium_*.glb` du pack 1.1 sont importés via `kit-manifest.json` +
  `npm run kaykit:import`, avec la licence du pack.
- `General` et `MovementBasic` viennent aussi du pack 1.1 : vérifié, ils sont identiques
  octet pour octet (même SHA-1, mêmes 15 et 11 clips, mêmes durées) à ceux d'Adventurers
  2.0. Les durées mesurées de `characters.ts` ne changent donc pas.
- `useClips` charge les clips depuis n'importe lequel des 8 fichiers, mais seulement les
  fichiers qui contiennent au moins un clip de `CLIPS`.
- `CLIPS` devient la concaténation de tableaux par thème, chacun à son endroit.
- Figures d'agents, squelettes de l'embuscade et hérauts passent déjà tous par
  `Character` → `useClips` : le même mécanisme les sert.

### Non-Functional Requirements
- **Performance:** chaque fichier fait 0,7 à 1,5 Mo. Aujourd'hui `preloadKit()` précharge
  TOUT le manifeste : il doit exclure le pack d'animations et ne précharger que les
  fichiers utilisés. Avec les clips actuels, seuls `General` et `MovementBasic` sont
  chargés : aucun octet de plus qu'avant.
- **Security:** le script d'import n'est pas modifié (ses contrôles glb s'appliquent).
- **UX/UI:** aucun changement visible.

### Out of Scope
- Tout nouveau clip joué, tout changement de `clipFor`.
- `Rig_Large`, mannequins.

### Success Criteria
- `npm test` et `npm run typecheck` passent ; la scène se rend sans avertissement de clip.
- Le réseau ne charge que `Rig_Medium_General.glb` et `Rig_Medium_MovementBasic.glb`.

## Assumptions

- Chaque nom de clip est unique dans les 8 fichiers, sauf `T-Pose` (présent partout,
  jamais joué). Vérifié par un test sur le catalogue.

## Technical Approach

### Architecture
- Nouveau pack `animations` (format glb), source
  `animations/KayKit_Character_Animations_1.1/Animations/gltf/Rig_Medium`, 8 modèles,
  licence du pack. Le pack `adventurers_anim` disparaît (git verra des renommages pour les
  deux fichiers identiques).
- Nouveau module pur `scene/clipCatalog.ts` : `ANIM_FILES` (les 8 fichiers),
  `CLIP_FILE` = catalogue figé « nom de clip → fichier » des 138 clips (sans `T-Pose`),
  `KitClip` = ses clés, `animFilesFor(clips)` = fichiers utilisés, dans l'ordre de
  `ANIM_FILES`. Écrit une fois, jamais modifié par les branches suivantes ; un test le
  compare aux GLB (chaque entrée est dans son fichier, chaque clip des fichiers y figure).
- `characters.ts` : `BASE_CLIPS` (les clips actuels hors autel), `ALTAR_CLIPS`
  (`Death_B`, `Death_A_Pose`, déjà propres à l'attente à l'autel), `AMBUSH_CLIPS`,
  `HERALD_CLIPS`, `WORK_CLIPS`, `BONUS_CLIPS` (vides), chacun `as const satisfies readonly
  KitClip[]`, séparés par des lignes de commentaire ; `CLIPS = [...]` les concatène ;
  `ClipName` reste `(typeof CLIPS)[number]`. `ANIM_FILES_USED = animFilesFor(CLIPS)`.
- `kit.ts` : `preloadKit()` saute le pack `animations` et précharge `ANIM_FILES_USED` ;
  nouveau `useKitGLTFs(pack, names)` (drei `useGLTF` accepte un tableau d'URL).
- `AgentFigure.tsx` : `useClips` charge `ANIM_FILES_USED` via `useKitGLTFs`, garde le
  filtre et l'avertissement DEV (manquants / doublons).

### Files to Create/Modify
1. `packages/web/src/scene/kit-manifest.json` — pack `animations` remplace `adventurers_anim`
2. `packages/web/public/kaykit/animations/*` — produit par `npm run kaykit:import`
3. `packages/web/src/scene/clipCatalog.ts` — catalogue (nouveau)
4. `packages/web/src/scene/characters.ts` — tableaux par thème
5. `packages/web/src/scene/kit.ts` — préchargement, `useKitGLTFs`
6. `packages/web/src/scene/AgentFigure.tsx` — `useClips`
7. `packages/web/test/dungeon.test.ts`, `packages/web/test/characters.test.ts` — pack renommé, tests du catalogue
8. `docs/modeles-3d.md`, `docs/ai/dungeon-scene.md` — via otis / curator

## Work Breakdown

Single lot — main session

## Alternatives Considered

- **Garder `adventurers_anim` et ajouter un pack de 6 fichiers** — deux packs, deux
  licences pour le même rig ; la table clip → fichier devrait porter le pack en plus.
  Gagnerait si les fichiers 2.0 et 1.1 différaient.
- **Table clip → fichier écrite à la main au fil des ajouts** — chaque branche éditerait
  le même objet : conflits. Le catalogue complet figé l'évite.
- **Charger les 8 fichiers** — ~7 Mo dont 6 inutiles aujourd'hui.

## Edge Cases & Error Handling

- Clip mal orthographié dans un tableau de thème : erreur de typecheck (`KitClip`).
- Fichier absent du réseau : l'error boundary existante de `Character` affiche la capsule.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Deux branches éditent `clipFor` ou les listes de tests | high | conflits de fusion | Hors de ce socle ; signalé dans la note de passation |
| Nombre de fichiers chargés varie entre rendus | low | ordre de hooks | Liste figée au chargement du module, un seul `useGLTF` sur un tableau |

## Reversibility & Rollback

- **Hard-to-undo decisions:** les noms `ALTAR_CLIPS`… et `clipCatalog.ts` deviennent la
  base de cinq branches parallèles ; les renommer après leur départ provoquerait des
  conflits.
- Les six GLB encore inutilisés (~6 Mo) restent dans l'historique git même après un revert.
  Exception voulue à la règle « ne livrer que les assets utilisés » : la tâche demande de
  les ajouter tous, et un import par branche ferait éditer à chacune la même liste
  `models` du manifeste et le même catalogue (conflits).
- **Rollback:** revert du commit avant que les branches partent.

## Objections Considered

| Objection | Severity | Resolution |
|---|---|---|
| Préchargement et chargement tableau n'ont pas la même clé de cache | 🟡 | accepted — un seul helper `kitUrls` ; préchargement en un appel tableau, même liste, même ordre, même `false` |
| Même clip dans deux tableaux de thème : test rouge après fusion | 🟡 | accepted — `CLIPS` dédoublonne ; le test d'unicité porte sur chaque tableau |
| Disposition des tableaux non sûre pour git | 🟡 | accepted — tableaux multi-lignes, crochets seuls sur leur ligne, ligne vide et commentaire figé entre eux ; fusion de deux branches jetables pour valider |
| L'import ne supprime pas `adventurers_anim/` | 🟡 | accepted — `git rm` du dossier, `docs/modeles-3d.md` mis à jour |
| Six GLB inutilisés, irréversibles dans l'historique | 🟡 | accepted — consigné dans Reversibility comme exception voulue (demandée par la tâche) |
| Taille sous-estimée | 🔵 | accepted — M |
| Aucun test ne lie `ANIM_FILES` au manifeste | 🔵 | accepted — test d'égalité |

**Verdict:** SOUND WITH RESERVATIONS (1 run; Technical Approach unchanged in substance)

## Complexity Estimate

**Size:** M

**Justification:** six fichiers source et test, un module neuf, un import binaire et deux docs ; logique simple.
