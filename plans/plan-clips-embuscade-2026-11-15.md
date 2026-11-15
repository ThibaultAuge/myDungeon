# Implementation Plan — Skeleton ambush with the dedicated KayKit clips
*Generated on 2026-11-15 — branch `claude/clips-embuscade-59a7e8` (cut from the clip groundwork 2e0ad27)*

## Business Objective
When a session ends, skeletons ambush its knight outside the castle. With the old free pack they
faked everything (rise = `Spawn_Ground`, strike = looping `Use_Item`, walk = `Walking_A`,
burrow = `Spawn_Ground` held backwards). KayKit Character Animations 1.1 now gives real
skeleton and combat clips: the scene should use them so it reads as a proper ambush.

## Requirements Summary
### Functional Requirements
- **Rise**: `Skeletons_Spawn_Ground` (the skeleton climbs out from ~2.8 m underground, measured;
  `Skeletons_Awaken_Floor` starts lying ON the floor, which would pop a body out of nothing).
  Played sped up (`SKELETON_RISE_RATE` 1.5 → ~2.4 s instead of 3.57 s), tuned by eye.
- **Taunt** (new skeleton phase `taunting`): `Skeletons_Taunt` once (1.03 s) after rising.
- **Strike**: real attack matching the held weapon, looped until the body lies still:
  `Skeleton_Blade` → `Melee_1H_Attack_Chop` (1.067 s, blow lands ~0.60 s: measured hand-speed
  peak), `Skeleton_Axe` → `Melee_2H_Attack_Chop` (1.633 s, blow ~0.75 s). Chosen from
  `SKELETON_LOOKS[index].right.model`.
- **Victim sync**: the victim's `struck` phase lasts rise + taunt + impact time of the
  skeleton it faces (`spawns[0]`), stored on the `Victim` (`strikeAt`), instead of the static
  `SPAWN_CLIP_TIME + IMPACT_TIME`. Victim clips stay `Idle_B` → `Hit_A` → `Death_A` (they read well).
- **Walk to a tree**: `Skeletons_Walking`, rate = `SKELETON_SPEED` / its own measured clip speed
  (feet method used for `WALK_CLIP_SPEED`: Walking_A gives 0.567 at KIT_SCALE, matching 0.57;
  Skeletons_Walking ≈ 0.41), capped at `MAX_CLIP_RATE`.
- **Leave without a tree**: new phase `collapsing` = `Skeletons_Death` once (2.0 s, collapses
  into a bone pile), then `burrowing` = the pile (`Skeletons_Death` held at its end) sinks
  `BURROW_DEPTH` over `BURROW_TIME`. Depth/time retuned for a low pile.
- New clips listed only in `AMBUSH_CLIPS` (`characters.ts`), one per line: Skeletons_Spawn_Ground,
  Skeletons_Taunt, Melee_1H_Attack_Chop, Melee_2H_Attack_Chop, Skeletons_Walking, Skeletons_Death.
  This adds the Special and CombatMelee files to the preload (only when needed is not possible:
  loading is per-file at module level — accepted, same as other themes).

### Non-Functional Requirements
- **Merge hygiene**: `characters.ts` touched only inside `AMBUSH_CLIPS`; `clipFor` untouched
  (ambush clips go through `ClipInput.scripted`). New measured constants live in `ambush.ts`
  and are GLB-checked in `test/ambush.test.ts` (not the shared `it.each` in dungeon.test.ts).
- **Reduced motion**: unchanged path (doomed figure removed at once, skeletons hidden; `clipFor`
  ignores `scripted`).
- **Performance**: +2 animation GLBs fetched once; no per-frame allocation added.

### Out of Scope
Victim choreography changes, other themes' arrays, `clipFor`, `dungeon.test.ts` shared list.

### Success Criteria
`npm test` and `npm run typecheck` pass; in the browser with fake hooks the ambush shows
rise from the ground → taunt → blade/axe chops → victim hit and dies → skeletons walk into a
tree or collapse into bones and sink; screenshots taken.

## Assumptions
- Impact times (0.60 s / 0.75 s) are from the right hand-slot speed peak, measured with three.js
  in node; confirmed by eye in the browser.
- `Character` switching from `play(X)` to `hold(X, t)` on the same clip just freezes it (read in
  `AgentFigure.tsx` clip logic) — no blend glitch for the bone pile.

## Technical Approach
### Files to Create/Modify
1. `packages/web/src/scene/characters.ts` — 6 lines inside `AMBUSH_CLIPS` only.
2. `packages/web/src/scene/ambush.ts` — measured constants (`SKELETON_RISE_CLIP_TIME` 3.5667,
   `SKELETON_RISE_RATE`, `TAUNT_CLIP_TIME` 1.0333, `CHOP_1H_CLIP_TIME`, `CHOP_2H_CLIP_TIME`,
   impact times, `SKELETON_WALK_CLIP_SPEED`, `SKELETON_DEATH_CLIP_TIME` 2.0, `BURROW_TIME`),
   `attackFor(index)`, phases `taunting` / `collapsing`, `Victim.strikeAt`, updated
   `skeletonClip` (takes `index`), `skeletonDepth`; `IMPACT_TIME`/`USE_ITEM` dependency removed.
3. `packages/web/src/scene/Ambush.tsx` — nothing beyond what types require (it passes the
   whole skeleton already).
4. `packages/web/test/ambush.test.ts` — update timeline/clip tests; add GLB length checks for
   the new constants (small local GLB JSON reader) and impact < clip length.
5. `docs/ai/agent-lifecycle.md` (ambush bullet) and `docs/ai/dungeon-scene.md` only if its
   ambush clip mention is stale — via `curator` in Wave 3.
6. `plans/plan-clips-embuscade-2026-11-15.md` — copy of this plan.

## Work Breakdown
Single lot — main session

## Alternatives Considered
- **`Skeletons_Awaken_Floor` for the rise** — starts lying on the ground: needs a pile already
  there; would win if a bone pile stayed in the forest between ambushes.
- **Constants in `characters.ts`** — consistent with existing measured times, but a merge
  hotspot with four parallel branches.

## Edge Cases & Error Handling
- Victim released while a skeleton taunts → it finishes the taunt, then leaves (same rule as rising).
- Axe skeleton facing the victim when blades are busy → `strikeAt` uses its own impact time.
- Reduced motion switched mid-ambush: unchanged behaviour.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Ambush feels too long (~4 s before the blow) | medium | pacing | rise rate tuned by eye in browser |
| 2H clip with one-handed axe looks off | low | visual | check screenshot; fallback 1H chop |

## Reversibility & Rollback
- **Hard-to-undo decisions:** none.
- **Rollback:** revert the commit.

## Complexity Estimate
**Size:** S
**Justification:** one pure module, its test, one array, one doc section.
