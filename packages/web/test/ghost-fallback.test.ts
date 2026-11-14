import { describe, expect, it, vi } from 'vitest';
// vi.mock below is hoisted above this import, so ghost.ts sees the small layout.
import { WANDER_POINTS, nearestOnCorridor, nextWander } from '../src/scene/ghost.ts';

// A tiny layout where every corridor end lies within 4 m of every other, plus a degenerate
// (zero-length) corridor: the real dungeon is too big to reach these branches of ghost.ts.
vi.mock('../src/scene/layout.ts', () => ({
  CORRIDORS: [
    [
      { x: 0, z: 0 },
      { x: 2, z: 0 },
    ],
    [
      { x: 0, z: 1 },
      { x: 0, z: 1 },
    ],
  ],
  // Straight line: the real router depends on the real corridors.
  corridorPath: (_from: { x: number; z: number }, to: { x: number; z: number }) => [to],
}));


describe('ghost wander on a small layout', () => {
  /**
   * Verifies that wander points are deduplicated, a zero-length corridor giving one point
   */
  it('lists each distinct corridor end once', () => {
    expect(WANDER_POINTS).toEqual([
      { x: 0, z: 0 },
      { x: 2, z: 0 },
      { x: 0, z: 1 },
    ]);
  });

  /**
   * Verifies that a zero-length corridor projects onto its single point without NaN
   */
  it('projects onto a zero-length corridor', () => {
    expect(nearestOnCorridor({ x: 0, z: 3 })).toEqual({ x: 0, z: 1 });
  });

  /**
   * Verifies that with no corridor end 4 m away, the ghost still gets a target
   */
  it('falls back to any corridor end when none is at least 4 m away', () => {
    const from = { x: 0, z: 0 };
    expect(nextWander(() => 0, from)).toEqual([{ x: 0, z: 0 }]);
    expect(nextWander(() => 0.5, from)).toEqual([{ x: 2, z: 0 }]);
    expect(nextWander(() => 0.99, from)).toEqual([{ x: 0, z: 1 }]);
  });
});
