---
description: Use when changing the selected-agent details card (AgentInfo), session details sent to the client (SessionView.info, worktree, branch, model, effort, permission mode, CLI version), or the detection of a session's local web servers (ports.ts, SessionView.servers).
---

# Agent details card, session info, web server detection

## Current State
- Card (`AgentInfo`): non-modal card in the conversation box's parchment style, docked
  top-right of `.office__scene`, shown while `selectedAgentId` is set (independent of
  `dialogOpen`, see `docs/ai/dialogue.md`). It replaced the former side-column panel.
  Sections: state line; Session (name for subagents, origin desktop/terminal + running/ended,
  worktree yes/no + name, folder, branch "(from <source>)", model via `modelLabel`, effort
  and permission mode via `rawLabel` with raw fallback, started (desktop only: a cli
  session's `createdAt` is when the office first saw it), activity = turns + active
  subagents, Claude Code version, web servers as `http://localhost:<port>` links built
  client-side by `serverUrl`, new tab, plus process name); Agent (agent details, last
  message).
- Focus: × deselects and focuses the list row. If the card disappears with focus inside,
  focus goes to `#live-title`. Focus-inside is tracked with onFocus/onBlur because removing
  a focused node fires no blur and a deps-change cleanup runs after the DOM removal.
- CSS `.agent-info*` shares the `--dlg-*` variables with `.agent-dialog`; its max-height keeps
  12px above the box's plate (`--dlg-height`); mobile rules at ≤800px; forced-colors rules.
- i18n: `info.*` keys; `panel.*` kept for reused labels (`panel.close` closes details and
  conversation); `office.side` is "Agents and places".
- Shared types: `SessionView.info: SessionInfo` (worktree?, branch?, sourceBranch?, model?,
  effort?, permissionMode?, completedTurns?, cliVersion?) and
  `SessionView.servers: ListeningServer[]` (`{port, process?}`). Raw data only, never
  display strings.
- Session info (server):
  - desktop: read from `local_*.json` in `inventory.ts`, each field validated (`LABEL`
    refuses control, bidi and zero-width chars, ≤128; `MODEL_ID`; `RAW_WORD`; `VERSION`); a
    wrong type drops only that field. `cliVersion` from `~/.claude/sessions/<pid>.json`.
  - terminal (`origin === 'cli'` only): `isWorktree(cwd)` = lstat `<cwd>/.git` is a file;
    remote/relative paths skipped.
  - `reducer.ts`: `state.livePids` (session → Claude pid); a desktop session missing from a
    read keeps its info; `markSessionDone` empties `servers`.
- Port scan (`ports.ts`, loop in `index.ts`): every 10 s, no overlap, after failures skips
  1/2/4/6 rounds, skipped when no session is live.
  - Windows: `netstat -ano` (listeners = foreign `:0`; pid taken from line end because the
    state word is localised); process list via PowerShell `Win32_Process` as tab-separated
    pid, ppid, CreationDate FILETIME, name, command line, re-run only when attributable
    listeners (local address, not our own port) or targets change (`PortScanner`). POSIX:
    `lsof` + `ps`.
  - Tools run by absolute path (`systemTool`: System32 or fixed POSIX dirs), never bare
    names (cwd / `node_modules/.bin` hijack).
  - Attribution: (a) listener descends from the session's Claude pid (the listener itself
    excluded; the chain stops at a parent created after its child = Windows pid reuse);
    else (b) port listed in `<cwd>/.claude/launch.json` (`readLaunchPorts`: `isRemotePath`,
    `linkedBelow`, `O_NOFOLLOW`, ≤64 KiB, `url` field ignored; `LaunchPortsCache` 60 s) and
    the listener's or an ancestor's command line mentions the cwd (`mentionsFolder`, rejects
    a `\.claude\worktrees\` continuation); longest cwd wins. Max 8 servers per session.
  - Command lines never leave `ports.ts`; only port and `processName` do.

## Relevant Files
- `packages/web/src/ui/AgentInfo.tsx` — card and focus handling.
- `packages/web/src/format.ts` — `modelLabel`, `rawLabel`, `serverUrl`; tested in
  `packages/web/test/format.test.ts`.
- `packages/web/src/App.tsx`, `packages/web/src/ui/SessionList.tsx`,
  `packages/web/src/styles.css`, `packages/web/src/i18n/{fr,de,en}.ts`.
- `packages/shared/src/index.ts` — `SessionInfo`, `ListeningServer`, `SessionView`.
- `packages/server/src/inventory.ts` — desktop file fields, validators, CLI version,
  `isWorktree`.
- `packages/server/src/reducer.ts` — `livePids`, info merge, `markSessionDone`.
- `packages/server/src/ports.ts` — `PortScanner`, `systemTool`, `readLaunchPorts`,
  `LaunchPortsCache`, `mentionsFolder`, attribution.
- `packages/server/src/index.ts` — scan loop and backoff.
- Tests: `packages/server/test/{ports,inventory,reducer,store}.test.ts`.

## Usage
- New session details: add a raw field to `SessionInfo`, validate it at the read in
  `inventory.ts`, format it client-side (`format.ts`, `info.*` keys). Never send a display
  string or URL from the server (`docs/ai/i18n.md`).
- Reuse `systemTool` for any system command, and `isRemotePath` / `linkedBelow` for any
  read inside a session folder.
- Manual test: in a worktree run its own `npm ci` (otherwise `@agent-office/shared` resolves
  to the main checkout via the parent `node_modules`), `npm run build`, then
  `AGENT_OFFICE_PORT=4779 npm run start`. It reads the real desktop data, so the current
  session appears with its worktree info; a
  `node -e "require('http').createServer().listen(PORT,'127.0.0.1')"` started from the
  session appears under Web servers within ~10 s. Fake hooks: `docs/ai/agent-lifecycle.md`.
  The Browser pane runs no requestAnimationFrame when not rendering; use Playwright to check
  focus moves.

## Notes
- PowerShell list ~0.9 s and netstat ~70 ms (measured); `ConvertTo-Json` took 4.7 s, hence
  the tab format. Keep the process list conditional.
- Known limits, not done: rule (a) also shows ports of MCP servers or tools spawned by
  Claude; `/ws` (unauthenticated, follow-up in `docs/ai/dialogue.md`) now also carries branch/worktree names, ports and
  process names; Windows TOCTOU between `linkedBelow` and open (`O_NOFOLLOW` is 0); sync
  `launch.json` read and `.git` lstat on mapped network drives; terminal worktree detection
  misses subfolders of a worktree and counts submodules; mobile card is cramped when the
  box is open; POSIX process name is the first token of args.
