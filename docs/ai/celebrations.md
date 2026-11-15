---
description: Use when changing the celebration gag — heralds trumpeting from the corner towers on git commit/push, fireworks when tests pass — its server-side command classification (celebration.ts, HookEventSummary.celebrations), the corner towers (Towers.tsx, TOWERS), or the agentOffice.heraut / feuArtifice console commands.
---

# Celebrations: heralds and fireworks

## Current State
User request: a purely visual gag, no other effect. A successful `git commit` / `git push`
sends a herald up a corner tower to blow a trumpet; a passing test run fires fireworks above
the castle.

### Server classification
- `celebrationsFor(ev)` (`celebration.ts`, pure) looks only at `PostToolUse` (never
  `PostToolUseFailure`) of tool `Bash` / `PowerShell`. Command cut to 4 KB, then heredoc
  bodies removed (`dropHeredocs`; the `HEREDOC` regex excludes `<<<`), then quoted strings
  (`dropQuoted`), then split on `&& || ; | & ( ) { }`, backticks and newlines
  (`commandSegments`); launchers and `VAR=` prefixes dropped.
- `gitAction(segment)` → `'commit' | 'push'` (push wins when both; dry runs ignored).
- `isTestSegment` / `isTestCommand`: npm/pnpm/yarn/bun `test|t|test:*`, vitest/jest without
  watch, `playwright test`, `pytest`, `python -m pytest`, `mvn test|verify`,
  `gradle test|check`, `cargo|go|dotnet test`, `node --test` → `'tests'`, unless the last
  64 KB of `tool_response` stdout/stderr/output matches `FAILURE` (linear regex) or
  `tool_response.interrupted === true`. `isTestCommand` is exported for other gags.
- `summarize()` (`reducer.ts`) adds `celebrations?: Celebration[]` to `HookEventSummary`;
  shared type `Celebration = 'commit' | 'push' | 'tests'`. The command text is never sent.

### Client
- `store.ts` calls `celebrate(kind)` for each `event.celebrations` entry when
  `(event.envId ?? NO_ENV_ID) === route.envId`. Live events only (not replayed on
  reconnect).
- `celebrate.ts` (pure): bus `celebrate` / `onCelebrate`; herald timing `heraldPhase`
  (`rising → trumpeting → sinking → gone`, `TRUMPET_TIME` commit 2.4 s / push 6 s),
  `heraldClip` / `heraldCheerAt` (see Heralds below), `heraldDepth`;
  `TowerPool.claim(random, preferred)` (one herald per tower, standing towers first);
  fireworks `fireworkBursts`, `SPARK_DIRECTIONS`, `rocketAt`, `sparkAt`, `stillAlpha`,
  `FIREWORKS_TIME` (derived, about 4.3 s).
- Towers (`Towers.tsx`, geometry in `dungeon.ts` `TOWERS`): four small corner towers,
  centre `TOWER_OFFSET` 0.2 outside each `OUTER` corner, `TOWER_R` 0.8, `TOWER_H` 3.8,
  `TOWER_BASE` −1.2; cutaway anchor = the `PERIMETER_LINE` corner (same as the corner
  pillar), facing toward the courtyard. One merged geometry per tower (`mergeGeometries`),
  wearing the shared KayKit dungeon `'wall'` material (`useKitParts`, never mutated) with UVs
  pointed at a stone band of the palette texture (`STONE_U` 0.115, V gradient) so they match
  the walls. They sink with the cutaway through `cutHeight` (`docs/ai/dungeon-scene.md`).
  Module-global `towerHeights` (reset to 1 on unmount) is read by the heralds.
- Heralds (`Herald.tsx`, `Heralds` / `HeraldFigure`): reuse `Character` + `Motion.scripted`
  like `SkeletonFigure`; body `Rogue`; procedural brass trumpet in bone `handslotr`
  (`TRUMPET_GRIP`); red pennant for a push; drei `<Html>` notes ♪ (`.herald-notes` in
  `styles.css`, `aria-hidden`). Hidden below tower height 0.35 (notes too).
- Herald gestures, `heraldClip(phase, t, kind = 'commit', cheerAt = null)`: rising =
  `Spawn_Ground` once; trumpeting = `TRUMPET_CLIP` (`Ranged_Magic_Raise`) played once and held
  on its last frame, fist at the chin (`Use_Item` held the trumpet out to the side,
  `Holding_*` at the belt). A commit's 2.4 s call is one block; a push's 6 s fanfare is cut
  fanfare / `Waving` (one cycle, `WAVING_CLIP_TIME` 2.1333) / fanfare, `PUSH_FANFARE_PART`
  derived. Sinking = `Spawn_Ground` held backwards.
- Cheer: each `HeraldFigure` subscribes to `'tests'`; the first one of its outing sets
  `cheerAt = heraldCheerAt(phase, t)` (rising → negative, trumpeting → `t`, sinking/gone →
  null) and the herald plays `Cheering` once (`CHEERING_CLIP_TIME` 5/3) from
  `max(0, cheerAt)`, then the trumpet comes back. A cheer overlapping the wave window ends the
  wave: the mixer restarts a faded-out clip from frame 0, so a resumed wave would be a cut-off
  fragment.
- Notes ♪ show only while the clip is `TRUMPET_CLIP` (not during wave or cheer). Under
  reduced motion `clipFor` still holds `Idle_A`; the notes keep following the `heraldClip`
  timeline.
- `TRUMPET_GRIP` rotation `[0, 0, π/12]`, calibrated on the held last frame of the raise:
  bell about 83° up, slightly toward the courtyard. Aimed toward the courtyard, it points at
  the default camera and shrinks to a stub.
- The trumpet cleanup effect also clears the `attached` ref: StrictMode's dev mount cleanup
  can run after the first frame attached the trumpet, and without the reset it never came
  back.
- `HERALD_CLIPS` (`characters.ts`) = `Ranged_Magic_Raise`, `Waving`, `Cheering`; it makes
  every figure load `Rig_Medium_CombatRanged` (~1.0 MB) and `Rig_Medium_Simulation`
  (~0.86 MB).
- Fireworks (`Fireworks.tsx`): one additive `Points` per show (`toneMapped` false, canvas
  dot texture), placed behind the castle middle so they show in the sky of the default view.
  A show runs to its end; `'tests'` triggers during a show are ignored.
- Flash-safety design (WCAG 2.3.1 attempt): burst openings ≥ 0.4 s apart (`BURST_SPACING`
  0.5, `DELAY_JITTER` 0.1), `SPARK_RAMP` 0.25 s, rockets brighten over `ROCKET_RISE` and fade
  over `ROCKET_FADE`. Reduced motion: a still bouquet faded in/out (`STILL_PEAK` 0.6) for
  2 s.
- Console commands: `installCelebrationCommands(window)` from `main.tsx` adds
  `agentOffice.heraut('commit' | 'push')` and `agentOffice.feuArtifice()`, production
  included. Namespace helper `gagCommands`: `docs/ai/dungeon-scene.md` (Usage).

## Relevant Files
- `packages/server/src/celebration.ts`, `packages/server/src/reducer.ts` (`summarize`),
  `packages/shared/src/index.ts` (`Celebration`, `HookEventSummary.celebrations`).
- `packages/web/src/scene/celebrate.ts`, `Towers.tsx`, `Herald.tsx`, `Fireworks.tsx`,
  `dungeon.ts` (`TOWERS`, `TOWER_*`, `cutHeight`), `Office.tsx` (mounts `Towers`, `Heralds`,
  `Fireworks`), `packages/web/src/store.ts`, `packages/web/src/main.tsx`,
  `packages/web/src/styles.css` (`.herald-notes`).
- Tests: `packages/server/test/celebration.test.ts`, `packages/web/test/celebrate.test.ts`,
  `packages/web/test/gagCommands.test.ts`, `packages/web/test/dungeon.test.ts`,
  `packages/web/test/heraldClips.test.ts` (checks `CHEERING_CLIP_TIME` / `WAVING_CLIP_TIME`
  and the presence of `TRUMPET_CLIP` against the GLB; kept out of the shared `dungeon.test.ts`
  list).
- Human console command list: [docs/commandes-console.md](../commandes-console.md).

## Usage
- New celebration kind: classify on the server in `celebration.ts` (pure, tested), extend
  `Celebration`, then subscribe with `onCelebrate`. Never send command text to the client.
- A scene-wide (not per-agent) reaction to a hook reuses this server-classified path; a
  per-agent one follows `potion.ts` / `MishapWatcher` (`docs/ai/dungeon-scene.md`).
- Reuse the server `isTestCommand` for test-run detection on the server. The client mishap
  gag has its own `isTestCommand` in `mishap.ts` (separate implementation).
- Timing, pool and firework math go in `celebrate.ts`; the `.tsx` files only render.
- Preview: second server on another port with fake `PostToolUse` hooks (`git commit`,
  `git push`, `npm test`; setup in `docs/ai/agent-lifecycle.md`, Usage) or the console
  commands. A hidden Browser pane renders no frames: use headless Playwright. The server
  only accepts the Vite origin on port 5173.
- Herald close-ups: the cutaway lowers a tower whose ground anchor projects below the
  pointer (`inForeground`), so keep the default camera position, move the pointer to the
  canvas bottom edge, and narrow the FOV onto a back tower (e.g. target (23.7, 3.2, −13.7),
  fov 8) through the R3F store found in the fiber dep's `_roots`. Import that dep by its full
  `http://127.0.0.1:5173/...` URL taken from performance entries; a path-only import yields a
  separate module instance with empty `_roots`.
- A new herald gesture: add the clip to `HERALD_CLIPS`, choose it in `trumpetingClip`
  (`celebrate.ts`), and add its length to `heraldClips.test.ts` if the timing depends on it.

## Notes
- Security, keep: no backtracking regex on quote runs (a former quadratic unquote was
  removed); inputs capped (4 KB command, 64 KB output); `FAILURE` stays linear.
- Accepted limits: `<<` inside quotes or arithmetic, `<<\EOF`, a second heredoc on one line,
  a heredoc message over 4 KB hiding a following push, dotnet's failure summary not
  recognised. The herald cheers at the first `'tests'` of his outing even when `Fireworks`
  ignores it because a show is already running.
- ACCEPTED RISK (user decision 2026-11-15): the accessibility audit kept a 🔴 on WCAG 2.3.1
  for the fireworks (opposing-luminance pair count per burst; no flash-analyser measurement
  possible). The user chose to accept it. The success signal is visual-only (events stay
  listed as text on `/debug`), like the ambush and ghost decisions. Do not reopen without a
  new user request.
