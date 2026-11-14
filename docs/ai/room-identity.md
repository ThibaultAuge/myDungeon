---
description: Use when changing a room's visual identity — per-room wall variants, wall hangs, room lights, decor kinds and decor recipes (decor.ts), the skeleton dummy — or the static mesh merging of posts (merge.ts) and the scene's draw-call count.
---

# Room identity, decor recipes and mesh merging

## Current State
- Tone (user decision): medieval with a few modern winks.
- `RoomDef` (`layout.ts`) optional identity fields:
  - `walls`: `[model, weight][]`, replaces `WALL_VARIANTS` for that room's wall chunks
    ≥ 1.5 m.
  - `hangs`: `WallHang { pack, name, y, back?, s? }[]`. On the decor roll they replace the
    banners for that room (torches unchanged); placed using the wall's thickness.
  - `light`: `RoomLight { color, intensity }` → one non-shadow `pointLight` per room at
    y 2.6, distance `max(w, d) * 0.75 + 2`, decay 1.6. Zones inside another room have none.
- Tall wall keys: `tallKey(pack, name)` (`dungeon.ts`) is the bare name for `dungeon`, else
  `"pack:name"`; `tallModel(key)` reverses it. `Structure.tsx`'s `CutawayKit` resolves keys
  with `tallModel`.
- Decor kinds: `DECOR_KINDS` exported from `layout.ts` (tests also keep their own lists).
  A kind with a recipe in `decor.ts` `DECOR_RECIPES` (`DecorPiece { pack, name, x, z, y?,
  rot?, s?, shadow? }`, Y-turn only) is drawn map-wide by `DecorInstances` (`Room.tsx`) from
  `decorPlacement(rooms)`: one instanced batch per pack / model / shadow flag. `shadow`
  defaults to `s >= 0.6`. `PROPS` still has a `Recipe` renderer for each recipe kind
  (`Record<PropKind>` requires it); it is not used on the map.
- `skeleton` kind has no recipe: `SkeletonDummy.tsx` (pack `skeletons`, `Skeleton_Minion`)
  plays the idle `Rig_Medium` clip, restarted from `useFrame` when the action is no longer
  `isScheduled()` (first-load Suspense hide stops it, same gotcha as `Character` in
  `docs/ai/dungeon-scene.md`); paused under reduced motion; skeleton disposed on unmount.
- `weeds` and `cobwebs` have `[0, 0]` footprints (walk-through / overhead). Post piece kind
  `keg` exists (taverne).
- Per-room choices: observatoire chart chest + arched windows; pigeonnier sacks, grass,
  chicken-plushie birds in the aviary; cartes chart chest, frame/shield hangs; biblio
  `wall_shelves` + book pile with `book_mimic`; atelier lumber, forge (anvil, grindstone),
  scaffold walls; autel Halloween `shrine_candles` on the candle posts + triple banners;
  machines woodstove boiler, fuel barrels, hanging chains; arithmetique treasury of bars;
  detente Furniture couch + oval rug, gamer corner (chair, console, guitar), puzzle cube;
  concierge cobwebs in the back corners + cracked walls; garde prison bones / shackle, bear
  trap, shield / keyring / sword hangs; epreuves skeleton test subject; heraut frames;
  taverne log stack, pantry crates, kegs, stew and dinner plates.
- Corridors do not use `floor_tile_large_rocks` (user: looked like a boulder); the model
  stays in the manifest.
- Mesh merging: `merge.ts` `mergeStatic(root)` merges a post's static meshes sharing
  `lookKey` + shadow flags + attribute layout into one mesh per group (sources hidden, not
  removed; merged mesh gets `userData.noMerge`); `unmerge` undoes it. `Post.tsx` calls it in
  its `useLayoutEffect` right after building hit boxes, cleanup unmerges. Materials are read
  through `highlight.ts` `baseMaterial`, so a glowing post never bakes the glow.
- Merge skips: `InstancedMesh`, `SkinnedMesh`, `userData.noMerge`, invisible (checked up to
  root), array materials, non-standard or transparent materials, morph targets, non-Float32
  or normalized positions, meshes mirrored relative to the root. Non-plain standard
  materials merge only with the very same material instance.
- Draw calls per frame (Playwright count): 618 → 368 from these changes before merging
  main; 443 after merging main (its forest adds draws; main alone not measured).

## Relevant Files
- `packages/web/src/scene/layout.ts` — `RoomDef.walls` / `hangs` / `light`, `WallHang`,
  `RoomLight`, `DECOR_KINDS`, per-room decor.
- `packages/web/src/scene/decor.ts` — `DecorPiece`, `DECOR_RECIPES`, `decorPlacement`.
- `packages/web/src/scene/Room.tsx` — `DecorInstances`, room lights.
- `packages/web/src/scene/dungeon.ts` — `tallKey`, `tallModel`, wall variant and hang
  placement; `Structure.tsx` — `CutawayKit`.
- `packages/web/src/scene/SkeletonDummy.tsx`, `props.tsx` (`PROPS`, `Recipe`).
- `packages/web/src/scene/merge.ts` — `lookKey`, `mergeStatic`, `unmerge`; `Post.tsx`;
  `highlight.ts` (`baseMaterial`).
- Tests: `packages/web/test/decor.test.ts`, `merge.test.ts`, `dungeon.test.ts`,
  `layout.test.ts`, `forest.test.ts`.

## Usage
- New room look: set `walls`, `hangs`, `light` on the `RoomDef`; do not add per-room
  branches in rendering code.
- New multi-piece decor: add a `DECOR_RECIPES` entry (plus its `PROPS` `Recipe` entry for
  the type) instead of a new component; it is batched automatically. Models come from the
  manifest (see `docs/ai/dungeon-scene.md`).
- Post children must be static (no changing `visible` / material props after mount); a
  piece that changes opts out with `userData.noMerge`.
- Hover / selection material swaps must keep going through `highlight.ts` so
  `baseMaterial` stays correct for merging.

## Notes
- Accepted limits / open items: the 15 point lights add per-fragment GPU cost (not measured,
  only draw calls were); `lookKey`'s plain-material check is an exclusion list
  (`bumpMap`, `displacementMap`, `lightMap`, `blending`… not checked); a merge redone while
  hovered leaves merged parts unlit until the next hover change; the `Recipe` fallback path
  is unused.
