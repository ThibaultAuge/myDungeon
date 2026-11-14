---
description: Use when changing where agents rest or wait (tavern, altar queue), how subagent figures appear, leave or return, the agent roster (snapshot.roster, agent definitions, seen types), or when testing the scene with fake hooks.
---

# Agent life cycle: tavern, altar, roster

## Current State
- Design (user-defined, French): `docs/lieux-et-personnages.md`, section "La taverne et le
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
- First figures shown after a page load or environment change start in place, not from the
  lockers (`useStarts` `loaded` ref in `Office.tsx`).
- Main agent: waiting for a prompt (Stop, SessionStart, idle notification) rests in the
  tavern. The altar queue is only for `permission`, `question` and `error`
  (`setWaiting` in `reducer.ts`). User decision.
- Roster (`snapshot.roster`, `rosterView` in `reducer.ts`): agents defined in
  `~/.claude/agents` and `<env folder>/.claude/agents`, plus types seen at work in that
  environment (`seenTypes`, max 32 per env, kept until server restart), deduped
  case-insensitively, sorted. A definition counts only by its frontmatter `name:` (no
  filename fallback, like Claude Code). Folders are read at most once per 60 s
  (`AgentsCache` in `index.ts`); a transient read failure keeps the previous list.

## Relevant Files
- `packages/web/src/scene/tavern.ts` — pure, no three.js: `NEUTRAL_COLOR`, `restId`,
  `restingAgent`, `restingTypes`, `startOrigins` (`rest` / `lockers` / `seat`),
  `inheritSeats`.
- `packages/web/src/scene/Office.tsx` — `useStarts`, `arrived` set, resting figures.
- `packages/web/src/scene/AgentFigure.tsx` — `onArrive` when a done subagent reaches its
  tavern spot.
- `packages/web/src/store.ts`, `packages/shared/src/index.ts` — roster in the snapshot.
- `packages/server/src/inventory.ts` — `AGENT_NAME`, `agentNameFromDefinition`,
  `AgentsCache`, agent folder reads.
- `packages/server/src/reducer.ts` — `seenTypes`, `rosterView`, `setWaiting`.
- `packages/server/src/store.ts`, `packages/server/src/index.ts`.
- `packages/web/test/tavern.test.ts`.

## Usage
- Put life-cycle logic in `tavern.ts` (tested), never inline in `Office` or `AgentFigure`.
- Reuse `setWaiting` for any new waiting reason, and keep the tavern/altar split above.
- Test the scene without real sessions: the server only accepts the Vite origin on port
  5173, so from a worktree build the web client and run a second server on another port
  (`AGENT_OFFICE_PORT` and `AGENT_OFFICE_TOKEN` env), then POST fake hook events to
  `/hooks` with header `x-agent-office-token`. A hidden Browser pane renders no frames, so
  figures do not move there.

## Notes
- Security, keep both: `agentNameFromDefinition` must not run a backtracking regex on the
  `name:` value (a former regex took 31 s on a crafted 4 KB line; a time-bounded test
  guards it). Hook agent types must pass `AGENT_NAME` before joining `seenTypes`, which is
  broadcast to every client.
- Known follow-ups, not done: seat memory mutated during render; start origin computed only
  in the first render; `wallSeats` cost; per-figure `<Html>` cost; `seenTypes` not re-keyed
  when a CLI session is absorbed; `loaded` guessed from stage contents; synchronous agent
  folder reads (slow on UNC paths); hook `agent_type` unvalidated in `AgentView` /
  `pendingSpawns`; an `agent_id` could collide with `rest:` ids.
