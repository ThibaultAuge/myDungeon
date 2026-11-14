# Implementation Plan — Agent info popup (top right)

*Generated on 2026-11-14*

## Business Objective

When you click an agent, the conversation box opens at the bottom. Without leaving the
scene, you also want the session's working context: its name, whether it runs in a
worktree, the folder and branch, the model, its activity, and above all the link to the
web server it started.

## Requirements Summary

### Functional Requirements
- A popup in the style of `AgentDialog` (dark plate, gold border, title on a plate), docked
  **top right** of `.office__scene`, shown while an agent is selected.
- It **replaces `AgentPanel`** (side column): all of its current content moves over
  (state + duration + room, agent, request/task, tool, error detail, "launched from" with
  its link, last message).
- New **Session** section:
  - name (`sessionTitle`), origin desktop/terminal, live or not;
  - **Worktree**: yes/no + worktree name;
  - **Folder**: `cwd` (full path, with `title` showing all of it if cut);
  - **Branch**: `branch` ← `sourceBranch` (e.g. `claude/xyz ← main`);
  - **Model**: model id + effort + permission mode (translated labels, raw value if unknown);
  - **Activity**: started at / duration, completed turns, active subagents;
  - **Web servers**: one `http://localhost:<port>` link per detected port (new tab,
    `rel="noopener noreferrer"`), plus the process name (`node`, `python`…); "none" otherwise.
- For a selected subagent: same popup, agent section about it, session section about its session.
- × closes the popup and deselects (current `AgentPanel` behaviour, focus goes back to the
  list row). Escape is left to `AgentDialog` (it only closes the conversation).

### Non-Functional Requirements
- **Performance:** port detection outside the hook path, every 10 s, async, never two runs
  at once, skipped when no session is live. Broadcast only if the result changes.
- **Security:** only port numbers and process names leave the server (never a command line).
  Fixed system commands, no interpolated arguments. `launch.json` read bounded, local,
  without following links.
- **UX/UI:** i18n FR/DE/EN for every label (`info.*` keys), `<dl>` structure, `<h2>` title,
  visible focus, forced-colors, mobile (≤ 800 px) without overlapping the conversation box.

### Out of Scope
- Git state (uncommitted changes / commits ahead): not chosen.
- Opening the folder / worktree in the editor, PR link.
- Detecting servers bound to a remote interface or started outside the session's process tree
  and not declared in its `launch.json`.

## Technical Approach

### Architecture

**1. Desktop session data (server, `inventory.ts`)**
`sessionSchema` / `parseDesktopSession` read in addition (lenient, all optional):
`worktreeName`, `worktreePath`, `branch`, `sourceBranch`, `model`, `effort`,
`permissionMode`, `completedTurns`. Values are bounded (`truncate`, `AGENT_NAME`-like
pattern for model/effort/mode; unknown → undefined).
For a terminal session (`cli:`): worktree = `lstat(<cwd>/.git).isFile()` (a worktree has a
`.git` *file*), name = `basename(cwd)`; no branch (not read, out of scope).
`LiveProcess` keeps `version` (shown as "Claude Code x.y.z", optional).

**2. Shared types (`packages/shared/src/index.ts`)**
```ts
interface SessionInfo {
  worktree?: { name: string };       // absent = not a worktree
  branch?: string; sourceBranch?: string;
  model?: string; effort?: string; permissionMode?: string;
  completedTurns?: number;
  cliVersion?: string;
}
interface ListeningServer { port: number; process?: string }
SessionView += { info: SessionInfo; servers: ListeningServer[] }
```
Filled in `applyInventory` (`reducer.ts`) for desktop and cli sessions alike.

**3. Port detection (new `packages/server/src/ports.ts`)**
- `scanListeners()` → `{ listeners: {pid, port, address}[], procs: {pid, ppid, name, cmd}[] }`:
  - Windows: a single `powershell -NoProfile -NonInteractive -Command <fixed script>`
    (`Get-NetTCPConnection -State Listen` + `Get-CimInstance Win32_Process`
    → `ConvertTo-Json`), `execFile`, timeout 8 s, `maxBuffer` bounded.
  - POSIX: `lsof -nP -iTCP -sTCP:LISTEN -F pcn` + `ps -A -o pid=,ppid=,comm=,args=`.
  - Any failure → `null` (previous result kept, logged once).
- `attribute(scan, sessions)` (pure, tested): for each live session,
  - (a) ports whose process **descends from the `pid` of its live process**
    (`LiveProcess.pid`, walk up through `ppid`, cycle guard, depth ≤ 32);
  - (b) ports declared in `<cwd>/.claude/launch.json` (`configurations[].port`) that are
    listening **and** whose listening process or one of its ancestors has a command line
    containing the session's `cwd` (normalised with `normPath`). If several sessions match,
    the **longest `cwd`** wins (a worktree is under the main repo's folder).
  - excluded: Agent Office's own server port, ports > 65535, addresses other than
    loopback / `0.0.0.0` / `::`; deduped, sorted, max 8 per session.
- `readLaunchPorts(cwd)`: reuse `isRemotePath` and the `linkedBelow` logic (refuse when
  `.claude` or `launch.json` is a link), `O_NOFOLLOW`, read ≤ 64 KiB, lenient zod, 60 s cache
  per folder (same pattern as `AgentsCache`).
- `index.ts`: 10 s interval, `running` flag, `store.ingestServers(map)`; `OfficeStore`
  compares with the previous map before `schedule()`.

**4. Client**
- New `packages/web/src/ui/AgentInfo.tsx` (replaces `AgentPanel.tsx`, which is removed):
  rendered in `.office__scene` next to `AgentDialog` in `App.tsx`; removed from `.office__side`.
  Reuses `agentName`, `sessionTitle`, `stateLabel`, `elapsed`, `STATE_COLORS`, `rowId`.
- Pure formatting in `format.ts` (tested): `branchLabel`, `serverUrl(port)`,
  `modelLabel(info, t)`.
- CSS: `.agent-info` reuses the `--dlg-*` variables (shared under a common selector
  `.agent-dialog, .agent-info`), `top/right: 12px`, `width: min(360px, 40%)`,
  `max-height` bounded so it never covers the conversation box (`calc(100% - <box height> - 36px)`
  when `:has(.agent-dialog)`), internal scrolling (focusable, `tabIndex=0`). Mobile: full width,
  `max-height` 40 %. `forced-colors` like the box.
- i18n: `info.*` keys in `fr.ts`, `de.ts`, `en.ts` (title, sections, yes/no, worktree,
  branch, model, effort `{low, medium, high, xhigh, max}`, permission mode
  `{default, auto, plan, acceptEdits, bypassPermissions}` with raw-value fallback, turns
  (plural via `plural.ts`), active subagents, servers, none, "opens in a new tab" for the
  link `aria-label`). `panel.*` keys become `info.*` or are kept if reused.

### Stack & Tools
- **Frontend:** React, zustand (`useOffice`), existing CSS.
- **Backend:** Fastify server, zod, `node:child_process.execFile`.
- **External APIs:** none (local system commands only).

### Files to Create/Modify
1. `packages/shared/src/index.ts` — `SessionInfo`, `ListeningServer`, `SessionView` fields.
2. `packages/server/src/inventory.ts` — extended schema, `.git` worktree check, `version`.
3. `packages/server/src/reducer.ts` — fill `info` / `servers` in `createSession` / `applyInventory`.
4. `packages/server/src/ports.ts` — **new**: scan, attribution, `launch.json`.
5. `packages/server/src/store.ts` — `ingestServers` with change detection.
6. `packages/server/src/index.ts` — port scan interval.
7. `packages/web/src/ui/AgentInfo.tsx` — **new**; `AgentPanel.tsx` — **removed**.
8. `packages/web/src/App.tsx` — placement in the scene.
9. `packages/web/src/format.ts`, `packages/web/src/styles.css`.
10. `packages/web/src/i18n/{fr,de,en}.ts`.
11. Tests: `packages/server/test/{inventory,reducer,store}.test.ts`, new
    `packages/server/test/ports.test.ts` (parsing PowerShell/lsof/ps output, attribution,
    longest-cwd tie-break, cycles, exclusions, malicious `launch.json`),
    `packages/web/test/{format,i18n}.test.ts`.

## Security Constraints

(to be audited by `neo` in implementation, gate 5)
- Never send a command line or a `launch.json` `url` to the client: port + process name
  (truncated to 32 chars, `[\w.-]` pattern) only.
- Link built client-side, only `http://localhost:<integer port>`.
- Reminder: `/ws` is still unauthenticated (known follow-up): the new fields (branch, ports)
  are no more sensitive than the `cwd` already sent, but they widen what leaks to a local
  client. To be mentioned in the final summary.

## Performance Considerations

- **Expected bottleneck:** PowerShell cold start (~0.5–1 s CPU) every 10 s.
- **Scale target:** a few dozen sessions, a few hundred processes.
- **Optimisations:** skipped with no live session, no overlap, `launch.json` cache 60 s,
  attribution in O(processes × depth).

## Edge Cases & Error Handling

- Several worktrees with the same `launch.json` port (5173): only one listens; it goes to the
  session whose `cwd` appears in the listener's command line (longest wins).
- Ended session: `servers` emptied, popup still shows the info (history).
- Desktop file mid-write: previous info kept (same rule as today).
- PowerShell missing / `Get-NetTCPConnection` refused: previous result kept, single log line.
- Missing fields (old session, terminal session): line hidden or "—", never an error.
- Selected subagent that finished and walked back to the tavern: popup closes like today's panel.

## Verification

1. `npm run typecheck`, `npm test` (new tests included).
2. Test server from the worktree (`AGENT_OFFICE_PORT`, `AGENT_OFFICE_TOKEN`,
   `docs/ai/agent-lifecycle.md`), web client build, Browser pane: click this session's agent
   (worktree `agent-info-popup-b0c674`) → popup top right: Worktree yes, branch
   `claude/agent-info-popup-b0c674 ← main`, model, and the test server port in "Web servers".
3. Check the mobile layout (375 px) and dark/forced-colors, popup × → focus goes back to the row.
4. Quality gates: dexter → hermione → timmy (gatsby skipped: internal UI, not public) → neo
   → hancock (removal of `AgentPanel`) → curator (`docs/ai/dialogue.md`,
   `docs/ai/agent-lifecycle.md`) → otis if the README describes the panel.

## Complexity Estimate

**Size:** M

**Justification:** two packages and the shared type touched, a new system detection module
with platform-dependent parsing and its tests, but no architectural change.
