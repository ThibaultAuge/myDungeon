import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OUTER,
  TOWERS,
  TOWER_R,
  WALL_INSET,
  WALL_T,
  dungeonWalls,
  edgeRuns,
  wallLayout,
  wallRuns,
  type Box,
} from '../src/scene/dungeon.ts';
import { BRIDGE } from '../src/scene/forest.ts';
import { BOUNDS, GATE, ROOMS, doorOf, type Point } from '../src/scene/layout.ts';
import { PAN_MARGIN, PATH } from '../src/scene/outside.ts';
import {
  EYE_HEIGHT,
  FPS_START,
  MAX_DT,
  MOVE_KEYS,
  PITCH_MAX,
  PLAYER_R,
  RUN_FACTOR,
  TURN_SPEED,
  WALK_SPEED,
  clampToWorld,
  fpsObstacles,
  fpsState,
  isFps,
  isShortcut,
  isTypingTarget,
  moveVector,
  moveWithCollision,
  onFpsChange,
  setFpsState,
  turnInput,
  yawToward,
  type FpsState,
  type Obstacles,
} from '../src/scene/fps.ts';

const TOL = 1e-6;
const GATE_MID_X = (GATE.lo + GATE.hi) / 2;
const WALLED = ROOMS.filter((r) => !r.insideOf);

/** Forward direction on the ground for a camera yaw (yaw 0 looks north, -z). */
function forward(yaw: number): Point {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** Distance from a point to an axis-aligned box, 0 inside it. */
function boxDistance(p: Point, b: Box): number {
  const dx = Math.max(b.x0 - p.x, 0, p.x - b.x1);
  const dz = Math.max(b.z0 - p.z, 0, p.z - b.z1);
  return Math.hypot(dx, dz);
}

/** Describes the first obstacle a body of radius r at p overlaps, or undefined. */
function overlap(p: Point, obs: Obstacles, r = PLAYER_R): string | undefined {
  for (const b of obs.boxes) if (boxDistance(p, b) < r - TOL) return `box ${JSON.stringify(b)} at ${JSON.stringify(p)}`;
  for (const c of obs.circles) if (Math.hypot(p.x - c.x, p.z - c.z) < c.r + r - TOL) return `circle ${JSON.stringify(c)} at ${JSON.stringify(p)}`;
  return undefined;
}

/**
 * Walks from `from` by (dx, dz) in calls of at most `step` metres, as frames would. Returns
 * every position reached, the start excluded.
 */
function walk(from: Point, dx: number, dz: number, step: number, obs = fpsObstacles()): Point[] {
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(len / step));
  const out: Point[] = [];
  let p = from;
  for (let i = 0; i < n; i++) {
    p = moveWithCollision(p, dx / n, dz / n, obs);
    out.push(p);
  }
  return out;
}

afterEach(() => {
  setFpsState('off');
});

// ---------------------------------------------------------------- constants

describe('constants', () => {
  /**
   * Verifies that the tuning constants are positive and the eyes stay under the 2.2 m gate lintel
   */
  it('are sane', () => {
    expect(EYE_HEIGHT).toBeGreaterThan(0);
    expect(EYE_HEIGHT).toBeLessThan(2.2);
    expect(PLAYER_R).toBeGreaterThan(0);
    expect(WALK_SPEED).toBeGreaterThan(0);
    expect(RUN_FACTOR).toBeGreaterThan(1);
    expect(PITCH_MAX).toBeGreaterThan(0);
    expect(PITCH_MAX).toBeLessThan(Math.PI / 2);
    expect(MAX_DT).toBeGreaterThan(0);
  });

  /**
   * Verifies that the keyboard turn speed is 2 rad/s
   */
  it('turns at 2 rad/s with the turn keys', () => {
    expect(TURN_SPEED).toBe(2);
  });
});

// ---------------------------------------------------------------- store

describe('FPS state store', () => {
  /**
   * Verifies that the view starts off
   */
  it('starts in the off state', () => {
    expect(fpsState()).toBe('off');
    expect(isFps()).toBe(false);
  });

  /**
   * Verifies that isFps is false only in the off state
   */
  it.each([
    ['off', false],
    ['requesting', true],
    ['locked', true],
    ['fallback', true],
  ] as [FpsState, boolean][])('isFps in state %s is %s', (s, expected) => {
    setFpsState(s);
    expect(fpsState()).toBe(s);
    expect(isFps()).toBe(expected);
  });

  /**
   * Verifies that the full lifecycle off → requesting → locked → fallback → off is followed
   */
  it('follows every transition', () => {
    const seen: FpsState[] = [];
    const unsub = onFpsChange(() => seen.push(fpsState()));
    for (const s of ['requesting', 'locked', 'fallback', 'requesting', 'off'] as FpsState[]) setFpsState(s);
    unsub();
    expect(seen).toEqual(['requesting', 'locked', 'fallback', 'requesting', 'off']);
  });

  /**
   * Verifies that listeners run only when the state actually changes
   */
  it('notifies only on change', () => {
    const listener = vi.fn();
    const unsub = onFpsChange(listener);
    setFpsState('off');
    expect(listener).toHaveBeenCalledTimes(0);
    setFpsState('locked');
    setFpsState('locked');
    expect(listener).toHaveBeenCalledTimes(1);
    setFpsState('off');
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
  });

  /**
   * Verifies that a listener sees the new state when it is called
   */
  it('updates the state before notifying', () => {
    let during: FpsState | undefined;
    const unsub = onFpsChange(() => {
      during = fpsState();
    });
    setFpsState('fallback');
    unsub();
    expect(during).toBe('fallback');
  });

  /**
   * Verifies that every subscribed listener is notified
   */
  it('notifies several listeners', () => {
    const a = vi.fn();
    const b = vi.fn();
    const ua = onFpsChange(a);
    const ub = onFpsChange(b);
    setFpsState('requesting');
    ua();
    ub();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  /**
   * Verifies that an unsubscribed listener is no longer notified while others still are
   */
  it('stops notifying after unsubscribe', () => {
    const gone = vi.fn();
    const kept = vi.fn();
    const unsubGone = onFpsChange(gone);
    const unsubKept = onFpsChange(kept);
    unsubGone();
    setFpsState('locked');
    expect(gone).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
    unsubKept();
    setFpsState('off');
    expect(kept).toHaveBeenCalledTimes(1);
  });

  /**
   * Verifies that calling unsubscribe twice is harmless
   */
  it('tolerates a double unsubscribe', () => {
    const l = vi.fn();
    const unsub = onFpsChange(l);
    unsub();
    expect(() => unsub()).not.toThrow();
    setFpsState('locked');
    expect(l).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- yawToward and FPS_START

describe('yawToward', () => {
  /**
   * Verifies that yaw 0 looks north and a quarter turn looks west, as a three.js camera
   */
  it.each([
    ['north', { x: 0, z: -5 }, 0],
    ['west', { x: -5, z: 0 }, Math.PI / 2],
    ['east', { x: 5, z: 0 }, -Math.PI / 2],
  ])('looks %s', (_label, to, yaw) => {
    expect(yawToward({ x: 0, z: 0 }, to)).toBeCloseTo(yaw, 12);
  });

  /**
   * Verifies that the forward vector of the returned yaw points at the target
   */
  it.each([
    [{ x: 1, z: 2 }, { x: -3, z: 7 }],
    [{ x: 0, z: 0 }, { x: 4, z: -4 }],
    [{ x: -10, z: 3 }, { x: -10.5, z: -20 }],
  ])('points from %o toward %o', (from, to) => {
    const f = forward(yawToward(from, to));
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    expect(f.x).toBeCloseTo((to.x - from.x) / d, 12);
    expect(f.z).toBeCloseTo((to.z - from.z) / d, 12);
  });
});

describe('FPS_START', () => {
  /**
   * Verifies that the visitor appears outside the castle, past the drawbridge
   */
  it('lies outside the castle, past the drawbridge', () => {
    expect(FPS_START.z).toBeGreaterThan(OUTER.z1);
    expect(FPS_START.z).toBeGreaterThan(BRIDGE.z1);
  });

  /**
   * Verifies that the visitor appears on a point of the forest path, inside the world clamp
   */
  it('is a path point within the walkable world', () => {
    expect(PATH.some((p) => p.x === FPS_START.x && p.z === FPS_START.z)).toBe(true);
    const c = clampToWorld(FPS_START);
    expect(c.x).toBe(FPS_START.x);
    expect(c.z).toBe(FPS_START.z);
  });

  /**
   * Verifies that the starting body overlaps no wall, pillar or tower
   */
  it('is not inside any obstacle', () => {
    expect(overlap(FPS_START, fpsObstacles())).toBeUndefined();
  });

  /**
   * Verifies that the visitor faces the castle gate, north-ish, within a few degrees
   */
  it('looks toward the gate', () => {
    const f = forward(FPS_START.yaw);
    expect(f.z).toBeLessThan(0);
    const tx = GATE_MID_X - FPS_START.x;
    const tz = BOUNDS.z1 - FPS_START.z;
    const cos = Math.min(1, Math.max(-1, (f.x * tx + f.z * tz) / Math.hypot(tx, tz)));
    const angle = Math.acos(cos);
    expect(angle).toBeLessThan((3 * Math.PI) / 180);
  });

  /**
   * Verifies that the shared start pose cannot be mutated
   */
  it('is frozen', () => {
    expect(Object.isFrozen(FPS_START)).toBe(true);
  });
});

// ---------------------------------------------------------------- moveVector

describe('moveVector', () => {
  const keys = (...codes: string[]) => new Set(codes);

  /**
   * Verifies that each single movement key at yaw 0 moves along the expected axis
   */
  it.each([
    ['KeyW', 0, -1],
    ['KeyS', 0, 1],
    ['KeyD', 1, 0],
    ['KeyA', -1, 0],
  ])('maps %s at yaw 0 to (%i, %i)', (code, x, z) => {
    const v = moveVector(keys(code), 0);
    expect(v.x).toBeCloseTo(x, 12);
    expect(v.z).toBeCloseTo(z, 12);
  });

  /**
   * Verifies that arrow keys move exactly as their letter counterparts
   */
  it.each([
    ['ArrowUp', 'KeyW'],
    ['ArrowDown', 'KeyS'],
    ['ArrowLeft', 'KeyA'],
    ['ArrowRight', 'KeyD'],
  ])('%s equals %s', (arrow, letter) => {
    for (const yaw of [0, 0.7, -2.1]) {
      const a = moveVector(keys(arrow), yaw);
      const l = moveVector(keys(letter), yaw);
      expect(a.x).toBeCloseTo(l.x, 12);
      expect(a.z).toBeCloseTo(l.z, 12);
    }
  });

  /**
   * Verifies that diagonals are normalised to unit length (no faster diagonal walk)
   */
  it.each([
    ['KeyW', 'KeyD'],
    ['KeyW', 'KeyA'],
    ['KeyS', 'KeyD'],
    ['ArrowDown', 'ArrowLeft'],
  ])('gives a unit vector for %s + %s', (a, b) => {
    for (const yaw of [0, 1.1, -0.4]) {
      const v = moveVector(keys(a, b), yaw);
      expect(Math.hypot(v.x, v.z)).toBeCloseTo(1, 12);
    }
    const v = moveVector(keys('KeyW', 'KeyD'), 0);
    expect(v.x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(v.z).toBeCloseTo(-Math.SQRT1_2, 12);
  });

  /**
   * Verifies that opposite keys cancel out to a zero vector
   */
  it.each([
    [['KeyW', 'KeyS']],
    [['KeyA', 'KeyD']],
    [['KeyW', 'ArrowDown']],
    [['KeyW', 'KeyS', 'KeyA', 'KeyD']],
  ])('cancels %o to zero', (codes) => {
    const v = moveVector(keys(...codes), 0.9);
    expect(v.x).toBe(0);
    expect(v.z).toBe(0);
  });

  /**
   * Verifies that no key, or only unrelated keys, yields a zero vector (never NaN)
   */
  it.each([[[]], [['KeyF', 'ShiftLeft', 'KeyQ']]])('is zero for %o', (codes) => {
    const v = moveVector(keys(...codes), 1.3);
    expect(v).toEqual({ x: 0, z: 0 });
  });

  /**
   * Verifies that the turn keys alone never move the visitor
   */
  it.each([[['KeyQ']], [['KeyE']], [['KeyQ', 'KeyE']]])('is zero for the turn keys %o', (codes) => {
    expect(moveVector(keys(...codes), 0.4)).toEqual({ x: 0, z: 0 });
  });

  /**
   * Verifies that holding a turn key does not change the walking direction
   */
  it.each([
    ['KeyW', 'KeyQ'],
    ['KeyD', 'KeyE'],
    ['KeyS', 'KeyQ'],
  ])('ignores %s + %s turn key in the vector', (move, turn) => {
    for (const yaw of [0, 1.2, -2.6]) {
      expect(moveVector(keys(move, turn), yaw)).toEqual(moveVector(keys(move), yaw));
    }
  });

  /**
   * Verifies that a letter and its arrow held together count once, giving a unit vector
   */
  it('counts a key and its arrow twin once', () => {
    const v = moveVector(keys('KeyW', 'ArrowUp'), 0);
    expect(v.x).toBeCloseTo(0, 12);
    expect(v.z).toBeCloseTo(-1, 12);
  });

  /**
   * Verifies that turning the camera by a quarter turn rotates the movement by a quarter turn
   */
  it('rotates with the yaw', () => {
    const combos = [['KeyW'], ['KeyS'], ['KeyA'], ['KeyD'], ['KeyW', 'KeyD'], ['KeyS', 'KeyA']];
    for (const codes of combos) {
      for (const yaw of [0, 0.3, 2, -1.7]) {
        const v = moveVector(keys(...codes), yaw);
        const w = moveVector(keys(...codes), yaw + Math.PI / 2);
        // Turning left by π/2 maps (x, z) to (z, -x).
        expect(w.x).toBeCloseTo(v.z, 12);
        expect(w.z).toBeCloseTo(-v.x, 12);
      }
    }
    const west = moveVector(keys('KeyW'), Math.PI / 2);
    expect(west.x).toBeCloseTo(-1, 12);
    expect(west.z).toBeCloseTo(0, 12);
  });

  /**
   * Verifies that forward always matches the camera's forward vector
   */
  it('moves forward along the camera direction', () => {
    for (const yaw of [0, 0.5, 3, -2.5]) {
      const v = moveVector(keys('KeyW'), yaw);
      const f = forward(yaw);
      expect(v.x).toBeCloseTo(f.x, 12);
      expect(v.z).toBeCloseTo(f.z, 12);
    }
  });
});

describe('MOVE_KEYS', () => {
  /**
   * Verifies that exactly the eight movement keys and two turn keys are listed, not Shift+F's key
   */
  it('lists the letters, arrows and turn keys', () => {
    expect([...MOVE_KEYS].sort()).toEqual(
      ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'KeyA', 'KeyD', 'KeyE', 'KeyQ', 'KeyS', 'KeyW'].sort(),
    );
    expect(MOVE_KEYS.has('KeyF')).toBe(false);
    expect(MOVE_KEYS.has('ShiftLeft')).toBe(false);
  });

  /**
   * Verifies that every listed key either moves the visitor by a unit step or turns them
   */
  it('contains only keys that move or turn', () => {
    for (const code of MOVE_KEYS) {
      const pressed = new Set([code]);
      const v = moveVector(pressed, 0);
      const moves = Math.abs(Math.hypot(v.x, v.z) - 1) < 1e-12;
      const turns = turnInput(pressed) !== 0;
      // Exactly one of the two: no key both walks and turns.
      expect(moves !== turns, code).toBe(true);
    }
  });
});

describe('turnInput', () => {
  const keys = (...codes: string[]) => new Set(codes);

  /**
   * Verifies that KeyQ turns left and KeyE turns right
   */
  it.each([
    ['KeyQ', -1],
    ['KeyE', 1],
  ])('maps %s to %i', (code, expected) => {
    expect(turnInput(keys(code))).toBe(expected);
  });

  /**
   * Verifies that no key, or both turn keys together, gives no turn
   */
  it.each([[[]], [['KeyQ', 'KeyE']]])('is 0 for %o', (codes) => {
    expect(turnInput(keys(...codes))).toBe(0);
  });

  /**
   * Verifies that movement, arrow and unrelated keys never turn the visitor
   */
  it('ignores every other key', () => {
    const others = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyF', 'ShiftLeft', 'KeyZ'];
    expect(turnInput(keys(...others))).toBe(0);
    // Key values (not physical codes) are not turn keys either.
    expect(turnInput(keys('q', 'e', 'Q', 'E'))).toBe(0);
  });

  /**
   * Verifies that other keys held with a turn key do not change its direction
   */
  it('keeps the direction when other keys are held', () => {
    expect(turnInput(keys('KeyQ', 'KeyW', 'ArrowRight', 'KeyD'))).toBe(-1);
    expect(turnInput(keys('KeyE', 'KeyA', 'ArrowLeft', 'ShiftLeft'))).toBe(1);
  });
});

// ---------------------------------------------------------------- shortcut

describe('isShortcut', () => {
  const base = { code: 'KeyF', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false, repeat: false };

  /**
   * Verifies that Shift+F alone toggles the view
   */
  it('accepts Shift+F', () => {
    expect(isShortcut(base)).toBe(true);
  });

  /**
   * Verifies that a missing Shift, an extra modifier, auto-repeat or another key is rejected
   */
  it.each([
    ['without shift', { shiftKey: false }],
    ['with ctrl', { ctrlKey: true }],
    ['with alt', { altKey: true }],
    ['with meta', { metaKey: true }],
    ['auto-repeated', { repeat: true }],
    ['another key', { code: 'KeyG' }],
    ['the letter as a key value', { code: 'f' }],
  ])('rejects Shift+F %s', (_label, change) => {
    expect(isShortcut({ ...base, ...change })).toBe(false);
  });
});

describe('isTypingTarget', () => {
  /**
   * Verifies that text fields and editable elements count as typing targets
   */
  it.each([
    ['input', { tagName: 'INPUT' }],
    ['textarea', { tagName: 'TEXTAREA' }],
    ['select', { tagName: 'SELECT' }],
    ['lower-case input', { tagName: 'input' }],
    ['contentEditable div', { tagName: 'DIV', isContentEditable: true }],
  ])('is true for %s', (_label, target) => {
    expect(isTypingTarget(target as unknown as EventTarget)).toBe(true);
  });

  /**
   * Verifies that null, plain objects and non-editable elements are not typing targets
   */
  it.each([
    ['null', null],
    ['a plain object', {}],
    ['a div', { tagName: 'DIV' }],
    ['a non-editable div', { tagName: 'DIV', isContentEditable: false }],
    ['a canvas', { tagName: 'CANVAS' }],
    ['a button', { tagName: 'BUTTON' }],
    ['a window-like object', { addEventListener: () => {} }],
    ['a non-string tagName', { tagName: 42 }],
  ])('is false for %s', (_label, target) => {
    expect(isTypingTarget(target as unknown as EventTarget | null)).toBe(false);
  });
});

// ---------------------------------------------------------------- blockers

describe('wallLayout().blockers', () => {
  /**
   * Verifies that there is one blocker per wall run (edge and room walls) and one per pillar
   */
  it('has one box per wall run and per pillar', () => {
    const layout = wallLayout();
    const runs = edgeRuns().length + WALLED.reduce((s, r) => s + wallRuns(r).length, 0);
    const pillars = layout.tall.get('pillar')?.length ?? 0;
    expect(pillars).toBeGreaterThan(0);
    expect(layout.low.get('column')?.length).toBe(pillars);
    expect(layout.blockers.length).toBe(runs + pillars);
  });

  /**
   * Verifies that every blocker is a non-degenerate rectangle
   */
  it('has positive-size boxes only', () => {
    for (const b of wallLayout().blockers) {
      expect(b.x0, JSON.stringify(b)).toBeLessThan(b.x1);
      expect(b.z0, JSON.stringify(b)).toBeLessThan(b.z1);
    }
  });

  /**
   * Verifies that every blocker stays within the castle's outer rectangle
   */
  it('stays within the castle', () => {
    for (const b of wallLayout().blockers) {
      expect(b.x0, JSON.stringify(b)).toBeGreaterThanOrEqual(OUTER.x0 - TOL);
      expect(b.x1, JSON.stringify(b)).toBeLessThanOrEqual(OUTER.x1 + TOL);
      expect(b.z0, JSON.stringify(b)).toBeGreaterThanOrEqual(OUTER.z0 - TOL);
      expect(b.z1, JSON.stringify(b)).toBeLessThanOrEqual(OUTER.z1 + TOL);
    }
  });

  /**
   * Verifies that the layout is deterministic: two builds give the same blockers
   */
  it('is deterministic', () => {
    expect(wallLayout().blockers).toEqual(wallLayout().blockers);
  });
});

describe('dungeonWalls', () => {
  /**
   * Verifies that the shared wall layout is built once and the same object is returned
   */
  it('returns the same object every time', () => {
    const a = dungeonWalls();
    expect(dungeonWalls()).toBe(a);
    expect(dungeonWalls().blockers).toBe(a.blockers);
  });

  /**
   * Verifies that the shared layout's blockers equal a fresh default wallLayout()'s
   */
  it('has the same blockers as a fresh default layout', () => {
    expect(dungeonWalls().blockers).toEqual(wallLayout().blockers);
    expect(dungeonWalls().blockers.length).toBeGreaterThan(0);
  });
});

describe('fpsObstacles', () => {
  /**
   * Verifies that the collision boxes are the very blockers of the shared rendered walls
   */
  it('shares its boxes with dungeonWalls()', () => {
    expect(fpsObstacles().boxes).toBe(dungeonWalls().blockers);
  });

  /**
   * Verifies that the obstacles are the wall blockers plus one circle per corner tower
   */
  it('uses the wall blockers and the towers', () => {
    const obs = fpsObstacles();
    expect(obs.boxes).toEqual(wallLayout().blockers);
    expect(obs.circles).toHaveLength(TOWERS.length);
    for (let i = 0; i < TOWERS.length; i++) {
      expect(obs.circles[i]).toEqual({ x: TOWERS[i].x, z: TOWERS[i].z, r: TOWER_R });
    }
  });

  /**
   * Verifies that the obstacles are built once and shared
   */
  it('returns the same object every time', () => {
    expect(fpsObstacles()).toBe(fpsObstacles());
  });
});

// ---------------------------------------------------------------- moveWithCollision

describe('moveWithCollision', () => {
  /** Middle of the x = 5 corridor beside the Autel, whose east wall is on the west. */
  const CORRIDOR: Point = { x: 5, z: 0 };
  /** East face of the Autel's east wall (room edge x = 4). */
  const AUTEL_WALL_FACE = 4 - WALL_INSET + WALL_T / 2;
  /** West face of that same wall. */
  const AUTEL_WALL_BACK = 4 - WALL_INSET - WALL_T / 2;

  /**
   * Verifies that a move with nothing in the way is applied exactly
   */
  it('moves freely in an open corridor', () => {
    const p = moveWithCollision(CORRIDOR, 0, -1, fpsObstacles());
    expect(p.x).toBeCloseTo(5, 9);
    expect(p.z).toBeCloseTo(-1, 9);
  });

  /**
   * Verifies that a zero move leaves the body where it is and never mutates the input
   */
  it('returns a new point and leaves the input untouched', () => {
    const from = Object.freeze({ x: 5, z: 0 });
    const p = moveWithCollision(from, 0, 0, fpsObstacles());
    expect(p).toEqual({ x: 5, z: 0 });
    expect(p).not.toBe(from);
    expect(() => moveWithCollision(FPS_START, 1, 1, fpsObstacles())).not.toThrow();
  });

  /**
   * Verifies that walking into a wall in steps of any size never overlaps or crosses it
   */
  it.each([0.02, 0.15, 0.3, 1, 3])('stops at the wall with steps of %d m', (step) => {
    const obs = fpsObstacles();
    const path = walk(CORRIDOR, -4, 0, step, obs);
    for (const p of path) {
      expect(overlap(p, obs)).toBeUndefined();
      expect(p.x).toBeGreaterThan(AUTEL_WALL_FACE);
    }
    const end = path[path.length - 1];
    expect(end.x).toBeCloseTo(AUTEL_WALL_FACE + PLAYER_R, 9);
    expect(end.z).toBeCloseTo(0, 9);
  });

  /**
   * Verifies that one huge 50 m step still stops at the first wall (no tunnelling)
   */
  it('does not tunnel through a wall on a 50 m step', () => {
    const obs = fpsObstacles();
    const end = moveWithCollision(CORRIDOR, -50, 0, obs);
    expect(overlap(end, obs)).toBeUndefined();
    expect(end.x).toBeCloseTo(AUTEL_WALL_FACE + PLAYER_R, 9);
  });

  /**
   * Verifies that a body inside a room cannot get out through its wall, even on a huge step
   */
  it('keeps a body inside a room on a 50 m step', () => {
    const obs = fpsObstacles();
    const end = moveWithCollision({ x: 2, z: 0 }, 50, 0, obs);
    expect(overlap(end, obs)).toBeUndefined();
    expect(end.x).toBeCloseTo(AUTEL_WALL_BACK - PLAYER_R, 9);
  });

  /**
   * Verifies that the outer wall keeps the visitor in the castle away from the gate
   */
  it.each([0.1, 1, 50])('does not leave through the south outer wall (step %d m)', (step) => {
    const obs = fpsObstacles();
    // The x = 15 corridor reaches the south outer wall between the Conciergerie and the Taverne.
    const path = walk({ x: 15, z: 8 }, 0, 50, step, obs);
    for (const p of path) {
      expect(overlap(p, obs)).toBeUndefined();
      expect(p.z).toBeLessThan(OUTER.z1);
    }
  });

  /**
   * Verifies that a body pushed diagonally against a wall slides along it on the free axis
   */
  it('slides along a wall when pushed diagonally', () => {
    const obs = fpsObstacles();
    const end = moveWithCollision({ x: 4.4, z: 0 }, -1, -1, obs);
    expect(overlap(end, obs)).toBeUndefined();
    expect(end.x).toBeCloseTo(AUTEL_WALL_FACE + PLAYER_R, 9);
    expect(end.z).toBeCloseTo(-1, 9);
  });

  /**
   * Verifies that walking north from the start, in the gate's axis, enters the castle
   */
  it('walks from the forest through the gate into the castle', () => {
    const obs = fpsObstacles();
    const from = { x: GATE_MID_X, z: FPS_START.z };
    const target = 5;
    const path = walk(from, 0, target - from.z, 0.1, obs);
    for (const p of path) expect(overlap(p, obs)).toBeUndefined();
    const end = path[path.length - 1];
    expect(end.z).toBeLessThan(BOUNDS.z1);
    expect(end.z).toBeCloseTo(target, 6);
    expect(end.x).toBeCloseTo(GATE_MID_X, 9);
  });

  /**
   * Verifies that every walled room can be entered straight through its door
   */
  it.each(WALLED.map((r) => [r.id, r] as const))('enters %s through its door', (_id, room) => {
    const obs = fpsObstacles();
    const { outside, inside } = doorOf(room);
    expect(overlap(outside, obs), 'outside point').toBeUndefined();
    const path = walk(outside, inside.x - outside.x, inside.z - outside.z, 0.05, obs);
    for (const p of path) expect(overlap(p, obs)).toBeUndefined();
    const end = path[path.length - 1];
    expect(end.x).toBeCloseTo(inside.x, 6);
    expect(end.z).toBeCloseTo(inside.z, 6);
    // The end really is in the room.
    expect(Math.abs(end.x - room.cx)).toBeLessThan(room.w / 2);
    expect(Math.abs(end.z - room.cz)).toBeLessThan(room.d / 2);
  });

  /**
   * Verifies that every corner tower blocks as a circle of radius TOWER_R + PLAYER_R
   */
  it.each(TOWERS.map((t, i) => [i, t] as const))('blocks at tower %i as a circle', (_i, t) => {
    const obs = fpsObstacles();
    // Come from outside the castle, straight along x through the tower centre (the tower
    // stands out of the castle corner, so nothing else is on that line before it).
    const ox = Math.sign(t.x);
    const from = { x: t.x + 3 * ox, z: t.z };
    const min = TOWER_R + PLAYER_R;
    for (const step of [0.05, 0.5, 50]) {
      const path = walk(from, -6 * ox, 0, step, obs);
      for (const p of path) expect(Math.hypot(p.x - t.x, p.z - t.z)).toBeGreaterThanOrEqual(min - 1e-9);
      const end = path[path.length - 1];
      expect(Math.hypot(end.x - t.x, end.z - t.z)).toBeCloseTo(min, 9);
    }
  });

  /**
   * Verifies that a body pushed into the nook where a tower meets the outer wall never
   * overlaps the tower, the wall or any other obstacle
   */
  it.each(TOWERS.map((t, i) => [i, t] as const))('stays clear in the nook of tower %i and the outer wall', (_i, t) => {
    const obs = fpsObstacles();
    const sx = Math.sign(t.x);
    const sz = Math.sign(t.z);
    // Outside the castle, beyond the north or south outer wall, 3 m in from the tower; walk
    // diagonally toward the tower and the wall at once, into the concave corner they form.
    const from = { x: t.x - 3 * sx, z: t.z + 2 * sz };
    expect(overlap(from, obs), 'start').toBeUndefined();
    for (const step of [0.05, 0.4, 50]) {
      const path = walk(from, 3 * sx, -4 * sz, step, obs);
      for (const p of path) expect(overlap(p, obs)).toBeUndefined();
      const end = path[path.length - 1];
      // Still outside the castle: the corner was not crossed.
      const outerFace = sz > 0 ? OUTER.z1 : OUTER.z0;
      expect(sz * (end.z - outerFace)).toBeGreaterThanOrEqual(PLAYER_R - 1e-6);
      expect(Math.hypot(end.x - t.x, end.z - t.z)).toBeGreaterThanOrEqual(TOWER_R + PLAYER_R - 1e-6);
    }
  });

  /**
   * Verifies that a zero, negative or NaN body radius is rejected with a RangeError
   */
  it.each([0, -0.3, Number.NaN])('throws a RangeError for radius %d', (r) => {
    expect(() => moveWithCollision({ x: 5, z: 0 }, 1, 0, fpsObstacles(), r)).toThrow(RangeError);
    expect(() => moveWithCollision({ x: 5, z: 0 }, 0, 0, { boxes: [], circles: [] }, r)).toThrow(RangeError);
  });

  /**
   * Verifies that the default and a tiny positive radius are accepted
   */
  it('accepts the default radius and a tiny positive one', () => {
    expect(() => moveWithCollision({ x: 5, z: 0 }, 0, 0, fpsObstacles())).not.toThrow();
    expect(() => moveWithCollision({ x: 5, z: 0 }, 0.01, 0, { boxes: [], circles: [] }, 1e-3)).not.toThrow();
  });

  /**
   * Verifies that a body passing the tower off-centre slides around it rather than stopping
   */
  it('slides around a tower when brushing it', () => {
    const obs = fpsObstacles();
    const t = TOWERS.find((q) => q.x > 0 && q.z > 0)!;
    // East of the south-east tower, walking north past it, offset by half the clearance.
    const from = { x: t.x + 0.5, z: t.z + 3 };
    const path = walk(from, 0, -6, 0.05, obs);
    for (const p of path) expect(Math.hypot(p.x - t.x, p.z - t.z)).toBeGreaterThanOrEqual(TOWER_R + PLAYER_R - 1e-9);
    expect(path[path.length - 1].z).toBeLessThan(t.z - 1);
  });

  /**
   * Verifies that a huge move into the forest is clamped to the world edge
   */
  it('clamps the result to the world', () => {
    const end = moveWithCollision(FPS_START, 0, 1000, fpsObstacles());
    expect(end.z).toBeCloseTo(BOUNDS.z1 + PAN_MARGIN, 9);
    const west = moveWithCollision(FPS_START, -1000, 0, { boxes: [], circles: [] });
    expect(west.x).toBeCloseTo(BOUNDS.x0 - PAN_MARGIN, 9);
  });

  /**
   * Verifies that a custom radius is honoured: a fatter body stops farther from the wall
   */
  it('honours a custom body radius', () => {
    const obs = fpsObstacles();
    const end = moveWithCollision(CORRIDOR, -3, 0, obs, 0.5);
    expect(end.x).toBeCloseTo(AUTEL_WALL_FACE + 0.5, 9);
  });

  /**
   * Verifies that a body whose centre starts inside a box is pushed out by the shortest way
   */
  it('pushes a body out of a box it starts in', () => {
    const box: Box = { x0: 0, x1: 4, z0: 0, z1: 1 };
    const end = moveWithCollision({ x: 2, z: 0.2 }, 0, 0, { boxes: [box], circles: [] }, 0.3);
    expect(end.x).toBeCloseTo(2, 9);
    expect(end.z).toBeCloseTo(-0.3, 9);
  });

  /**
   * Verifies that a body starting exactly on a tower centre is pushed out of it
   */
  it('pushes a body out of a circle it starts at the centre of', () => {
    const end = moveWithCollision({ x: 0, z: 0 }, 0, 0, { boxes: [], circles: [{ x: 0, z: 0, r: 1 }] }, 0.3);
    expect(Math.hypot(end.x, end.z)).toBeCloseTo(1.3, 9);
  });
});

// ---------------------------------------------------------------- clampToWorld

describe('clampToWorld', () => {
  /**
   * Verifies that a point inside the pan area is returned unchanged
   */
  it('keeps a point inside the world', () => {
    expect(clampToWorld({ x: 1, z: 2 })).toEqual({ x: 1, z: 2 });
    const edge = { x: BOUNDS.x1 + PAN_MARGIN, z: BOUNDS.z0 - PAN_MARGIN };
    expect(clampToWorld(edge)).toEqual(edge);
  });

  /**
   * Verifies that a point beyond each side is clamped to BOUNDS ± PAN_MARGIN
   */
  it.each([
    ['west', { x: -1000, z: 0 }, { x: BOUNDS.x0 - PAN_MARGIN, z: 0 }],
    ['east', { x: 1000, z: 0 }, { x: BOUNDS.x1 + PAN_MARGIN, z: 0 }],
    ['north', { x: 0, z: -1000 }, { x: 0, z: BOUNDS.z0 - PAN_MARGIN }],
    ['south', { x: 0, z: 1000 }, { x: 0, z: BOUNDS.z1 + PAN_MARGIN }],
    ['south-east corner', { x: 1000, z: 1000 }, { x: BOUNDS.x1 + PAN_MARGIN, z: BOUNDS.z1 + PAN_MARGIN }],
  ])('clamps a point far %s', (_label, p, expected) => {
    expect(clampToWorld(p)).toEqual(expected);
  });

  /**
   * Verifies that clamping returns a new point and leaves the input untouched
   */
  it('returns a copy', () => {
    const p = { x: 1000, z: 0 };
    const c = clampToWorld(p);
    expect(c).not.toBe(p);
    expect(p.x).toBe(1000);
  });
});
