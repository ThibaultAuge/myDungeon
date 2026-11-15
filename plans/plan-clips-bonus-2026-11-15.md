# Implementation Plan — Bonus clips: cheer, dodge, sneak, fishing

*Generated on 2026-11-15. Copied to `plans/plan-clips-bonus-2026-11-15.md` once approved.*

## Context

Branch `claude/clips-bonus-60a28a`, cut from the clip groundwork (`claude/clips-socle-a44e7d`,
commit 2e0ad27), which imported KayKit Character Animations 1.1. Four other sessions are
working in parallel on the altar, ambush, heralds and work gestures. This branch owns
`BONUS_CLIPS` only. Merges come later, so edits to shared code stay small and local:
new lines in `BONUS_CLIPS`, new optional fields, and new lines in `clipFor` for this
theme's branches only. Nothing in shared code is reordered or reformatted.

User decisions (AskUserQuestion, this session):
- Dodge: the **3rd slap of a streak** is dodged (slaps less than 2 s apart). The streak
  then starts again from zero. On a dodge the hand sweeps through empty air: no slap
  sound, no stars, a "Raté !" bubble (FR/DE/EN).
- Sneaking: **Rogue-looking subagents (Rogue, Rogue_Hooded) sneak back to the tavern**
  once they are done.
- Fishing: **a main agent that has waited for a prompt in the tavern for a long time**
  walks out to the moat and fishes. It comes back as soon as it has work.
- Cheering (from the brief): play `Cheering` once when an agent turns `done`. Reduced
  motion: no cheer.

## Business Objective

Four more humorous, purely visual gags that make the dungeon livelier. They have no effect
on agents and send nothing to the server.

## Requirements Summary

### Functional Requirements
1. **Cheer.** When a figure's agent changes from `working`/`waiting` to `done` while the
   figure is mounted, the figure plays `Cheering` once (1.67 s) where it stands, with its
   walk paused, then sets off to the tavern as today. A figure mounted already `done`
   (tavern resting figures, the first snapshot) does not cheer. Doomed figures (`exit`) and
   figures still spawning do not cheer. Under reduced motion there is no cheer and no pause.
2. **Dodge.** Each figure keeps a slap streak. A slap less than `DODGE_STREAK_MS` (2000 ms)
   after the previous one extends the streak, and an older one starts a new streak at 1.
   The 3rd slap of a streak is dodged, then the streak resets to 0. Dodge clips rotate
   `Dodge_Backward` → `Dodge_Left` → `Dodge_Right` per dodge. A dodge starts at once (the
   0.4 s clip is under way when the hand passes at `SWING_IMPACT` 0.12 s). The hand sweep
   is unchanged. There is no `playSlapSound`, and `SlapEffect` gets `dodged`: no stars, and
   the bubble shows `t.slap.miss`. Hits keep their current timing exactly (hand → impact →
   hit clip + sound at 0.12 s, stars).
3. **Sneak.** A subagent whose look's body is `Rogue` or `Rogue_Hooded` and whose state is
   `done` plays `Sneaking` while it walks (instead of `Walking_A`/`Running_A`), and its
   speed is capped at `SNEAK_SPEED` (3 m/s instead of the 9 m/s cruise speed), so it
   visibly creeps. Under reduced motion it gets the usual still pose, but the speed cap
   still applies, because position is information.
4. **Fishing.** A main agent of a live session in state `waiting`, `waitReason: 'prompt'`,
   room `taverne`, waiting for at least `FISHING_AFTER_MS` (3 min, measured from `since`),
   gets a fishing spot on the moat's south bank instead of its tavern seat. It walks out
   through the gate and over the drawbridge, and once at the bank it loops `Fishing_Cast`
   once, then cycles Idle (seeded 8–14 s) → Bite → Reeling (2 s) → Catch → Idle. It holds a
   procedural rod (no pack has one), whose line hangs from the tip down to the water with a
   small float. Any state change (new prompt) changes its spot, and it walks back in.
   Under reduced motion it holds `Fishing_Idle`. Console command
   `agentOffice.peche(id?)` forces or releases fishing for the selected main agent (demo
   and screenshots), following the `agentOffice.autel` pattern.

### Non-Functional Requirements
- **Performance:** no new per-frame allocations. The rod and line are shared module-scope
  geometries/materials, and the rod is mounted only while fishing. The added clip files
  are `Rig_Medium_Simulation` (Cheering), `Rig_Medium_MovementAdvanced` (Dodge, Sneaking)
  and `Rig_Medium_Tools` (Fishing). They load automatically through `ANIM_FILES_USED`.
- **Security:** none (client-only, no input crosses a trust boundary, and the console
  command validates its argument like `autel`).
- **UX/UI:** new display string `t.slap.miss` in FR ("Raté !"), DE ("Daneben!") and EN
  ("Missed!"). The bubble is decorative and `aria-hidden` like the slap bubble.

### Out of Scope
- `Crouching`, `Dodge_Forward`, `Fishing_Struggling`/`Fishing_Tug`.
- Fishing for subagents or resting types, catching visible fish, sound.
- Altar, ambush, herald and per-room work clips (other sessions).

### Success Criteria
- `npm test` and `npm run typecheck` pass, with new tests for the dodge rule, the cheer
  trigger, the fishing schedule/spots/eligibility, the new `clipFor` branches and the
  measured clip lengths.
- One browser screenshot per item: cheering figure, dodge with the "Raté !" bubble,
  sneaking Rogue, knight fishing at the moat.

## Assumptions
- Main agents only become `done` at session creation (`reducer.ts:252`), so in practice
  the cheer is for subagents. Checked in `reducer.ts`.
- The Sneaking stride is close to Walking_A's at half the cadence (2.133 s vs 1.067 s
  cycle), so `SNEAK_CLIP_SPEED ≈ WALK_CLIP_SPEED / 2 = 0.29`. To be calibrated by eye in
  the screenshot. A foot slide at 3 m/s is accepted, as the walk already slides at cruise.
- The default camera shows the south bank (the moat is on the camera side). To be checked
  in the screenshot.
- Every main body (Knight) has an empty right hand, so the rod hides no prop.

## Technical Approach

### Architecture
New pure modules (no three.js, tested in node):
- `scene/dodge.ts`: `DODGE_STREAK_MS`, `DODGE_CLIPS`, `type DodgeClip`,
  `nextSlapStreak(prev: { count; at }, now) → { count, at, dodge: boolean }`, and
  `dodgeClipFor(n)`.
- `scene/cheer.ts`: `CHEER_CLIP_TIME` (1.67), and `startsCheer(prev: AgentState | null,
  next: AgentState)`, which is true only for a non-done → done change.
- `scene/sneak.ts`: `SNEAK_BODIES`, `SNEAK_SPEED` 3, `SNEAK_CLIP_SPEED`, and
  `sneaks(kind, state, body)`.
- `scene/fishing.ts`: `FISHING_AFTER_MS`, `FISHING_SPACE = 'moat'`,
  `wantsToFish(agent, live, now)`, `fishingSpot(rank)` (frozen and cached per rank, so it is
  stable for `memo` and the `[spot]` effect; ranks alternate east/west of the drawbridge at
  1.5 m steps on z = `MOAT.z1 + 0.45`, facing north; anchor `GATE_SPOT.anchor`; entry =
  gate door → drawbridge far end → bank row point), `fishingClip(t, seed): ClipChoice`
  (O(1) with a fixed per-agent cycle), the measured fishing clip times, and the force
  registry with `installFishingCommand(window, deps)` registered on `gagCommands`.

Shared-code touches (small, additive):
- `characters.ts`: new lines in `BONUS_CLIPS` (Cheering, Dodge_Backward, Dodge_Left,
  Dodge_Right, Sneaking, Fishing_Cast, Fishing_Idle, Fishing_Bite, Fishing_Reeling,
  Fishing_Catch). `ClipInput` gains the optional fields `cheering?`, `sneaking?` and
  `fishing?: ClipChoice`, and `hit`'s type widens to `'Hit_A' | 'Hit_B' | DodgeClip`. In
  `clipFor`, three new lines, each in place: cheering after `drinking`
  (`play('Cheering', 1, false)`, not under reduced motion); sneaking just before
  `if (moving)` (`play('Sneaking', clamp(speed / SNEAK_CLIP_SPEED, 0.5, MAX_CLIP_RATE))`,
  not under reduced motion); fishing after the altar lines (`reducedMotion ?
  hold('Fishing_Idle') : fishing`). The existing lines stay untouched.
- `AgentFigure.tsx`: `Motion.hit` widened, plus optional `cheerLeft?` and `fishingAt?`.
  - Cheer: a `prevState` ref plus an effect on `agent.state` sets `cheerLeft` (fallback, then
    the real duration set by `Character` as for hits). The walk pauses while it is above 0.
  - Slap listener: keeps a streak ref, calls `nextSlapStreak`, picks `dodgeClipFor` or
    `hitClipFor`, sets `hitWait = 0` for a dodge, skips `playSlapSound` on a dodge, and
    stores `dodged` in the slap state for `SlapEffect`.
  - Sneak: when `sneaks(...)`, caps `m.speed` at `SNEAK_SPEED` and passes `sneaking`.
  - Fishing: `fishingAt` counts seconds at the place when `spot.space === FISHING_SPACE`
    (reset to -1 otherwise), and the figure passes `rod` to `Character`.
  - `Character` gets optional `rod?: boolean`, mounts `<FishingRod>` in the right hand, and
    shows it only while the current clip is a `Fishing_*` one.
- `scene/FishingRod.tsx` (new): a tapered cylinder rod, plus a line (a unit cylinder scaled
  each frame from the rod tip's world position down to `WATER_Y`) and a float sphere. The
  geometries and materials live at module scope.
- `SlapEffect.tsx`: optional `dodged` prop.
- `Office.tsx`: after `useSpots`, a `useMemo` keyed on the fishing ids overrides the spots
  of the agents that `wantsToFish` (or are forced) with `fishingSpot(rank)`, ranked by
  `since` then id. It also installs the `peche` command (an effect, like `autel`) and
  subscribes to the force version.
- i18n `fr.ts` / `de.ts` / `en.ts`: `slap.miss`.

### Files to Create/Modify
1. `packages/web/src/scene/dodge.ts`, `cheer.ts`, `sneak.ts`, `fishing.ts` — new, pure.
2. `packages/web/src/scene/FishingRod.tsx` — new.
3. `packages/web/src/scene/characters.ts` — `BONUS_CLIPS`, `ClipInput`, three `clipFor` lines.
4. `packages/web/src/scene/AgentFigure.tsx` — Motion fields, cheer/dodge/sneak/fishing wiring.
5. `packages/web/src/scene/SlapEffect.tsx`, `Office.tsx`, `i18n/{fr,de,en}.ts`.
6. Tests: `packages/web/test/bonus.test.ts` (new: dodge, cheer, sneak, fishing, clipFor
   branches, GLB clip lengths with the `dungeon.test.ts` helper pattern copied locally), and
   the existing i18n key-parity test covers `slap.miss`.
7. Docs (Wave 3): `docs/ai/dungeon-scene.md` (Clips bullet, slap), `agent-lifecycle.md`
   (cheer, sneak, fishing), `night-forest.md` (fishing spots on the bank) via `curator`;
   `docs/commandes-console.md` (`agentOffice.peche`) via `otis`.

## Work Breakdown

Single lot — main session.

## Alternatives Considered
- **Fishing as a scripted clip (`ClipInput.scripted`)** — rejected: `scripted` beats the
  slap and is the ambush's channel, which another session is editing.
- **A fishing rod from a pack** — none exists in any of the downloaded KayKit packs
  (searched `assets-src`). Using the `staff` prop as the rod would read as a mage's staff.
- **Random dodge (1 in 4)** — the user chose the deterministic streak rule.
- **Sneaking at full cruise speed** — 9 m/s is 31× the clip's foot speed, which looks broken.

## Edge Cases & Error Handling
- A slap during a cheer: the hit has priority (it is above cheering in `clipFor`), and the
  cheer timer keeps running.
- A fishing agent rerouted while still walking out on the bridge first finishes to its
  entry point, then turns back. This is the same accepted behaviour as `reroute` from a
  room's entry.
- Several long-waiting main agents: distinct ranks along the bank (cap of 12, then they
  stay in the tavern).
- `agentOffice.peche` on a subagent or an unknown id: refused with a console message.
- A figure that remounts (Suspense): the prevState ref initialises to the current state, so
  there is no spurious cheer.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Merge conflicts in `clipFor`/`ClipInput`/`AgentFigure` with the sibling branches | medium | manual merge | additive lines only, logic in own modules |
| Rod grip orientation wrong | medium | odd-looking rod | calibrate by eye in the screenshot, like `PROP_GRIP` |
| Fishing spot hidden by trees or the sign | low | gag not visible | `MOAT_CLEARANCE` already keeps trees off; check the screenshot |

## Reversibility & Rollback
- **Hard-to-undo decisions:** none (client-only, no data format change).
- **Rollback:** revert the commit.

## Complexity Estimate

**Size:** L (raised from M, following grumpy's point and "when in doubt, estimate higher")

**Justification:** four features across several components, a new outdoor spot and
route, a procedural prop with a world-space line, and a console command.

## Amendments after the plan challenge (they override the sections above)

- **Cheer: subagents only** (user answer). `startsCheer(kind, prev, next)` is true only for
  `kind === 'sub'` and a non-done → done change. This covers SubagentStop, the silent
  retirement, and the subagents of a session that ended. The knight never cheers. The
  Assumption about main agents was wrong: `markSessionDone` sets the main agent `done`
  too (`reducer.ts:225-229`).
- **Sneak guard:** the `clipFor` line is `if (sneaking && moving && !reducedMotion)`, with
  a test showing that a sneaking figure that is not moving gets the done pose (resting
  Rogues stay still). `SNEAK_SPEED` drops to **1.5 m/s**. The Sneaking foot speed, at most
  about 0.29 × 1.8 ≈ 0.52, would slide about 3×, under today's run slide (about 3.6×).
  `turing` computes these figures during implementation, and the value is tuned by eye.
- **Fishing layout:** ranks sit at x = 5.5 ± (3.2 + 1.5·⌊rank/2⌋) (even ranks east, odd
  ranks west), seat z = `MOAT.z1 + 0.35`, facing north (towards the water: the back is to
  the default camera, accepted, and the rod and line show over the head). Entry: gate door
  → bridge far end → (5.5, `MOAT.z1 + 1.9`), south of the pennants → (x, `MOAT.z1 + 1.9`)
  → seat. A test checks that every seat and entry leg stays at least `PENNANT_CLEARANCE`
  from `PENNANTS`. The line is drawn only while the rod tip is over the water
  (`tip.z < MOAT.z1`), from the tip down to `WATER_Y`, with the float on the water. It is
  hidden otherwise (during the cast's back-swing). At most 12 ranks.
- **Office override:** `useMemo` keyed on `[spots, fishingKey]`, returning a new map that
  copies `spots` and overrides the fishers. `lastSpots.current` gets this final map.
  Ranks are sticky: a `useRef<Map<id, rank>>` frees a rank only when its agent stops
  fishing, and a new fisher takes the lowest free rank.
- **Root motion:** measured in the GLB. Dodge root moves 0.50–0.65 (model units) and ends
  displaced, so the figure jumps aside and springs back over the 0.2 s blend. That reads as
  a dodge-and-recover, accepted, to be checked in the screenshot. Sneaking and Cheering
  have no root motion. The local GLB test records these facts (Sneaking/Cheering root
  constant).
- **Dodge when the hit is skipped:** under reduced motion or while spawning, the slap does
  not count toward the streak, and it always shows as today's hit (sound, bubble, no clip).
  There is never a "Raté !" over a figure that did not move.
- **Docs:** `otis` also updates `docs/utilisation.md` (the slap dodge, cheering, sneaking,
  fishing).
- **Strongest alternative (split fishing into its own branch)** — rejected: the user asked
  for all four on this branch. The Office edit stays one memo plus one effect, to keep
  conflicts small.

## Objections Considered

| Objection | Severity | Resolution |
|---|---|---|
| Main agents also become `done` at SessionEnd | 🔴 | accepted — subagents only (user answer), assumption fixed |
| Sneak branch not limited to moving | 🔴 | accepted — `moving` guard and test |
| Fishing row through the pennants, line into the bank | 🟡 | accepted — explicit offsets, south waypoint, clearance test, line only over water |
| Sneak slide worse than the run | 🟡 | accepted — `SNEAK_SPEED` 1.5 |
| Root motion unchecked | 🟡 | accepted — measured; dodge spring-back accepted, checked visually |
| Office override under-specified | 🟡 | accepted — deps, `lastSpots`, sticky ranks |
| Reduced-motion dodge, `utilisation.md`, size | 🔵 | accepted — no streak when the hit is skipped, doc added, size L |

**Verdict:** SOUND WITH RESERVATIONS (1 run; the Technical Approach was not changed, only made more precise).
