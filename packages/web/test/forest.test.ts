import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DECOR_RECIPES } from '../src/scene/decor.ts';
import { OUTER } from '../src/scene/dungeon.ts';
import {
  BRIDGE,
  BUSH_MODELS,
  CLEARING,
  FAR_LIMIT,
  FOREST_MATERIAL_SOURCE,
  GROUND_Y,
  KAYKIT_TREE_SCALE,
  LEAFY_MODELS,
  MOAT,
  MOAT_CLEARANCE,
  NEAR_LIMIT,
  NIGHT_SKY,
  PATH_CLEARANCE,
  PATH_HALF_WIDTH,
  PENNANT_CLEARANCE,
  PENNANTS,
  PINE_MODELS,
  ROCK_MODELS,
  SIGN,
  SIGN_YAW,
  SIGN_CLEARANCE,
  SIGN_WIDTH,
  WATER_Y,
  alongSign,
  distanceToPath,
  distanceToRect,
  nearModel,
  pathPoints,
  scatterTrees,
  scatterUndergrowth,
  treeAllowed,
  type Rect,
  type Tree,
  type TreeKind,
  type Undergrowth,
} from '../src/scene/forest.ts';
import { GATE, type Point } from '../src/scene/layout.ts';

// forest.ts is pure geometry: Forest.tsx (three.js) and kit.ts (drei, import.meta.env) are
// not imported here. The manifest is read as plain JSON, like dungeon.test.ts does.

const TOL = 1e-6;

// The forest is pure and deterministic: computed once for every test below.
const PATH = pathPoints();
const TREES = scatterTrees();
const ALL_TREES: Tree[] = [...TREES.near, ...TREES.far];
const UNDERGROWTH: Undergrowth[] = scatterUndergrowth();

interface PackSpec {
  source: string;
  license: string | null;
  format?: string;
  textures: string[];
  models: string[];
}

const MANIFEST: Record<string, PackSpec> = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL('../src/scene/kit-manifest.json', import.meta.url)), 'utf8'),
);
const FOREST_DIR = fileURLToPath(new URL('../public/kaykit/forest/', import.meta.url));
const FOREST_TEXTURE = 'forest_texture.png';

const TREE_MODELS: readonly string[] = [...PINE_MODELS, ...LEAFY_MODELS];
const ALL_FOREST_MODELS: readonly string[] = [...TREE_MODELS, ...BUSH_MODELS, ...ROCK_MODELS];
const BUSHES = new Set<string>(BUSH_MODELS);
const ROCKS = new Set<string>(ROCK_MODELS);

/** A near tree with the given kind and variant, other fields fixed. */
function tree(kind: TreeKind, variant: number): Tree {
  return { x: 0, z: 0, rotY: 0, scale: 1, kind, shade: 1, variant };
}

/** Variants spread evenly over [0, 1), dense enough to hit every slot of every list. */
const VARIANTS = Array.from({ length: 1000 }, (_, i) => i / 1000);

/** Number of bends of the path minus one, derived from the coarsest sampling (one point per bend). */
const KNOTS = pathPoints(1);

// ---------------------------------------------------------------- constants

describe('forest constants', () => {
  /**
   * Verifies that the moat water lies below the forest floor, itself below the castle floor
   */
  it('puts the water below the ground, and the ground below the castle floor', () => {
    expect(GROUND_Y).toBeLessThan(0);
    expect(WATER_Y).toBeLessThan(GROUND_Y);
  });

  /**
   * Verifies that the night sky colour is a six-digit hex colour
   */
  it('gives the night sky a hex colour', () => {
    expect(NIGHT_SKY).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  /**
   * Verifies that the limits are ordered: clearing, then near ring, then far forest
   */
  it('orders the clearing, the near limit and the far limit', () => {
    expect(CLEARING).toBeGreaterThan(0);
    expect(NEAR_LIMIT).toBeGreaterThan(CLEARING);
    expect(FAR_LIMIT).toBeGreaterThan(NEAR_LIMIT);
    // Trees keep clear of the path's edges, not only of its middle.
    expect(PATH_CLEARANCE).toBeGreaterThan(PATH_HALF_WIDTH);
    expect(MOAT_CLEARANCE).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- moat and bridge

describe('MOAT and BRIDGE', () => {
  /**
   * Verifies that the moat runs along the whole south side, from the castle's south edge
   */
  it('spans the south side of the castle, starting at its south edge', () => {
    expect(MOAT.x0).toBeLessThanOrEqual(OUTER.x0);
    expect(MOAT.x1).toBeGreaterThanOrEqual(OUTER.x1);
    expect(MOAT.z0).toBeCloseTo(OUTER.z1, 9);
    expect(MOAT.z1).toBeGreaterThan(MOAT.z0);
  });

  /**
   * Verifies that the drawbridge fits inside the gate opening along x
   */
  it('keeps the bridge within the gate opening', () => {
    expect(BRIDGE.x0).toBeGreaterThanOrEqual(GATE.lo);
    expect(BRIDGE.x1).toBeLessThanOrEqual(GATE.hi);
    expect(BRIDGE.x1).toBeGreaterThan(BRIDGE.x0);
  });

  /**
   * Verifies that the drawbridge crosses the moat from the castle edge to past the far bank
   */
  it('spans the moat from bank to bank', () => {
    expect(BRIDGE.z0).toBeLessThanOrEqual(MOAT.z0);
    expect(BRIDGE.z1).toBeGreaterThanOrEqual(MOAT.z1);
  });
});

// ---------------------------------------------------------------- distanceToRect

describe('distanceToRect', () => {
  const R: Rect = { x0: 0, x1: 2, z0: 0, z1: 1 };

  /**
   * Verifies that a point inside the rectangle, or on its border, is at distance 0
   */
  it.each([
    ['inside', 1, 0.5],
    ['on a corner', 0, 0],
    ['on the east edge', 2, 0.3],
    ['on the south edge', 1.5, 1],
  ])('returns 0 for a point %s', (_label, x, z) => {
    expect(distanceToRect(x, z, R)).toBe(0);
  });

  /**
   * Verifies that a point facing a side gets its perpendicular distance to that side
   */
  it.each([
    ['west', -3, 0.5, 3],
    ['east', 2.5, 0.2, 0.5],
    ['north', 1, -2, 2],
    ['south', 0.4, 4, 3],
  ])('returns the distance to the %s side', (_label, x, z, d) => {
    expect(distanceToRect(x, z, R)).toBeCloseTo(d, 9);
  });

  /**
   * Verifies that a point off a corner gets its straight-line distance to that corner
   */
  it('returns the distance to the nearest corner off a corner', () => {
    expect(distanceToRect(5, 5, R)).toBeCloseTo(5, 9); // 3-4-5 from (2, 1)
    expect(distanceToRect(-3, -4, R)).toBeCloseTo(5, 9); // from (0, 0)
  });

  /**
   * Verifies that a degenerate (zero-size) rectangle measures the distance to its point
   */
  it('handles a rectangle reduced to a point', () => {
    expect(distanceToRect(3, 4, { x0: 0, x1: 0, z0: 0, z1: 0 })).toBeCloseTo(5, 9);
    expect(distanceToRect(0, 0, { x0: 0, x1: 0, z0: 0, z1: 0 })).toBe(0);
  });
});

// ---------------------------------------------------------------- distanceToPath

describe('distanceToPath', () => {
  const L: Point[] = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 10 },
  ];

  /**
   * Verifies that a point on the polyline is at distance 0
   */
  it.each([
    [0, 0],
    [5, 0],
    [10, 0],
    [10, 7],
  ])('returns 0 on the polyline at (%d, %d)', (x, z) => {
    expect(distanceToPath(x, z, L)).toBeCloseTo(0, 9);
  });

  /**
   * Verifies that a point beside a segment gets its perpendicular distance
   */
  it('returns the perpendicular distance beside a segment', () => {
    expect(distanceToPath(4, -3, L)).toBeCloseTo(3, 9);
    expect(distanceToPath(12, 5, L)).toBeCloseTo(2, 9);
  });

  /**
   * Verifies that beyond the ends the distance is to the end point, not to the extended line
   */
  it('measures to the end points past the ends of the polyline', () => {
    expect(distanceToPath(-3, -4, L)).toBeCloseTo(5, 9);
    expect(distanceToPath(10, 13, L)).toBeCloseTo(3, 9);
  });

  /**
   * Verifies that the nearest of several segments wins
   */
  it('keeps the nearest segment', () => {
    // 1 m from the second segment, 8 m from the first.
    expect(distanceToPath(9, 8, L)).toBeCloseTo(1, 9);
  });

  /**
   * Verifies that a zero-length segment (repeated point) is measured as a point
   */
  it('handles a repeated point without dividing by zero', () => {
    const d = distanceToPath(3, 4, [{ x: 0, z: 0 }, { x: 0, z: 0 }]);
    expect(d).toBeCloseTo(5, 9);
  });
});

// ---------------------------------------------------------------- path

describe('pathPoints', () => {
  /**
   * Verifies that the path starts in the middle of the far end of the drawbridge
   */
  it('starts at the far end of the drawbridge, in the gate axis', () => {
    expect(PATH[0].x).toBeCloseTo((GATE.lo + GATE.hi) / 2, 9);
    expect(PATH[0].z).toBeCloseTo(BRIDGE.z1, 9);
    expect(PATH[0].x).toBeGreaterThan(BRIDGE.x0);
    expect(PATH[0].x).toBeLessThan(BRIDGE.x1);
  });

  /**
   * Verifies that the default sampling is 12 points per bend
   */
  it('samples 12 points per bend by default', () => {
    expect(PATH).toEqual(pathPoints(12));
  });

  /**
   * Verifies that the point count is perSegment per bend plus the final point
   */
  it.each([1, 3, 12, 40])('returns perSegment × bends + 1 points for perSegment = %d', (n) => {
    const bends = KNOTS.length - 1;
    expect(bends).toBeGreaterThan(1);
    expect(pathPoints(n)).toHaveLength(n * bends + 1);
  });

  /**
   * Verifies that the path passes exactly through its bends whatever the sampling
   */
  it.each([2, 5, 12])('passes through every bend with perSegment = %d', (n) => {
    const pts = pathPoints(n);
    KNOTS.forEach((k, i) => {
      expect(pts[i * n].x, `bend ${i}`).toBeCloseTo(k.x, 9);
      expect(pts[i * n].z, `bend ${i}`).toBeCloseTo(k.z, 9);
    });
    expect(pts[pts.length - 1]).toEqual(KNOTS[KNOTS.length - 1]);
  });

  /**
   * Verifies that the path is continuous: finely sampled, no jump between two points
   */
  it('is continuous', () => {
    const pts = pathPoints(200);
    let worst = 0;
    for (let i = 1; i < pts.length; i++) {
      worst = Math.max(worst, Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    }
    expect(worst).toBeLessThan(0.5);
  });

  /**
   * Verifies that the path leads away from the castle and never crosses back over the moat
   */
  it('stays south of the drawbridge end and reaches the far forest', () => {
    for (const p of PATH) expect(p.z).toBeGreaterThanOrEqual(BRIDGE.z1 - TOL);
    const last = PATH[PATH.length - 1];
    expect(distanceToRect(last.x, last.z, OUTER)).toBeGreaterThanOrEqual(NEAR_LIMIT);
  });

  /**
   * Verifies that two calls give the same points
   */
  it('is deterministic', () => {
    expect(pathPoints()).toEqual(PATH);
  });
});

// ---------------------------------------------------------------- treeAllowed

describe('treeAllowed', () => {
  const midX = (OUTER.x0 + OUTER.x1) / 2;

  /**
   * Verifies that no tree may stand inside the castle or within the clearing around it
   */
  it('refuses the castle and its clearing', () => {
    expect(treeAllowed(midX, (OUTER.z0 + OUTER.z1) / 2, PATH)).toBe(false);
    expect(treeAllowed(midX, OUTER.z0 - CLEARING + 0.01, PATH)).toBe(false);
  });

  /**
   * Verifies that a tree may stand exactly CLEARING away from the castle (north side)
   */
  it('accepts the edge of the clearing, away from the moat and the path', () => {
    expect(treeAllowed(midX, OUTER.z0 - CLEARING, PATH)).toBe(true);
    expect(treeAllowed(OUTER.x0 - CLEARING, OUTER.z0, PATH)).toBe(true);
  });

  /**
   * Verifies that no tree may stand within MOAT_CLEARANCE of the moat
   */
  it('keeps MOAT_CLEARANCE around the moat', () => {
    // West end of the moat, past the castle's corner: far from the path and the clearing.
    const x = MOAT.x0 + 1;
    expect(treeAllowed(x, MOAT.z1 + MOAT_CLEARANCE - 0.01, PATH)).toBe(false);
    expect(treeAllowed(x, MOAT.z1 + MOAT_CLEARANCE + 0.5, PATH)).toBe(true);
    expect(treeAllowed(x, (MOAT.z0 + MOAT.z1) / 2, PATH)).toBe(false);
  });

  /**
   * Verifies that no tree may stand on the path or within PATH_CLEARANCE of its middle
   */
  it('keeps PATH_CLEARANCE along the path', () => {
    const p = PATH[Math.floor(PATH.length / 2)];
    expect(treeAllowed(p.x, p.z, PATH)).toBe(false);
    expect(treeAllowed(p.x + PATH_CLEARANCE * 0.5, p.z, PATH)).toBe(false);
    // Far to the side of the path, deep in the forest.
    expect(treeAllowed(p.x + 30, p.z, PATH)).toBe(true);
  });

  /**
   * Verifies that no tree may stand on the name sign or on either pennant
   */
  it('refuses the sign and each pennant', () => {
    expect(treeAllowed(SIGN.x, SIGN.z, PATH)).toBe(false);
    PENNANTS.forEach((p, i) => expect(treeAllowed(p.x, p.z, PATH), `pennant ${i}`).toBe(false));
  });

  /**
   * Verifies that SIGN_CLEARANCE alone rejects a point east of the sign, and its edge is free
   */
  it('keeps SIGN_CLEARANCE around the sign', () => {
    // East and south of the sign: past the moat banks and far from the path, so only the
    // sign clearance can reject these points.
    expect(treeAllowed(SIGN.x + SIGN_CLEARANCE - 0.05, SIGN.z, PATH)).toBe(false);
    expect(treeAllowed(SIGN.x + SIGN_CLEARANCE + 0.05, SIGN.z, PATH)).toBe(true);
    expect(treeAllowed(SIGN.x, SIGN.z + SIGN_CLEARANCE - 0.05, PATH)).toBe(false);
    expect(treeAllowed(SIGN.x, SIGN.z + SIGN_CLEARANCE + 0.05, PATH)).toBe(true);
  });
});

// ---------------------------------------------------------------- sign and pennants

describe('SIGN and PENNANTS', () => {
  /**
   * Verifies that the sign's clearance covers the whole board, with room to spare
   */
  it('gives the sign a clearance wider than half its board, and the pennants one', () => {
    expect(SIGN_WIDTH).toBeGreaterThan(0);
    expect(SIGN_CLEARANCE).toBeGreaterThan(SIGN_WIDTH / 2);
    expect(PENNANT_CLEARANCE).toBeGreaterThan(0);
  });

  /**
   * Verifies that no point of the sign's board lies on the path band
   */
  it('keeps the whole board off the path', () => {
    // The board is turned by SIGN_YAW: sample its foot from the west end to the east end.
    for (let i = 0; i <= 20; i++) {
      const p = alongSign(-1 + i / 10);
      expect(distanceToPath(p.x, p.z, PATH), `t = ${(-1 + i / 10).toFixed(1)}`).toBeGreaterThan(PATH_HALF_WIDTH);
    }
  });

  /**
   * Verifies that the sign stands on dry ground past the moat, east of the path
   */
  it('puts the sign on dry ground past the moat, east of the path start', () => {
    expect(SIGN.z).toBeGreaterThan(MOAT.z1);
    expect(distanceToRect(SIGN.x, SIGN.z, MOAT)).toBeGreaterThan(0);
    expect(distanceToRect(SIGN.x, SIGN.z, BRIDGE)).toBeGreaterThan(0);
    expect(alongSign(-1).x).toBeGreaterThan(PATH[0].x);
    // Both ends of the turned board stay on dry ground too.
    for (const t of [-1, 1]) expect(alongSign(t).z).toBeGreaterThan(MOAT.z1);
  });

  /**
   * Verifies that there are two pennants, one on each side of the drawbridge
   */
  it('frames the bridge with one pennant on each side', () => {
    expect(PENNANTS).toHaveLength(2);
    const west = PENNANTS.filter((p) => p.x < BRIDGE.x0);
    const east = PENNANTS.filter((p) => p.x > BRIDGE.x1);
    expect(west).toHaveLength(1);
    expect(east).toHaveLength(1);
  });

  /**
   * Verifies that each pennant stands on dry ground south of the moat, beside the bridge
   */
  it.each([0, 1])('puts pennant %d south of the moat, off the bridge and the path', (i) => {
    const p = PENNANTS[i];
    expect(p.z).toBeGreaterThan(MOAT.z1);
    expect(p.x < BRIDGE.x0 || p.x > BRIDGE.x1).toBe(true);
    expect(distanceToRect(p.x, p.z, BRIDGE)).toBeGreaterThan(0);
    expect(distanceToPath(p.x, p.z, PATH)).toBeGreaterThan(PATH_HALF_WIDTH);
  });

  /**
   * Verifies that no tree, near or far, grows within the sign's or a pennant's clearance
   */
  it('keeps every tree clear of the sign and the pennants', () => {
    const nearSign = ALL_TREES.filter((t) => Math.hypot(t.x - SIGN.x, t.z - SIGN.z) < SIGN_CLEARANCE);
    expect(nearSign).toEqual([]);
    for (const p of PENNANTS) {
      expect(ALL_TREES.filter((t) => Math.hypot(t.x - p.x, t.z - p.z) < PENNANT_CLEARANCE)).toEqual([]);
    }
  });

  /**
   * Verifies that no bush or rock lies within the sign's or a pennant's clearance
   */
  it('keeps the undergrowth clear of the sign and the pennants', () => {
    expect(UNDERGROWTH.filter((u) => Math.hypot(u.x - SIGN.x, u.z - SIGN.z) < SIGN_CLEARANCE)).toEqual([]);
    for (const p of PENNANTS) {
      expect(UNDERGROWTH.filter((u) => Math.hypot(u.x - p.x, u.z - p.z) < PENNANT_CLEARANCE)).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------- scatterTrees

describe('scatterTrees', () => {
  /**
   * Verifies that two calls give exactly the same trees
   */
  it('is deterministic', () => {
    expect(scatterTrees()).toEqual(TREES);
  });

  /**
   * Verifies that both the near ring and the far forest hold a fair number of trees
   */
  it('plants a non-empty near ring and a larger far forest', () => {
    expect(TREES.near.length).toBeGreaterThan(100);
    expect(TREES.far.length).toBeGreaterThan(TREES.near.length);
  });

  /**
   * Verifies that no tree grows within CLEARING of the castle walls
   */
  it('keeps the clearing around the castle free', () => {
    const bad = ALL_TREES.filter((t) => distanceToRect(t.x, t.z, OUTER) < CLEARING);
    expect(bad).toEqual([]);
  });

  /**
   * Verifies that no tree grows in the moat or within MOAT_CLEARANCE of it
   */
  it('keeps the moat and its banks free', () => {
    const bad = ALL_TREES.filter((t) => distanceToRect(t.x, t.z, MOAT) < MOAT_CLEARANCE);
    expect(bad).toEqual([]);
  });

  /**
   * Verifies that no tree grows on the drawbridge
   */
  it('keeps the drawbridge free', () => {
    const bad = ALL_TREES.filter((t) => distanceToRect(t.x, t.z, BRIDGE) === 0);
    expect(bad).toEqual([]);
  });

  /**
   * Verifies that no tree grows within PATH_CLEARANCE of the path's middle
   */
  it('keeps the path and its sides free', () => {
    const bad = ALL_TREES.filter((t) => distanceToPath(t.x, t.z, PATH) < PATH_CLEARANCE);
    expect(bad.map((t) => `(${t.x.toFixed(2)}, ${t.z.toFixed(2)})`)).toEqual([]);
  });

  /**
   * Verifies that every tree passes treeAllowed
   */
  it('only plants trees where treeAllowed accepts them', () => {
    expect(ALL_TREES.filter((t) => !treeAllowed(t.x, t.z, PATH))).toEqual([]);
  });

  /**
   * Verifies that near trees are closer than NEAR_LIMIT to the castle
   */
  it('keeps near trees within NEAR_LIMIT of the castle', () => {
    const bad = TREES.near.filter((t) => distanceToRect(t.x, t.z, OUTER) >= NEAR_LIMIT);
    expect(bad).toEqual([]);
  });

  /**
   * Verifies that far trees stand between NEAR_LIMIT (included) and FAR_LIMIT (excluded)
   */
  it('keeps far trees in [NEAR_LIMIT, FAR_LIMIT) from the castle', () => {
    const bad = TREES.far.filter((t) => {
      const d = distanceToRect(t.x, t.z, OUTER);
      return d < NEAR_LIMIT || d >= FAR_LIMIT;
    });
    expect(bad).toEqual([]);
  });

  /**
   * Verifies that trees surround the castle on all four sides
   */
  it('surrounds the castle on every side', () => {
    const near = TREES.near;
    expect(near.some((t) => t.z < OUTER.z0)).toBe(true);
    expect(near.some((t) => t.z > MOAT.z1)).toBe(true);
    expect(near.some((t) => t.x < OUTER.x0)).toBe(true);
    expect(near.some((t) => t.x > OUTER.x1)).toBe(true);
  });

  /**
   * Verifies that each tree has a valid kind, rotation, size and shade
   */
  it('gives every tree a kind, rotation, size and shade in range', () => {
    for (const t of ALL_TREES) {
      expect(['pine', 'round']).toContain(t.kind);
      expect(t.rotY).toBeGreaterThanOrEqual(0);
      expect(t.rotY).toBeLessThan(Math.PI * 2);
      expect(t.scale).toBeGreaterThanOrEqual(0.8);
      expect(t.scale).toBeLessThan(1.4 + TOL);
      expect(t.shade).toBeGreaterThanOrEqual(0.75);
      expect(t.shade).toBeLessThan(1.15 + TOL);
    }
  });

  /**
   * Verifies that both tree kinds appear, for variety
   */
  it('mixes pines and round trees', () => {
    const kinds = new Set(ALL_TREES.map((t) => t.kind));
    expect([...kinds].sort()).toEqual(['pine', 'round']);
  });

  /**
   * Verifies that every tree gets a model variant in [0, 1)
   */
  it('gives every tree a variant in [0, 1)', () => {
    const bad = ALL_TREES.filter((t) => !(t.variant >= 0 && t.variant < 1));
    expect(bad).toEqual([]);
  });

  /**
   * Verifies that variants actually vary, so the near ring mixes several models
   */
  it('spreads the variants and uses several near models', () => {
    expect(new Set(TREES.near.map((t) => t.variant)).size).toBeGreaterThan(TREES.near.length / 2);
    const models = new Set(TREES.near.map(nearModel));
    expect(models.size).toBeGreaterThan(3);
    expect([...models].some((m) => (PINE_MODELS as readonly string[]).includes(m))).toBe(true);
    expect([...models].some((m) => (LEAFY_MODELS as readonly string[]).includes(m))).toBe(true);
  });
});

// ---------------------------------------------------------------- KayKit forest pack

describe('KayKit forest pack', () => {
  const spec = MANIFEST.forest;

  /**
   * Verifies that the manifest declares the forest pack as gltf with its texture and license
   */
  it('declares a gltf forest pack with forest_texture.png and a license', () => {
    expect(spec).toBeDefined();
    expect(spec.format ?? 'gltf').toBe('gltf');
    expect(spec.textures).toEqual([FOREST_TEXTURE]);
    expect(spec.license).toBeTruthy();
  });

  /**
   * Verifies that every model the forest code draws is in the manifest forest pack
   */
  it('contains every pine, leafy, bush and rock model', () => {
    const models = new Set(spec.models);
    expect(ALL_FOREST_MODELS.filter((m) => !models.has(m))).toEqual([]);
  });

  /**
   * Verifies that every forest model uses one same material, the one the near forest copies from FOREST_MATERIAL_SOURCE
   */
  it('shares one material across every model, taken from a manifest model', () => {
    expect(spec.models).toContain(FOREST_MATERIAL_SOURCE);
    const names = spec.models.map((m) => {
      const gltf = JSON.parse(fs.readFileSync(path.join(FOREST_DIR, `${m}.gltf`), 'utf8')) as { materials?: { name?: string }[] };
      expect(gltf.materials ?? [], m).toHaveLength(1);
      return gltf.materials![0].name;
    });
    expect(new Set(names).size).toBe(1);
  });

  /**
   * Verifies that the forest pack ships no model that neither the lists nor the room decor (grass tufts) uses
   */
  it('ships only models used by one of the lists or by the room decor', () => {
    const decor = Object.values(DECOR_RECIPES).flatMap((pieces) => (pieces ?? []).filter((p) => p.pack === 'forest').map((p) => p.name));
    const used = new Set([...ALL_FOREST_MODELS, ...decor]);
    expect(spec.models.filter((m) => !used.has(m))).toEqual([]);
  });

  /**
   * Verifies that each forest model has its .gltf and .bin in public/kaykit/forest
   */
  it('has a .gltf and a .bin per model, the texture and License.txt in public', () => {
    const expected = [...spec.models.flatMap((m) => [`${m}.gltf`, `${m}.bin`]), FOREST_TEXTURE, 'License.txt'];
    expect(expected.filter((f) => !fs.existsSync(path.join(FOREST_DIR, f)))).toEqual([]);
  });

  /**
   * Verifies that public/kaykit/forest holds no stray file besides the expected ones
   */
  it('holds no stray file in public/kaykit/forest', () => {
    const expected = new Set([...spec.models.flatMap((m) => [`${m}.gltf`, `${m}.bin`]), FOREST_TEXTURE, 'License.txt']);
    expect(fs.readdirSync(FOREST_DIR).filter((f) => !expected.has(f))).toEqual([]);
  });

  /**
   * Verifies that each forest .gltf references only its own .bin and the forest texture
   */
  it.each((spec?.models ?? []).map((m) => [m]))('%s.gltf references only its own .bin and the texture, no extension', (name) => {
    const file = path.join(FOREST_DIR, `${name}.gltf`);
    const gltf = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      extensionsUsed?: string[];
      extensionsRequired?: string[];
      buffers?: { uri?: string }[];
      images?: { uri?: string }[];
    };
    expect(gltf.extensionsUsed ?? []).toEqual([]);
    expect(gltf.extensionsRequired ?? []).toEqual([]);
    expect((gltf.buffers ?? []).length).toBeGreaterThan(0);
    for (const b of gltf.buffers ?? []) expect(b.uri).toBe(`${name}.bin`);
    for (const i of gltf.images ?? []) expect(i.uri).toBe(FOREST_TEXTURE);
  });
});

// ---------------------------------------------------------------- model lists

describe('forest model lists', () => {
  /**
   * Verifies that each model list is non-empty and every name has the _Color1 suffix
   */
  it.each([
    ['PINE_MODELS', PINE_MODELS],
    ['LEAFY_MODELS', LEAFY_MODELS],
    ['BUSH_MODELS', BUSH_MODELS],
    ['ROCK_MODELS', ROCK_MODELS],
  ] as const)('%s is non-empty with _Color1 names', (_label, list) => {
    expect(list.length).toBeGreaterThan(0);
    for (const m of list) expect(m).toMatch(/^[A-Za-z0-9_]+_Color1$/);
  });

  /**
   * Verifies that trees, bushes and rocks use disjoint model sets
   */
  it('keeps trees, bushes and rocks apart', () => {
    const trees = new Set(TREE_MODELS);
    expect([...BUSHES].filter((m) => trees.has(m) || ROCKS.has(m))).toEqual([]);
    expect([...ROCKS].filter((m) => trees.has(m))).toEqual([]);
    expect((PINE_MODELS as readonly string[]).filter((m) => (LEAFY_MODELS as readonly string[]).includes(m))).toEqual([]);
  });

  /**
   * Verifies that the KayKit tree scale factor shrinks the models a little, never flips them
   */
  it('scales KayKit trees by a positive factor no larger than 1', () => {
    expect(KAYKIT_TREE_SCALE).toBeGreaterThan(0);
    expect(KAYKIT_TREE_SCALE).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------- nearModel

describe('nearModel', () => {
  /**
   * Verifies that a pine always gets a pine model, whatever its variant
   */
  it('returns a pine model for a pine', () => {
    for (const v of VARIANTS) expect(PINE_MODELS).toContain(nearModel(tree('pine', v)));
  });

  /**
   * Verifies that a round tree always gets a leafy model, whatever its variant
   */
  it('returns a leafy model for a round tree', () => {
    for (const v of VARIANTS) expect(LEAFY_MODELS).toContain(nearModel(tree('round', v)));
  });

  /**
   * Verifies that variants from 0 to 1 reach every entry of each list
   */
  it.each([
    ['pine', PINE_MODELS],
    ['round', LEAFY_MODELS],
  ] as const)('covers every model of the %s list across variants', (kind, list) => {
    const seen = new Set(VARIANTS.map((v) => nearModel(tree(kind, v))));
    expect([...seen].sort()).toEqual([...new Set<string>(list)].sort());
  });

  /**
   * Verifies that slot i of the list is picked for a variant in [i/n, (i+1)/n)
   */
  it.each([
    ['pine', PINE_MODELS],
    ['round', LEAFY_MODELS],
  ] as const)('maps each equal slice of [0, 1) to its list entry for %s', (kind, list) => {
    const n = list.length;
    list.forEach((model, i) => {
      expect(nearModel(tree(kind, (i + 0.5) / n)), `slot ${i}`).toBe(model);
    });
  });

  /**
   * Verifies that variant 0 picks the first entry of the list
   */
  it('picks the first model for variant 0', () => {
    expect(nearModel(tree('pine', 0))).toBe(PINE_MODELS[0]);
    expect(nearModel(tree('round', 0))).toBe(LEAFY_MODELS[0]);
  });

  /**
   * Verifies that a variant just below 1 picks the last entry, never past the end
   */
  it.each([0.999, 1 - 1e-12, 1 - Number.EPSILON / 2])('picks the last model for variant %s', (v) => {
    expect(nearModel(tree('pine', v))).toBe(PINE_MODELS[PINE_MODELS.length - 1]);
    expect(nearModel(tree('round', v))).toBe(LEAFY_MODELS[LEAFY_MODELS.length - 1]);
  });

  /**
   * Verifies that a variant of exactly 1 is clamped to the last entry
   */
  it('clamps variant 1 to the last model', () => {
    expect(nearModel(tree('pine', 1))).toBe(PINE_MODELS[PINE_MODELS.length - 1]);
    expect(nearModel(tree('round', 1))).toBe(LEAFY_MODELS[LEAFY_MODELS.length - 1]);
  });

  /**
   * Verifies that every near tree of the real scatter gets a model from the manifest pack
   */
  it('gives every scattered near tree a model of the forest pack', () => {
    const models = new Set(MANIFEST.forest.models);
    const bad = TREES.near.map(nearModel).filter((m) => !models.has(m));
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------- scatterUndergrowth

describe('scatterUndergrowth', () => {
  /**
   * Verifies that two calls give exactly the same bushes and rocks
   */
  it('is deterministic', () => {
    expect(scatterUndergrowth()).toEqual(UNDERGROWTH);
  });

  /**
   * Verifies that the forest floor gets some undergrowth
   */
  it('is not empty', () => {
    expect(UNDERGROWTH.length).toBeGreaterThan(10);
  });

  /**
   * Verifies that all undergrowth stays within NEAR_LIMIT of the castle
   */
  it('stays within NEAR_LIMIT of the castle', () => {
    const bad = UNDERGROWTH.filter((u) => distanceToRect(u.x, u.z, OUTER) >= NEAR_LIMIT);
    expect(bad).toEqual([]);
  });

  /**
   * Verifies that no bush or rock lies in the clearing, the moat, its banks or on the path
   */
  it('only places undergrowth where treeAllowed accepts it', () => {
    expect(UNDERGROWTH.filter((u) => !treeAllowed(u.x, u.z, PATH))).toEqual([]);
  });

  /**
   * Verifies that no bush or rock lies on the drawbridge
   */
  it('keeps the drawbridge free', () => {
    expect(UNDERGROWTH.filter((u) => distanceToRect(u.x, u.z, BRIDGE) === 0)).toEqual([]);
  });

  /**
   * Verifies that every item has a positive scale and a rotation in [0, 2π)
   */
  it('gives every item a positive scale and a rotation in range', () => {
    for (const u of UNDERGROWTH) {
      expect(u.scale).toBeGreaterThan(0);
      expect(u.rotY).toBeGreaterThanOrEqual(0);
      expect(u.rotY).toBeLessThan(Math.PI * 2);
    }
  });

  /**
   * Verifies that every model comes from the bush or rock lists
   */
  it('uses only bush and rock models', () => {
    expect(UNDERGROWTH.filter((u) => !BUSHES.has(u.model) && !ROCKS.has(u.model))).toEqual([]);
  });

  /**
   * Verifies that both bushes and rocks appear on the forest floor
   */
  it('mixes bushes and rocks, bushes being the majority', () => {
    const bushes = UNDERGROWTH.filter((u) => BUSHES.has(u.model)).length;
    const rocks = UNDERGROWTH.filter((u) => ROCKS.has(u.model)).length;
    expect(bushes).toBeGreaterThan(0);
    expect(rocks).toBeGreaterThan(0);
    expect(bushes).toBeGreaterThan(rocks);
  });

  /**
   * Verifies that every undergrowth model is in the manifest forest pack
   */
  it('uses only models of the forest pack', () => {
    const models = new Set(MANIFEST.forest.models);
    expect(UNDERGROWTH.filter((u) => !models.has(u.model))).toEqual([]);
  });

  /**
   * Verifies that undergrowth surrounds the castle on every side
   */
  it('surrounds the castle on every side', () => {
    expect(UNDERGROWTH.some((u) => u.z < OUTER.z0)).toBe(true);
    expect(UNDERGROWTH.some((u) => u.z > MOAT.z1)).toBe(true);
    expect(UNDERGROWTH.some((u) => u.x < OUTER.x0)).toBe(true);
    expect(UNDERGROWTH.some((u) => u.x > OUTER.x1)).toBe(true);
  });
});

describe('alongSign', () => {
  /**
   * Verifies that the board foot spans SIGN_WIDTH around the sign, turned south-west by SIGN_YAW
   */
  it('spans the board width around the sign, turned by SIGN_YAW towards the path', () => {
    const west = alongSign(-1);
    const east = alongSign(1);
    expect(Math.hypot(east.x - west.x, east.z - west.z)).toBeCloseTo(SIGN_WIDTH, 6);
    expect(alongSign(0)).toEqual(SIGN);
    // Face turned south-west: the west end comes closer to the castle than the east end.
    expect(SIGN_YAW).toBeLessThan(0);
    expect(west.z).toBeLessThan(east.z);
    // The board's whole length stays inside the tree clearance (true whatever the yaw).
    for (const p of [west, east]) expect(Math.hypot(p.x - SIGN.x, p.z - SIGN.z)).toBeLessThan(SIGN_CLEARANCE);
  });

  /**
   * Verifies that alongSign follows three.js's own Y rotation, the one DungeonSign renders with
   */
  it('matches the rotation three.js applies to the board', () => {
    const end = new Vector3(SIGN_WIDTH / 2, 0, 0).applyAxisAngle(new Vector3(0, 1, 0), SIGN_YAW);
    const p = alongSign(1);
    expect(p.x).toBeCloseTo(SIGN.x + end.x, 9);
    expect(p.z).toBeCloseTo(SIGN.z + end.z, 9);
  });
});
