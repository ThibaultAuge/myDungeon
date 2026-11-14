---
description: Use when changing the agent conversation box (AgentDialog), how transcripts are found, parsed or paged (transcript.ts, /api/transcript, useTranscript), or browser sign-in (AuthGate, /login, /logout, session cookie).
---

# Agent conversation box, transcripts, browser sign-in

## Current State
- Box: selecting an agent (3D click or side-list row) opens an RPG-style, non-modal,
  read-only box docked at the bottom of `.office__scene`. Store: `select(id)` sets
  `dialogOpen = id !== null`; `closeDialog` (× button, Escape) closes it without
  deselecting. A list row whose agent is selected with the box closed reopens it; a row
  click on the selected agent with the box open deselects. Row `aria-pressed` =
  `selected && dialogOpen`.
- Accessibility: the log is `role="log"` with `aria-live="off"` (it is polled, so it must not
  chatter); opening is announced by an sr-only `role="status"`, and sign-in/error notices by
  a second sr-only `role="status"`.
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
- Route `GET /api/transcript?session=&agent=&before=`: 401 without a valid session cookie,
  400 on bad params/cursor, 404 when no transcript; `Cache-Control: no-store`; `ETag` +
  304 on the latest page only (older pages of an append-only file never change).
- Client `useTranscript`: polls the latest page every 2 s (`POLL_MS`), 10 s after a 404
  (`POLL_EMPTY_MS`); merges with pure `mergeLatest` / `prependOlder` (`dialogue.ts`); loads
  older pages on scroll-to-top or a button.
- Sign-in (`AuthGate`): a one-time code is printed in the server console at start as a link
  (`index.ts`: origin port 5173 when `packages/web/dist` is absent, else the server port).
  Code valid 10 min, rotated on success or when an expired code is presented (a wrong code
  never rotates a valid one). `GET /login?code=` sets cookie `agent_office_session`
  (HttpOnly, SameSite=Strict, 12 h sliding, max 32 sessions, in memory: a server restart
  signs everyone out) and 303 to `/`; failure 303 to `/?login=failed`, which the client
  turns into `dialog.loginFailed`. `POST /logout` revokes and clears. `readCookie` refuses
  a cookie name sent twice (shadowing from another 127.0.0.1 port). Vite proxies `/login`
  and `/logout`.

## Relevant Files
- `packages/web/src/ui/AgentDialog.tsx` — box, log, notices, older-page loading.
- `packages/web/src/ui/useTranscript.ts` — polling and paging.
- `packages/web/src/ui/dialogue.ts` — pure merge (`entryOffset`, `mergeLatest`,
  `prependOlder`); tested in `packages/web/test/dialogue.test.ts`.
- `packages/web/src/store.ts` — `dialogOpen`, `closeDialog`, `select`, `loginFailed`.
- `packages/web/src/ui/SessionList.tsx` — row reopen / `aria-pressed`.
- `packages/server/src/transcript.ts` — `projectDirName`, `isInside`, `findTranscript`,
  `entriesOfLine`, `readTranscriptPage`, `transcriptEtag`.
- `packages/server/src/auth.ts` — `AuthGate`, `readCookie`, `sessionCookie`, `clearedCookie`.
- `packages/server/src/app.ts` — `/login`, `/logout`, `requireSession`, `/api/transcript`.
- `packages/server/src/index.ts` — `AuthGate` wiring, printed link, `projectsDir`.
- `packages/shared/src/index.ts` — `DialogueEntry`, `TranscriptPage`.
- `packages/web/vite.config.ts` — proxy entries.
- Tests: `packages/server/test/transcript.test.ts`, `auth.test.ts`, `app.test.ts`.

## Usage
- Any route exposing conversation contents goes behind `requireSession`. Reuse `AuthGate`
  and `readCookie`; do not add another auth scheme.
- Add transcript filtering in `entriesOfLine` and merge logic in `dialogue.ts` (both
  tested), never inline in `AgentDialog`.
- Never accept a file path from a client or hook; derive it from store state through
  `findTranscript`.
- Box text follows the i18n invariant (`dialog.*` keys); server error bodies are not shown.
- Testing with a test server and fake hooks: `docs/ai/agent-lifecycle.md`. To see a
  transcript, sign in through the link that server prints.

## Notes
- Known follow-ups (review/security, not done): bind `DEV_PORTS` 5173 to dev mode only;
  authenticate `/ws` and `/api/*` and add a CSRF token before any state-changing route
  (planned "reply from 3D" phase); fstat/realpath containment in transcript reads;
  `GET /login` can be consumed by link prefetchers (consider a confirm page + POST);
  cost of the fallback project-folder scan on every poll; the focus guard reads the DOM
  during render.
