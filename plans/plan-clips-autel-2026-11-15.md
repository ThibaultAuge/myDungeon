# Implementation Plan — Vrais clips assis et couché à l'autel

*Generated on 2026-11-15*

## Business Objective

L'attente sans fin à l'autel simulait deux poses faute de clip dans l'ancien pack gratuit :
assis = `Death_B` figé à genoux (dos tourné), endormi = `Death_A_Pose` (posé comme un
cadavre). Le pack KayKit Character Animations 1.1 (socle `claude/clips-socle-a44e7d`) a
de vrais clips : on les utilise.

## Requirements Summary

### Functional Requirements
- assis : `Sit_Floor_Down` une fois (1 s), puis `Sit_Floor_Idle` en boucle.
- endormi (et toile) : `Lie_Down` une fois (3 s), puis `Lie_Idle` en boucle.
- Quand la pose assise ou couchée prend fin (l'humain répond, la file avance, l'étape
  repasse à calme), l'agent se relève d'abord : `Sit_Floor_StandUp` (1,13 s) ou
  `Lie_StandUp` (2,33 s), la marche attendant la fin du clip comme pour une gifle.
  Assis → endormi enchaîne directement `Lie_Down` (pas de relevé).
- Une figure montée déjà à sa place (rechargement de page) prend directement la pose
  bouclée, sans rejouer la descente. Après une gifle ou une gorgée, la descente est rejouée.
- Zzz et toiles n'apparaissent qu'une fois l'agent allongé (`Lie_Down` terminé).
- Recalibrer à l'œil la position du Zzz et des toiles ; réévaluer l'orientation « dos
  tourné » (captures des deux variantes pour l'utilisateur).

### Non-Functional Requirements
- **Performance:** un fichier d'animation de plus chargé (`Rig_Medium_Simulation.glb`),
  inévitable ; `General` reste chargé pour les autres clips.
- **Security:** aucun changement (visuel, client).
- **UX/UI:** mouvement réduit : poses fixes (`Sit_Floor_Idle` / `Lie_Idle` figés), pas de
  descente ni de relevé.

### Out of Scope
- Étapes et durées d'`altarWait.ts`, commande console, `data-asleep` (comportement), autres
  tableaux de clips.

### Success Criteria
- `npm test` et `npm run typecheck` passent ; captures des étapes assis et endormi.

## Assumptions
- La première image de `Sit_Floor_Idle` / `Lie_Idle` est une pose propre pour le mouvement
  réduit — vérifié dans le navigateur.

## Technical Approach

### Architecture
- `characters.ts` : `ALTAR_CLIPS` = les 6 clips `Sit_Floor_*` / `Lie_*` (retire `Death_B`,
  `Death_A_Pose`) ; `AltarPose` gagne `rising-sit` / `rising-lie` ; `ClipInput.altarFor`
  (secondes depuis le début de la pose) ; durées mesurées `SIT_DOWN_TIME`,
  `SIT_UP_TIME`, `LIE_DOWN_TIME`, `LIE_UP_TIME` ; `altarClip(pose, held, still)` appelé
  par la branche autel de `clipFor` (remplace `SIT_CLIP`, `SIT_POSE_TIME`, `SLEEP_CLIP`).
- `altarWait.ts` : fonction pure `trackAltarPose(track, wanted, dt, opts)` qui gère pose
  courante, temps tenu et relevé ; `isLyingDown(track)` pour Zzz et toiles.
- `AgentFigure.tsx` : calcule la pose voulue avant la marche, met en pause la marche
  pendant le relevé, passe `altarFor` à `clipFor`.
- `SnoreBubble` / `.snore` et `AltarCobwebs` : positions recalibrées.

### Files to Create/Modify
1. `packages/web/src/scene/characters.ts`
2. `packages/web/src/scene/altarWait.ts`
3. `packages/web/src/scene/AgentFigure.tsx`
4. `packages/web/src/scene/AltarCobwebs.tsx`, `packages/web/src/styles.css` (`.snore`)
5. Tests : `characters.test.ts`, `altarWait.test.ts`, `dungeon.test.ts` (test du `SIT_POSE_TIME`
   retiré), nouveau `altarClips.test.ts` (durées contre le GLB)
6. `docs/ai/altar-wait.md`, `docs/ai/dungeon-scene.md` (ligne `ALTAR_CLIPS` si nécessaire)

## Work Breakdown

Single lot — main session

## Alternatives Considered
- **Garder `clipFor` sans état et laisser `Character` enchaîner les clips (événement
  `finished` du mixer)** — rejeté : la logique deviendrait non testable (dans le `.tsx`),
  et le relevé doit de toute façon bloquer la marche dans `AgentFigure`.
- **Pas de relevé** — plus simple, mais l'agent glisserait couché vers son poste ; le
  relevé s'insère proprement via la pause de marche existante.

## Edge Cases & Error Handling
- Gifle / potion pendant la pose : le clip de gifle passe devant, la descente est rejouée.
- Forçage console assis ↔ endormi : endormi → assis passe par le relevé.
- Mort hors du château (exit) : pas de relevé, la scène scriptée prend la main.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Transition assise → `Lie_Down` (qui part debout) saute visuellement | medium | cosmétique | fondu de 0,2 s existant ; vérifié à l'œil |
| Conflit avec les branches parallèles sur `clipFor` / `ClipInput` | medium | fusion manuelle | modifications limitées aux lignes autel |

## Reversibility & Rollback
- **Hard-to-undo decisions:** none
- **Rollback:** revert du commit.

## Complexity Estimate

**Size:** S

**Justification:** une logique pure de transition, une branche de `clipFor`, des
recalibrages visuels ; pas de serveur.
