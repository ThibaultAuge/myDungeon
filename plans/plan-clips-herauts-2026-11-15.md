# Implementation Plan — Clips des hérauts

*Generated on 2026-11-15*

## Business Objective

Les hérauts des tours d'angle (commit / push) simulent leurs gestes avec trois clips de
base. Le pack KayKit Character Animations 1.1 (branche socle `claude/clips-socle-a44e7d`)
apporte `Cheering`, `Waving`, `Holding_*`, `Ranged_Magic_*` : les utiliser pour un héraut
plus vivant, sans changer la durée de ses sorties.

## Requirements Summary

### Functional Requirements
- **Apparition / départ** : inchangés (`Spawn_Ground` joué, puis tenu à l'envers en
  descendant par la trappe), c'est déjà le bon geste.
- **Sonnerie** : un clip qui tient la trompette procédurale (os `handslotr`) à la bouche de
  façon crédible, choisi à l'œil dans le navigateur parmi `Use_Item` (actuel),
  `Ranged_Magic_Raise`, `Holding_A/B/C`. `TRUMPET_GRIP` peut être réajusté pour ce clip.
  Retenu : `Ranged_Magic_Raise` joué une fois puis tenu (poing au menton), prise
  `[0, 0, π/12]` (pavillon ~83° vers le ciel). Corrigé au passage : la trompette disparaissait
  en dev (nettoyage StrictMode qui ne remettait pas la ref à null).
- **Commit** (2,4 s) : sonnerie courte, du début à la fin.
- **Push** (6 s) : fanfare, puis le héraut salue la foule (`Waving`, un cycle), puis
  reprend la fanfare. Découpage dérivé : fanfare `(6 − WAVING)/2`, salut, fanfare.
- **Feu d'artifice** (tests passés) : un héraut en scène au départ du spectacle (montée ou
  sonnerie) joue `Cheering` une fois (durée du clip) puis reprend sa séquence. Un seul
  `Cheering` par sortie (le feu ignore aussi les `tests` pendant un spectacle). Pas de
  `Cheering` pendant la descente.
- Les notes ♪ ne s'affichent que pendant la sonnerie elle-même (pas pendant le salut ou
  l'acclamation).

### Non-Functional Requirements
- **Mouvement réduit** : inchangé (`clipFor` tient `Idle_A` même sur un clip scripté ; le
  héraut ne descend pas).
- **Durées** : `TRUMPET_TIME`, `heraldPhase`, `heraldDuration` inchangés. Nouvelles durées
  mesurées `CHEERING_CLIP_TIME`, `WAVING_CLIP_TIME` vérifiées contre le GLB dans un test
  propre aux hérauts (pas dans la liste `it.each` partagée de `dungeon.test.ts`).
- **Branches parallèles** : clips ajoutés seulement dans `HERALD_CLIPS` ; `clipFor` non
  touché (les hérauts passent par `scripted`).

### Out of Scope
- Durées des sorties, tours, feu d'artifice lui-même, classification serveur.

### Success Criteria
- `agentOffice.heraut('commit' | 'push')` et `agentOffice.feuArtifice()` montrent les
  gestes ci-dessus (captures d'écran), tests et typecheck verts.

## Assumptions
- Deux fichiers d'animation chargés en plus pour toutes les figures : `Rig_Medium_Simulation`
  (Cheering, Waving, 0,86 Mo) et `Rig_Medium_CombatRanged` (`Ranged_Magic_Raise`, 1,0 Mo).
  Accepté ; d'autres thèmes peuvent les charger aussi (vérifier après la fusion).

## Technical Approach

### Architecture
- `celebrate.ts` (pur) : `heraldClip(phase, t, kind = 'commit', cheerAt = null)`.
  `cheerAt` = temps, dans la phase de sonnerie, où le feu a démarré (négatif s'il a démarré
  pendant la montée). Fenêtre d'acclamation `[max(0, cheerAt), max(0, cheerAt) +
  CHEERING_CLIP_TIME)` ; sinon séquence par `kind`. Constante `TRUMPET_CLIP` exportée.
  `heraldCheerAt(phase, t)` : la valeur `cheerAt` à retenir quand un feu part, ou `null`
  (descente / parti).
- `Herald.tsx` : s'abonne aussi à `onCelebrate('tests')` (une ref par héraut), passe
  `kind` et `cheerAt` à `heraldClip`, notes visibles si le clip est `TRUMPET_CLIP`.
- `characters.ts` : `HERALD_CLIPS` seulement (+ clip de sonnerie s'il n'est pas déjà de
  base, `Cheering`, `Waving`). Les deux constantes de durée vont dans `celebrate.ts`, hors
  des zones partagées.

### Files to Create/Modify
- `packages/web/src/scene/celebrate.ts`, `Herald.tsx`, `characters.ts` (`HERALD_CLIPS`
  seulement), `packages/web/test/celebrate.test.ts`, nouveau
  `packages/web/test/heraldClips.test.ts` (durées GLB), `docs/ai/celebrations.md`.

## Work Breakdown
Single lot — main session.

## Alternatives Considered
- Allonger `TRUMPET_TIME.commit` pour y loger un salut : rejeté, la consigne garde les
  durées.
- Hérauts qui acclament pendant tout le feu : rejeté, perdrait le signal du commit (un
  commit suit souvent des tests verts).

## Security Constraints
Aucune (client, purement visuel).

## Compliance Constraints
Aucune donnée personnelle.

## Performance Considerations
Un fichier d'animation de plus chargé (voir Assumptions). Pas de coût par image notable.

## Edge Cases & Error Handling
- Feu pendant la descente : ignoré. Feu avant la montée : héraut pas en scène, rien.
- Acclamation qui déborderait la fin de la sonnerie : coupée par la descente.

## Risks
- Clip de sonnerie peu crédible avec la prise actuelle : ajuster `TRUMPET_GRIP`.

## Reversibility & Rollback
Revert du commit.

## Complexity Estimate
S — deux fichiers source, tests, doc. Pas de `grumpy` (S, réversible).

## Objections Considered
Aucun `grumpy` (taille S).

Revue d'implémentation (`hermione`, `timmy`), résolutions :
- **Accepté** — une acclamation qui chevauche le salut relançait le salut depuis sa première
  image (le mixeur redémarre un clip déjà fondu) : désormais l'acclamation termine le salut, la
  trompette revient après.
- **Accepté** — fichier `CombatRanged` non prévu : consigné dans Assumptions.
- **Rejeté (documenté)** — acclamation sur un `tests` ignoré par le feu en cours : écart
  visuel mineur, consigné dans la doc.
- **Rejeté (préexistant)** — sortie de push > 5 s (WCAG 2.2.2) : durées inchangées par ce plan.
- **Accepté tel quel** — notes visibles sous mouvement réduit pendant la sonnerie, masquées
  pendant salut/acclamation : comportement des notes d'avant conservé pour la sonnerie.
