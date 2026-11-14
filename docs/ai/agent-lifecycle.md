---
description: Use when changing where agents rest or wait (tavern, altar queue), how agent figures appear, leave or return (subagent tavern cycle, main agents walking in from the forest, the skeleton ambush when a session ends, stopped sessions, ghosts of sessions that never worked, everActive), the agent roster (snapshot.roster, agent definitions, seen types), or when testing the scene with fake hooks.
---

# Agent life cycle: tavern, altar, forest entry, ambush, roster

## Current State
- Design (user-defined, French): `docs/lieux.md`, section "La taverne et le
  cycle de vie d'un agent". The code below implements it.
- Tavern: one neutral figure (`NEUTRAL_COLOR`) per roster type with no agent of that type
  on stage. Resting figures have id `rest:<type>` and are not selectable. They wear their
  type's role look (`lookFor`, `docs/ai/dungeon-scene.md`).
- Call: when a session starts a subagent of a resting type, the new figure starts from that
  resting figure's seat and walks to its post in the session colour. Simultaneous extras
  of the same type start from the lockers (`SPAWN`).
- Return: a finished subagent (`done`) turns neutral, walks back to the tavern and is
  removed from the scene on arrival (`AgentFigure` `onArrive` → `arrived` set in
  `Office`). The type then rests again as one figure, inheriting the seat of the agent that
  came back (`inheritSeats` runs before `assignSpots`). Subagents of a session that just
  ended also walk back. Done figures are opaque.
- Figures of the first snapshot accepted for the current route start in place; later ones
  walk in (`useStarts` in `Office.tsx`, driven by store `snapshotReceived`: false on
  navigate/popstate, true once a snapshot for the route is accepted). Not reset on WebSocket
  reconnect, by decision: agents that appeared during an outage walk in.
- Main agent: waiting for a prompt (Stop, SessionStart, idle notification) rests in the
  tavern. The altar queue is only for `permission`, `question` and `error`
  (`setWaiting` in `reducer.ts`). User decision.
- Stopped sessions (`live: false`, not archived) keep their main agent visible, resting in
  the tavern in the session colour, but NOT selectable: the side panel lists live sessions
  only (accessibility decision: no 3D-only clickable target). Exception: ghosts below.

### Ghosts: stopped sessions that never worked
User design: `plans/plan-fantomes-2026-11-15.md` (French).
- `SessionView.everActive` (shared): desktop sessions start true; a `cli` session becomes
  true on a work hook (`ACTIVITY_EVENTS` in `reducer.ts` `applyHook`: UserPromptSubmit,
  PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, SubagentStart,
  SubagentStop, Stop, StopFailure — NOT SessionStart, SessionEnd, Notification), a busy
  process (`mainFromLiveStatus`), or `LiveProcess.transcript` (`applyInventory`); ORed in
  `absorb`. Never goes back to false.
- `hasTranscript(projectsDir, cwd, cliSessionId)` (`inventory.ts`): one `lstat` per live
  process per tick of `<projects>/<projectDirName(cwd)>/<id>.jsonl`; true only for a
  non-empty regular file; id must match `/^[\w-]{1,128}$/`; `isInside` checked before the
  lstat; no link followed.
- Client rule (`isGhost` in `ghost.ts`): origin `cli` && !live && !archived && !everActive.
  Ghost mains are excluded from `visibleAgents` in `Office.tsx`, so they get no seat, no
  `Stage` departure and no ambush.
- `Ghosts` class (`ghost.ts`, render-time, idempotent, like `Stage.leaving` without the
  ambush): tracks shown ghosts and evaporating ones; clears and shows nothing while
  `snapshotReceived` is false. Ghost list memoised on sessions / `snapshotReceived` /
  `goneCount`; React key `ghost:<sessionId>`. A ghost that comes back to life evaporates
  (`EVAPORATE_MS` 1500, rise `EVAPORATE_RISE` 1.6, ease-out) and the knight reappears at
  its spot.
- Wandering (`GhostFigure.tsx`, state in a ref): starts from the replaced knight's
  `agentPositions.get(bodyId)` if still mounted that render (best effort), else a random
  corridor end (`wanderStart`, `seededRandom` = FNV-1a + mulberry32 seeded by session id).
  Goes straight to the nearest corridor (`nearestOnCorridor`, through walls), then corridor
  end to corridor end (`nextWander`: a `WANDER_POINTS` end ≥ 4 m away via `corridorPath`,
  fallback to all) at `GHOST_SPEED` 0.7 m/s with bob and sway. Reduced motion: snaps once
  to the nearest corridor and stays still; evaporation is instant.
- Figure: procedural, no KayKit model (`docs/ai/dungeon-scene.md` for models): a
  `LatheGeometry` dome with wavy hem and two flattened sphere eyes; geometries shared at
  module scope; a cloned `MeshStandardMaterial` per ghost (transparent, `depthWrite`
  false, `DoubleSide`, emissive tinted by session colour). Raycast disabled, not
  selectable, no disc or ring. Tag `agent-tag agent-tag--ghost` (dashed, italic,
  `styles.css`), `aria-hidden`, hidden while evaporating.
- Accessibility decision (accepted): ghosts are 3D-only like stopped sessions; motion stops
  only through the OS `prefers-reduced-motion`.

### Main agents entering and leaving the castle
User design: `plans/plan-entree-sortie-session-2026-11-14.md` (French). Only MAIN agents
do this; subagents keep the tavern cycle above.
- Bookkeeping: `Stage` (`stage.ts`, pure) compares each snapshot of the route with the
  previous one through `sessionChanges` (`tavern.ts`). The route's first snapshot
  (`snapshotReceived` false → true) makes no arrival and no death. A `cli:X` session
  absorbed into a desktop session whose `cliSessionIds` holds X is neither.
- Arrival: a session that appears later goes into `Stage.fromForest`; its main agent gets
  start origin `'forest'` (`startOrigins`) at `ENTRY_SPOT` (path index `ENTRY_INDEX` 48,
  beyond the pan clamp) and walks the path, drawbridge, `GATE_DOOR`, then the corridor end
  `GATE_SPOT` (5, 9.5) to its spot (`routeFrom`). `GATE_SPOT` is a corridor point, so a
  reroute keeps the forest leg. `Stage.shown` consumes the arrival.
- Departure: a session that leaves the snapshot (deleted, archived, pruned after 60 min,
  evicted past `HISTORY_LIMIT` 30, or missing after a WebSocket reconnect — accepted) puts
  its main agent in `Stage.leaving` (only if it had a spot in the previous render). Its
  figure stays mounted (single children array, same React key) with `exit` = the shared
  `Ambush`, walks out by `exitRoute` (through the gate if inside, along the path if
  already outside: `isOutside` is z > `BOUNDS.z1`) to `killPoint(slot)` (path index
  `KILL_INDEX` 18 + slot × `SLOT_STEP` 3).
- Ambush (`ambush.ts`, pure state machine, `Ambush` class): victim phases
  `walking → waiting → struck → hit → dying → lying → sinking → gone`. At most
  `SKELETON_COUNT` 3 skeletons, split by `assignSkeletons` (a lone victim gets all 3, other
  victims wait). Skeletons rise (`Spawn_Ground`), strike (`Use_Item` looping; the free pack
  has no attack clip), then walk into the nearest near tree within `TREE_REACH` and shrink,
  or burrow (`Spawn_Ground` held backwards + y descent). The body sinks `SINK_DEPTH`, then
  `onGone` → `Stage.gone`. Timings use the measured clip lengths in `characters.ts`.
- React keys: `stage.key(id)` is the id, then `${id}~${n}` after n deaths, so a session that
  reappears while its old figure dies mounts a NEW figure from the forest once the old one
  is gone (`Stage.hidden` holds it back meanwhile). Generations are never cleared, on
  purpose (a reused key would revive a dead figure).
- `Office.tsx` holds `Stage` and `Ambush` in `useState` (not `useMemo`) and runs
  `Stage.update` inside a `useMemo` during render, not an effect, so a departed figure is
  never unmounted for a frame; `update` is idempotent for the same sessions array.
- Doomed figures: no tag, disc, ring or gem; not selectable; `victimClip` gives `Idle_B`
  while `waiting` / `struck`. Skeletons are `SkeletonFigure`s in `Ambush.tsx`, reusing
  `Character` with `SKELETON_LOOKS`; keyed `${i}:${sortie}` so each outing remounts, with
  `scripted` seeded at mount (no standing flash).
- Height outside: `groundY(p)` (`outside.ts`) is 0 inside `OUTER`, a linear slope on the
  drawbridge, `GROUND_Y` beyond; `AgentFigure` and skeletons apply it every frame.
- Reduced motion: a doomed figure is removed at once (also when switched on mid-death) and
  skeletons are hidden.

### Markers, roster, hook boundary
- Waiting markers (`AgentFigure`): an agent waiting for a prompt shows the amber
  octahedron. An agent at the altar (`permission`, `question`, `error`) shows an HTML/SVG
  speech bubble (`RequestBubble`, glyph … / ? / !, fill `#b3261e` for contrast,
  `aria-hidden`) rendered inside the name tag `<Html>` (wrapper class `agent-tag-anchor`,
  name span `agent-tag`). While the figure walks, the destination badge replaces the
  bubble: `docs/ai/dungeon-scene.md`.
- Roster (`snapshot.roster`, `rosterView` in `reducer.ts`): agents defined in
  `~/.claude/agents` and `<env folder>/.claude/agents`, plus types seen at work in that
  environment (`seenTypes`, max 32 per env, kept until server restart), deduped
  case-insensitively, sorted. A definition counts only by its frontmatter `name:` (no
  filename fallback, like Claude Code). Folders are read at most once per 60 s
  (`AgentsCache` type in `inventory.ts`, instance in `index.ts`); a transient read failure
  keeps the previous list. The cache prunes folders no environment uses, except when the
  presets file is unreadable. When a `cli:` session is absorbed into a desktop session,
  `absorb` returns the moved subagents and only those are re-noted in `seenTypes` under the
  desktop session's environment (`applyInventory`).
- Definition reads (`listAgentTypes`): bounded `opendirSync` (1024 entries examined, 64
  `.md` kept, OS listing order); files opened with `O_NOFOLLOW|O_NONBLOCK` where defined
  (both 0 on Windows) and checked with `fstat().isFile()`; `closeSync` failures swallowed.
  `agentNameFromDefinition(text, truncated)` reads a 4096-byte head; an unclosed
  frontmatter is accepted only when the head was truncated, and a truncated head is first
  cut at its last newline (the final line may be partial).
- Hook boundary (`hookEventSchema` / `validOrNull` in `reducer.ts`): `agent_id` must match
  `AGENT_ID` (no `:` nor `#`, so it never collides with client `rest:<type>` or
  `<session>#main` ids); `agent_type` must match `HOOK_AGENT_TYPE` (`AGENT_NAME` plus an
  optional single `:part`, for plugin agents). Absent or JSON null → undefined; present but
  invalid → null, payload still accepted. A null `agent_id` touches no agent
  (`findOrCreateSub` returns `'ignore'`, never falls back to the main agent) but still counts
  as session activity. Agent/Task `subagent_type` passes `HOOK_AGENT_TYPE` before entering
  `pendingSpawns` (missing → `general-purpose`); `noteSeenType` checks again; `summarize`
  maps null → undefined.
- Rendering: resting figures are memoised on a joined-type key and `AgentFigure` is
  wrapped in `React.memo`, so the 1 s clock re-render skips figures while props stay
  stable between snapshots.

## Relevant Files
- `packages/web/src/scene/tavern.ts` — pure, no three.js: `NEUTRAL_COLOR`, `restId`,
  `restingAgent`, `restingTypes`, `startOrigins` (`rest` / `lockers` / `seat` / `forest`),
  `sessionChanges`, `inheritSeats`.
- `packages/web/src/scene/stage.ts` — pure: `Stage` (`update`, `leaving`, `fromForest`,
  `hidden`, `key`, `gone`, `shown`), `Leaving`.
- `packages/web/src/scene/outside.ts` — pure: `PAN_MARGIN`, `groundY`, `PATH`,
  `ENTRY_INDEX`, `KILL_INDEX`, `SLOT_STEP`, `GATE_SPOT`, `ENTRY_SPOT`, `routeFrom`,
  `killIndex`, `killPoint`, `nearestPathIndex`, `isOutside`, `exitRoute`.
- `packages/web/src/scene/ambush.ts` — pure: `Ambush` state machine, `assignSkeletons`,
  `skeletonSpawns`, `nearestTree`, `victimClip`, `victimSink`, `skeletonClip`,
  `skeletonDepth`, `skeletonScale`, timing constants.
- `packages/web/src/scene/Ambush.tsx` — skeleton rendering (`SkeletonFigure`).
- `packages/web/src/scene/ghost.ts` — pure: `isGhost`, `seededRandom`, `WANDER_POINTS`,
  `nearestOnCorridor`, `wanderStart`, `nextWander`, `Ghosts`, evaporation constants.
- `packages/web/src/scene/GhostFigure.tsx` — procedural ghost mesh, wandering, tag.
- `packages/web/src/scene/Office.tsx` — `useStarts`, `arrived` set, memoised resting
  figures, `Stage` / `Ambush` instances, doomed figures in the children array.
- `packages/web/src/scene/AgentFigure.tsx` — `React.memo`; `onArrive` when a done subagent
  reaches its tavern spot; `exit` prop (doomed figure), `groundY` per frame; exports
  `Character` and `Motion` (`Motion.scripted`).
- `packages/web/src/scene/RequestBubble.tsx` — altar speech bubble.
- `packages/web/src/scene/layout.ts` — `wallSeats` / `candidateSeats` (cached per room).
- `packages/web/src/store.ts` — `snapshotReceived`; `packages/shared/src/index.ts` —
  roster in the snapshot.
- `packages/server/src/inventory.ts` — `AGENT_NAME`, `AGENT_ID`, `HOOK_AGENT_TYPE`,
  `agentNameFromDefinition`, `listAgentTypes`, `isRemotePath`, `linkedBelow`,
  `AgentsCache`, `hasTranscript` (uses `paths.ts`: `docs/ai/dialogue.md`).
- `packages/server/src/reducer.ts` — `hookEventSchema`, `validOrNull`, `findOrCreateSub`,
  `pendingSpawns`, `noteSeenType`, `absorb`, `applyInventory`, `seenTypes`, `rosterView`,
  `setWaiting`, `ACTIVITY_EVENTS`, `mainFromLiveStatus` (`everActive`).
- `packages/server/src/store.ts`, `packages/server/src/index.ts`.
- Tests: `packages/web/test/{tavern,layout,stage,outside,ambush,ghost,ghost-fallback}.test.ts`,
  `packages/server/test/{reducer,inventory}.test.ts`.

## Usage
- Put life-cycle logic in `tavern.ts`, `stage.ts`, `outside.ts` or `ambush.ts` (pure,
  tested), never inline in `Office`, `AgentFigure` or `Ambush.tsx`. Any new route outside
  the castle goes through `routeFrom` / `exitRoute`; any figure standing outside applies
  `groundY`. A new scripted creature reuses `Character` with a `Look` and `Motion.scripted`
  (clip packs and `ClipInput.scripted`: `docs/ai/dungeon-scene.md`).
- Watching an ambush in a store-injected gallery (general preview setup:
  `docs/ai/dungeon-scene.md`, Usage): remove a session from `sessions` after a first
  snapshot; at headless 1–2 fps the walk out takes minutes. Read `agentPositions` from the
  `AgentFigure.tsx` URL found in `performance.getEntriesByType('resource')` (after HMR the
  modules carry `?t=`, so a plain `import('/src/scene/AgentFigure.tsx')` gives a different
  map). Pan with synthetic right-button pointer events to see the kill point (z ≈ 23–30).
- Reuse `setWaiting` for any new waiting reason, and keep the tavern/altar split above.
- Test the scene without real sessions: the server only accepts the Vite origin on port
  5173, so from a worktree build the web client and run a second server on another port
  (`AGENT_OFFICE_PORT` and `AGENT_OFFICE_TOKEN` env), then POST fake hook events to
  `/hooks` with header `x-agent-office-token`. Without `AGENT_OFFICE_TOKEN`, the server reads
  the token from `relay.env` (`config.ts`). Fake sessions with no live process are ended by
  the inventory after about 30 s, so screenshot quickly. A hidden Browser pane renders no
  frames, so figures do not move there: keep it shown. Ghosts: a fake session with only
  `SessionStart` becomes a ghost once the inventory ends it; add `UserPromptSubmit` and it
  stays a knight. Fake-hook sessions may land in the "hors-environnement" group. A real
  pre-warmed, idle desktop-launched process with no transcript also shows as a ghost.
- Ghost logic goes in `ghost.ts` (pure, tested); reuse `isGhost` wherever a stopped main
  must be told apart, and reuse `corridorPath` for any new corridor wandering.

## Notes
- A 3D altar bubble was tried and rejected: the HTML tags and room signs are drawn over the
  canvas and hid it. Keep the request bubble in the tag `<Html>`.
- Security, keep all:
  - `agentNameFromDefinition` must not run a backtracking regex on the `name:` value (a
    former regex took 31 s on a crafted 4 KB line; a time-bounded test guards it).
  - Hook agent types are validated (`HOOK_AGENT_TYPE`) before reaching `seenTypes`, which is
    broadcast to every client, and before `pendingSpawns`. Hook `agent_id` must keep
    excluding `:` and `#` (`AGENT_ID`) so it cannot impersonate `rest:` or `#main` ids.
  - `hasTranscript` keeps the id regex, `isInside` before `lstat`, and never follows links.
    Accepted (informational): intermediate components (`projects/<seg>`) are not
    junction-checked, same posture as the dialogue route; `~/.claude/projects` is trusted
    as a same-user location.
  - Agent folder reads skip UNC/device paths (`isRemotePath`; `\\?\C:\` stays local) and,
    for environment folders, refuse `.claude` or `.claude/agents` when either is a
    symlink/junction (`linkedBelow`, lstat only, never resolves the target: a repo link to
    `\\host\share` would leak NTLM credentials). Keep reads bounded and non-following.
- Shared read-only seats: `wallSeats` / `candidateSeats` are cached per static room in a
  WeakMap (candidates keyed by station, never by the server-provided type) and return
  shared arrays. Never mutate them or their seat objects.
- Keep `AgentFigure` props stable between snapshots when adding any, or `React.memo` stops
  skipping the clock re-render.
- Known follow-ups, not done: seat memory mutated during render; start origin computed only
  in the first render; per-figure `<Html>` cost; request bubbles of queued altar agents
  overlap under the near-vertical camera.
- Known limits: mapped network drives (`Z:\`) are still read synchronously (only the user's
  own presets point there); subagent ids are unique per session only, so `agentHookAt` and
  React keys could clash across sessions with a crafted payload; above the 64-file cap the
  kept definitions depend on OS listing order.
- Accepted limits of the ambush: with many simultaneous deaths, kill slots past the path
  end stack there and go beyond the pan limit; a skeleton walks to its tree in a straight
  line; after a server restart, a reconnect may kill sessions missing from the first
  snapshot.
