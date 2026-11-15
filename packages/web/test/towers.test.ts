import { describe, expect, it } from 'vitest';
import {
  CUT_SPEED,
  OUTER,
  PERIMETER_INNER,
  PERIMETER_LINE,
  PERIMETER_T,
  TOWERS,
  TOWER_BASE,
  TOWER_H,
  TOWER_OFFSET,
  TOWER_R,
  cutHeight,
  type Tower,
} from '../src/scene/dungeon.ts';

const TOL = 1e-6;
const CENTRE = { x: (OUTER.x0 + OUTER.x1) / 2, z: (OUTER.z0 + OUTER.z1) / 2 };

/** Which map corner a tower stands at. */
function cornerOf(t: Tower): { xs: 'w' | 'e'; zs: 'n' | 's' } {
  return { xs: t.x < CENTRE.x ? 'w' : 'e', zs: t.z < CENTRE.z ? 'n' : 's' };
}

/** Points sampled on the tower circle. */
function circle(t: Tower, n = 360): { x: number; z: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return { x: t.x + TOWER_R * Math.cos(a), z: t.z + TOWER_R * Math.sin(a) };
  });
}

// ---------------------------------------------------------------- cutHeight

describe('cutHeight', () => {
  /** Verifies that the first frame (NaN) jumps straight to the target */
  it.each([
    [0, 0.016, false],
    [1, 0.016, false],
    [0, 0, false],
    [1, 0, true],
  ] as const)('jumps from NaN to the target %d (dt %d, reduced %s)', (target, dt, reduced) => {
    expect(cutHeight(NaN, target, dt, reduced)).toBe(target);
  });

  /** Verifies that reduced motion snaps to the target in one frame, both ways */
  it.each([
    [0, 1],
    [1, 0],
    [0.3, 1],
    [0.7, 0],
  ] as const)('snaps from %d to %d under reduced motion', (prev, target) => {
    expect(cutHeight(prev, target, 0.016, true)).toBe(target);
    expect(cutHeight(prev, target, 0, true)).toBe(target);
  });

  /** Verifies that a piece already at its target stays there */
  it.each([0, 1])('keeps a piece already at %d', (h) => {
    expect(cutHeight(h, h, 0.016, false)).toBe(h);
    expect(cutHeight(h, h, 0, false)).toBe(h);
  });

  /** Verifies that no time elapsed means no movement when far from the target */
  it('does not move when dt is 0', () => {
    expect(cutHeight(0, 1, 0, false)).toBe(0);
    expect(cutHeight(0.6, 0, 0, false)).toBe(0.6);
  });

  /** Verifies that one frame covers dt * CUT_SPEED of the remaining way */
  it('eases by dt * CUT_SPEED of the remaining way', () => {
    const dt = 0.5 / CUT_SPEED;
    expect(cutHeight(0, 1, dt, false)).toBeCloseTo(0.5, 12);
    expect(cutHeight(1, 0, dt, false)).toBeCloseTo(0.5, 12);
    expect(cutHeight(0.2, 1, 0.25 / CUT_SPEED, false)).toBeCloseTo(0.4, 12);
  });

  /** Verifies that a long frame (tab back in focus) never overshoots the target */
  it.each([1 / CUT_SPEED, 1, 10, 1e6])('reaches the target without overshoot for dt %d', (dt) => {
    expect(cutHeight(0, 1, dt, false)).toBe(1);
    expect(cutHeight(1, 0, dt, false)).toBe(0);
  });

  /** Verifies that a value close enough to the target snaps onto it exactly */
  it.each([
    [0.999, 1],
    [0.9985, 1],
    [0.001, 0],
    [0.0015, 0],
  ] as const)('snaps %d onto %d when within 0.002', (prev, target) => {
    expect(cutHeight(prev, target, 0.001, false)).toBe(target);
  });

  /** Verifies that a value still 0.002 or more away keeps easing rather than snapping */
  it('does not snap while still at least 0.002 away', () => {
    const dt = 0.1 / CUT_SPEED;
    const h = cutHeight(0.99, 1, dt, false);
    expect(h).toBeCloseTo(0.991, 12);
    expect(h).not.toBe(1);
  });

  /** Verifies that at 60 fps a piece settles exactly on its target, monotonically */
  it.each([
    [0, 1],
    [1, 0],
  ] as const)('settles from %d onto %d at 60 fps without overshoot', (start, target) => {
    let h = start;
    let frames = 0;
    while (h !== target && frames < 1000) {
      const next = cutHeight(h, target, 1 / 60, false);
      expect(Math.abs(target - next)).toBeLessThan(Math.abs(target - h));
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThanOrEqual(1);
      h = next;
      frames++;
    }
    expect(h).toBe(target);
    // Quick enough to feel responsive: well under two seconds.
    expect(frames).toBeLessThan(120);
  });

  /** Verifies that the target can change mid-way and the piece turns back */
  it('turns back toward a new target mid-way', () => {
    const dt = 0.5 / CUT_SPEED;
    const down = cutHeight(1, 0, dt, false);
    const back = cutHeight(down, 1, dt, false);
    expect(back).toBeGreaterThan(down);
    expect(back).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------- towers

describe('TOWERS', () => {
  /** Verifies the tower constants are sane: a small tower taller than the 3 m walls */
  it('uses a small radius and a top above the walls, base below ground', () => {
    expect(TOWER_R).toBeGreaterThan(0);
    expect(TOWER_OFFSET).toBeGreaterThanOrEqual(0);
    expect(TOWER_OFFSET).toBeLessThan(TOWER_R);
    expect(TOWER_H).toBeGreaterThan(3);
    expect(TOWER_BASE).toBeLessThan(0);
  });

  /** Verifies that there is exactly one tower at each of the four map corners */
  it('places one tower at each corner', () => {
    expect(TOWERS).toHaveLength(4);
    const corners = TOWERS.map((t) => {
      const c = cornerOf(t);
      return `${c.zs}${c.xs}`;
    });
    expect(new Set(corners)).toEqual(new Set(['nw', 'ne', 'sw', 'se']));
  });

  /** Verifies that each tower centre sits TOWER_OFFSET outside its OUTER corner, diagonally */
  it('puts each centre TOWER_OFFSET outside the OUTER corner on both axes', () => {
    for (const t of TOWERS) {
      const { xs, zs } = cornerOf(t);
      const cornerX = xs === 'w' ? OUTER.x0 : OUTER.x1;
      const cornerZ = zs === 'n' ? OUTER.z0 : OUTER.z1;
      expect(t.x).toBeCloseTo(cornerX + (xs === 'w' ? -1 : 1) * TOWER_OFFSET, 9);
      expect(t.z).toBeCloseTo(cornerZ + (zs === 'n' ? -1 : 1) * TOWER_OFFSET, 9);
    }
  });

  /** Verifies that no point of a tower reaches further inside the castle than the outer wall */
  it('keeps every point of each tower disc within the outer wall band on at least one axis', () => {
    for (const t of TOWERS) {
      const { xs, zs } = cornerOf(t);
      const inner = (p: { x: number; z: number }) => {
        // How far inside the inner face of the outer wall the point is, on each axis (> 0 = inside).
        const ix = xs === 'w' ? p.x - PERIMETER_INNER.w : PERIMETER_INNER.e - p.x;
        const iz = zs === 'n' ? p.z - PERIMETER_INNER.n : PERIMETER_INNER.s - p.z;
        return Math.min(ix, iz);
      };
      // The circle and its centre bound the whole disc for this convex test.
      for (const p of [...circle(t), { x: t.x, z: t.z }]) {
        expect(inner(p), `tower ${xs}${zs} at (${p.x}, ${p.z})`).toBeLessThanOrEqual(TOL);
      }
    }
  });

  /** Verifies the same band rule stated against OUTER and PERIMETER_T directly */
  it('keeps every disc point within PERIMETER_T of OUTER on at least one axis', () => {
    for (const t of TOWERS) {
      const { xs, zs } = cornerOf(t);
      for (const p of circle(t)) {
        const depthX = xs === 'w' ? p.x - OUTER.x0 : OUTER.x1 - p.x;
        const depthZ = zs === 'n' ? p.z - OUTER.z0 : OUTER.z1 - p.z;
        expect(Math.min(depthX, depthZ)).toBeLessThanOrEqual(PERIMETER_T + TOL);
      }
    }
  });

  /** Verifies that each tower overlaps the castle corner, so it reads as part of the walls */
  it('overlaps its map corner (the corner lies inside the tower disc)', () => {
    for (const t of TOWERS) {
      const { xs, zs } = cornerOf(t);
      const d = Math.hypot(PERIMETER_LINE[xs] - t.x, PERIMETER_LINE[zs] - t.z);
      expect(d).toBeLessThan(TOWER_R);
    }
  });

  /** Verifies that the cutaway anchor of each tower is its corner pillar on PERIMETER_LINE */
  it('anchors each tower on its corner pillar of the perimeter line', () => {
    for (const t of TOWERS) {
      const { xs, zs } = cornerOf(t);
      expect(t.ax).toBe(PERIMETER_LINE[xs]);
      expect(t.az).toBe(PERIMETER_LINE[zs]);
    }
  });

  /** Verifies that a figure on each tower faces into the castle (KayKit faces +Z at rotation 0) */
  it('faces each figure toward the castle centre', () => {
    for (const t of TOWERS) {
      const forward = { x: Math.sin(t.facing), z: Math.cos(t.facing) };
      const toCentre = { x: CENTRE.x - t.x, z: CENTRE.z - t.z };
      expect(Math.sign(forward.x)).toBe(Math.sign(toCentre.x));
      expect(Math.sign(forward.z)).toBe(Math.sign(toCentre.z));
      const dot = (forward.x * toCentre.x + forward.z * toCentre.z) / Math.hypot(toCentre.x, toCentre.z);
      expect(dot).toBeGreaterThan(0.5);
      expect(Math.hypot(forward.x, forward.z)).toBeCloseTo(1, 12);
    }
  });

  /** Verifies that the north heralds face +Z (toward the default camera, south of the castle) */
  it('turns the north heralds toward +Z and the south ones toward -Z', () => {
    for (const t of TOWERS) {
      const fz = Math.cos(t.facing);
      if (cornerOf(t).zs === 'n') expect(fz).toBeGreaterThan(0);
      else expect(fz).toBeLessThan(0);
    }
  });

  /** Verifies that every tower field is a finite number */
  it('has finite coordinates, anchor and facing', () => {
    for (const t of TOWERS) {
      for (const v of [t.x, t.z, t.ax, t.az, t.facing]) expect(Number.isFinite(v)).toBe(true);
    }
  });

  /** Verifies that towers are frozen so no component can move them by accident */
  it('freezes every tower', () => {
    for (const t of TOWERS) expect(Object.isFrozen(t)).toBe(true);
  });

  /** Verifies that towers do not overlap each other */
  it('keeps the towers apart', () => {
    for (let i = 0; i < TOWERS.length; i++) {
      for (let j = i + 1; j < TOWERS.length; j++) {
        expect(Math.hypot(TOWERS[i].x - TOWERS[j].x, TOWERS[i].z - TOWERS[j].z)).toBeGreaterThan(2 * TOWER_R);
      }
    }
  });
});
