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

- `docs/ai/i18n.md` — Use when adding or changing any text shown in the web interface, a language, a RoomId, or server data that the client displays.
- `docs/ai/dungeon-scene.md` — Use when changing the 3D dungeon map — rooms, floors, walls, cutaway, props, lighting, KayKit models or their import — agent figures (walking motion, character models, animations), or when previewing the web scene.

Human docs (French): `README.md` and `docs/`.
