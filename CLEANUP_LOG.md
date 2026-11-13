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
