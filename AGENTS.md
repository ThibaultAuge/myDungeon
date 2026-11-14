# Agent Office

3D office (React + react-three-fiber client, Fastify server) that shows Claude Code agents live.
npm workspaces: `packages/server`, `packages/web`, `packages/shared`.

## Commands

`npm run dev` · `npm run build` · `npm run start` · `npm test` · `npm run typecheck`

## Invariants

- **Every displayed text is translated.** Visible text, `aria-label`, `title`,
  `document.title`, live-region announcements and 3D labels go through
  `packages/web/src/i18n` and exist in FR, DE and EN. Never hard-code a display string in
  a component and never send one from the server. Exception: "Debug" stays untranslated,
  marked `lang="en"`.

## AI context index

- `docs/ai/i18n.md` — Use when adding or changing any text shown in the web interface, a language, a RoomId or PostId, or server data that the client displays.
- `docs/ai/dungeon-scene.md` — Use when changing the 3D dungeon map — rooms, floors, walls, castle gate, cutaway, props, lighting, KayKit models or their import — clickable workstations (posts, hover glow, post card and list), pointer/cursor handling of 3D targets, agent figures (walking motion, character models, role looks and held props, animations, destination badge, agent slap gag), room or post icons, or when previewing the web scene.
- `docs/ai/night-forest.md` — Use when changing the night environment around the castle — forest floor, trees, moat, drawbridge, dirt path, horizon, night shading or sky colour — or the camera pan limits.
- `docs/ai/agent-lifecycle.md` — Use when changing where agents rest or wait (tavern, altar queue), how subagent figures appear, leave or return, the agent roster (snapshot.roster, agent definitions, seen types), or when testing the scene with fake hooks.
- `docs/ai/dialogue.md` — Use when changing the agent conversation box (AgentDialog), how transcripts are found, parsed or paged (transcript.ts, /api/transcript, useTranscript), or adding any route that reads or changes conversations.
- `docs/ai/agent-info.md` — Use when changing the selected-agent details card (AgentInfo), session details sent to the client (SessionView.info, worktree, branch, model, effort, permission mode, CLI version), or the detection of a session's local web servers (ports.ts, SessionView.servers).

Human docs (French): `README.md` and `docs/`.
