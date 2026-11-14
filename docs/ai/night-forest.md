---
description: Use when changing the night environment around the castle — forest floor, trees, moat, drawbridge, dirt path, horizon, night shading or sky colour — or the camera pan limits.
---

# Night forest around the castle

## Current State
- `Forest` (in `Office.tsx`, next to the castle) draws: a forest floor disc r=320 at
  `GROUND_Y` −0.3 (so 30 cm of the castle base shows), a moat on the SOUTH side only, a
  lowered drawbridge, a dirt path, trees and a horizon. Canvas background = `NIGHT_SKY`
  (`#0b1020`); no `scene.fog`.
- Moat: `MOAT` rect, water at `WATER_Y` −1, earth banks whose tops sit 1 cm under the ground
  (avoids z-fighting). The castle stone base is the moat's north side.
- Drawbridge: `BRIDGE` rect in front of the castle gate (`GATE`, see
  `docs/ai/dungeon-scene.md`), planks on beams. No chains on purpose: they would hang from
  the gate, which sinks with the cutaway.
- Path: ribbon of half-width `PATH_HALF_WIDTH` along a Catmull-Rom through fixed knots
  (`pathPoints`), starting at the bridge.
- Trees: `scatterTrees()` returns `{ near, far }` from two jittered seeded grids: near
  detailed ring inside `NEAR_LIMIT` 26 m, far simplified trees out to `FAR_LIMIT` 150 m.
  `treeAllowed` excludes `CLEARING` 3.5 m from `OUTER`, `MOAT_CLEARANCE` and
  `PATH_CLEARANCE`. Kinds: `pine`, `round`.
- Trees are procedural low-poly (cones / icosahedra merged with vertex colours), instanced
  in `TreeInstances`: one draw call per kind × detail level. They are NOT KayKit.
- Horizon: a tileable pine silhouette painted on a canvas (no image file) on an inner
  cylinder r=280.
- Night look, castle untouched: `nightify(material)` patches `onBeforeCompile` after
  `#include <opaque_fragment>` (three r171 chunk name): light × `uNearLight` 0.34 near the
  castle down to `uFarLight` 0.11, moon-blue tint, then fade to `NIGHT_SKY` with distance to
  the castle rectangle (30→150 m). Night materials set `toneMapped = false` so the fade
  matches the untonemapped background.
- Camera: `Office.tsx` clamps the OrbitControls target to `BOUNDS` ± `PAN_MARGIN` 20 so
  panning cannot leave the finite world.

## Relevant Files
- `packages/web/src/scene/forest.ts` — pure, no three.js: `GROUND_Y`, `WATER_Y`,
  `NIGHT_SKY`, `Rect`, `MOAT`, `BRIDGE`, `distanceToRect`, `PATH_HALF_WIDTH`, `pathPoints`,
  `distanceToPath`, `Tree`, `TreeKind`, the clearance / limit constants, `treeAllowed`,
  `scatterTrees`.
- `packages/web/src/scene/Forest.tsx` — `Forest` plus module-private `inject`, `nightify`,
  shared materials `MAT`, `useGeometry`, `TreeInstances`, `Ground`, `Moat`, `Path`, `Horizon`.
- `packages/web/src/scene/Office.tsx` — mounts `<Forest />`, background colour, pan clamp.
- `packages/web/test/forest.test.ts`.

## Usage
- Placement logic (what goes where, exclusions) belongs in `forest.ts` so it stays tested;
  `Forest.tsx` only renders it.
- Any new scenery material goes in `MAT` (module-level, shared) and through `nightify`, with
  `toneMapped = false`. Build geometries with `useGeometry` so they are freed on unmount.
- `inject` warns in dev when a shader chunk is missing: check it after a three.js upgrade.
- Switching trees to KayKit (open item below): add a `forest` pack to `kit-manifest.json`,
  run the import (`docs/ai/dungeon-scene.md`), and replace the `TreeInstances` geometry with
  `<KitInstances>`.
- Preview: `docs/ai/dungeon-scene.md` (Usage).

## Notes
- Open item: the user chose the KayKit Forest Nature Pack (CC0, free tier, gltf) for trees,
  but it was not available in `assets-src/`, so procedural trees stand in.
- Accepted limits (review suggestions not done): far trees are not culled (one bounding
  sphere per instanced set); low camera angles may let near trees hide part of the castle;
  a faint bluish band below the horizon silhouette (partial fade) was kept.
