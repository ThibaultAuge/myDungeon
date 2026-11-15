---
description: Use when changing the rat gag — a procedural rat scurrying between corridor holes or stealing the tavern's cheese (rat.ts, RatScene, the KayKit cheese) — the agentOffice.rat console command, or when adding another scurrying creature.
---

# Rat and cheese (gag)

User design (French): `plans/plan-rat-fromage-2026-11-15.md`. Human description of the
console command: `docs/commandes-console.md`.

## Current State
- Purely visual, client only: no hook, no server change, no displayed text (no i18n keys).
  Console messages are in English (developer tool). One rat at a time.
- Natural passes: `setTimeout` chain in `RatScene`, delay `nextPassDelay` 3–6 min
  (`PASS_MIN_MS` / `PASS_MAX_MS`); `pickPass` → `'cheese'` with `THEFT_CHANCE` 0.25, else
  `'corridor'`. A pass is skipped when `document.hidden`, under reduced motion, or while a
  rat is already out.
- Holes: `RAT_HOLES` = `ghost.ts` `WANDER_POINTS` within `HOLE_DEPTH` 0.6 of `BOUNDS`,
  castle gate excluded (`atGate`, assumes the gate is on the south side). `holeMouth` sits
  0.6 m outward (inside the wall).
- Run planning: `planRun(kind, random)` → `RatRun` of legs (floor run at `RAT_SPEED`
  2.4 m/s, hops of `HOP_MS` 450 with arc `HOP_HEIGHT`, pauses); `sampleRun(run, ms)` →
  `RatPose`; `emergeScale` grows / shrinks the rat over `EMERGE_MS` 350 at both ends.
  - Corridor pass: hole → `corridorPath` → another hole ≥ 4 m away.
  - Cheese pass: hole → `corridorPath` → `TAVERN_GATE` (tavern `doorOf` outside) →
    `TAVERN_WAY` (door inside, west of the tables, gap between the 1st and 2nd `longTable`,
    foot of the 2nd table's north end) → hop up to `TABLE_LANDING` (`TABLE_TOP` 0.75,
    `TABLE_SIDE` 0.28 m off the table's middle line, clear of the `longTable` stew in
    `props.tsx`) → `GRAB_MS` pause, grab at mid-pause (`grabAt`) → hop down → back out →
    a far hole. Floor legs avoid every tavern prop footprint (tested with `inFootprint`).
- Cheese: KayKit Restaurant `food_ingredient_cheese`, always mounted at `CHEESE_SPOT` =
  `TABLE_LANDING` + `MOUTH_AHEAD` 0.42 (so the grab has no jump); carried at the rat's foot
  level `MOUTH_AHEAD` ahead, scaled with `emergeScale`. After a theft it reappears
  `CHEESE_BACK_MS` 8 s after the rat is gone, growing over `CHEESE_GROW_MS` 400
  (`cheeseScale`). `CHEESE_CENTRE_X` 0.1535 is measured from the current model.
- Clock: frame clock with dt capped at 0.1 s, so a hidden tab pauses everything.
- Rat mesh: procedural (no free KayKit rat), ~13 meshes (body, head, snout, nose, ears,
  eyes, tail tube, 4 feet), geometries and materials shared at module level, `RAT_SCALE`
  1.9 (larger than life to stay visible), no shadow. Mounted only during a pass (keyed
  group): ~13 extra draw calls during a pass, +1 permanent mesh for the cheese.
  `RatScene` is `memo`'d, no props; mounted in `Office.tsx` after `<MishapProps />`.
- Not selectable: raycast disabled on rat and cheese, no keyboard route (accepted
  accessibility decision, like ghosts; motion stops only through OS
  `prefers-reduced-motion`, accepted WCAG 2.2.2 warning).
- Reduced motion: no natural pass, the command returns false, a running rat vanishes, the
  cheese is always home with no regrowth animation.
- Console command `agentOffice.rat(pass?)` from `installRatCommand` (same namespace guard
  as `installAltarCommand` / `installMishapCommands`): `undefined` / `'couloir'` /
  `'corridor'` → corridor run; `'fromage'` / `'cheese'` → theft (case-insensitive).
  Replaces a running pass (the cheese returns at once); returns true if a rat starts.
  Installed in a `RatScene` effect, so it exists only once the scene's models have loaded
  (can take a while after a reload).

## Relevant Files
- `packages/web/src/scene/rat.ts` — pure: constants, `RAT_HOLES`, `holeMouth`,
  `TABLE_LANDING`, `CHEESE_SPOT`, `TAVERN_WAY`, `TAVERN_GATE`, `nextPassDelay`, `pickPass`,
  `planRun`, `sampleRun`, `emergeScale`, `cheeseScale`, `installRatCommand`.
- `packages/web/src/scene/RatScene.tsx` — rat mesh, cheese, pass scheduling, command
  install.
- `packages/web/src/scene/Office.tsx` — mounts `<RatScene />`.
- `packages/web/src/scene/kit-manifest.json`,
  `packages/web/public/kaykit/restaurant/food_ingredient_cheese.{gltf,bin}` (imported with
  `npm run kaykit:import`; import process: `docs/ai/dungeon-scene.md`).
- Tests: `packages/web/test/rat.test.ts`.

## Usage
- Rat logic stays in `rat.ts` (pure, tested). Reuse `WANDER_POINTS`, `corridorPath`,
  `doorOf` and `inFootprint` rather than adding new geometry.
- Any new scurrying creature reuses `planRun` / `sampleRun` (legs, hops, pauses).
- Console command convention: `docs/ai/dungeon-scene.md` Usage.
- Preview: the camera follows a selected agent. Select a resting tavern figure via
  `#roster-button-<type>`, then dispatch wheel events on the canvas to zoom onto the
  tavern, and call `agentOffice.rat('cheese')`. The Browser pane must be visible or no
  frames render.

## Notes
- Accepted limits (not done): the rat turns ~180° on the table in ~150 ms at the start of
  the hop down (the tail may sweep over table props); the cheese's stew clearance is
  measured by eye; `atGate` assumes the south gate; static rat parts are not merged per
  material (`merge.ts` approach, possible optimisation); one-frame flicker when the
  console replaces a running pass.
