import { describe, expect, it } from 'vitest';
import type { Point } from '../src/scene/layout.ts';
import {
  ACCELERATION,
  CRUISE_SPEED,
  MIN_SPEED,
  advance,
  nextSpeed,
  remainingDistance,
} from '../src/scene/walk.ts';

const TOL = 1e-9;
const DT = 1 / 60;

/** Distance needed to brake from cruising speed to a stop at constant deceleration. */
const BRAKING_DISTANCE = (CRUISE_SPEED * CRUISE_SPEED) / (2 * ACCELERATION);

interface Frame {
  /** Distance left to the end of the route before the frame. */
  remaining: number;
  /** Speed used during the frame. */
  speed: number;
  /** Waypoints left after the frame. */
  pathLeft: number;
}

/** Runs the same per-frame loop as AgentFigure until the path is empty (or a guard trips). */
function simulate(start: Point, route: Point[], dt: number, maxFrames = 10_000) {
  const pos = { ...start };
  const path = route.map((p) => ({ ...p }));
  const frames: Frame[] = [];
  let speed = 0;
  while (path.length > 0 && frames.length < maxFrames) {
    const remaining = remainingDistance(pos, path);
    speed = nextSpeed(speed, remaining, dt);
    advance(pos, path, speed * dt);
    frames.push({ remaining, speed, pathLeft: path.length });
  }
  return { pos, path, frames };
}

describe('walk constants', () => {
  /** Verifies that the cruising speed is twice the original 4.5 units per second */
  it('cruise speed doubles the old constant speed', () => {
    expect(CRUISE_SPEED).toBe(9);
  });

  /** Verifies that the speed floor is positive and well below cruising speed */
  it('min speed is a small positive floor', () => {
    expect(MIN_SPEED).toBeGreaterThan(0);
    expect(MIN_SPEED).toBeLessThan(CRUISE_SPEED);
    expect(ACCELERATION).toBeGreaterThan(0);
  });
});

describe('remainingDistance', () => {
  /** Verifies that an empty path leaves no distance to walk */
  it('returns 0 for an empty path', () => {
    expect(remainingDistance({ x: 3, z: -2 }, [])).toBe(0);
  });

  /** Verifies that the distance to a single waypoint is the euclidean distance */
  it('measures a single segment', () => {
    expect(remainingDistance({ x: 0, z: 0 }, [{ x: 3, z: 4 }])).toBeCloseTo(5, 9);
  });

  /** Verifies that the distance sums every segment through all the waypoints */
  it('sums a multi-segment route', () => {
    const path = [
      { x: 3, z: 4 },
      { x: 3, z: 10 },
      { x: -2, z: 10 },
    ];
    expect(remainingDistance({ x: 0, z: 0 }, path)).toBeCloseTo(5 + 6 + 5, 9);
  });

  /** Verifies that a waypoint at the start position adds no distance */
  it('counts zero-length segments as zero', () => {
    const path = [
      { x: 1, z: 1 },
      { x: 1, z: 1 },
      { x: 1, z: 3 },
    ];
    expect(remainingDistance({ x: 1, z: 1 }, path)).toBeCloseTo(2, 9);
  });

  /** Verifies that measuring the route leaves the path and position untouched */
  it('does not mutate its inputs', () => {
    const from = { x: 0, z: 0 };
    const path = [{ x: 1, z: 0 }, { x: 1, z: 1 }];
    remainingDistance(from, path);
    expect(from).toEqual({ x: 0, z: 0 });
    expect(path).toEqual([{ x: 1, z: 0 }, { x: 1, z: 1 }]);
  });
});

describe('nextSpeed', () => {
  /** Verifies that from standstill the speed grows by ACCELERATION * dt */
  it('accelerates from 0 by ACCELERATION * dt', () => {
    expect(nextSpeed(0, 100, 0.1)).toBeCloseTo(ACCELERATION * 0.1, 9);
  });

  /** Verifies that acceleration is added to the current speed, not restarted */
  it('accelerates from the current speed', () => {
    expect(nextSpeed(2, 100, 0.1)).toBeCloseTo(2 + ACCELERATION * 0.1, 9);
  });

  /** Verifies that the speed never exceeds CRUISE_SPEED on a long route */
  it('caps at CRUISE_SPEED', () => {
    expect(nextSpeed(CRUISE_SPEED - 0.01, 100, 0.1)).toBe(CRUISE_SPEED);
    expect(nextSpeed(CRUISE_SPEED, 100, 1)).toBe(CRUISE_SPEED);
  });

  /** Verifies that a speed above cruise (e.g. stale value) is brought back to cruise */
  it('clamps an over-cruise speed down to CRUISE_SPEED', () => {
    expect(nextSpeed(CRUISE_SPEED * 3, 100, DT)).toBe(CRUISE_SPEED);
  });

  /** Verifies that near the end the speed follows the braking curve sqrt(2*A*d) */
  it('caps by the braking curve near the end of the route', () => {
    const remaining = 0.5;
    expect(nextSpeed(CRUISE_SPEED, remaining, DT)).toBeCloseTo(
      Math.sqrt(2 * ACCELERATION * remaining),
      9,
    );
  });

  /** Verifies that the braking curve does not limit speed beyond the braking distance */
  it('is not limited by braking beyond the braking distance', () => {
    expect(nextSpeed(CRUISE_SPEED, BRAKING_DISTANCE + 0.01, DT)).toBe(CRUISE_SPEED);
  });

  /** Verifies that the braking curve exactly allows cruise at the braking distance */
  it('allows cruise exactly at the braking distance', () => {
    expect(nextSpeed(CRUISE_SPEED, BRAKING_DISTANCE, DT)).toBeCloseTo(CRUISE_SPEED, 9);
  });

  /** Verifies that the speed never drops below MIN_SPEED while distance remains */
  it('floors at MIN_SPEED when the braking curve is tiny', () => {
    expect(nextSpeed(CRUISE_SPEED, 1e-6, DT)).toBe(MIN_SPEED);
  });

  /** Verifies that a zero dt from standstill still yields MIN_SPEED, not 0 */
  it('floors at MIN_SPEED from standstill with dt 0', () => {
    expect(nextSpeed(0, 100, 0)).toBe(MIN_SPEED);
  });

  /** Verifies that the speed is 0 when the route is finished */
  it('returns 0 when remaining is 0', () => {
    expect(nextSpeed(CRUISE_SPEED, 0, DT)).toBe(0);
  });

  /** Verifies that a negative remaining distance is treated as arrived */
  it('returns 0 when remaining is negative', () => {
    expect(nextSpeed(CRUISE_SPEED, -1, DT)).toBe(0);
  });
});

describe('advance', () => {
  /** Verifies that a short step moves partway along the segment and keeps the waypoint */
  it('moves partway along a segment', () => {
    const pos = { x: 0, z: 0 };
    const path = [{ x: 10, z: 0 }];
    const heading = advance(pos, path, 3);
    expect(pos.x).toBeCloseTo(3, 9);
    expect(pos.z).toBeCloseTo(0, 9);
    expect(path).toEqual([{ x: 10, z: 0 }]);
    expect(heading).toBeCloseTo(Math.PI / 2, 9);
  });

  /** Verifies that a diagonal partial move follows the segment direction */
  it('moves along a diagonal segment', () => {
    const pos = { x: 0, z: 0 };
    const path = [{ x: 3, z: 4 }];
    advance(pos, path, 2.5);
    expect(pos.x).toBeCloseTo(1.5, 9);
    expect(pos.z).toBeCloseTo(2, 9);
    expect(path).toHaveLength(1);
  });

  /** Verifies that a step equal to the distance lands on and removes the waypoint */
  it('removes the waypoint on exact arrival', () => {
    const pos = { x: 0, z: 0 };
    const path = [{ x: 10, z: 0 }];
    const heading = advance(pos, path, 10);
    expect(pos).toEqual({ x: 10, z: 0 });
    expect(path).toEqual([]);
    expect(heading).toBeCloseTo(Math.PI / 2, 9);
  });

  /** Verifies that leftover step after a corner carries into the next segment */
  it('carries the overshoot into the next segment', () => {
    const pos = { x: 0, z: 0 };
    const path = [
      { x: 2, z: 0 },
      { x: 2, z: 5 },
    ];
    const heading = advance(pos, path, 4);
    expect(pos.x).toBeCloseTo(2, 9);
    expect(pos.z).toBeCloseTo(2, 9);
    expect(path).toEqual([{ x: 2, z: 5 }]);
    // Heading of the last movement: along +z.
    expect(heading).toBeCloseTo(0, 9);
  });

  /** Verifies that one step can cross several corners in a single call */
  it('crosses several waypoints in one step', () => {
    const pos = { x: 0, z: 0 };
    const path = [
      { x: 1, z: 0 },
      { x: 1, z: 1 },
      { x: 0, z: 1 },
      { x: 0, z: 5 },
    ];
    advance(pos, path, 4);
    expect(pos.x).toBeCloseTo(0, 9);
    expect(pos.z).toBeCloseTo(2, 9);
    expect(path).toEqual([{ x: 0, z: 5 }]);
  });

  /** Verifies that a step longer than the whole route stops on the last waypoint */
  it('stops at the end of the route when the step overshoots everything', () => {
    const pos = { x: 0, z: 0 };
    const path = [
      { x: 1, z: 0 },
      { x: 1, z: 1 },
    ];
    const heading = advance(pos, path, 100);
    expect(pos).toEqual({ x: 1, z: 1 });
    expect(path).toEqual([]);
    expect(heading).toBeCloseTo(0, 9);
  });

  /** Verifies that the heading is atan2(dx, dz) for the four cardinal directions */
  it.each([
    ['+z', { x: 0, z: 5 }, 0],
    ['+x', { x: 5, z: 0 }, Math.PI / 2],
    ['-x', { x: -5, z: 0 }, -Math.PI / 2],
    ['-z', { x: 0, z: -5 }, Math.PI],
  ])('returns the heading for a move towards %s', (_label, target, expected) => {
    const pos = { x: 0, z: 0 };
    const heading = advance(pos, [target], 1);
    expect(heading).not.toBeNull();
    expect(heading as number).toBeCloseTo(expected, 9);
  });

  /** Verifies that the heading matches atan2(dx, dz) on a diagonal */
  it('returns atan2(dx, dz) on a diagonal', () => {
    const heading = advance({ x: 1, z: 1 }, [{ x: 4, z: -3 }], 1);
    expect(heading as number).toBeCloseTo(Math.atan2(3, -4), 9);
  });

  /** Verifies that an empty path returns null and leaves the position unchanged */
  it('returns null and does not move when the path is empty', () => {
    const pos = { x: 2, z: 3 };
    const path: Point[] = [];
    expect(advance(pos, path, 5)).toBeNull();
    expect(pos).toEqual({ x: 2, z: 3 });
    expect(path).toEqual([]);
  });

  /** Verifies that a zero step leaves the position and path unchanged */
  it('does not move with a step of 0', () => {
    const pos = { x: 0, z: 0 };
    const path = [{ x: 5, z: 0 }];
    const heading = advance(pos, path, 0);
    expect(pos).toEqual({ x: 0, z: 0 });
    expect(path).toEqual([{ x: 5, z: 0 }]);
    // Documented: a zero step still returns the heading towards the next waypoint.
    expect(heading).toBeCloseTo(Math.PI / 2, 9);
  });

  /** Verifies that a waypoint on the current position is consumed with null heading */
  it('consumes a zero-length segment with step 0 and returns null', () => {
    const pos = { x: 1, z: 1 };
    const path = [{ x: 1, z: 1 }];
    expect(advance(pos, path, 0)).toBeNull();
    expect(path).toEqual([]);
    expect(pos).toEqual({ x: 1, z: 1 });
  });

  /** Verifies that a zero-length segment does not override the heading of a real move */
  it('keeps the heading of the real move across a duplicate waypoint', () => {
    const pos = { x: 0, z: 0 };
    const path = [
      { x: 2, z: 0 },
      { x: 2, z: 0 },
    ];
    const heading = advance(pos, path, 5);
    expect(path).toEqual([]);
    expect(heading).toBeCloseTo(Math.PI / 2, 9);
  });

  /** Verifies that the caller's position object and path array are mutated in place */
  it('mutates the given position and path in place', () => {
    const pos = { x: 0, z: 0 };
    const path = [{ x: 1, z: 0 }, { x: 1, z: 3 }];
    const posRef = pos;
    const pathRef = path;
    advance(pos, path, 2);
    expect(posRef.z).toBeCloseTo(1, 9);
    expect(pathRef).toHaveLength(1);
  });
});

describe('walking simulation', () => {
  // A 20-unit L-shaped route with its corner 10 units before the end, far beyond the
  // braking distance.
  const START: Point = { x: 0, z: 0 };
  const CORNER: Point = { x: 10, z: 0 };
  const END: Point = { x: 10, z: 10 };
  const ROUTE = [CORNER, END];
  const TOTAL = remainingDistance(START, ROUTE);

  /** Verifies that a long route ends exactly on its last waypoint within a bounded time */
  it('arrives at the end within a bounded number of frames', () => {
    const { pos, path, frames } = simulate(START, ROUTE, DT);
    expect(path).toEqual([]);
    expect(pos.x).toBeCloseTo(END.x, 9);
    expect(pos.z).toBeCloseTo(END.z, 9);
    // Cannot be faster than cruising all the way.
    expect(frames.length).toBeGreaterThanOrEqual(Math.floor(TOTAL / CRUISE_SPEED / DT));
    // Trapezoidal profile: cruise time plus one ramp time, with a margin for the tail.
    const ideal = TOTAL / CRUISE_SPEED + CRUISE_SPEED / ACCELERATION;
    expect(frames.length).toBeLessThanOrEqual(Math.ceil(ideal / DT) + 30);
  });

  /** Verifies that the first frame starts from rest with one acceleration step */
  it('starts from rest', () => {
    const { frames } = simulate(START, ROUTE, DT);
    expect(frames[0].speed).toBeCloseTo(Math.max(MIN_SPEED, ACCELERATION * DT), 9);
    expect(frames[0].speed).toBeLessThan(CRUISE_SPEED / 4);
  });

  /** Verifies that cruising speed is reached and never exceeded on a long route */
  it('reaches but never exceeds CRUISE_SPEED', () => {
    const { frames } = simulate(START, ROUTE, DT);
    const speeds = frames.map((f) => f.speed);
    expect(Math.max(...speeds)).toBeCloseTo(CRUISE_SPEED, 9);
    for (const s of speeds) expect(s).toBeLessThanOrEqual(CRUISE_SPEED + TOL);
  });

  /** Verifies that speed only grows or holds before the braking zone (eases in) */
  it('is monotonically non-decreasing before the braking zone', () => {
    const { frames } = simulate(START, ROUTE, DT);
    const early = frames.filter((f) => f.remaining > BRAKING_DISTANCE);
    expect(early.length).toBeGreaterThan(10);
    for (let i = 1; i < early.length; i++) {
      expect(early[i].speed).toBeGreaterThanOrEqual(early[i - 1].speed - TOL);
    }
    // The ramp takes several frames: it really eases in rather than jumping to cruise.
    const firstCruise = early.findIndex((f) => f.speed >= CRUISE_SPEED - TOL);
    expect(firstCruise).toBeGreaterThan(5);
  });

  /** Verifies that speed only drops in the braking zone and ends low (eases out) */
  it('decelerates monotonically and ends slowly', () => {
    const { frames } = simulate(START, ROUTE, DT);
    const late = frames.filter((f) => f.remaining <= BRAKING_DISTANCE);
    expect(late.length).toBeGreaterThan(5);
    for (let i = 1; i < late.length; i++) {
      expect(late[i].speed).toBeLessThanOrEqual(late[i - 1].speed + TOL);
    }
    const last = frames[frames.length - 1];
    expect(last.speed).toBeLessThan(CRUISE_SPEED / 4);
    expect(last.speed).toBeGreaterThanOrEqual(MIN_SPEED);
  });

  /** Verifies that the agent takes an intermediate corner at full cruising speed */
  it('does not slow down at an intermediate corner far from the end', () => {
    const { frames } = simulate(START, ROUTE, DT);
    const cornerFrame = frames.findIndex((f) => f.pathLeft === 1);
    expect(cornerFrame).toBeGreaterThan(0);
    expect(frames[cornerFrame].speed).toBe(CRUISE_SPEED);
    // Every frame in a window around the corner stays at cruise.
    const around = frames.filter((f) => f.remaining > BRAKING_DISTANCE + 1 && f.remaining < TOTAL - 5);
    expect(around.length).toBeGreaterThan(0);
    for (const f of around) expect(f.speed).toBe(CRUISE_SPEED);
  });

  /** Verifies that a short route arrives without reaching cruise (triangular profile) */
  it('arrives on a short route without reaching cruising speed', () => {
    const shortRoute = [{ x: 0.5, z: 0 }];
    const total = remainingDistance(START, shortRoute);
    const { pos, path, frames } = simulate(START, shortRoute, DT);
    expect(path).toEqual([]);
    expect(pos.x).toBeCloseTo(0.5, 9);
    expect(Math.max(...frames.map((f) => f.speed))).toBeLessThan(CRUISE_SPEED);
    const ideal = 2 * Math.sqrt(total / ACCELERATION);
    expect(frames.length).toBeLessThanOrEqual(Math.ceil(ideal / DT) + 30);
  });

  /** Verifies that the walk still arrives with the 0.05 s frame clamp of AgentFigure */
  it('arrives with large clamped frames', () => {
    const dt = 0.05;
    const { pos, path, frames } = simulate(START, ROUTE, dt);
    expect(path).toEqual([]);
    expect(pos.x).toBeCloseTo(END.x, 9);
    expect(pos.z).toBeCloseTo(END.z, 9);
    for (const f of frames) expect(f.speed).toBeLessThanOrEqual(CRUISE_SPEED + TOL);
    const ideal = TOTAL / CRUISE_SPEED + CRUISE_SPEED / ACCELERATION;
    expect(frames.length).toBeLessThanOrEqual(Math.ceil(ideal / dt) + 30);
  });

  /** Verifies that a route starting on its only waypoint finishes in one frame */
  it('finishes immediately when already on the last waypoint', () => {
    const { path, frames } = simulate(START, [{ ...START }], DT);
    expect(path).toEqual([]);
    expect(frames).toHaveLength(1);
    expect(frames[0].speed).toBe(0);
  });
});
