---
description: Use when changing the endless-wait gag at the altar — agents waiting for the human that pace, sit, fall asleep (Zzz bubble) and gather cobwebs over time (altarWait.ts, SnoreBubble, AltarCobwebs) — or the agentOffice.autel console command.
---

# Endless wait at the altar (gag)

User design (French): `plans/plan-attente-autel-2026-11-15.md`. Human description of the
console command: `docs/commandes-console.md`.

## Current State
- Purely visual, client only: no server change, nothing sent. Applies to every agent of the
  altar queue (state `waiting`, room `autel`, reason `permission` / `question` / `error`;
  queue rules: `docs/ai/agent-lifecycle.md`).
- Stage by wait time from `AgentView.since` (the server resets it on each state or reason
  change): `altarStage(agent, now)` → `calm` < 1 min ≤ `pacing` < 3 min ≤ `sitting` < 5 min
  ≤ `sleeping` < 10 min ≤ `webbed` (`ALTAR_STAGE_MS`). A client clock behind the server
  counts as no wait.
- `Office.tsx` computes `shownAltarStage` (forced stage, else the real one) from the 1 s
  `useNow` clock and passes it to `AgentFigure` as a string prop, so `React.memo` still
  skips unchanged figures.
- Poses (`clipFor` in `characters.ts`, `ClipInput.altar: AltarPose`, `webbed` posed as
  `sleeping`; clip priority list: `docs/ai/dungeon-scene.md`). Sitting, sleeping and
  getting up use `ALTAR_CLIPS` (`Sit_Floor_Down` / `_Idle` / `_StandUp`, `Lie_Down` /
  `_Idle` / `_StandUp`, file `Rig_Medium_Simulation`), chosen by the pure
  `altarClip(pose, held, still)` that `clipFor`'s altar branch calls with
  `ClipInput.altarFor` (seconds the pose has been shown, `Infinity` when absent):
  - pacing: `Walking_A` at `PACE_CLIP_RATE` 0.6; sideways ±`PACE_AMPLITUDE` 0.35 m along
    `paceAxis(facing)`, sine of period `PACE_PERIOD` 4 s, phase offset `paceSeed(id)`
    (FNV-1a) so a queue does not walk in step. The offset (`paceShift`, eased with
    `approach`) moves the drawn group only, never `pos`, so walking and reroutes ignore it.
    Pacing replaces kneeling.
  - sitting: `Sit_Floor_Down` once (`SIT_DOWN_TIME` 1 s), then `Sit_Floor_Idle` looping;
    the figure turns its back to the altar (`altarHeading`: facing + π), toward the
    default camera.
  - sleeping: `Lie_Down` once (`LIE_DOWN_TIME` 3 s), then `Lie_Idle`, keeping the place's
    facing (feet toward the altar, head toward the camera); plus the "Zzz" bubble
    `SnoreBubble` in the name tag `<Html>` (text `t.altarWait.snore`, CSS `.snore*`).
  - webbed: sleeping plus `AltarCobwebs`: two `mixed2` `cobweb_C` via `<Kit>` at scale 0.4,
    at (−0.5, 0.7, −0.65) rot 0 and (0.5, 0.7, 0.4) rot π, figure-local, tented over the
    lying body (head z ≈ −0.6 to feet z ≈ +0.35).
  - getting up (`rising-sit` / `rising-lie`): when a sitting or sleeping pose ends (queue
    moves, human answers, stage back to calm or pacing, console release), the figure plays
    `Sit_Floor_StandUp` (`SIT_UP_TIME` 17/15 s) or `Lie_StandUp` (`LIE_UP_TIME` 7/3 s); the
    walk pauses meanwhile like for a slap and the heading is held. Sitting → sleeping goes
    straight to `Lie_Down`; sleeping → sitting gets up first.
- Pose tracking: pure `trackAltarPose(track, wanted, dt, {still, exit, interrupted})` in
  `altarWait.ts` (`AltarPoseTrack {pose, held, riseLeft}`, `WantedAltarPose`).
  `AgentFigure` computes the wanted pose before the walk step, keeps the track in a ref
  (starts at `ALTAR_POSE_START`, `held` = `Infinity`: a figure that appears already in a
  pose, e.g. after a reload, is shown settled with no way down) and passes `held` as
  `altarFor`. `interrupted` = the hit clip, gulp or cheer (`cheer.ts`) actually shows
  (`(m.hitWait <= 0 && m.hitLeft > 0) || gulping || cheering`, not during the hand's swing
  delay): it restarts the way down afterwards and ends a getting-up at once, because all
  three clips end standing (otherwise a lying figure would cheer standing, snap back to
  lying, then pop up). `still` (reduced motion) or `exit` (doomed figure): no way down, no
  getting up. Returns the same object when a figure away from the altar has nothing to
  change (no per-frame allocation).
- Follows the pose actually shown: `AgentFigure`'s `useFrame` sets `data-asleep` on the tag
  anchor (CSS hides `.snore` otherwise) and the cobweb group's `visible` only once lying is
  settled (`isLyingDown`: past `Lie_Down`), and never while hit or gulping. A slap or a
  gulp freezes pacing (heading and shift).
- Reduced motion: pacing falls back to calm (head of the queue kneels); sit / sleep poses
  are held still (`Sit_Floor_Idle` / `Lie_Idle` at time 0) and cobwebs stay; Zzz is
  static (second Z hidden).
- Forced stages: module-level bus in `altarWait.ts` (`forceAltarStage` returns whether
  anything changed, `clearForcedAltarStages`, `forcedAltarStage`, `onAltarForce` +
  `altarForceVersion` for `useSyncExternalStore`). Console command `agentOffice.autel(stage?,
  id?)` from `installAltarCommand`, installed by `Office` in a `useEffect`: stage names
  `calme` / `cent-pas` / `assis` / `endormi` / `toile` or the code ids (`parseStageArg`,
  case-insensitive); `null` releases; no id → selected agent, else every agent at the
  altar; `autel()` releases all; returns a boolean. Uninstall clears forced stages. Shipped
  in production (visual only).

## Relevant Files
- `packages/web/src/scene/altarWait.ts` — pure: `AltarStage`, `ALTAR_STAGES`,
  `ALTAR_STAGE_MS`, `altarStage`, `isAsleep`, pacing math (`paceOffset`, `paceAxis`,
  `paceHeading`, `paceSeed`, `altarHeading`), forced-stage bus, `shownAltarStage`,
  `parseStageArg`, `installAltarCommand`, pose tracking (`AltarPoseTrack`,
  `ALTAR_POSE_START`, `WantedAltarPose`, `trackAltarPose`, `isLyingDown`).
- `packages/web/src/scene/characters.ts` — `AltarPose`, `ClipInput.altar` / `altarFor`,
  `ALTAR_CLIPS`, `altarClip`, `SIT_DOWN_TIME`, `SIT_UP_TIME`, `LIE_DOWN_TIME`,
  `LIE_UP_TIME`, `PACE_CLIP_RATE`.
- `packages/web/src/scene/AgentFigure.tsx` — pose track ref, walk pause and held heading
  while getting up, pacing shift / heading, per-frame `data-asleep` and cobweb visibility.
- `packages/web/src/scene/Office.tsx` — stage per agent, command install.
- `packages/web/src/scene/SnoreBubble.tsx`, `scene/AltarCobwebs.tsx`; `.snore*` in
  `packages/web/src/styles.css`; `altarWait.snore` in the i18n dictionaries.
- Tests: `packages/web/test/altarWait.test.ts` (own `trackAltarPose` describe),
  `characters.test.ts`, `dungeon.test.ts` (the four way-down / get-up lengths checked
  against the GLB, 'times the altar clip %s …'), `i18n.test.ts`.

## Usage
- New stage logic goes in `altarWait.ts` (pure, tested); clip choice stays in `clipFor`.
- Per-frame, pose-dependent decorations toggle refs or DOM attributes in `useFrame`, never
  through props (keeps `React.memo` and avoids per-frame renders), as `data-asleep` does.
- Console command convention (namespace guard, never replace `window.agentOffice`):
  `docs/ai/dungeon-scene.md` Usage. A new command also gets a row in
  `docs/commandes-console.md` (human doc, owned by `otis`).
- Visual check: Vite on a free port bound to 127.0.0.1, inject sessions into the store
  (gallery setup: `docs/ai/dungeon-scene.md` Usage), reach the R3F store through the
  `@react-three_fiber` module `_roots`, set `controls.target` / `camera.position` near
  `agentPositions.get(id)`, then call `agentOffice.autel(stage, id)`. Reload the page after
  editing `altarWait.ts`: HMR leaves the forced-stage bus and the figures in a mixed module
  state and the figures stop following `autel()`.

## Notes
- The turned-back sitting heading is kept on purpose (compared by screenshot): facing the
  altar shows only helmet and cape from the default camera; facing the camera shows the
  face and crossed legs. Keep it.
- `cobweb_C`'s origin is its top corner: the web spans +x and +z and hangs 1.3 m down at
  scale 0.4. The Zzz CSS was checked by eye against the lying pose and still sits beside
  the request bubble on the name tag.
- Accepted limits (not done): a client clock ahead of the server advances stages early;
  ids passed to the command are not validated; the Zzz animation loops forever like
  `request-bob` (stopped by reduced motion); cobwebs are outside the potion sway group;
  below 20 fps the way-down and getting-up timers use the clamped dt, so the walk resumes
  slightly late; a slap during the way down replays it.
