// Walking motion of the figures, without three.js so it is testable in node.
// The speed eases in when a trip starts and eases out before the last waypoint,
// over the whole route rather than per segment: corners are taken at speed.
import type { Point } from './layout.ts';

/** Cruising speed, in world units per second: twice the original 4.5. */
export const CRUISE_SPEED = 2 * 4.5;
/** Constant acceleration at the start and deceleration at the end, in units per second². */
export const ACCELERATION = 18;
/** Floor of the braking curve, so the last waypoint is reached in finite time. */
export const MIN_SPEED = 0.3;

/** Distance from `from` to the end of `path`, through every waypoint. */
export function remainingDistance(from: Point, path: readonly Point[]): number {
  let total = 0;
  let prev = from;
  for (const p of path) {
    total += Math.hypot(p.x - prev.x, p.z - prev.z);
    prev = p;
  }
  return total;
}

/**
 * Speed for the next frame: accelerates from `speed` towards the cruising speed, capped by
 * the speed from which a constant deceleration still stops exactly at the end of the route.
 */
export function nextSpeed(speed: number, remaining: number, dt: number): number {
  if (remaining <= 0) return 0;
  const braking = Math.sqrt(2 * ACCELERATION * remaining);
  return Math.max(MIN_SPEED, Math.min(speed + ACCELERATION * dt, CRUISE_SPEED, braking));
}

/**
 * Moves `value` towards `target` by at most `step`, and stops on it. A value already on
 * its target stays put, whatever the step (a large step must not overshoot back and forth).
 */
export function approach(value: number, target: number, step: number): number {
  if (value < target) return Math.min(target, value + step);
  if (value > target) return Math.max(target, value - step);
  return value;
}

/**
 * Turns an angle `current` towards `target` by a `fraction` of the gap, along the shortest
 * arc, so a figure never spins a full turn. `fraction` 1 snaps to the target.
 */
export function turnToward(current: number, target: number, fraction: number): number {
  const diff = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + diff * Math.min(1, Math.max(0, fraction));
}

/**
 * Moves `pos` by `step` along `path`. Reached waypoints are removed from `path` and the
 * rest of the step carries on to the next one, so a corner never costs a frame.
 * Returns the heading towards the last waypoint aimed at (as `atan2(dx, dz)`), even for a
 * zero step, or null if there was no waypoint to aim at.
 */
export function advance(pos: Point, path: Point[], step: number): number | null {
  let heading: number | null = null;
  let left = step;
  while (path.length > 0) {
    const next = path[0];
    const dx = next.x - pos.x;
    const dz = next.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0) heading = Math.atan2(dx, dz);
    if (dist <= left) {
      pos.x = next.x;
      pos.z = next.z;
      left -= dist;
      path.shift();
    } else {
      pos.x += (dx / dist) * left;
      pos.z += (dz / dist) * left;
      break;
    }
  }
  return heading;
}
