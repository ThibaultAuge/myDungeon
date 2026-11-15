import { dungeonWalls, TOWER_R, TOWERS, type Box } from './dungeon.ts';
import { BRIDGE } from './forest.ts';
import { BOUNDS, GATE, type Point } from './layout.ts';
import { PAN_MARGIN, PATH } from './outside.ts';

// First-person view: a visitor walking around the dungeon (Shift+F, Escape to leave). Pure
// geometry and state, no three.js; FpsControls wires it to the camera and the DOM.

/** Height of the eyes above the ground. Under the gate lintel (2.2 m). */
export const EYE_HEIGHT = 1.5;
/** Radius of the visitor's body: how close the eyes get to a wall. */
export const PLAYER_R = 0.3;
/** Walking speed, in metres per second. */
export const WALK_SPEED = 3;
/** Speed multiplier while Shift is held. */
export const RUN_FACTOR = 2;
/** Looking up or down stops short of the vertical. */
export const PITCH_MAX = 1.4;
/** Longest frame step applied: a background tab must not teleport the visitor. */
export const MAX_DT = 0.1;
/** Radians turned per pixel of mouse movement. */
export const LOOK_SPEED = 0.0025;
/** Radians turned per second with the turn keys (no mouse needed). */
export const TURN_SPEED = 2;
/** Field of view while walking: the overhead camera's 42° feels like a telephoto lens at eye height. */
export const FPS_FOV = 70;

// ---------------------------------------------------------------- mode

/**
 * Lifecycle of the view: `off`, then `requesting` the pointer lock, then `locked` (the mouse
 * looks around) or `fallback` (the browser refused: a click on the scene asks again).
 */
export type FpsState = 'off' | 'requesting' | 'locked' | 'fallback';

let state: FpsState = 'off';
const listeners = new Set<() => void>();

/** Current state, for `useSyncExternalStore`. */
export function fpsState(): FpsState {
  return state;
}

/** True while the first-person view is on. Read every frame by the cutaway and the camera. */
export function isFps(): boolean {
  return state !== 'off';
}

export function setFpsState(next: FpsState): void {
  if (next === state) return;
  state = next;
  for (const l of listeners) l();
}

/** Subscribes to mode changes (for `useSyncExternalStore`); returns the unsubscribe. */
export function onFpsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---------------------------------------------------------------- start

/** Where the visitor looks from: yaw 0 looks north (-z), as a three.js camera does. */
export interface Pose extends Point {
  yaw: number;
}

/** Yaw that looks from `from` towards `to`. */
export function yawToward(from: Point, to: Point): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

/** How far past the drawbridge's end the visitor appears, on the path. */
const START_PAST_BRIDGE = 4;

/** On the forest path, a few metres past the drawbridge, facing the castle gate. */
export const FPS_START: Pose = (() => {
  const p = PATH.find((q) => q.z >= BRIDGE.z1 + START_PAST_BRIDGE) ?? PATH[0];
  const gate = { x: (GATE.lo + GATE.hi) / 2, z: BOUNDS.z1 };
  return Object.freeze({ x: p.x, z: p.z, yaw: yawToward(p, gate) });
})();

// ---------------------------------------------------------------- keys

/** Physical keys (`KeyboardEvent.code`): ZQSD on an AZERTY keyboard, WASD on QWERTY/QWERTZ. */
const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];

/** Turn keys: A/E on AZERTY, Q/E on QWERTY/QWERTZ. */
const TURN_LEFT = ['KeyQ'];
const TURN_RIGHT = ['KeyE'];

/** Keys that move or turn the visitor: their default action (scrolling a panel) is cancelled. */
export const MOVE_KEYS: ReadonlySet<string> = new Set([...FORWARD, ...BACK, ...LEFT, ...RIGHT, ...TURN_LEFT, ...TURN_RIGHT]);

/** -1 turns left, 1 right, 0 when neither or both turn keys are held. Multiply by TURN_SPEED·dt. */
export function turnInput(pressed: ReadonlySet<string>): -1 | 0 | 1 {
  const l = TURN_LEFT.some((c) => pressed.has(c));
  const r = TURN_RIGHT.some((c) => pressed.has(c));
  return l === r ? 0 : l ? -1 : 1;
}

/**
 * Unit direction on the ground for the keys held, or zero. `yaw` is the camera's: forward is
 * (-sin, -cos), right is (cos, -sin).
 */
export function moveVector(pressed: ReadonlySet<string>, yaw: number): { x: number; z: number } {
  const held = (codes: string[]) => (codes.some((c) => pressed.has(c)) ? 1 : 0);
  const f = held(FORWARD) - held(BACK);
  const r = held(RIGHT) - held(LEFT);
  if (f === 0 && r === 0) return { x: 0, z: 0 };
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const x = -s * f + c * r;
  const z = -c * f - s * r;
  const len = Math.hypot(x, z);
  return { x: x / len, z: z / len };
}

/** Shift+F, without another modifier and not auto-repeated. */
export function isShortcut(e: Pick<KeyboardEvent, 'code' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey' | 'repeat'>): boolean {
  return e.code === 'KeyF' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat;
}

/** True when keys typed there are text: neither the shortcut nor the walking keys take them. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName.toUpperCase());
}

// ---------------------------------------------------------------- collisions

/** A round obstacle (a corner tower). */
export interface Circle extends Point {
  r: number;
}

export interface Obstacles {
  boxes: readonly Box[];
  circles: readonly Circle[];
}

let obstacles: Obstacles | undefined;

/** Walls, pillars and corner towers: the only things the visitor bumps into. Built once. */
export function fpsObstacles(): Obstacles {
  obstacles ??= {
    boxes: dungeonWalls().blockers,
    circles: TOWERS.map((t) => ({ x: t.x, z: t.z, r: TOWER_R })),
  };
  return obstacles;
}

/** Pushes a body of radius r at p out of a box it overlaps. */
function pushOutOfBox(p: Point, b: Box, r: number): void {
  const cx = Math.min(Math.max(p.x, b.x0), b.x1);
  const cz = Math.min(Math.max(p.z, b.z0), b.z1);
  const dx = p.x - cx;
  const dz = p.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    p.x = cx + (dx / d) * r;
    p.z = cz + (dz / d) * r;
    return;
  }
  // Centre inside the box: out by the shortest way.
  const exits = [
    { d: p.x - b.x0, x: b.x0 - r, z: p.z },
    { d: b.x1 - p.x, x: b.x1 + r, z: p.z },
    { d: p.z - b.z0, x: p.x, z: b.z0 - r },
    { d: b.z1 - p.z, x: p.x, z: b.z1 + r },
  ];
  const best = exits.reduce((m, e) => (e.d < m.d ? e : m));
  p.x = best.x;
  p.z = best.z;
}

function pushOutOfCircle(p: Point, c: Circle, r: number): void {
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  const min = c.r + r;
  const d = Math.hypot(dx, dz);
  if (d >= min) return;
  if (d < 1e-9) {
    p.z = c.z + min;
    return;
  }
  p.x = c.x + (dx / d) * min;
  p.z = c.z + (dz / d) * min;
}

/** Passes over the obstacles: in a corner, getting out of one may push back into another. */
const RESOLVE_PASSES = 3;

function resolve(p: Point, obs: Obstacles, r: number): void {
  for (let pass = 0; pass < RESOLVE_PASSES; pass++) {
    for (const b of obs.boxes) {
      // Cheap reject before the exact test.
      if (p.x < b.x0 - r || p.x > b.x1 + r || p.z < b.z0 - r || p.z > b.z1 + r) continue;
      pushOutOfBox(p, b, r);
    }
    for (const c of obs.circles) pushOutOfCircle(p, c, r);
  }
}

/** Keeps the visitor within the camera's usual pan area: the forest has an edge. */
export function clampToWorld(p: Point): Point {
  return {
    x: Math.min(Math.max(p.x, BOUNDS.x0 - PAN_MARGIN), BOUNDS.x1 + PAN_MARGIN),
    z: Math.min(Math.max(p.z, BOUNDS.z0 - PAN_MARGIN), BOUNDS.z1 + PAN_MARGIN),
  };
}

/**
 * Moves a body of radius r from `from` by (dx, dz), sliding along walls: small steps (never
 * more than r/2, so no wall is crossed), x then z, each pushed out of every obstacle.
 */
export function moveWithCollision(from: Point, dx: number, dz: number, obs: Obstacles, r = PLAYER_R): Point {
  if (!(r > 0)) throw new RangeError(`moveWithCollision: radius must be positive, got ${r}`);
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (r / 2)));
  const p = { x: from.x, z: from.z };
  for (let i = 0; i < steps; i++) {
    p.x += dx / steps;
    resolve(p, obs, r);
    p.z += dz / steps;
    resolve(p, obs, r);
  }
  return clampToWorld(p);
}
