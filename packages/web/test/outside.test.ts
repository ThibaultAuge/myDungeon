import { describe, expect, it } from 'vitest';
import type { RoomId } from '@agent-office/shared';
import { GATE_JAMB, OUTER, PERIMETER_T } from '../src/scene/dungeon.ts';
import { BRIDGE, GROUND_Y, PATH_HALF_WIDTH, distanceToPath, distanceToRect, pathPoints } from '../src/scene/forest.ts';
import {
  BOUNDS,
  CORRIDORS,
  GATE,
  ROOMS,
  SPAWN,
  assignSpots,
  corridorPath,
  doorOf,
  reroute,
  routeBetween,
  type Point,
  type RoomDef,
  type Spot,
} from '../src/scene/layout.ts';
import {
  ENTRY_INDEX,
  ENTRY_SPOT,
  GATE_SPOT,
  KILL_INDEX,
  PAN_MARGIN,
  PATH,
  SLOT_STEP,
  exitRoute,
  groundY,
  isOutside,
  killIndex,
  killPoint,
  nearestPathIndex,
  routeFrom,
} from '../src/scene/outside.ts';

const TOL = 1e-3;
/** The corridor end just inside the gate: where every trip outside meets the corridors. */
const CORRIDOR_END: Point = { x: 5, z: 9.5 };
/** Inner face of the south outer wall: the wall band runs from here to OUTER.z1. */
const WALL_INNER_Z = OUTER.z1 - PERIMETER_T;
/** Clear part of the gate opening, away from the jambs (stricter than the jamb faces). */
const GATE_CLEAR = { lo: GATE.lo + GATE_JAMB, hi: GATE.hi - GATE_JAMB };

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < TOL && Math.abs(a.z - b.z) < TOL;
}

function rect(r: RoomDef) {
  return { x0: r.cx - r.w / 2, x1: r.cx + r.w / 2, z0: r.cz - r.d / 2, z1: r.cz + r.d / 2 };
}

/** The spot a lone generic agent gets in a room. */
function spotIn(roomId: RoomId, agentType = 'general-purpose'): Spot {
  return assignSpots([{ id: 'solo', room: roomId, agentType, queued: false, since: 0 }], new Map()).get('solo')!;
}

/** Points every `step` metres along the walk from `from` through `points`, both ends included. */
function samples(from: Point, points: Point[], step = 0.05): Point[] {
  const out: Point[] = [from];
  let prev = from;
  for (const p of points) {
    const n = Math.max(1, Math.ceil(Math.hypot(p.x - prev.x, p.z - prev.z) / step));
    for (let i = 1; i <= n; i++) out.push({ x: prev.x + ((p.x - prev.x) * i) / n, z: prev.z + ((p.z - prev.z) * i) / n });
    prev = p;
  }
  return out;
}

/** True when the walk from a to b goes through a room wall anywhere but its door gap (as in layout.test). */
function crossesWall(a: Point, b: Point): RoomId | undefined {
  const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
  for (const r of ROOMS) {
    if (r.insideOf) continue;
    const { x0, x1, z0, z1 } = rect(r);
    const inside = (p: Point) => p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1;
    const door = doorOf(r).wall;
    let prev = a;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      if (inside(p) !== inside(prev) && Math.hypot(p.x - door.x, p.z - door.z) > 0.9) return r.id;
      prev = p;
    }
  }
  return undefined;
}

/**
 * Problems of a walk that leaves or enters the castle: a point in the south wall band out of
 * the gate's clear opening, a point outside the castle off the path and off the drawbridge,
 * or a leg through a room wall.
 */
function walkProblems(from: Point, points: Point[]): string[] {
  const problems: string[] = [];
  const path = PATH as Point[];
  for (const p of samples(from, points)) {
    const inWallBand = p.z > WALL_INNER_Z && p.z <= OUTER.z1;
    if (inWallBand && (p.x < GATE_CLEAR.lo || p.x > GATE_CLEAR.hi)) problems.push(`through the wall at ${JSON.stringify(p)}`);
    if (p.z > OUTER.z1) {
      const onPath = distanceToPath(p.x, p.z, path) <= PATH_HALF_WIDTH + TOL;
      const onBridge = distanceToRect(p.x, p.z, BRIDGE) <= TOL;
      if (!onPath && !onBridge) problems.push(`off the path at ${JSON.stringify(p)}`);
    }
  }
  let prev = from;
  for (const p of points) {
    const wall = crossesWall(prev, p);
    if (wall) problems.push(`through ${wall} from ${JSON.stringify(prev)} to ${JSON.stringify(p)}`);
    prev = p;
  }
  return problems.slice(0, 5);
}

/** True when the walk goes through the gate opening, crossing the wall band. */
function crossesGate(from: Point, points: Point[]): boolean {
  const s = samples(from, points);
  return s.some((p) => p.z > WALL_INNER_Z && p.z <= OUTER.z1 && p.x >= GATE_CLEAR.lo && p.x <= GATE_CLEAR.hi);
}

// ---------------------------------------------------------------- groundY

describe('groundY', () => {
  /**
   * Verifies that every point of the castle, its edges included, is at floor height 0
   */
  it.each([
    ['centre', { x: 0, z: 0 }],
    ['north-west corner', { x: OUTER.x0, z: OUTER.z0 }],
    ['south-east corner', { x: OUTER.x1, z: OUTER.z1 }],
    ['gate threshold', { x: (GATE.lo + GATE.hi) / 2, z: OUTER.z1 }],
    ['corridor end', CORRIDOR_END],
  ])('is 0 inside the castle (%s)', (_label, p) => {
    expect(groundY(p)).toBe(0);
  });

  /**
   * Verifies that points of the forest all around the castle are on the forest floor
   */
  it.each([
    ['south, on the path', { x: PATH[KILL_INDEX].x, z: PATH[KILL_INDEX].z }],
    ['far south', { x: 0, z: 80 }],
    ['north', { x: 0, z: OUTER.z0 - 5 }],
    ['west', { x: OUTER.x0 - 0.01, z: 0 }],
    ['east', { x: OUTER.x1 + 10, z: 0 }],
    ['past the drawbridge end', { x: (BRIDGE.x0 + BRIDGE.x1) / 2, z: BRIDGE.z1 }],
  ])('is GROUND_Y on the forest floor (%s)', (_label, p) => {
    expect(groundY(p)).toBe(GROUND_Y);
  });

  /**
   * Verifies that the drawbridge slopes steadily down from the castle floor to the forest floor
   */
  it('slopes monotonically down the drawbridge, between 0 and GROUND_Y', () => {
    const x = (BRIDGE.x0 + BRIDGE.x1) / 2;
    const n = 40;
    let prev = groundY({ x, z: BRIDGE.z0 });
    expect(prev).toBe(0);
    for (let i = 1; i < n; i++) {
      const y = groundY({ x, z: BRIDGE.z0 + ((BRIDGE.z1 - BRIDGE.z0) * i) / n });
      expect(y).toBeLessThan(prev);
      expect(y).toBeLessThan(0);
      expect(y).toBeGreaterThan(GROUND_Y);
      prev = y;
    }
    expect(groundY({ x, z: BRIDGE.z1 })).toBe(GROUND_Y);
  });

  /**
   * Verifies that the slope is continuous: no step at either end of the drawbridge
   */
  it('joins the castle floor and the forest floor without a step', () => {
    const x = (BRIDGE.x0 + BRIDGE.x1) / 2;
    expect(groundY({ x, z: BRIDGE.z0 + 1e-6 })).toBeCloseTo(0, 5);
    expect(groundY({ x, z: BRIDGE.z1 - 1e-6 })).toBeCloseTo(GROUND_Y, 5);
    expect(groundY({ x, z: (BRIDGE.z0 + BRIDGE.z1) / 2 })).toBeCloseTo(GROUND_Y / 2, 9);
  });

  /**
   * Verifies that the slope does not depend on where across the drawbridge the point lies
   */
  it('is the same across the width of the drawbridge', () => {
    const z = BRIDGE.z0 + (BRIDGE.z1 - BRIDGE.z0) * 0.3;
    expect(groundY({ x: BRIDGE.x0, z })).toBeCloseTo(groundY({ x: BRIDGE.x1, z }), 12);
  });
});

// ---------------------------------------------------------------- PATH and indices

describe('PATH', () => {
  /**
   * Verifies that PATH is the forest path, starting at the end of the drawbridge
   */
  it('is the forest path from the drawbridge end', () => {
    expect(PATH).toEqual(pathPoints());
    expect(PATH[0].x).toBeCloseTo((GATE.lo + GATE.hi) / 2, 9);
    expect(PATH[0].z).toBeCloseTo(BRIDGE.z1, 9);
  });

  /**
   * Verifies that the shared PATH and its points cannot be mutated by callers
   */
  it('is frozen, points included', () => {
    expect(Object.isFrozen(PATH)).toBe(true);
    for (const p of PATH) expect(Object.isFrozen(p)).toBe(true);
  });

  /**
   * Verifies that the entry and kill indices exist and every kill slot 0..3 lies before the entry
   */
  it('has the entry point beyond every kill point', () => {
    expect(ENTRY_INDEX).toBeLessThan(PATH.length);
    expect(SLOT_STEP).toBeGreaterThan(0);
    expect(KILL_INDEX).toBeGreaterThan(0);
    for (let slot = 0; slot <= 3; slot++) expect(killIndex(slot)).toBeLessThan(ENTRY_INDEX);
  });
});

describe('ENTRY_SPOT and GATE_SPOT', () => {
  /**
   * Verifies that new main agents appear on the path beyond the camera's pan limit
   */
  it('puts ENTRY_SPOT on the path, out of the pan clamp', () => {
    expect(ENTRY_SPOT.id).toBe('forest');
    expect(ENTRY_SPOT.x).toBe(PATH[ENTRY_INDEX].x);
    expect(ENTRY_SPOT.z).toBe(PATH[ENTRY_INDEX].z);
    expect(ENTRY_SPOT.z).toBeGreaterThan(BOUNDS.z1 + PAN_MARGIN);
    expect(isOutside(ENTRY_SPOT)).toBe(true);
  });

  /**
   * Verifies that GATE_SPOT is the south end of the x = 5 corridor, inside the castle
   */
  it('puts GATE_SPOT at the corridor end, inside the castle', () => {
    expect(samePoint(GATE_SPOT, CORRIDOR_END)).toBe(true);
    expect(samePoint(GATE_SPOT.anchor, GATE_SPOT)).toBe(true);
    expect(GATE_SPOT.entry).toEqual([]);
    expect(isOutside(GATE_SPOT)).toBe(false);
    expect(GATE_SPOT.x).toBeGreaterThan(GATE.lo);
    expect(GATE_SPOT.x).toBeLessThan(GATE.hi);
  });

  /**
   * Verifies that GATE_SPOT lies on a corridor, so the corridor graph can route from it
   */
  it('puts GATE_SPOT on a corridor', () => {
    const on = CORRIDORS.some(
      ([a, b]) =>
        Math.abs(a.x - b.x) < TOL &&
        Math.abs(GATE_SPOT.x - a.x) < TOL &&
        GATE_SPOT.z >= Math.min(a.z, b.z) - TOL &&
        GATE_SPOT.z <= Math.max(a.z, b.z) + TOL,
    );
    expect(on).toBe(true);
    // Off every corridor, corridorPath would fall back to a straight line: [to] alone.
    const far = { x: 15, z: 5.5 };
    const path = corridorPath(GATE_SPOT, far);
    expect(path.length).toBeGreaterThan(1);
    expect(samePoint(path[path.length - 1], far)).toBe(true);
  });

  /**
   * Verifies that both shared spots are frozen
   */
  it('freezes the shared spots', () => {
    expect(Object.isFrozen(GATE_SPOT)).toBe(true);
    expect(Object.isFrozen(ENTRY_SPOT)).toBe(true);
  });
});

// ---------------------------------------------------------------- kill points

describe('killIndex and killPoint', () => {
  /**
   * Verifies that slot 0 is KILL_INDEX and each further slot is SLOT_STEP points farther
   */
  it.each([0, 1, 2, 3, 5])('places slot %i SLOT_STEP points apart from the previous one', (slot) => {
    expect(killIndex(slot)).toBe(KILL_INDEX + slot * SLOT_STEP);
  });

  /**
   * Verifies that a huge slot is clamped to the last path point instead of overflowing
   */
  it.each([1000, Number.MAX_SAFE_INTEGER])('clamps slot %d to the end of the path', (slot) => {
    expect(killIndex(slot)).toBe(PATH.length - 1);
    expect(killPoint(slot)).toEqual({ ...PATH[PATH.length - 1] });
  });

  /**
   * Verifies that kill points of slots 0..3 lie outside the castle and within the pan limit
   */
  it.each([0, 1, 2, 3])('keeps the kill point of slot %i outside the castle and in view', (slot) => {
    const p = killPoint(slot);
    expect(p).toEqual({ ...PATH[killIndex(slot)] });
    expect(isOutside(p)).toBe(true);
    expect(p.z).toBeLessThanOrEqual(BOUNDS.z1 + PAN_MARGIN);
    expect(groundY(p)).toBe(GROUND_Y);
  });

  /**
   * Verifies that every slot gets its own kill point
   */
  it('gives distinct slots distinct points', () => {
    const pts = [0, 1, 2, 3].map(killPoint);
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(samePoint(pts[i], pts[j])).toBe(false);
  });

  /**
   * Verifies that killPoint returns a fresh copy, so a caller cannot move the path
   */
  it('returns a copy', () => {
    const p = killPoint(0);
    expect(p).not.toBe(PATH[KILL_INDEX]);
    p.x += 100;
    expect(killPoint(0).x).toBe(PATH[KILL_INDEX].x);
  });
});

describe('nearestPathIndex', () => {
  /**
   * Verifies that a path point maps back to its own index
   */
  it.each([0, KILL_INDEX, ENTRY_INDEX, PATH.length - 1])('finds index %i for its own point', (i) => {
    expect(nearestPathIndex(PATH[i])).toBe(i);
  });

  /**
   * Verifies that a point slightly off the path maps to the closest path point
   */
  it('finds the closest point for a point beside the path', () => {
    const p = PATH[30];
    expect(nearestPathIndex({ x: p.x + 0.3, z: p.z })).toBe(30);
  });

  /**
   * Verifies that a point in the castle maps to the start of the path
   */
  it('maps the gate side to index 0', () => {
    expect(nearestPathIndex(CORRIDOR_END)).toBe(0);
  });
});

describe('isOutside', () => {
  /**
   * Verifies that points past the dungeon's south edge (the gate onwards) are outside and the edge itself is not
   */
  it('splits at the south edge of the dungeon', () => {
    expect(isOutside({ x: 5.5, z: BOUNDS.z1 })).toBe(false);
    expect(isOutside({ x: 5.5, z: BOUNDS.z1 + 0.01 })).toBe(true);
    expect(isOutside({ x: 5.5, z: OUTER.z1 })).toBe(true);
    expect(isOutside({ x: 0, z: 0 })).toBe(false);
    expect(isOutside(CORRIDOR_END)).toBe(false);
    expect(isOutside(PATH[0])).toBe(true);
  });
});

// ---------------------------------------------------------------- routeFrom

describe('routeFrom', () => {
  const targets: RoomId[] = ['taverne', 'observatoire', 'garde', 'concierge', 'heraut', 'biblio'];

  /**
   * Verifies that a newcomer from the forest starts on the path, just past its entry point
   */
  it('starts at the path point before ENTRY_INDEX', () => {
    const route = routeFrom(ENTRY_SPOT, spotIn('taverne'));
    expect(route[0]).toEqual({ ...PATH[ENTRY_INDEX - 1] });
  });

  /**
   * Verifies that the forest route walks the path, the drawbridge and the gate, never a wall
   */
  it.each(targets)('walks in from the forest to %s on the path and through the gate', (roomId) => {
    const to = spotIn(roomId);
    const route = routeFrom(ENTRY_SPOT, to);
    expect(walkProblems(ENTRY_SPOT, route)).toEqual([]);
    expect(crossesGate(ENTRY_SPOT, route)).toBe(true);
  });

  /**
   * Verifies that the route passes the corridor end inside the gate and ends at the spot
   */
  it.each(targets)('passes GATE_SPOT and ends at the %s spot', (roomId) => {
    const to = spotIn(roomId);
    const route = routeFrom(ENTRY_SPOT, to);
    expect(route.some((p) => samePoint(p, GATE_SPOT))).toBe(true);
    expect(samePoint(route[route.length - 1], to)).toBe(true);
  });

  /**
   * Verifies that the forest part comes first: every outside point precedes every inside one
   */
  it('walks the whole forest part before entering the castle', () => {
    const route = routeFrom(ENTRY_SPOT, spotIn('taverne'));
    const firstInside = route.findIndex((p) => !isOutside(p));
    expect(firstInside).toBeGreaterThan(0);
    expect(route.slice(firstInside).every((p) => !isOutside(p))).toBe(true);
    // Path points walked from the entry back to the drawbridge, in order, then the gate.
    expect(route.slice(0, firstInside)).toEqual([
      ...Array.from({ length: ENTRY_INDEX }, (_, i) => ({ ...PATH[ENTRY_INDEX - 1 - i] })),
      { x: (GATE.lo + GATE.hi) / 2, z: BOUNDS.z1 + 0.2 },
    ]);
  });

  /**
   * Verifies that the route has no two consecutive identical waypoints
   */
  it('has no repeated consecutive waypoint', () => {
    const route = routeFrom(ENTRY_SPOT, spotIn('observatoire'));
    for (let i = 1; i < route.length; i++) expect(samePoint(route[i], route[i - 1]), `at ${i}`).toBe(false);
  });

  /**
   * Verifies that a start that is not the forest gives the plain corridor route
   */
  it('equals routeBetween for a start inside the castle', () => {
    const to = spotIn('biblio');
    expect(routeFrom(SPAWN, to)).toEqual(routeBetween(SPAWN, to));
    const from = spotIn('garde');
    expect(routeFrom(from, to)).toEqual(routeBetween(from, to));
  });

  /**
   * Verifies that mutating a returned route never changes the shared path
   */
  it('returns points that are not the shared PATH points', () => {
    const route = routeFrom(ENTRY_SPOT, spotIn('taverne'));
    const before = PATH[ENTRY_INDEX - 1].x;
    route[0].x += 50;
    expect(PATH[ENTRY_INDEX - 1].x).toBe(before);
  });
});

// ---------------------------------------------------------------- reroute of a forest route

describe('reroute of a route from the forest', () => {
  /**
   * Verifies that a newcomer redirected while outside keeps its forest part up to the corridor end
   */
  it('keeps the forest part up to the corridor end, then goes to the new spot', () => {
    const via = spotIn('taverne');
    const to = { ...spotIn('observatoire', 'turing'), id: 'target' };
    const route = routeFrom(ENTRY_SPOT, via);
    const k = route.findIndex((p) => samePoint(p, CORRIDOR_END));
    expect(k).toBeGreaterThan(0);
    for (const i of [0, 1, Math.floor(k / 2), k - 1, k]) {
      const rest = route.slice(i);
      const next = reroute(rest, via, to);
      expect(next.slice(0, k - i + 1), `from waypoint ${i}`).toEqual(route.slice(i, k + 1));
      expect(samePoint(next[next.length - 1], to)).toBe(true);
    }
  });

  /**
   * Verifies that a redirected newcomer never crosses a wall, wherever it is on the way in
   */
  it('never goes through a wall after a redirection', () => {
    const via = spotIn('taverne');
    const to = { ...spotIn('garde', 'turing'), id: 'target' };
    const route = routeFrom(ENTRY_SPOT, via);
    let pos: Point = ENTRY_SPOT;
    for (let i = 0; i < route.length; i++) {
      const mid = { x: (pos.x + route[i].x) / 2, z: (pos.z + route[i].z) / 2 };
      const next = reroute(route.slice(i), via, to);
      expect(walkProblems(mid, next), `at waypoint ${i}`).toEqual([]);
      pos = route[i];
    }
  });
});

// ---------------------------------------------------------------- exitRoute

describe('exitRoute', () => {
  /**
   * Verifies that a doomed agent seated in a room walks out through the gate to its kill point
   */
  it.each([
    ['taverne', 0],
    ['observatoire', 1],
    ['garde', 2],
    ['concierge', 3],
  ] as [RoomId, number][])('leads from a %s seat to the kill point of slot %i through the gate', (roomId, slot) => {
    const from = spotIn(roomId);
    const route = exitRoute(from, [], from, slot);
    expect(route[route.length - 1]).toEqual(killPoint(slot));
    expect(route.some((p) => samePoint(p, GATE_SPOT))).toBe(true);
    expect(crossesGate(from, route)).toBe(true);
    expect(walkProblems(from, route)).toEqual([]);
  });

  /**
   * Verifies that once out of the castle the route only walks the path
   */
  it('stays on the path once outside the castle', () => {
    const from = spotIn('taverne');
    const route = exitRoute(from, [], from, 0);
    const firstOut = route.findIndex(isOutside);
    expect(firstOut).toBeGreaterThan(0);
    expect(route.slice(firstOut)).toEqual([
      { x: (GATE.lo + GATE.hi) / 2, z: BOUNDS.z1 + 0.2 },
      ...Array.from({ length: KILL_INDEX + 1 }, (_, i) => ({ ...PATH[i] })),
    ]);
  });

  /**
   * Verifies that an agent stopped halfway along a corridor leg finishes it without crossing a wall
   */
  it('finishes the current leg of a walk inside the castle, never through a wall', () => {
    const a = spotIn('biblio');
    const b = spotIn('machines');
    const route = routeBetween(a, b);
    let pos: Point = a;
    for (let i = 0; i < route.length; i++) {
      const mid = { x: (pos.x + route[i].x) / 2, z: (pos.z + route[i].z) / 2 };
      const out = exitRoute(mid, route.slice(i), b, 0);
      expect(walkProblems(mid, out), `at waypoint ${i}`).toEqual([]);
      expect(out[out.length - 1]).toEqual(killPoint(0));
      pos = route[i];
    }
  });

  /**
   * Verifies that an agent still walking in from the forest turns round on the path
   */
  it.each([
    [40, 0],
    [30, 2],
    [ENTRY_INDEX, 1],
  ])('turns round on the path from index %i to slot %i, never entering the castle', (at, slot) => {
    const pos = { ...PATH[at] };
    const route = exitRoute(pos, routeFrom(ENTRY_SPOT, spotIn('taverne')), spotIn('taverne'), slot);
    const target = killIndex(slot);
    expect(route).toEqual(Array.from({ length: at - target + 1 }, (_, i) => ({ ...PATH[at - i] })));
    expect(route.every(isOutside)).toBe(true);
  });

  /**
   * Verifies that an agent outside between the gate and its kill point walks on to it
   */
  it('walks forward along the path from the drawbridge side', () => {
    const route = exitRoute({ ...PATH[3] }, [], spotIn('taverne'), 1);
    expect(route).toEqual(Array.from({ length: killIndex(1) - 3 + 1 }, (_, i) => ({ ...PATH[3 + i] })));
    expect(route.every(isOutside)).toBe(true);
  });

  /**
   * Verifies that an agent standing on its kill point gets just that point
   */
  it('returns the kill point alone when already there', () => {
    expect(exitRoute(killPoint(0), [], spotIn('taverne'), 0)).toEqual([killPoint(0)]);
  });

  /**
   * Verifies that an agent beside the path snaps to its nearest path point first
   */
  it('starts from the nearest path point for a point beside the path', () => {
    const p = PATH[25];
    const route = exitRoute({ x: p.x + 0.4, z: p.z }, [], spotIn('taverne'), 0);
    expect(route[0]).toEqual({ ...PATH[25] });
    expect(route[route.length - 1]).toEqual(killPoint(0));
  });
});
