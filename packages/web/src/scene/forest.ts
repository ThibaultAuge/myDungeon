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
  /** Brightness factor of the whole tree (foliage and trunk), for variety. Far trees only. */
  shade: number;
  /** Picks the model among those of its kind, from 0 to 1. */
  variant: number;
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

/** Width of the board of the dungeon's name sign. */
export const SIGN_WIDTH = 5.6;

/**
 * The wooden sign bearing the dungeon's name, beside the path just past the drawbridge, east
 * of it so it never stands in the way of the figures walking in. It faces +z, the default
 * camera.
 */
export const SIGN: Point = { x: (GATE.lo + GATE.hi) / 2 + PATH_HALF_WIDTH + 0.4 + SIGN_WIDTH / 2, z: BRIDGE.z1 + 1.8 };

/** The two dungeon-coloured pennants framing the landing of the drawbridge, on firm ground. */
export const PENNANTS: Point[] = [
  { x: BRIDGE.x0 - 0.4, z: BRIDGE.z1 - 0.25 },
  { x: BRIDGE.x1 + 0.4, z: BRIDGE.z1 - 0.25 },
];

/** Free ground kept around the sign and the pennants, so no tree or bush goes through them. */
export const SIGN_CLEARANCE = SIGN_WIDTH / 2 + 0.8;
export const PENNANT_CLEARANCE = 1.4;

/** True when a tree may stand at (x, z): out of the clearing, the moat, the path and the sign. */
export function treeAllowed(x: number, z: number, path: Point[]): boolean {
  if (distanceToRect(x, z, OUTER) < CLEARING) return false;
  if (distanceToRect(x, z, MOAT) < MOAT_CLEARANCE) return false;
  if (Math.hypot(x - SIGN.x, z - SIGN.z) < SIGN_CLEARANCE) return false;
  if (PENNANTS.some((p) => Math.hypot(x - p.x, z - p.z) < PENNANT_CLEARANCE)) return false;
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
        const variant = rand();
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
          variant,
        });
      }
    }
  };
  grid(NEAR_STEP, NEAR_LIMIT, 'forest:near', (d) => d < NEAR_LIMIT, near);
  grid(FAR_STEP, FAR_LIMIT, 'forest:far', (d) => d >= NEAR_LIMIT && d < FAR_LIMIT, far);
  return { near, far };
}

// ---------------------------------------------------------------- KayKit models (near ring)

/**
 * KayKit Forest models for the near pines. Tree_4_C (almost 11 m, towering over the forest)
 * is left out on purpose.
 */
export const PINE_MODELS = ['Tree_4_A_Color1', 'Tree_4_A_Color1', 'Tree_4_B_Color1'] as const;
/** KayKit Forest models for the near broadleaf trees, a dead tree now and then. */
export const LEAFY_MODELS = [
  'Tree_1_A_Color1',
  'Tree_1_B_Color1',
  'Tree_3_A_Color1',
  'Tree_3_B_Color1',
  'Tree_2_A_Color1',
  'Tree_2_B_Color1',
  'Tree_1_A_Color1',
  'Tree_3_A_Color1',
  'Tree_Bare_1_A_Color1',
  'Tree_Bare_2_A_Color1',
] as const;
export const BUSH_MODELS = ['Bush_1_E_Color1', 'Bush_2_F_Color1', 'Bush_3_C_Color1', 'Bush_4_F_Color1'] as const;
export const ROCK_MODELS = ['Rock_1_H_Color1', 'Rock_3_G_Color1'] as const;

/** The model whose material (the pack's one, shared by every model) the near forest copies. */
export const FOREST_MATERIAL_SOURCE = 'Tree_4_A_Color1';

/** KayKit trees are drawn a little taller than ours: they are scaled down by this factor. */
export const KAYKIT_TREE_SCALE = 0.8;

function choose<T>(list: readonly T[], t: number): T {
  return list[Math.min(list.length - 1, Math.floor(t * list.length))];
}

/** The KayKit model drawn for a near tree. */
export function nearModel(tree: Tree): string {
  return choose(tree.kind === 'pine' ? PINE_MODELS : LEAFY_MODELS, tree.variant);
}

/** A bush or a rock on the forest floor. */
export interface Undergrowth {
  x: number;
  z: number;
  rotY: number;
  scale: number;
  model: string;
}

const UNDERGROWTH_STEP = 3.4;

/** Bushes and a few rocks between the near trees, on the same free ground. Deterministic. */
export function scatterUndergrowth(): Undergrowth[] {
  const path = pathPoints();
  const rand = seeded('forest:undergrowth');
  const out: Undergrowth[] = [];
  for (let x = OUTER.x0 - NEAR_LIMIT; x <= OUTER.x1 + NEAR_LIMIT; x += UNDERGROWTH_STEP) {
    for (let z = OUTER.z0 - NEAR_LIMIT; z <= OUTER.z1 + NEAR_LIMIT; z += UNDERGROWTH_STEP) {
      const jx = (rand() - 0.5) * UNDERGROWTH_STEP;
      const jz = (rand() - 0.5) * UNDERGROWTH_STEP;
      const what = rand();
      const rot = rand();
      const size = rand();
      const variant = rand();
      const tx = x + jx;
      const tz = z + jz;
      if (what > 0.45 || distanceToRect(tx, tz, OUTER) >= NEAR_LIMIT || !treeAllowed(tx, tz, path)) continue;
      const rock = what < 0.08;
      out.push({
        x: tx,
        z: tz,
        rotY: rot * Math.PI * 2,
        scale: rock ? 0.5 + size * 0.5 : 0.6 + size * 0.6,
        model: choose(rock ? ROCK_MODELS : BUSH_MODELS, variant),
      });
    }
  }
  return out;
}
