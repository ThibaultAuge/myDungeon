import { OUTER } from './dungeon.ts';
import { BRIDGE, GROUND_Y, pathPoints } from './forest.ts';
import { BOUNDS, GATE, reroute, routeBetween, type Point, type Spot } from './layout.ts';

// Where main agents walk outside the castle: in from the forest when their session appears,
// out to the place where skeletons kill them when it is deleted. Pure geometry, no three.js.

/** How far the camera target may be panned past the castle walls: the forest has an edge. */
export const PAN_MARGIN = 20;

/** Ground height under a point: castle floor, drawbridge slope, or forest floor. */
export function groundY(p: Point): number {
  if (p.x >= OUTER.x0 && p.x <= OUTER.x1 && p.z >= OUTER.z0 && p.z <= OUTER.z1) return 0;
  if (p.x >= BRIDGE.x0 && p.x <= BRIDGE.x1 && p.z > BRIDGE.z0 && p.z < BRIDGE.z1) {
    return (GROUND_Y * (p.z - BRIDGE.z0)) / (BRIDGE.z1 - BRIDGE.z0);
  }
  return GROUND_Y;
}

/** The forest path, from the end of the drawbridge into the forest. Shared, never mutated. */
export const PATH: readonly Point[] = Object.freeze(pathPoints().map((p) => Object.freeze(p)));

/** Point of PATH where a new main agent appears: past the camera's pan limit, out of sight. */
export const ENTRY_INDEX = 48;
/** Point of PATH where the first doomed agent stops: in view, within the pan limit. */
export const KILL_INDEX = 18;
/** Path points between two doomed agents waiting their turn. */
export const SLOT_STEP = 3;

/** The south end of the x=5 corridor, just inside the gate: the castle side of every trip outside. */
export const GATE_SPOT: Spot = Object.freeze({
  id: 'gate',
  x: 5,
  z: BOUNDS.z1 - 0.5,
  facing: 0,
  space: 'gate',
  anchor: Object.freeze({ x: 5, z: BOUNDS.z1 - 0.5 }),
  entry: [],
  room: 'taverne',
}) as Spot;

/** Through the gate, in its axis, between the corridor end and the drawbridge. */
const GATE_DOOR: Point = Object.freeze({ x: (GATE.lo + GATE.hi) / 2, z: BOUNDS.z1 + 0.2 });

/** Where a new main agent appears, on the path. Its id marks a start from the forest. */
export const ENTRY_SPOT: Spot = Object.freeze({
  id: 'forest',
  x: PATH[ENTRY_INDEX].x,
  z: PATH[ENTRY_INDEX].z,
  facing: Math.PI,
  space: 'forest',
  anchor: GATE_SPOT.anchor,
  entry: [],
  room: 'taverne',
}) as Spot;

/** PATH points from index `from` to index `to`, both included, in walking order. */
function along(from: number, to: number): Point[] {
  const out: Point[] = [];
  const step = from <= to ? 1 : -1;
  for (let i = from; i !== to + step; i += step) out.push({ ...PATH[i] });
  return out;
}

function dedupe(points: Point[]): Point[] {
  return points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z) > 1e-3);
}

/**
 * Waypoints from `start` to `spot`. From the forest: along the path, over the drawbridge,
 * through the gate, then the corridors. The corridor end is kept in the route, so a
 * `reroute` while still outside keeps walking in through the gate.
 */
export function routeFrom(start: Spot, spot: Spot): Point[] {
  if (start.id !== ENTRY_SPOT.id) return routeBetween(start, spot);
  return dedupe([...along(ENTRY_INDEX - 1, 0), GATE_DOOR, ...routeBetween(GATE_SPOT, spot)]);
}

/** Index of PATH where the doomed agent of waiting slot `slot` stops. */
export function killIndex(slot: number): number {
  return Math.min(KILL_INDEX + slot * SLOT_STEP, PATH.length - 1);
}

/** Point where the doomed agent of waiting slot `slot` stops. */
export function killPoint(slot: number): Point {
  return { ...PATH[killIndex(slot)] };
}

/** Index of the PATH point nearest to `p`. */
export function nearestPathIndex(p: Point): number {
  let best = 0;
  let bestD = Infinity;
  PATH.forEach((q, i) => {
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/**
 * True when `p` is past the corridor end, in the gate or beyond (drawbridge, forest): from
 * there the way to the path is a straight line out. Only the south side has a way out.
 */
export function isOutside(p: Point): boolean {
  return p.z > BOUNDS.z1;
}

/**
 * Waypoints of a doomed agent at `pos`, from wherever it is, to its kill point. Inside the
 * castle it finishes its current corridor leg (never through a wall), takes the corridors to
 * the gate and goes out; already outside, it turns round on the path.
 */
export function exitRoute(pos: Point, remaining: Point[], last: Spot, slot: number): Point[] {
  const target = killIndex(slot);
  if (isOutside(pos)) return dedupe(along(nearestPathIndex(pos), target));
  return dedupe([...reroute(remaining, last, GATE_SPOT), GATE_DOOR, ...along(0, target)]);
}
