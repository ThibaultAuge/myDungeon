import { describe, expect, it } from 'vitest';
import { OUTER } from '../src/scene/dungeon.ts';
import {
  BRIDGE,
  CLEARING,
  FAR_LIMIT,
  GROUND_Y,
  MOAT,
  MOAT_CLEARANCE,
  NEAR_LIMIT,
  NIGHT_SKY,
  PATH_CLEARANCE,
  PATH_HALF_WIDTH,
  WATER_Y,
  distanceToPath,
  distanceToRect,
  pathPoints,
  scatterTrees,
  treeAllowed,
  type Rect,
  type Tree,
} from '../src/scene/forest.ts';
import { GATE, type Point } from '../src/scene/layout.ts';

// forest.ts is pure geometry: Forest.tsx (three.js) is not imported here.

const TOL = 1e-6;

// The forest is pure and deterministic: computed once for every test below.
const PATH = pathPoints();
const TREES = scatterTrees();
const ALL_TREES: Tree[] = [...TREES.near, ...TREES.far];

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
});
