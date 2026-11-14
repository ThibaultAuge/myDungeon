---
description: Use when changing where agents rest or wait (tavern, altar queue), how subagent figures appear, leave or return, the agent roster (snapshot.roster, agent definitions, seen types), or when testing the scene with fake hooks.
---

# Agent life cycle: tavern, altar, roster

## Current State
- Design (user-defined, French): `docs/lieux-et-personnages.md`, section "La taverne et le
  cycle de vie d'un agent". The code below implements it.
- Tavern: one neutral figure (`NEUTRAL_COLOR`) per roster type with no agent of that type
  on stage. Resting figures have id `rest:<type>` and are not selectable.
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
  `restingAgent`, `restingTypes`, `startOrigins` (`rest` / `lockers` / `seat`),
  `inheritSeats`.
- `packages/web/src/scene/Office.tsx` — `useStarts`, `arrived` set, memoised resting
  figures.
- `packages/web/src/scene/AgentFigure.tsx` — `React.memo`; `onArrive` when a done subagent
  reaches its tavern spot.
- `packages/web/src/scene/layout.ts` — `wallSeats` / `candidateSeats` (cached per room).
- `packages/web/src/store.ts` — `snapshotReceived`; `packages/shared/src/index.ts` —
  roster in the snapshot.
- `packages/server/src/inventory.ts` — `AGENT_NAME`, `AGENT_ID`, `HOOK_AGENT_TYPE`,
  `agentNameFromDefinition`, `listAgentTypes`, `isRemotePath`, `linkedBelow`,
  `AgentsCache`.
- `packages/server/src/reducer.ts` — `hookEventSchema`, `validOrNull`, `findOrCreateSub`,
  `pendingSpawns`, `noteSeenType`, `absorb`, `applyInventory`, `seenTypes`, `rosterView`,
  `setWaiting`.
- `packages/server/src/store.ts`, `packages/server/src/index.ts`.
- Tests: `packages/web/test/{tavern,layout}.test.ts`,
  `packages/server/test/{reducer,inventory}.test.ts`.

## Usage
- Put life-cycle logic in `tavern.ts` (tested), never inline in `Office` or `AgentFigure`.
- Reuse `setWaiting` for any new waiting reason, and keep the tavern/altar split above.
- Test the scene without real sessions: the server only accepts the Vite origin on port
  5173, so from a worktree build the web client and run a second server on another port
  (`AGENT_OFFICE_PORT` and `AGENT_OFFICE_TOKEN` env), then POST fake hook events to
  `/hooks` with header `x-agent-office-token`. A hidden Browser pane renders no frames, so
  figures do not move there.

## Notes
- Security, keep all:
  - `agentNameFromDefinition` must not run a backtracking regex on the `name:` value (a
    former regex took 31 s on a crafted 4 KB line; a time-bounded test guards it).
  - Hook agent types are validated (`HOOK_AGENT_TYPE`) before reaching `seenTypes`, which is
    broadcast to every client, and before `pendingSpawns`. Hook `agent_id` must keep
    excluding `:` and `#` (`AGENT_ID`) so it cannot impersonate `rest:` or `#main` ids.
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
  in the first render; per-figure `<Html>` cost.
- Known limits: mapped network drives (`Z:\`) are still read synchronously (only the user's
  own presets point there); subagent ids are unique per session only, so `agentHookAt` and
  React keys could clash across sessions with a crafted payload; above the 64-file cap the
  kept definitions depend on OS listing order.
