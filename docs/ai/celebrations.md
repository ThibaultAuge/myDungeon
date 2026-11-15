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
  `heraldClip` (`Spawn_Ground`, `Use_Item`, `Spawn_Ground` held backwards), `heraldDepth`;
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
  `packages/web/test/gagCommands.test.ts`, `packages/web/test/dungeon.test.ts`.
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
  commands. Keep the Browser pane shown, or use headless Playwright.

## Notes
- Security, keep: no backtracking regex on quote runs (a former quadratic unquote was
  removed); inputs capped (4 KB command, 64 KB output); `FAILURE` stays linear.
- Accepted limits: `<<` inside quotes or arithmetic, `<<\EOF`, a second heredoc on one line,
  a heredoc message over 4 KB hiding a following push, dotnet's failure summary not
  recognised.
- ACCEPTED RISK (user decision 2026-11-15): the accessibility audit kept a 🔴 on WCAG 2.3.1
  for the fireworks (opposing-luminance pair count per burst; no flash-analyser measurement
  possible). The user chose to accept it. The success signal is visual-only (events stay
  listed as text on `/debug`), like the ambush and ghost decisions. Do not reopen without a
  new user request.
