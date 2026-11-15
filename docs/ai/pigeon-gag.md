---
description: Use when changing the Samuel-Morse pigeon gag — HTTP-call detection of dovecote agents (http-call.ts, HookEventSummary.httpCall), pigeon flights, outcomes and their 3D rendering (pigeon.ts, Pigeons.tsx), or the agentOffice.pigeon console command.
---

# Samuel-Morse pigeon gag

## Current State
- Humorous, purely visual gag (sibling of the slap and potion gags in
  `docs/ai/dungeon-scene.md`): each HTTP call made by an agent working in the dovecote
  sends a pigeon from the aviary; it comes back with the outcome.
- Server classification (`packages/server/src/http-call.ts`):
  - `httpCallOf(ev, room)` is called by `summarize` (`reducer.ts`) with the room of the
    event's agent AFTER `applyHook`. Only `room === 'pigeonnier'` counts (in practice the
    `samuel-morse` subagent, via `AGENT_POSTS`), and only Bash / PowerShell commands that
    `isHttpCommand` matches (curl, wget, Invoke-WebRequest, Invoke-RestMethod, iwr, irm).
  - `PreToolUse` → `'start'`; `PostToolUseFailure` → `'error'`; `PostToolUse` → status from
    `tool_response.stdout` via `httpStatus`: last `--- HTTP nnn` marker (Samuel-Morse's
    `curl -w` output), else last `HTTP/x nnn` status line. ≥ 400 or < 100 (curl `000`) →
    `'error'`; anything else, including no status found → `'ok'`.
  - `httpStatus` scans only the first `SCAN_HEAD` (64 KB) and last `SCAN_TAIL` (4 KB) of
    stdout, with linear (non-backtracking) regexes.
  - Result: `HookEventSummary.httpCall?: 'start' | 'ok' | 'error'` (`packages/shared`).
- Client (`PigeonFlights` in `Pigeons.tsx`, mounted in `Office.tsx`):
  - Subscribes to the store's `events` and takes new ones with `freshEvents(next, prev)`
    (reference diff of the newest-first list).
  - Keeps an event only if its agent or its session is shown (`eventShown`). The main
    agent id is the session's `main.id`, never rebuilt from the session id (same rule as
    `potionTarget` in `potion.ts`).
  - `'start'` → `Pigeons.start`; `'ok'` / `'error'` → `Pigeons.land` with
    `pigeonOutcome`: `'ok'` → `back`; `'error'` → random `plucked` / `lost` / `dropping`.
  - Calls and ends pair FIFO per agent. With `MAX_PIGEONS` (4) in the air, a call gets a
    *silent* flight: it keeps its FIFO place, is never drawn and is not counted in the cap.
    Unanswered calls become `lost` after `LOST_TIMEOUT_S` (60).
- Timeline (`pigeon.ts`, pure; `phaseAt`, `pigeonPoint`, `feathersAt`, `splatOn`):
  - Leaving (`LEAVE_S` 1.6): from the aviary's top shelf (`NEST_Y` 1.8) to a sky point
    `SKY_RISE` 10 up and `SKY_NORTH` 6 north.
  - Away at least `MIN_AWAY_S`, then returning (`RETURN_S`), then landed (`LAND_S`).
  - `dropping`: hovers `HOVER_S` over the agent's head, the dropping falls (`DROP_S`) and
    stays on the head `SPLAT_S` (6 s), then the pigeon homes to the aviary.
  - `plucked`: feather burst at 75 % of the way back (`FEATHER_FALL_S`), skinny pigeon.
  - `lost`: one feather drifts down from 4 m above the aviary (`LOST_FEATHER_FALL_S`).
- Rendering (`Pigeons.tsx`): fixed mesh pools (4 pigeons = KayKit `mixed1`
  `chicken_plushie_A` at scale 0.4; `PLUCKED_FEATHERS × (MAX_PIGEONS + 1)` feathers;
  drops; splats), geometries and materials shared at module scope, raycast disabled,
  positions written in `useFrame`. Head point = figure position + `HEAD_Y` 1.78 × scale
  (0.85 for subagents, chosen by the `#main` id suffix), from `agentPositions`
  (`AgentFigure.tsx`); falls back to the lectern. Higher would be hidden by the name tag.
  Reduced motion: no flight and no feathers, only the static splat.
- Console command `agentOffice.pigeon(issue?, id?)`, installed by `PigeonFlights` through
  `gagCommands(window)` (shared namespace: `docs/ai/dungeon-scene.md`; human doc
  `docs/commandes-console.md`): issue `back | plucked | lost | dropping`; target = id ??
  selected agent ?? first non-done dovecote agent ?? lectern. Returns false for an unknown
  issue, an explicit id with no figure on stage, or a full sky. Uses `Pigeons.force`.

## Relevant Files
- `packages/server/src/http-call.ts` — `isHttpCommand`, `httpStatus`, `httpCallOf`,
  `SCAN_HEAD`, `SCAN_TAIL`.
- `packages/server/src/reducer.ts` — `summarize` sets `httpCall`.
- `packages/shared/src/index.ts` — `HookEventSummary.httpCall`.
- `packages/web/src/scene/pigeon.ts` — pure timeline, `Pigeons` queue, `freshEvents`,
  `pigeonOutcome`, constants.
- `packages/web/src/scene/Pigeons.tsx` — `PigeonFlights`, pools, console command.
- `packages/web/src/scene/Office.tsx` — mounts `PigeonFlights`.
- Tests: `packages/server/test/http-call.test.ts`, `packages/server/test/reducer.test.ts`
  (httpCall block), `packages/web/test/pigeon.test.ts`.

## Usage
- Another hook-derived, room-gated client effect: classify on the server into a small
  enum field of `HookEventSummary` (as `httpCallOf`), then consume it on the client with
  `freshEvents` and the `eventShown` filter. Hook-driven per-figure reactions that need no
  server data follow `potion.ts` instead (`docs/ai/dungeon-scene.md`).
- Keep timing and positions in `pigeon.ts` (tested); `Pigeons.tsx` only draws them.
- Preview: the in-app Browser pane renders about 3 fps. To inspect phases, dispatch `wheel`
  events on the canvas to zoom on the selected agent, then override `performance.now` in
  the console with a controllable clock (`performance.now = () => base + dt * 1000`) and
  step `dt`. Fake-hook sessions: `docs/ai/agent-lifecycle.md`.

## Notes
- Security, keep: only the enum leaves the server, never stdout, the status code or
  headers. `tool_response` is read through the hook schema's passthrough, not a new
  schema field.
- Never key fresh events on `seq`: it restarts with the server. `freshEvents` relies on
  the store prepending one live event per `setState`; a bulk load of past events into the
  same list would replay them.
- Accepted limit: a call ending after its `LOST_TIMEOUT_S` settles the agent's next
  pending call instead.
