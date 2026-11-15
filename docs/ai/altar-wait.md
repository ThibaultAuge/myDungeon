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
  `sleeping`; clip priority list: `docs/ai/dungeon-scene.md`):
  - pacing: `Walking_A` at `PACE_CLIP_RATE` 0.6; sideways ±`PACE_AMPLITUDE` 0.35 m along
    `paceAxis(facing)`, sine of period `PACE_PERIOD` 4 s, phase offset `paceSeed(id)`
    (FNV-1a) so a queue does not walk in step. The offset (`paceShift`, eased with
    `approach`) moves the drawn group only, never `pos`, so walking and reroutes ignore it.
    Pacing replaces kneeling.
  - sitting: `SIT_CLIP` `Death_B` held at `SIT_POSE_TIME` 1.1 (on its knees, upright); the
    figure turns its back to the altar (`altarHeading`: facing + π), toward the default
    camera.
  - sleeping: `SLEEP_CLIP` `Death_A_Pose` (lying) plus the "Zzz" bubble `SnoreBubble` in
    the name tag `<Html>` (text `t.altarWait.snore`, CSS `.snore*`).
  - webbed: sleeping plus `AltarCobwebs`: two `mixed2` `cobweb_C` via `<Kit>` tented over the
    body (positions calibrated by eye).
- Follows the pose actually shown: `AgentFigure`'s `useFrame` sets `data-asleep` on the tag
  anchor (CSS hides `.snore` otherwise) and the cobweb group's `visible`, so neither shows
  while walking or standing up for a slap or potion gulp. A slap or a gulp freezes pacing
  (heading and shift).
- Reduced motion: pacing falls back to calm (head of the queue kneels); sit / sleep poses
  and cobwebs stay; Zzz is static (second Z hidden).
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
  `parseStageArg`, `installAltarCommand`.
- `packages/web/src/scene/characters.ts` — `AltarPose`, `ClipInput.altar`, `SIT_CLIP`,
  `SIT_POSE_TIME`, `SLEEP_CLIP`, `PACE_CLIP_RATE`.
- `packages/web/src/scene/AgentFigure.tsx` — pacing shift / heading, per-frame
  `data-asleep` and cobweb visibility.
- `packages/web/src/scene/Office.tsx` — stage per agent, command install.
- `packages/web/src/scene/SnoreBubble.tsx`, `scene/AltarCobwebs.tsx`; `.snore*` in
  `packages/web/src/styles.css`; `altarWait.snore` in the i18n dictionaries.
- Tests: `packages/web/test/altarWait.test.ts`, `characters.test.ts`, `dungeon.test.ts`,
  `i18n.test.ts`.

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
  `agentPositions.get(id)`, then call `agentOffice.autel(stage, id)`.

## Notes
- The free KayKit pack has no sit clip; a forward slump read as kneeling seen from behind,
  hence `Death_B` upright and the turned back. Keep it.
- Accepted limits (not done): a client clock ahead of the server advances stages early;
  ids passed to the command are not validated; the Zzz animation loops forever like
  `request-bob` (stopped by reduced motion); cobwebs are outside the potion sway group.
