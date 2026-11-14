---
description: Use when changing the 3D dungeon map — rooms, floors, walls, cutaway, props, lighting, KayKit models or their import — agent figures (walking motion, character models, animations), or when previewing the web scene.
---

# 3D dungeon scene (KayKit assets)

## Current State
- The map is built from KayKit CC0 models (Dungeon Pack 1.1, RPG Tools Bits 1.0, Fantasy
  Weapons Bits 1.0, free tiers), grouped in three packs: `dungeon`, `tools`, `weapons`.
  Agents use KayKit Adventurers 2.0 (CC0): packs `adventurers` (character skins) and
  `adventurers_anim` (shared `Rig_Medium_General`, `Rig_Medium_MovementBasic` clips).
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
- Skins: `CHARACTERS` in `characters.ts` lists skins per kind — `Knight` for main agents,
  `Rogue_Hooded` for subagents (scale 0.85). `characterFor(kind, id)` picks one
  deterministically from a hash of the id.
- Walking: cruise `CRUISE_SPEED` 9 u/s, `ACCELERATION` 18 u/s², `MIN_SPEED` 0.3, with
  ease-in / ease-out over the WHOLE route (braking curve `sqrt(2·A·remaining)` on the total
  remaining distance, so no stop at corners). Speed lives in a ref in `AgentFigure`, reset
  to 0 when the path empties; a reroute keeps the current speed. Facing uses `turnToward`
  with exponential rates (`WALK_TURN_RATE` 14, `REST_TURN_RATE` 6).
- Clips: `clipFor` (pure, in `characters.ts`) picks, in priority order: spawn
  (`Spawn_Ground`, once, ×1.5, only for a figure whose `start` is the lockers `SPAWN` and not
  done; one coming from a resting seat just walks) > moving (`Walking_A`, or `Running_A` above
  `RUN_THRESHOLD`; rate = speed / measured clip speed, capped at `MAX_CLIP_RATE`) >
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
- `packages/web/src/scene/characters.ts` — pure, no three.js: `CHARACTERS`, `characterFor`,
  `clipFor` and the clip constants.
- `packages/web/src/scene/AgentFigure.tsx` — walk, `Character`, `CharacterBoundary`, tag.
- `packages/web/src/scene/walk.ts` — pure walking motion, no three.js: `remainingDistance`,
  `nextSpeed`, `advance` (mutates the position, shifts reached waypoints, carries leftover
  step past corners, lands exactly on the last waypoint), `turnToward`.
- `packages/web/src/scene/layout.ts`, `Room.tsx`, `Office.tsx`.
- `packages/web/test/dungeon.test.ts`, `walk.test.ts`, `characters.test.ts`.

## Usage
- New model: add it to `kit-manifest.json`, run `npm run kaykit:import`. Never hand-copy
  files into `public/kaykit/`. Load every model through `useKitGLTF`, never `useGLTF` directly.
- New agent skin (planned: a distinct skin per subagent): add the name to
  `CHARACTERS.sub` (or `.main`) and to the manifest `adventurers` models. The source zip
  holds Barbarian, Knight, Mage, Ranger, Rogue, Rogue_Hooded. All share the Rig_Medium
  skeleton (23 identical bones), so the shared clip files apply to every skin.
- Repeated pieces go through `<KitInstances>`; one-off furniture through `<Kit>`; a new
  prop is a `PROPS` entry. Put placement logic in `dungeon.ts` so it stays testable.
- Agent motion logic goes in `walk.ts`, clip choice in `clipFor` (both tested), never
  inline in `AgentFigure`'s `useFrame`, which only calls them.
- New decor must not cover seats or a door entry (tested in `dungeon.test.ts`).
- Preview: `.claude/launch.json` entry `agent-office-web` runs Vite dev on 5173, proxying to
  the test server on 4778. `agent-office` / `agent-office-test` serve `packages/web/dist`,
  which needs `npm run build` first. Previewing from a worktree with fake hooks:
  `docs/ai/agent-lifecycle.md`. The in-app Browser pane, when hidden, gives the Canvas
  size 0 and renders no frames; use Playwright for visual verification.
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
  `dungeon.ts`, `walk.ts`, `characters.ts` and the manifest JSON.
- Walk speed was set so figures reach the room before short tasks finish (user request).
  The chibi legs walk naturally at 0.57 (`Walking_A`) and 1.4 u/s (`Running_A`) at
  `KIT_SCALE`, so feet slide at cruise speed by design. Accepted limits: a reroute to a
  target within braking distance drops speed in one frame; a doubling-back reroute turns
  at speed.
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
