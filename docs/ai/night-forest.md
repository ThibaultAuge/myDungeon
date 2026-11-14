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
  `PATH_CLEARANCE`. Kinds: `pine`, `round`. `Tree.variant` (0–1) picks the near model;
  `Tree.shade` applies to far trees only.
- Near ring = KayKit Forest Nature Pack 1.0 (free tier, CC0), manifest pack `forest`: 16
  models, all `_Color1`, one shared pack material `forest` with `forest_texture.png`
  (tested). `forest.ts` lists `PINE_MODELS` (Tree_4_A twice, Tree_4_B), `LEAFY_MODELS`
  (Tree_1/2/3 A/B with repeats, two bare trees), `BUSH_MODELS` (4), `ROCK_MODELS` (2);
  `nearModel(tree)` chooses by kind and `variant`; trees are scaled by
  `KAYKIT_TREE_SCALE` 0.8. `scatterUndergrowth()` puts bushes and a few rocks in the near
  ring with the same `treeAllowed` exclusions.
- `NearForest` renders through `<KitInstances pack="forest">` with its own night-shaded
  `MeshLambertMaterial` reusing the pack texture (colour 0.6), copied from
  `FOREST_MATERIAL_SOURCE`; the kit's shared material is never modified. One instanced set
  per model AND per quadrant around the castle, so frustum culling drops the sides out of
  view. `shadow={false}`, `receiveShadow={false}`. Wrapped in `ForestBoundary` (error
  boundary, `null` fallback) + `Suspense`: a failed forest load only removes the near trees
  and undergrowth.
- Far ring = `FarTrees`: procedural low-poly cones / icosahedra merged with vertex colours,
  one instanced mesh per kind (KayKit there would cost about 5× the triangles).
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
  `scatterTrees`, the KayKit model lists, `FOREST_MATERIAL_SOURCE`, `KAYKIT_TREE_SCALE`,
  `nearModel`, `Undergrowth`, `scatterUndergrowth`.
- `packages/web/src/scene/Forest.tsx` — `Forest` plus module-private `inject`, `nightify`,
  shared materials `MAT`, `useGeometry`, `FarTrees`, `quadrant`, `ForestBoundary`,
  `NearForest`, `Ground`, `Moat`, `Drawbridge`, `Path`, `Horizon`.
- `packages/web/src/scene/KitInstances.tsx` — optional `material` (override) and
  `receiveShadow` props, used by `NearForest`.
- `packages/web/src/scene/kit-manifest.json` (`forest` pack), `packages/web/public/kaykit/forest/`.
- `packages/web/src/scene/Office.tsx` — mounts `<Forest />`, background colour, pan clamp.
- `packages/web/test/forest.test.ts`.

## Usage
- Placement logic (what goes where, exclusions) belongs in `forest.ts` so it stays tested;
  `Forest.tsx` only renders it.
- Any new scenery material goes in `MAT` (module-level, shared) and through `nightify`, with
  `toneMapped = false`. Build geometries with `useGeometry` so they are freed on unmount.
- `inject` warns in dev when a shader chunk is missing: check it after a three.js upgrade.
- New forest model: add it to the `forest` pack in `kit-manifest.json` (source files
  unzipped by the user in `assets-src/forest/`) and run `npm run kaykit:import`
  (`docs/ai/dungeon-scene.md`); keep `_Color1` variants so the single-material assumption
  holds. Near-ring scenery reuses `NearForest`'s material and per-quadrant placement;
  never pass the kit's shared material to `nightify`.
- Preview: `docs/ai/dungeon-scene.md` (Usage).

## Notes
- Never use `Tree_4_C` (about 10.8 m tall): the user rejected it as towering over the forest.
- Accepted limits (review suggestions not done): far trees are not culled (one bounding
  sphere per instanced set); low camera angles may let near trees hide part of the castle;
  a faint bluish band below the horizon silhouette (partial fade) was kept.
