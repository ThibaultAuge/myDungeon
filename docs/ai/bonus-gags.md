---
description: Use when changing the bonus clip gags — subagents cheering when they finish (cheer.ts), the dodge on the 3rd slap of a streak with its "missed" bubble (dodge.ts, SlapEffect dodged), rogue subagents sneaking back to the tavern (sneak.ts), main agents fishing in the moat after a long prompt wait (fishing.ts, FishingRod.tsx, moat spots in Office) — the bonus entries of clipFor's priority order, or the agentOffice.peche console command.
---

# Bonus clip gags (cheer, dodge, sneak, fishing)

User design (French): `plans/plan-clips-bonus-2026-11-15.md`. Human description of the
console command: `docs/commandes-console.md`. Base clip system, slap gag and `Motion`
rules: `docs/ai/dungeon-scene.md`.

## Current State
- `BONUS_CLIPS` (`characters.ts`): `Cheering`, `Dodge_Backward` / `_Left` / `_Right`,
  `Sneaking`, `Fishing_Cast` / `_Idle` / `_Bite` / `_Reeling` / `_Catch`. `ClipInput`
  gains optional `cheering`, `sneaking`, `fishing` (`ClipChoice`); `hit` also accepts a
  `DodgeClip`.
- Full `clipFor` priority order: scripted > spawn > hit/dodge > drinking > cheering >
  sneaking (only while moving) > moving > altar poses > fishing (reduced motion holds
  `Fishing_Idle`) > kneeling > place (work gesture or seated pose, `docs/ai/dungeon-scene.md`)
  > done > working > waiting. A fishing spot id `moat:<rank>` reads as `other` for
  `seatOf`, so no place clip applies at the bank.
- Cheer, subagents only (user decision): `startsCheer(kind, prev, next)` is true for a sub
  going non-done → done while mounted (SubagentStop, silent retirement, ended session);
  never for a main (it turns done at SessionEnd). `AgentFigure` keeps a `prevState` ref; an
  effect sets `Motion.cheerLeft = CHEER_CLIP_TIME` (5/3 s) and the walk to the tavern pauses
  meanwhile. No cheer when doomed, spawning or under reduced motion.
- Dodge, 3rd slap of a streak (user decision): slaps less than `DODGE_STREAK_MS` (2000 ms,
  `performance.now`) apart form a streak, reset after the dodge. Clips rotate Backward →
  Left → Right. The dodge starts at once (hit wait 0), plays no slap sound; `SlapEffect`
  with `dodged` shows no stars and the bubble `t.slap.miss` (fr/de/en). A skipped hit
  (reduced motion or spawning) does not count toward the streak, so "missed" never shows
  over a still figure.
- Sneak (user decision: rogue-looking subagents sneak back to the tavern):
  `sneaks(kind, state, body)` = sub + done + body `Rogue` / `Rogue_Hooded`. `Sneaking` only
  while moving (resting rogues stay still); rate = speed / `SNEAK_CLIP_SPEED` (0.29,
  estimated as half `WALK_CLIP_SPEED` for a cycle twice as long) clamped 0.5…`MAX_CLIP_RATE`;
  speed capped at `SNEAK_SPEED` 1.5 m/s, also under reduced motion.
- Fishing (user decision: a main agent waiting long for a prompt goes fishing in the moat):
  - `wantsToFish(agent, live, now, forced?)` = main + live + waiting + `waitReason`
    prompt + room `taverne` + waited ≥ `FISHING_AFTER_MS` (3 min); `forced` skips only the
    wait.
  - `Office.tsx`: after `useSpots` (result named `seated`), fishers sorted by `since` then
    id get sticky ranks (`assignFishingRanks`, kept in a ref, `MAX_FISHERS` 12) and spots
    `fishingSpot(rank)`: frozen and cached, space `'moat'`, id `moat:<rank>`, facing north,
    x = 5.5 ± (3.2 + 1.5·⌊rank/2⌋) (even east, odd west), z = `MOAT.z1` + 0.35, anchor
    `GATE_SPOT.anchor`. Entry: gate door → bridge far end → lane (5.5, `MOAT.z1` + 1.9)
    south of `PENNANTS` → (x, lane) → seat; tested clear of `PENNANT_CLEARANCE`. Memo keyed
    on `[seated, fishingKey]`; `lastSpots` gets the final map.
  - `AgentFigure`: `fishingAt` counts seconds at the place once `last.current.id ===
    spot.id`; `motion.fishing = fishingClip(t, fishingSeed(id))`: Cast once, then cycle Idle
    (8 + seed % 7 s) → Bite → Reeling 2 s → Catch.
  - Rod: `Character`'s `rod` prop mounts `FishingRod` in the right hand slot, visible only
    while a `Fishing_*` clip plays. Procedural (no KayKit pack in `assets-src` has a rod).
    Grip `[0, 0, -π/4]` measured (hand slot +X forward, +Y up during fishing clips). Line =
    unit cylinder placed in world space from the rod tip down to `WATER_Y`, with a red float,
    drawn only while tip.z < `MOAT.z1`.
  - Called back while walking out past the gate: `fishingReroute` retraces the passed entry
    points (else the layout reroute). Session deleted while seated: `fishingExitLead`
    prefixes `exitRoute` with the lane points back to the bridge axis.
  - Console `agentOffice.peche(id?)`: toggles forcing for the selected or given live main
    agent; `peche(null)` releases all. Installed in `Office` like `autel`; ships in
    production like the other gag commands.

## Relevant Files
- `packages/web/src/scene/cheer.ts`, `dodge.ts`, `sneak.ts`, `fishing.ts` (pure, tested).
- `packages/web/src/scene/FishingRod.tsx`, `characters.ts` (`BONUS_CLIPS`, `clipFor`),
  `AgentFigure.tsx`, `Office.tsx` (fishing ranks and spots, `peche`), `SlapEffect.tsx`.
- `packages/web/src/i18n/{fr,de,en}.ts` (`slap.miss`).
- `packages/web/test/bonus.test.ts`.

## Usage
- The slap reaction channel (`ClipInput.hit`) also carries dodges; reuse it for any other
  slap reaction instead of adding a channel.
- Any new per-figure timed reaction follows `cheerLeft`'s pattern: optional `Motion` field
  counted down in `useFrame`, set by an effect on a state transition.
- Any new outdoor spot gives its entry route clear of `PENNANTS` (test against
  `PENNANT_CLEARANCE`) and handles recall and deletion like `fishingReroute` /
  `fishingExitLead`.
- Preview: Vite from the worktree on a free port (`npx vite --port 5197 --strictPort` in
  `packages/web`), open `/env/demo`, inject sessions with `import('/src/store.ts')` then
  `useOffice.setState({sessions, roster: [], snapshotReceived: true})`. A main with
  `since` = now − 4 min fishes at once; switch a sub to done to see cheer then sneak; call
  `slapAgent` three times less than 2 s apart for the dodge. To catch the bubble, patch
  `setTimeout` for 1500 and set `document.getAnimations()` `currentTime` to 450 then pause.

## Notes
- Dodge clips have root motion (root moves 0.5–0.65 model units and ends displaced): the
  figure jumps aside and springs back over the 0.2 s blend. Accepted.
- Sneak computed foot slide ≈ 2.87× (running ≈ 3.57×). Accepted.
- Fishing accepted limits: a session deleted while its fisher is already walking back (last
  spot no longer the moat) takes `exitRoute`'s straight line and can cross a pennant; a
  moat-to-moat rank change walks straight (ranks are sticky, so it should not happen);
  `passedEntry` relies on routes ending with entry points then the seat.
