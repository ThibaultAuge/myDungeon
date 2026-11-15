# Plan — work gestures per room (WORK_CLIPS)

Branch `claude/clips-travail-d92330`, cut from `claude/clips-socle-a44e7d` (clip groundwork).
Five sibling branches (altar, ambush, heralds, bonuses) edit `characters.ts` in parallel and
will be merged later: stay inside the WORK theme.

## Objective
Every working agent plays `Interact` at its post today, whatever the room; resting figures
in the tavern hold `Idle_A` standing (state `done`). Give each room a fitting gesture; figures
at rest sit at the tavern tables, and the agent working in the relaxation corner (Butt-Stallion)
sits on the couch or at the dice table.

## Technical approach
- **New pure module `scene/workGestures.ts`** (tested in `test/workGestures.test.ts`):
  - `placeClip({ room, station, seat, state, reducedMotion, throwing })` (`seat` from `seatOf(spot.id)`) →
    `ClipChoice | null`: the gesture of a figure standing still at its spot. `null` keeps
    the existing chain (`Interact` / `Idle_A` / `Idle_B`).
  - A table `ROOM_GESTURES: Record<RoomId, …>` plus per-station overrides (easel, abacus,
    review table, lab, herald's stage, inspection desk), chosen on screen.
  - Seat kinds from the spot id (`:seat:`, `:wall:`, station): only the tavern table seats
    and the couch / dice-table seats sit; wall overflow places sit on the floor or stand.
  - Reduced motion: seated poses are held still (`hold`), standing work gestures return
    `null` so the existing `hold('Idle_A')` applies.
  - Pigeonnier: a calm gesture (`Work_C`), and `Throw` once each time a pigeon really leaves
    for that agent: `Pigeons.tsx` calls `throwPigeon(id)` when `start` or the console
    command's `force` returns a drawn flight (never for a silent one); `AgentFigure` listens
    with `onThrow` (bus like `onPotion`). Flight logic untouched.
- **`characters.ts`**: clips on new lines of `WORK_CLIPS`; one new optional
  `ClipInput.place` field and one line in `clipFor`, placed after the altar/kneel branches
  and before the `done` branch, so slap, potion, spawn, walk and altar keep priority.
- **`AgentFigure.tsx`**: `Motion.place` computed per frame from the spot when the figure is
  at its place (not walking, not doomed, no altar pose); passed to `clipFor`; a small
  effect for the pigeon throw cue.
- **Furniture**: render-only `stool` pieces inside the `longTable` and `diceTable` recipes
  (`props.tsx`), not new `PropKind`s, so no footprint, layout or post change; they sit
  0.25 m behind each seat where the `Sit_Chair_Idle` hips land (measured on screen). The two
  couch seats move back 0.25 m (`layout.ts`) so the pose lands on the cushions.
- **Props**: check `PROP_GRIP` on screen for each gesture; adjust only grips of props held
  by figures whose gesture changes, if one looks wrong.

## Objections considered (grumpy, SOUND WITH RESERVATIONS)
- Throw tied to store events (silent flights, console command, duplicated id mapping):
  **Accepted**, throw driven by real launches through `throwPigeon` / `onThrow`. Accepted
  limits: the bird leaves from the aviary, a few metres from the lectern; a second bird
  during a throw does not restart it.
- Extra animation files on the critical path (Tools, Simulation, CombatMelee,
  CombatRanged): **Accepted** as a cost; the brief asked for these clips and sibling branches
  load Simulation and Tools anyway. Recorded in the docs.
- Couch and stool geometry unspecified: **Accepted**, see Furniture.
- Objective wording on the lounge: **Accepted**, reworded.
- Priority chain conflicts with sibling branches: **Accepted**, `place` position recorded in
  `docs/ai/dungeon-scene.md`.
- Slapped seated figures pop up for the hit: **Accepted** as cosmetic.

## Work breakdown
Single lot — main session.

## Tests
Unit tests of `placeClip` (every room, station override, seat kinds, reduced motion, states,
throw), a `clipFor` test that `place` loses to slap/potion/walk/altar, and a GLB test of any
new clip-length constant (`Throw`).

## Docs
`docs/ai/dungeon-scene.md` (clips bullet, new module), `docs/ai/agent-lifecycle.md`
(seated resting figures), `docs/ai/pigeon-gag.md` (throw cue) via curator; `docs/lieux.md`
/ `docs/personnages.md` via otis if the human description of figures changes.

## Complexity estimate
M (one new pure module, small edits in three files, furniture calibration on screen).

## Reversibility & rollback
Revert the commit. No data, no server change.

## Verification
`npm test`, `npm run typecheck`, one Playwright screenshot per room with a store-injected
gallery of working agents.
