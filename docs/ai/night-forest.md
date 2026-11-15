---
description: Use when changing the night environment around the castle — forest floor, trees, moat, drawbridge, dirt path, horizon, night shading or sky colour — the dungeon name sign, pennants and per-environment dungeon colour (heraldry.ts, DungeonSign), or the camera pan limits.
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
  `PATH_CLEARANCE`, plus `SIGN_CLEARANCE` and `PENNANT_CLEARANCE` around the sign and
  pennants (the pennant one is redundant with moat/path today, kept as a guard). Kinds: `pine`, `round`. `Tree.variant` (0–1) picks the near model;
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
- Dungeon name sign: `DungeonSign` (group `dungeon-sign`), mounted by `OfficeScene` after
  `Forest` only when `dungeon.name` is set; `App.tsx` `EnvPage` passes
  `{ name: envName(env, t), color: dungeonColor(env.id, env.virtual) }`, nothing when the
  env is unknown. Placed at `SIGN` (east of the path just past the drawbridge,
  z = `BRIDGE.z1` + 2.4), board 5.6 × 1.7 m (`SIGN_WIDTH`) on two posts, whole sign leaning
  back (−0.5 rad) toward the overhead camera; a 3.2 m board was unreadable from the default
  camera (~50 m). The board is turned by `SIGN_YAW` (−0.25 rad) so its face looks slightly
  south-west toward the path instead of parallel to the castle wall (user decision: only
  slightly; −0.4 looked too strong from the camera). `DungeonSign` nests an outer group
  rotated `[0, SIGN_YAW, 0]` and an inner one `[LEAN, 0, 0]`, so the lean happens in the
  board's own frame; a single Euler `[LEAN, SIGN_YAW, 0]` (XYZ order) would lean around world
  X. Reuse the pure `alongSign(t)` (t = −1 west end … 1 east end) for any point along the
  turned board's foot instead of recomputing the rotation; `forest.test.ts` checks it against
  three.js `applyAxisAngle`. `SIGN_CLEARANCE` still covers the turned board. The +z face of the board's `BoxGeometry` (material array) carries a
  `CanvasTexture`: wood planks, bands in the dungeon colour, the name in serif sized by
  `fitLabel`. A small flag on the left post, plus two `Pennant`s (pole, crossbar,
  swallowtail cloth, 5 m) at `PENNANTS`, either side of the bridge landing
  (z = `BRIDGE.z1` − 0.25). The sign is NOT nightified (lit like the castle) and stays
  readable at night through `emissiveMap` = the same canvas at 0.35, no extra light.
  Raycast disabled.
- Dungeon colour (`heraldry.ts`): `dungeonColor(envId, virtual)` = FNV-1a hash of the env ID
  into `DUNGEON_PALETTE` (9 hues chosen to stay distinct at night: one green, no teal, which
  looked like the green); the virtual env gets `VIRTUAL_COLOR` grey. Hashing the ID (user
  decision) keeps the colour when the env is renamed. Not user-configurable (envs come from
  Claude desktop presets). Used outside only: interior banners keep their per-room accent
  colours (`docs/ai/room-identity.md`).
- `fitLabel(text, maxWidth, measure, max=150, min=64, step=4)`: largest font size that fits,
  last step clamped to `min`, non-positive step treated as 1; if nothing fits at `min`, the
  text is cut by code points with `…`. Only the first 120 code points are considered, which
  bounds the measuring cost.
- Fireworks in the night sky behind the castle (celebration gag, not nightified):
  `docs/ai/celebrations.md`.
- Camera: `Office.tsx` clamps the OrbitControls target to `BOUNDS` ± `PAN_MARGIN` 20
  (`outside.ts`) so panning cannot leave the finite world.
- Figures outside the castle (main agents walking in from the path end, the skeleton ambush
  on the path, `groundY` height on the drawbridge and ground, path indices `PATH`):
  `docs/ai/agent-lifecycle.md`. Path knots or bridge changes move those routes and kill
  points; re-run `outside.test.ts`.

## Relevant Files
- `packages/web/src/scene/forest.ts` — pure, no three.js: `GROUND_Y`, `WATER_Y`,
  `NIGHT_SKY`, `Rect`, `MOAT`, `BRIDGE`, `distanceToRect`, `PATH_HALF_WIDTH`, `pathPoints`,
  `distanceToPath`, `Tree`, `TreeKind`, the clearance / limit constants, `treeAllowed`,
  `scatterTrees`, the KayKit model lists, `FOREST_MATERIAL_SOURCE`, `KAYKIT_TREE_SCALE`,
  `nearModel`, `Undergrowth`, `scatterUndergrowth`, `SIGN_WIDTH`, `SIGN`, `SIGN_YAW`, `alongSign`, `PENNANTS`.
- `packages/web/src/scene/heraldry.ts` — pure: `DUNGEON_PALETTE`, `VIRTUAL_COLOR`, `fnv1a`,
  `dungeonColor`, `fitLabel`.
- `packages/web/src/scene/DungeonSign.tsx` — memoised `DungeonSign({ name, color })`,
  `Pennant`, module-level shared geometries and materials.
- `packages/web/src/App.tsx` — `EnvPage` builds the `dungeon` prop.
- `packages/web/src/scene/Forest.tsx` — `Forest` plus module-private `inject`, `nightify`,
  shared materials `MAT`, `useGeometry`, `FarTrees`, `quadrant`, `ForestBoundary`,
  `NearForest`, `Ground`, `Moat`, `Drawbridge`, `Path`, `Horizon`.
- `packages/web/src/scene/KitInstances.tsx` — optional `material` (override) and
  `receiveShadow` props, used by `NearForest`.
- `packages/web/src/scene/kit-manifest.json` (`forest` pack), `packages/web/public/kaykit/forest/`.
- `packages/web/src/scene/Office.tsx` — mounts `<Forest />` and `<DungeonSign />`
  (`OfficeScene({ dungeon?: Dungeon })`, exported `Dungeon { name, color }`), background
  colour, pan clamp.
- `packages/web/src/scene/outside.ts` — `PAN_MARGIN` (other exports:
  `docs/ai/agent-lifecycle.md`).
- `packages/web/test/forest.test.ts`, `packages/web/test/heraldry.test.ts`.

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
- Any per-environment colour or label reuses `dungeonColor` and `fitLabel` from
  `heraldry.ts`. Canvas-textured scenery follows `DungeonSign`: texture and materials in
  `useMemo`, disposed in the effect cleanup (same pattern as `useGeometry`; safe under
  StrictMode because three re-uploads disposed resources). New objects near the path or
  bridge need a clearance in `treeAllowed`.
- Preview: `docs/ai/dungeon-scene.md` (Usage). To see the sign in a worktree Vite with no
  server, open `/env/<id>` and run
  `(await import('/src/store.ts')).useOffice.setState({ environments: [...] })` with an env
  of that id.
- A visible change near the castle gate means re-capturing the home page image:
  `docs/ai/ui-theme.md`.

## Notes
- Never use `Tree_4_C` (about 10.8 m tall): the user rejected it as towering over the forest.
- Accepted limits (review suggestions not done): far trees are not culled (one bounding
  sphere per instanced set); low camera angles may let near trees hide part of the castle;
  a faint bluish band below the horizon silhouette (partial fade) was kept.
