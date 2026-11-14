// The backhand sweep of the 3D slapping hand, as a pure function of time. No three.js: the
// pose is given in the camera's frame around the slapped figure's head, so it is testable
// in node. SlapHand.tsx turns it into a world transform.

/** Length of the whole sweep, in seconds. */
export const SWING_DURATION = 0.32;
/** When the hand crosses the face, in seconds: the hit clip and the sound start then. */
export const SWING_IMPACT = 0.12;
/**
 * Radius of the arc around the pivot, in metres. Wide on purpose: seen from the usual camera
 * height a figure is a few dozen pixels tall and its name tag covers the head, so the sweep
 * must pass well clear of both to be seen.
 */
const RADIUS = 1.4;
/** The pivot sits this far behind the head (away from the camera): the hand passes in front of the face. */
const PIVOT_BEHIND = 0.5;
/** Angle of the arc before the impact, in radians; the sweep keeps the same angular speed after it. */
const WIND_UP = 1.1;
/** Share of the sweep spent growing in and shrinking out. */
const GROW = 0.15;
const SHRINK = 0.2;

/**
 * Where the hand is, in the camera's frame centred on the head: `right` along the screen's
 * horizontal, `up` the world vertical, `toward` horizontal towards the camera.
 */
export interface SwingPose {
  right: number;
  up: number;
  toward: number;
  /** Direction of motion (unit, in the right/toward plane): the back of the hand leads. */
  tangentRight: number;
  tangentToward: number;
  /** Wrist roll around the hand's own back-of-hand axis, in radians. */
  roll: number;
  /** Size factor: 0 to 1 while appearing, 1 to 0 while leaving. */
  scale: number;
}

/** The sweep angle at `time`: 0 at the impact, linear (constant angular speed). */
export function swingAngle(time: number): number {
  return WIND_UP * (time / SWING_IMPACT - 1);
}

/**
 * The hand's pose `time` seconds into the sweep, or null outside it. `dir` is +1 for a
 * sweep from the left of the screen to the right, -1 for the other way.
 */
export function swingPose(time: number, dir: 1 | -1): SwingPose | null {
  if (!(time >= 0 && time <= SWING_DURATION)) return null;
  const t = time / SWING_DURATION;
  const a = swingAngle(time);
  const sin = Math.sin(a);
  const cos = Math.cos(a);
  const scale = Math.min(1, t / GROW, (1 - t) / SHRINK);
  return {
    right: dir * RADIUS * sin,
    up: 0.2 * cos,
    toward: RADIUS * cos - PIVOT_BEHIND,
    // Derivative of the position along the angle, already of unit length.
    tangentRight: dir * cos,
    tangentToward: -sin,
    roll: 0.4 * Math.sin(Math.PI * t),
    scale: Math.max(0, scale),
  };
}
