---
description: Use when changing the 3D dungeon map — rooms, floors, walls, cutaway, props, lighting, KayKit models or their import — agent figures (walking motion, character models, role looks and held props, animations), or when previewing the web scene.
---

# 3D dungeon scene (KayKit assets)

## Current State
- The map is built from KayKit CC0 models (Dungeon Pack 1.1, RPG Tools Bits 1.0, Fantasy
  Weapons Bits 1.0, free tiers), grouped in three packs: `dungeon`, `tools`, `weapons`.
  Agents use KayKit Adventurers 2.0 (CC0): packs `adventurers` (character bodies),
  `adventurers_anim` (shared `Rig_Medium_General`, `Rig_Medium_MovementBasic` clips) and
  `adventurers_props` (8 held props, gltf + 4 textures).
- KayKit is about 1.33x our scene: every model is scaled by `KIT_SCALE = 0.75`. After
  scaling: small floor tile 1.5 m, wall 3 m high per 3 m chunk, table 0.75 m.
- Rooms (`RoomDef` in `layout.ts`) carry `floorKind` (`stone`, `stoneFancy`, `grate`, `wood`,
  `woodDark`, `dirt`) and `accent` (one of 6 KayKit banner colours). Decor `PropKind`s
  `crates`, `barrels`, `chest`, `coins`, `candle` have footprints.
- Walls: wall line `WALL_INSET` (0.15 m) inside the room edge, thickness `WALL_T` (0.25 m).
  Back-to-back rooms (garde / epreuves / heraut) share ONE wall on the common edge, drawn
  by the west/north room; wide pillars bridge corners. `edgeRuns` closes corridor ends at
  the map edge in line with room walls, never doubling a room wall.
- Cutaway (user-designed rule): each tall wall piece, with the torch/banner sharing its
  anchor, sinks when its anchor projects below an upside-down parabola through the mouse
  cursor (`inForeground`, NDC, `CUT_CURVE = 0.3`). Low barrier walls always stand. The
  pointer starts at screen centre and keeps its last position.
- Lighting: Canvas shadows, drei `SoftShadows`, `NeutralToneMapping`, one shadow-casting
  sun. Floors and small shapes/models (< 0.3 m, or scale < 0.6) cast no shadow.

### Agent figures
- Looks (`characters.ts`): a `Look` is a body plus optional `right` / `left` held props
  (`PropRef { pack: 'adventurers_props' | 'tools'; model }`). Main agents use `MAIN_BODY`
  (`Knight`). Every subagent figure, whatever its look, is scaled 0.85 by kind in
  `AgentFigure` (whole group: model, tag, ring, disc). Subagents get a role look from `LOOKS`, keyed by the
  lower-case agent TYPE (18 entries: the user's agents plus `Explore`, `Plan`,
  `general-purpose`, `claude-code-guide`, `statusline-setup`). `lookFor(kind, agentType)`
  looks up case-insensitively with `Object.hasOwn`; an unknown type gets
  `SUB_BODIES[FNV-1a(type) % 5]` with empty hands, `''` gets `SUB_BODIES[0]`. Keying by
  type, not agent id, makes every agent of a type and its resting figure `rest:<type>` look
  alike. `LOOKS` entries, `PropRef`s and grips are frozen.
- Held props: `Held` in `AgentFigure.tsx` clones the prop (`scene.clone()`, geometry and
  materials shared, `castShadow` on the clone's meshes) and mounts it via R3F `createPortal`
  into bone `handslotr` / `handslotl` (GLTFLoader strips the dots of `handslot.r`), inside a
  group carrying the grip. A dev warning fires when a hand slot is missing. Grips:
  `PROP_GRIP` / `gripFor` hold rotation/scale for `tools` models only; Adventurers props fit
  the slot as they are. The slot's local X points down, so upright tools turn a quarter turn
  on Z; the lantern turns on −Z (hangs).
- Walking: cruise `CRUISE_SPEED` 9 u/s, `ACCELERATION` 18 u/s², `MIN_SPEED` 0.3, with
  ease-in / ease-out over the WHOLE route (braking curve `sqrt(2·A·remaining)` on the total
  remaining distance, so no stop at corners). Speed lives in a ref in `AgentFigure`, reset
  to 0 when the path empties; a reroute keeps the current speed. Facing uses `turnToward`
  with exponential rates (`WALK_TURN_RATE` 14, `REST_TURN_RATE` 6).
- Clips: `clipFor` (pure, in `characters.ts`) picks, in priority order: spawn
  (`Spawn_Ground`, once, ×1.5, only for a figure whose `start` is the lockers `SPAWN` and not
  done; one coming from a resting seat just walks) > moving (`Walking_A`, or `Running_A` above
  `RUN_THRESHOLD`; rate = speed / measured clip speed, capped at `MAX_CLIP_RATE`, with a
  0.5 floor for `Walking_A` only) >
  kneeling at the altar (`PickUp` frozen at `KNEEL_POSE_TIME`) > done (`Idle_A` frozen, no
  transparency) > working (`Interact`) > waiting (`Idle_B`). Reduced motion: still poses,
  turns snap, no spawn; position still moves.
- `AgentFigure` structure: the parent runs the walk and writes a `Motion` ref; the
  `Character` child (own `Suspense` + `CharacterBoundary` error boundary with a capsule
  fallback) clones the model with `SkeletonUtils`, animates through drei `useAnimations`
  with manual weight blending (`FADE` 0.2 s), hides the model until the first clip is
  applied, and disposes skeletons on unmount.
- Tag (drei `<Html>`): name in `<span aria-hidden>` (the side list is the accessible
  source); border = session colour via `--session-color`; selection = outline `#185fa5`
  offset 2px + bold (not colour alone); forced-colors rules in `styles.css`. A floor disc
  in the session colour sits inside the state ring.

## Relevant Files
- `packages/web/src/scene/dungeon.ts` — pure geometry, no three scene: `KIT_SCALE`,
  `KitItem`, `Placement` (`Map<model, KitItem[]>`), `roomFloor`, `corridorFloor`,
  `foundation`, `wallRuns`, `edgeRuns`, `wallLayout`, `WALL_T`, `WALL_INSET`, `CUT_CURVE`,
  `inForeground`.
- `packages/web/src/scene/Structure.tsx` — `Floors` (instanced) and `Walls`.
- `packages/web/src/scene/KitInstances.tsx` — `<KitInstances>` (one InstancedMesh per model
  part, for repeated pieces) and `<Kit>` (single model, for furniture).
- `packages/web/src/scene/props.tsx` — `PROPS` renderer per `PropKind` (KayKit models plus
  simple shapes in a KayKit-matched palette).
- `packages/web/src/scene/kit.ts` — `useKitGLTF` (drei `useGLTF(url, false)`: Draco off, so
  no third-party decoder fetch); one shared material per pack + material name. `kitUrl` is
  module-private.
- `packages/web/src/scene/kit-manifest.json` — models and textures per pack; a pack may set
  `"format": "glb"` (self-contained, `textures: []`).
- `scripts/import-kaykit.mjs` (`npm run kaykit:import`) — copies manifest entries from
  `assets-src/<pack>/` (gitignored, unzipped by the user) to `packages/web/public/kaykit/<pack>/`
  (committed).
- `packages/web/src/scene/characters.ts` — pure, no three.js: `MAIN_BODY`, `SUB_BODIES`,
  `LOOKS`, `lookFor`, `PROP_GRIP`, `gripFor`, `clipFor` and the clip constants.
- `packages/web/src/scene/AgentFigure.tsx` — walk, `Character` (takes a `Look`), `Held`,
  `CharacterBoundary`, tag.
- `packages/web/src/scene/walk.ts` — pure walking motion, no three.js: `remainingDistance`,
  `nextSpeed`, `advance` (mutates the position, shifts reached waypoints, carries leftover
  step past corners, lands exactly on the last waypoint), `turnToward`, `approach`.
- `packages/web/src/scene/layout.ts`, `Room.tsx`, `Office.tsx`.
- `packages/web/test/dungeon.test.ts`, `walk.test.ts`, `characters.test.ts`,
  `layout.test.ts` (`layout.ts`: `ROOMS`, seats and `assignSpots`, altar `queueSpot`,
  `SPAWN`, `corridorPath`, `routeBetween`, `reroute`).

## Usage
- New model: add it to `kit-manifest.json`, run `npm run kaykit:import`. Never hand-copy
  files into `public/kaykit/`. Load every model through `useKitGLTF`, never `useGLTF` directly.
- New or changed role look: edit `LOOKS` (lower-case type key) and, for a new prop, the
  manifest models of its pack. A `tools` prop also needs a `PROP_GRIP` entry calibrated by
  eye (tested: every `tools` prop in `LOOKS` has a grip, every `adventurers_props` model is
  used). All six bodies (Barbarian, Knight, Mage, Ranger, Rogue, Rogue_Hooded) share the
  Rig_Medium skeleton (23 identical bones), so the shared clip files apply to every body.
- Grip calibration workflow: in Playwright, import the store by the URL actually loaded
  (take it from performance resource entries; Vite appends `?t=` after edits) and call
  `useOffice.setState({ sessions: [], roster: [...] })` so the tavern shows one resting
  figure per type. Hide other objects and move the camera for close-ups, mutate the grip
  group under the hand bone live, then copy the values into `PROP_GRIP`.
- Repeated pieces go through `<KitInstances>`; one-off furniture through `<Kit>`; a new
  prop is a `PROPS` entry. Put placement logic in `dungeon.ts` so it stays testable.
- Agent motion logic goes in `walk.ts`, clip choice in `clipFor` (both tested), never
  inline in `AgentFigure`'s `useFrame`, which only calls them.
- New decor must not cover seats or a door entry (tested in `dungeon.test.ts`).
- Preview: `.claude/launch.json` entry `agent-office-web` runs Vite dev on 5173, proxying to
  the test server on 4778. `agent-office` / `agent-office-test` serve `packages/web/dist`,
  which needs `npm run build` first. Previewing from a worktree with fake hooks:
  `docs/ai/agent-lifecycle.md`. The preview launcher reads the main folder's
  `.claude/launch.json`, so from a worktree run Vite on another port (5174 worked; the
  WebSocket is refused there, which is fine for store-injected galleries). The in-app
  Browser pane, when hidden, gives the Canvas size 0 and renders no frames; use Playwright
  for visual verification.
- Where figures rest, wait, appear and leave (tavern, altar, roster):
  `docs/ai/agent-lifecycle.md`.

## Notes
- The import script rejects unsafe names, `..` paths, symlinks, glTF extensions (Draco /
  Meshopt would fetch a decoder from a CDN), and glTF referencing files other than its own
  `.bin` and the pack textures. For `.glb`, `checkGlb` walks every chunk (exactly one JSON
  chunk first, an optional BIN, nothing else, aligned lengths) because the browser keeps
  the LAST JSON chunk; no buffer/image `uri`; it writes the validated buffer. Keep these
  checks when editing it.
- Running the import rewrites existing `.gltf` files with LF→CRLF noise under
  `core.autocrlf`: restore them with `git checkout` on the `dungeon`, `tools`, `weapons`
  folders.
- Some manifest models are unused on purpose, kept for upcoming 3D work (user decision).
  Do not prune them as dead code.
- Wall footprint matches the pre-KayKit one, so seat positions are unaffected.
- Orientation-based cutaway was tried and rejected; keep the cursor parabola.
- Tests must not import `kit.ts` or any `.tsx` file (drei / `import.meta.env`); test
  `dungeon.ts`, `layout.ts`, `walk.ts`, `characters.ts` and the manifest JSON.
- Walk speed was set so figures reach the room before short tasks finish (user request).
  The chibi legs walk naturally at 0.57 (`Walking_A`) and 1.4 u/s (`Running_A`) at
  `KIT_SCALE`, so feet slide at cruise speed by design. Accepted limits: a reroute to a
  target within braking distance drops speed in one frame; a doubling-back reroute turns
  at speed.
- No prop node name may equal a rig bone name: a clash would hijack animation tracks.
  Checked for the current props; re-check when adding one.
- Accepted limits of held props (review suggestions not done): props keep per-file
  materials (one texture copy per distinct held model, no `shareMaterial`); every held mesh
  casts a shadow; one R3F portal per prop (`bone.add` in a layout effect would be lighter).
- Clip blending must step weights with `approach(value, target, step)` from `walk.ts`
  (tested in `walk.test.ts`). An inline blend that took the decrease branch at
  `weight === target` flickered 1→0 every other slow frame, showing a T-pose.
- Kneeling replaced the old 30 cm sink at the altar; done agents are no longer transparent.
- First-load Suspense gotcha: an upper Suspense hides and re-shows the scene while the kit
  loads; React 19.2 runs passive effect cleanups then, so `useAnimations` stops every action
  while `Character`'s refs survive. `Character` restarts its clip when the current action
  is no longer `isScheduled()`. Keep this check.
- drei `<Html>` loses its content if mounted before the canvas events connect. Agent tags
  wait for `useThree(s => !!s.events.connected)`. `Room.tsx` signs still use the older
  "mount one tick later" trick: switching them to the connected guard left one sign
  consistently empty.
- Open items: about 700 draw calls per frame because props are not instanced (planned fix:
  drei `<Instances>` for shapes); the scene-wide Suspense hide/show also causes about 15
  "synchronously unmount a root" warnings per load and the `Room.tsx` sign issue above.
