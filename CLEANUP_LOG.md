# Cleanup log

Record of dead code removed after confirmation, for rollback reference.

## 2026-11-13 — branch feat/carte-donjon

Removed from `packages/web/src/scene/layout.ts` (formerly lines 104-106), unused exported
constants duplicated by the private `S`, `E`, `W` used in the room tables:

```ts
export const SOUTH = 0; // faces +z
export const EAST = Math.PI / 2;
export const WEST = -Math.PI / 2;
```

Reason: zero references in `packages/*/src` or `packages/*/test`; `@agent-office/web` is a
private package, so no external consumers. `NORTH` was kept (used in layout.ts and its test).

## 2026-11-14 — branch feat/carte-kaykit

Code-only cleanup after the KayKit map rewrite. Assets (`kit-manifest.json`,
`packages/web/public/kaykit/**`) left untouched on purpose: the 3D work is not finished.

- `packages/web/src/scene/kit.ts`: removed the re-export `export { KIT_SCALE } from './dungeon.ts';`
  (zero importers; everyone imports `KIT_SCALE` from `dungeon.ts`). Dropped `export` from
  `kitUrl` and `allKitModels` (used only inside kit.ts) and changed the `allKitModels` comment
  from "for preloading and for the manifest test" to "for preloading" (the test reads the JSON
  directly).
- `packages/web/src/scene/layout.ts`: removed the orphan comment
  `/** Room names, for the HTML panels. */` and its blank line (left behind when `ROOM_NAMES`
  was removed by the i18n commit ce4bff4).
- `packages/web/src/scene/props.tsx`: dropped `export` from `PALETTE`, `ACCENT_HEX`, `Box`,
  `Cyl`, `Ball` (used only inside props.tsx). Symbols unchanged.

Rollback: re-add the `export` keywords / the re-export line; `tsc --noEmit` was clean after the change.

## 2026-11-14 — branch feat/agent-characters

Cleanup after the KayKit adventurer characters replaced the capsule figure.

- `packages/web/src/scene/kit.ts`: dropped `export` from `kitUrl` again (the characters change
  had re-exported it, but it is only called inside kit.ts, by `useKitGLTF` and `preloadKit`;
  `AgentFigure.tsx` loads models through `useKitGLTF`). Function unchanged.

Rollback: re-add `export` before `function kitUrl(`; `tsc --noEmit` was clean after the change.
