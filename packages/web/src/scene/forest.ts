import { OUTER, seeded } from './dungeon.ts';
import { GATE, type Point } from './layout.ts';

// The night forest around the castle: ground, moat, drawbridge, path and where the trees
// stand. Pure geometry, no three.js scene: testable in node.

/** Height of the forest floor. The castle's stone base shows 30 cm above it. */
export const GROUND_Y = -0.3;
/** Height of the moat water, below the forest floor. */
export const WATER_Y = -1;
/** Colour of the night sky, the background and the far forest fading into it. */
export const NIGHT_SKY = '#0b1020';

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** The moat runs along the south side only, a little past both corners. */
export const MOAT: Rect = { x0: OUTER.x0 - 3, x1: OUTER.x1 + 3, z0: OUTER.z1, z1: OUTER.z1 + 3 };

/** The lowered drawbridge, from the gate to the far bank of the moat. */
export const BRIDGE: Rect = { x0: GATE.lo + 0.25, x1: GATE.hi - 0.25, z0: OUTER.z1, z1: MOAT.z1 + 0.5 };

/** Distance from a point to a rectangle, 0 inside it. */
export function distanceToRect(x: number, z: number, r: Rect): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

/** Where the path bends, from the end of the drawbridge into the forest. */
const PATH_KNOTS: Point[] = [
  { x: (GATE.lo + GATE.hi) / 2, z: BRIDGE.z1 },
  { x: 5.5, z: 19 },
  { x: 3, z: 27 },
  { x: 7.5, z: 37 },
  { x: 2, z: 50 },
  { x: 6.5, z: 64 },
  { x: -1, z: 82 },
  { x: 4, z: 102 },
  { x: -3, z: 128 },
  { x: 1, z: 160 },
];

/** Half the width of the path. */
export const PATH_HALF_WIDTH = 0.85;

/**
 * Points along the path, `perSegment` per bend (uniform Catmull-Rom through the bends: the
 * path passes through each of them and turns smoothly).
 */
export function pathPoints(perSegment = 12): Point[] {
  const k = PATH_KNOTS;
  const out: Point[] = [];
  for (let i = 0; i < k.length - 1; i++) {
    const p0 = k[Math.max(i - 1, 0)];
    const p1 = k[i];
    const p2 = k[i + 1];
    const p3 = k[Math.min(i + 2, k.length - 1)];
    for (let s = 0; s < perSegment; s++) {
      const t = s / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: cr(p0.x, p1.x, p2.x, p3.x), z: cr(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  out.push(k[k.length - 1]);
  return out;
}

/** Distance from a point to a polyline. */
export function distanceToPath(x: number, z: number, path: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const vx = b.x - a.x;
    const vz = b.z - a.z;
    const len2 = vx * vx + vz * vz;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / len2));
    best = Math.min(best, Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t)));
  }
  return best;
}

export type TreeKind = 'pine' | 'round';

export interface Tree {
  x: number;
  z: number;
  rotY: number;
  /** Size factor: 1 is a tree about 4.5 m high. */
  scale: number;
  kind: TreeKind;
  /** Brightness factor of the whole tree (foliage and trunk), for variety. */
  shade: number;
}

/** Clear ground left between the castle walls and the first trees. */
export const CLEARING = 3.5;
/** Trees closer to the castle than this are detailed; farther ones are simpler. */
export const NEAR_LIMIT = 26;
/** No tree beyond this distance from the castle: the horizon silhouette takes over. */
export const FAR_LIMIT = 150;
const NEAR_STEP = 2.8;
const FAR_STEP = 4.6;
/** Free space kept on each side of the path, from its middle. */
export const PATH_CLEARANCE = 2.4;
/** Free space kept around the moat. */
export const MOAT_CLEARANCE = 1.5;

/** True when a tree may stand at (x, z): out of the clearing, the moat and the path. */
export function treeAllowed(x: number, z: number, path: Point[]): boolean {
  if (distanceToRect(x, z, OUTER) < CLEARING) return false;
  if (distanceToRect(x, z, MOAT) < MOAT_CLEARANCE) return false;
  return distanceToPath(x, z, path) >= PATH_CLEARANCE;
}

/**
 * Trees on two jittered grids: a dense ring of detailed trees around the castle, then a wider
 * grid of simple ones out to FAR_LIMIT. Deterministic.
 */
export function scatterTrees(): { near: Tree[]; far: Tree[] } {
  const path = pathPoints();
  const near: Tree[] = [];
  const far: Tree[] = [];
  const grid = (step: number, reach: number, key: string, keep: (d: number) => boolean, out: Tree[]) => {
    const rand = seeded(key);
    for (let x = OUTER.x0 - reach; x <= OUTER.x1 + reach; x += step) {
      for (let z = OUTER.z0 - reach; z <= OUTER.z1 + reach; z += step) {
        // Always draw the same number of values per cell, so a skipped cell shifts nothing.
        const jx = (rand() - 0.5) * step * 0.9;
        const jz = (rand() - 0.5) * step * 0.9;
        const gap = rand();
        const rot = rand();
        const size = rand();
        const kind = rand();
        const shade = rand();
        const tx = x + jx;
        const tz = z + jz;
        const d = distanceToRect(tx, tz, OUTER);
        if (!keep(d) || gap < 0.12 || !treeAllowed(tx, tz, path)) continue;
        out.push({
          x: tx,
          z: tz,
          rotY: rot * Math.PI * 2,
          scale: 0.8 + size * 0.6,
          kind: kind < 0.7 ? 'pine' : 'round',
          shade: 0.75 + shade * 0.4,
        });
      }
    }
  };
  grid(NEAR_STEP, NEAR_LIMIT, 'forest:near', (d) => d < NEAR_LIMIT, near);
  grid(FAR_STEP, FAR_LIMIT, 'forest:far', (d) => d >= NEAR_LIMIT && d < FAR_LIMIT, far);
  return { near, far };
}
