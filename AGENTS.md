# Agents’ lAIr

Displayed product name "Agents’ lAIr", never translated; code and tooling keep the technical name `agent-office` (see `docs/ai/i18n.md`).

3D dungeon (React + react-three-fiber client, Fastify server) that shows Claude Code agents live.
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
- `docs/ai/dungeon-scene.md` — Use when changing the 3D dungeon map — rooms, floors, walls and their collision boxes, castle gate, cutaway, props, lighting, KayKit models or their import — the first-person view (Shift+F walk mode, fps.ts, FpsControls, FpsHint), workstations (posts, hover glow, post card and list), pointer handling of 3D targets, agent figures (walking, models, role looks, held props, clips, destination badge), the slap, potion and mishap gags, the agentOffice console namespace, room or post icons, or when previewing the web scene.
- `docs/ai/room-identity.md` — Use when changing a room's visual identity — per-room wall variants, wall hangs, room lights, decor kinds and decor recipes (decor.ts) — or the static mesh merging of posts (merge.ts) and the scene's draw-call count.
- `docs/ai/night-forest.md` — Use when changing the night environment around the castle — forest floor, trees, moat, drawbridge, dirt path, horizon, night shading or sky colour — the dungeon name sign, pennants and per-environment dungeon colour (heraldry.ts, DungeonSign), or the camera pan limits.
- `docs/ai/agent-lifecycle.md` — Use when changing where agents rest or wait (tavern, altar queue), how agent figures appear, leave or return (subagent tavern cycle, main agents walking in from the forest, the skeleton ambush when a session ends, stopped sessions, ghosts of sessions that never worked, everActive), the agent roster (snapshot.roster, agent definitions, seen types), the introduction card of resting subagent types (RestCard, RosterList), or when testing the scene with fake hooks.
- `docs/ai/altar-wait.md` — Use when changing the endless-wait gag at the altar — agents waiting for the human that pace, sit, fall asleep (Zzz bubble) and gather cobwebs over time (altarWait.ts, SnoreBubble, AltarCobwebs) — or the agentOffice.autel console command.
- `docs/ai/celebrations.md` — Use when changing the celebration gag — heralds trumpeting from the corner towers on git commit/push, fireworks when tests pass — its server-side command classification (celebration.ts, HookEventSummary.celebrations), the corner towers (Towers.tsx, TOWERS), or the agentOffice.heraut / feuArtifice console commands.
- `docs/ai/dialogue.md` — Use when changing the agent conversation box (AgentDialog), the Markdown rendering of agent messages (MessageText, markdown.ts), how transcripts are found, parsed or paged (transcript.ts, /api/transcript, useTranscript), or adding any route that reads or changes conversations.
- `docs/ai/agent-info.md` — Use when changing the selected-agent details card (AgentInfo), session details sent to the client (SessionView.info, worktree, branch, model, effort, permission mode, CLI version), or the detection of a session's local web servers (ports.ts, SessionView.servers).
- `docs/ai/ui-theme.md` — Use when changing the web UI's colours or chrome styling — root CSS tokens, the single dark dungeon theme, top bar, side panel, home page and its castle-gate background image (and how to re-capture it).
- `docs/ai/pigeon-gag.md` — Use when changing the Samuel-Morse pigeon gag — HTTP-call detection of dovecote agents (http-call.ts, HookEventSummary.httpCall), pigeon flights, outcomes and their 3D rendering (pigeon.ts, Pigeons.tsx), or the agentOffice.pigeon console command.
- `docs/ai/rat-gag.md` — Use when changing the rat gag — a procedural rat scurrying between corridor holes or stealing the tavern's cheese (rat.ts, RatScene, the KayKit cheese) — the agentOffice.rat console command, or when adding another scurrying creature.

Human docs (French): `README.md` (pitch, install, tests, index of the `docs/` files).
