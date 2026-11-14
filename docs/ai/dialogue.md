---
description: Use when changing the agent conversation box (AgentDialog), how transcripts are found, parsed or paged (transcript.ts, /api/transcript, useTranscript), or adding any route that reads or changes conversations.
---

# Agent conversation box and transcripts

## Current State
- Box: selecting an agent (3D click or side-list row) opens an RPG-style, non-modal,
  read-only box docked at the bottom of `.office__scene`. Store: `select(id)` sets
  `dialogOpen = id !== null`; `closeDialog` (× button, Escape) closes it without
  deselecting. A list row whose agent is selected with the box closed reopens it; a row
  click on the selected agent with the box open deselects. Row `aria-pressed` =
  `selected && dialogOpen`. The details card shown on selection: `docs/ai/agent-info.md`.
- Accessibility: the log is `role="log"` with `aria-live="off"` (it is polled, so it must not
  chatter); opening is announced by an sr-only `role="status"`, and error notices by a second
  sr-only `role="status"`.
- Which transcript (`findTranscript`, server only):
  - main agent: `~/.claude/projects/<projectDirName(cwd)>/<cliSessionId>.jsonl`, newest
    mtime among the session's `cliSessionIds`;
  - subagent: `<…>/<cliSessionId>/subagents/agent-<agentId>.jsonl`;
  - other project folders are scanned only when the cwd folder has no match.
  Paths come only from server state: ids UUID-checked (`CLI_SESSION_ID`), subagent ids
  through `AGENT_ID` and must belong to the session, every candidate passes `isInside` and
  must be a regular file (`lstat`). Never from the client or a hook `transcript_path`.
- Parsing (`entriesOfLine`): user/assistant text blocks, assistant `tool_use` as compact
  tool entries (`toolDetail`, name cut at 64). Skipped: thinking, tool_result, images,
  `isMeta`, `isCompactSummary`, user texts starting with `<command-`, `<local-command-`,
  `<system-reminder`, `<task-notification`, `<bash-`. Text cut at `TEXT_MAX` 4000 chars
  (`truncated: true`). Entry key `<lineOffset>:<blockIndex>`.
- Paging (`readTranscriptPage`): reads backwards in 64 KiB chunks, `PAGE_ENTRIES` 50 per
  page (stops at a line boundary), `READ_BUDGET` 1 MiB soft, `READ_HARD_CAP` 8 MiB hard,
  lines over `LINE_MAX` 1 MiB skipped without buffering. Cursor `before` = byte offset of
  the oldest line handled (`null` at file start).
- Route `GET /api/transcript?session=&agent=&before=`: unauthenticated; 400 on bad
  params/cursor, 404 when no transcript; `Cache-Control: no-store`; `ETag` + 304 on the
  latest page only (older pages of an append-only file never change).
- No browser sign-in (owner's decision): Agent Office is a single-user local tool started
  by hand, so whoever can load the page reads conversations. Exposure is limited by the
  `127.0.0.1` bind (`index.ts`) and the global `onRequest` Host/Origin allow-list in
  `app.ts` (DNS-rebinding and cross-origin guard, 403), plus no CORS headers, `nosniff`
  and `frame-ancestors 'none'`. Exposing it beyond the machine is a separate future
  project that would bring its own access control.
- Client `useTranscript`: polls the latest page every 2 s (`POLL_MS`), 10 s after a 404
  (`POLL_EMPTY_MS`), any other failure (including a 401) gives status `'error'`; merges with
  pure `mergeLatest` / `prependOlder` (`dialogue.ts`); loads older pages on scroll-to-top or
  a button.

## Relevant Files
- `packages/web/src/ui/AgentDialog.tsx` — box, log, notices, older-page loading.
- `packages/web/src/ui/useTranscript.ts` — polling and paging.
- `packages/web/src/ui/dialogue.ts` — pure merge (`entryOffset`, `mergeLatest`,
  `prependOlder`); tested in `packages/web/test/dialogue.test.ts`.
- `packages/web/src/store.ts` — `dialogOpen`, `closeDialog`, `select`.
- `packages/web/src/ui/SessionList.tsx` — row reopen / `aria-pressed`.
- `packages/server/src/transcript.ts` — `findTranscript`, `entriesOfLine`,
  `readTranscriptPage`, `transcriptEtag`; re-exports `projectDirName` and `isInside`.
- `packages/server/src/paths.ts` — leaf module (no imports from `transcript.ts` or
  `inventory.ts`, which both use it): `projectDirName`, `isInside`. Keep path helpers here
  to avoid an import cycle.
- `packages/server/src/app.ts` — global Host/Origin `onRequest` hook, framing headers,
  `/api/transcript`.
- `packages/server/src/index.ts` — `127.0.0.1` bind, `projectsDir`.
- `packages/shared/src/index.ts` — `DialogueEntry`, `TranscriptPage`.
- `packages/web/vite.config.ts` — proxy entries.
- Tests: `packages/server/test/transcript.test.ts`; `app.test.ts` ('conversation routes':
  200 without cookie, `/login` and `/logout` 404 without web dist, foreign Origin and
  foreign Host 403).

## Usage
- New conversation routes stay read-only GETs under the global Host/Origin hook. Never add
  CORS headers or a configurable bind address (e.g. `0.0.0.0`) without bringing back
  authentication.
- Future write/approval routes (planned "reply from 3D" phase): the Origin hook lets
  requests with no `Origin` through, and any local process can call the server, so a
  state-changing route must reject a missing `Origin`, never act on GET/HEAD, require a
  non-simple request (JSON content-type or a custom header), and consider a per-launch
  secret like `/hooks`. Put these guards in `onRequest` (before body parsing), also for
  `/ws` if commands travel there. Keep the framing headers.
- Add transcript filtering in `entriesOfLine` and merge logic in `dialogue.ts` (both
  tested), never inline in `AgentDialog`.
- Never accept a file path from a client or hook; derive it from store state through
  `findTranscript`.
- Box text follows the i18n invariant (`dialog.*` keys); server error bodies are not shown.
- Testing with a test server and fake hooks: `docs/ai/agent-lifecycle.md`.

## Notes
- Known follow-ups (review/security, not done): bind `DEV_PORTS` 5173 to dev mode only;
  no test proves the Origin guard covers the `/ws` upgrade; fstat/realpath containment in
  transcript reads; cost of the fallback project-folder scan on every poll; the focus
  guard reads the DOM during render.
