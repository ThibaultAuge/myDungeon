---
description: Use when changing the 3D dungeon map — rooms, floors, walls, cutaway, props, lighting, KayKit models or their import — or when previewing the web scene.
---

# 3D dungeon scene (KayKit assets)

## Current State
- The map is built from KayKit CC0 models (Dungeon Pack 1.1, RPG Tools Bits 1.0, Fantasy
  Weapons Bits 1.0, free tiers), grouped in three packs: `dungeon`, `tools`, `weapons`.
- KayKit is about 1.33x our scene: every model is scaled by `KIT_SCALE = 0.75`. After
  scaling: small floor tile 1.5 m, wall 3 m high per 3 m chunk, table 0.75 m. Agents are
  1.64 m tall.
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
- `packages/web/src/scene/kit.ts` — loads models with drei `useGLTF`; one shared material per
  pack + material name.
- `packages/web/src/scene/kit-manifest.json` — models and textures per pack.
- `scripts/import-kaykit.mjs` (`npm run kaykit:import`) — copies manifest entries from
  `assets-src/<pack>/` (gitignored, unzipped by the user) to `packages/web/public/kaykit/<pack>/`
  (committed).
- `packages/web/src/scene/layout.ts`, `Room.tsx`, `Office.tsx`, `AgentFigure.tsx`.
- `packages/web/test/dungeon.test.ts`.

## Usage
- New model: add it to `kit-manifest.json`, run `npm run kaykit:import`. Never hand-copy
  files into `public/kaykit/`.
- Repeated pieces go through `<KitInstances>`; one-off furniture through `<Kit>`; a new
  prop is a `PROPS` entry. Put placement logic in `dungeon.ts` so it stays testable.
- New decor must not cover seats or a door entry (tested in `dungeon.test.ts`).
- Preview: `.claude/launch.json` entry `agent-office-web` runs Vite dev on 5173, proxying to
  the test server on 4778. `agent-office` / `agent-office-test` serve `packages/web/dist`,
  which needs `npm run build` first.

## Notes
- The import script rejects unsafe names, `..` paths, symlinks, glTF extensions (Draco /
  Meshopt would fetch a decoder from a CDN), and glTF referencing files other than its own
  `.bin` and the pack textures. Keep these checks when editing it.
- Some manifest models are unused on purpose, kept for upcoming 3D work (user decision).
  Do not prune them as dead code.
- Wall footprint matches the pre-KayKit one, so seat positions are unaffected.
- Orientation-based cutaway was tried and rejected; keep the cursor parabola.
- Tests must not import `kit.ts` or any `.tsx` file (drei / `import.meta.env`); test
  `dungeon.ts` and the manifest JSON.
- Open items: about 700 draw calls per frame because props are not instanced (planned fix:
  drei `<Instances>` for shapes); a drei `<Html>` unmount warning predates this work.
