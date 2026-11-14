import { describe, expect, it } from 'vitest';
import type { SessionView } from '@agent-office/shared';
import {
  EVAPORATE_MS,
  EVAPORATE_RISE,
  Ghosts,
  WANDER_POINTS,
  evaporation,
  isGhost,
  nearestOnCorridor,
  nextWander,
  seededRandom,
  wanderStart,
} from '../src/scene/ghost.ts';
import { CORRIDORS, type Point } from '../src/scene/layout.ts';

function session(id: string, overrides: Partial<SessionView> = {}): SessionView {
  return {
    id,
    origin: 'cli',
    live: false,
    archived: false,
    everActive: false,
    main: { id: `${id}#main` },
    ...overrides,
  } as unknown as SessionView;
}

function onSomeCorridor(p: Point): boolean {
  return CORRIDORS.some(([a, b]) => {
    const cross = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
    return (
      Math.abs(cross) < 1e-6 &&
      p.x >= Math.min(a.x, b.x) - 1e-6 &&
      p.x <= Math.max(a.x, b.x) + 1e-6 &&
      p.z >= Math.min(a.z, b.z) - 1e-6 &&
      p.z <= Math.max(a.z, b.z) + 1e-6
    );
  });
}

describe('isGhost', () => {
  it('is a stopped, listed cli session that never did real work', () => {
    expect(isGhost(session('a'))).toBe(true);
  });

  it('is never a live, active, archived or desktop session', () => {
    expect(isGhost(session('a', { live: true }))).toBe(false);
    expect(isGhost(session('a', { everActive: true }))).toBe(false);
    expect(isGhost(session('a', { archived: true }))).toBe(false);
    expect(isGhost(session('a', { origin: 'desktop' }))).toBe(false);
  });
});

describe('seededRandom', () => {
  it('repeats the same sequence for the same seed, within [0, 1)', () => {
    const a = seededRandom('cli:x');
    const b = seededRandom('cli:x');
    const seq = Array.from({ length: 50 }, () => a());
    expect(Array.from({ length: 50 }, () => b())).toEqual(seq);
    for (const v of seq) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('differs between seeds', () => {
    const a = seededRandom('cli:x');
    const b = seededRandom('cli:y');
    expect(Array.from({ length: 5 }, () => a())).not.toEqual(Array.from({ length: 5 }, () => b()));
  });
});

describe('wander', () => {
  it('lists every corridor end once', () => {
    const keys = WANDER_POINTS.map((p) => `${p.x},${p.z}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [a, b] of CORRIDORS) {
      expect(keys).toContain(`${a.x},${a.z}`);
      expect(keys).toContain(`${b.x},${b.z}`);
    }
  });

  it('projects any point onto the nearest corridor', () => {
    // Inside a room west of the x = -5 corridor, closest to it.
    expect(nearestOnCorridor({ x: -6.5, z: 0 })).toEqual({ x: -5, z: 0 });
    // Beyond a corridor end, clamped to it.
    expect(nearestOnCorridor({ x: 15, z: 20 })).toEqual({ x: 15, z: 9.5 });
    expect(onSomeCorridor(nearestOnCorridor({ x: 1.3, z: 7.7 }))).toBe(true);
  });

  it('starts on a corridor end', () => {
    const random = seededRandom('s');
    for (let i = 0; i < 20; i++) expect(WANDER_POINTS).toContainEqual(wanderStart(random));
  });

  it('walks along corridors only, to a corridor end at least 4 m away', () => {
    const random = seededRandom('cli:abc');
    let at: Point = nearestOnCorridor({ x: 2, z: 7 });
    for (let leg = 0; leg < 30; leg++) {
      const path = nextWander(random, at);
      expect(path.length).toBeGreaterThan(0);
      const end = path[path.length - 1];
      expect(WANDER_POINTS).toContainEqual(end);
      expect(Math.hypot(end.x - at.x, end.z - at.z)).toBeGreaterThanOrEqual(4);
      let prev = at;
      for (const p of path) {
        expect(onSomeCorridor(p)).toBe(true);
        // Each step follows one axis: corridors are horizontal or vertical.
        expect(Math.abs(p.x - prev.x) < 1e-6 || Math.abs(p.z - prev.z) < 1e-6).toBe(true);
        prev = p;
      }
      at = end;
    }
  });
});

describe('wander: edge cases', () => {
  /**
   * Verifies that a point equidistant from two corridors projects onto one of them
   */
  it('resolves a tie between two corridors deterministically', () => {
    // Halfway between the x = -5 and x = 5 corridors, far from any cross corridor.
    const p = { x: 0, z: -10 };
    const q = nearestOnCorridor(p);
    expect(Math.abs(Math.abs(q.x) - 5)).toBeLessThan(1e-9);
    expect(q.z).toBeCloseTo(-10);
    expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeCloseTo(5);
    expect(nearestOnCorridor(p)).toEqual(q);
  });

  /**
   * Verifies that a point already on a corridor junction projects onto itself
   */
  it('keeps a junction point where it is', () => {
    const q = nearestOnCorridor({ x: -5, z: -8 });
    expect(q.x).toBeCloseTo(-5);
    expect(q.z).toBeCloseTo(-8);
  });

  /**
   * Verifies that a random source returning its upper bound never picks out of range
   */
  it('stays in range when random returns 1 or just below', () => {
    expect(WANDER_POINTS).toContainEqual(wanderStart(() => 1));
    expect(WANDER_POINTS).toContainEqual(wanderStart(() => 0.9999999999));
    const from = WANDER_POINTS[0];
    for (const r of [0, 0.9999999999, 1]) {
      const path = nextWander(() => r, from);
      expect(WANDER_POINTS).toContainEqual(path[path.length - 1]);
    }
  });

  /**
   * Verifies that the same seed and start give the same wander legs
   */
  it('is reproducible for the same seed', () => {
    const legs = (seed: string) => {
      const random = seededRandom(seed);
      let at = wanderStart(random);
      const out: Point[] = [at];
      for (let i = 0; i < 5; i++) {
        const path = nextWander(random, at);
        at = path[path.length - 1];
        out.push(at);
      }
      return out;
    };
    expect(legs('cli:same')).toEqual(legs('cli:same'));
  });
});

describe('evaporation: monotonicity', () => {
  /**
   * Verifies that opacity never rises and the ghost never sinks while evaporating
   */
  it('fades and rises monotonically over time', () => {
    let prev = evaporation(0);
    for (let ms = 50; ms <= EVAPORATE_MS + 200; ms += 50) {
      const cur = evaporation(ms);
      expect(cur.opacity).toBeLessThanOrEqual(prev.opacity);
      expect(cur.rise).toBeGreaterThanOrEqual(prev.rise);
      expect(cur.opacity).toBeGreaterThanOrEqual(0);
      expect(cur.rise).toBeLessThanOrEqual(EVAPORATE_RISE);
      // Once done, it stays done.
      if (prev.done) expect(cur.done).toBe(true);
      prev = cur;
    }
  });

  /**
   * Verifies that evaporation is not done one millisecond before its duration
   */
  it('is done exactly at the duration, not before', () => {
    expect(evaporation(EVAPORATE_MS - 1).done).toBe(false);
    expect(evaporation(EVAPORATE_MS - 1).opacity).toBeGreaterThan(0);
    expect(evaporation(EVAPORATE_MS + 1)).toEqual({ opacity: 0, rise: EVAPORATE_RISE, done: true });
  });

  /**
   * Verifies that a negative elapsed time is clamped to the starting state
   */
  it('clamps negative elapsed time to the start', () => {
    expect(evaporation(-1000)).toEqual({ opacity: 1, rise: 0, done: false });
  });
});

describe('Ghosts: entries', () => {
  /**
   * Verifies that a ghost whose session object changes is redrawn with the new session
   */
  it('replaces the entry when the session object changes', () => {
    const roll = new Ghosts();
    const first = session('a', { title: 'old' } as Partial<SessionView>);
    const [before] = roll.update([first], true);
    const second = session('a', { title: 'new' } as Partial<SessionView>);
    const out = roll.update([second], true);
    expect(out).toHaveLength(1);
    expect(out[0].session).toBe(second);
    expect(out[0].leaving).toBe(false);
    expect(out[0]).not.toBe(before);
  });

  /**
   * Verifies that the same session object keeps the same entry across updates
   */
  it('keeps the same entry for the same session object', () => {
    const roll = new Ghosts();
    const s = session('a');
    const [before] = roll.update([s], true);
    const [after] = roll.update([s], true);
    expect(after).toBe(before);
  });

  /**
   * Verifies that one ghost leaving does not affect another ghost still shown
   */
  it('tracks several ghosts independently', () => {
    const roll = new Ghosts();
    roll.update([session('a'), session('b')], true);
    const out = roll.update([session('b')], true);
    const byId = Object.fromEntries(out.map((e) => [e.session.id, e.leaving]));
    expect(byId).toEqual({ a: true, b: false });
    roll.gone('a');
    expect(roll.update([session('b')], true).map((e) => e.session.id)).toEqual(['b']);
  });

  /**
   * Verifies that gone for an unknown id changes nothing
   */
  it('ignores gone for an unknown id', () => {
    const roll = new Ghosts();
    roll.update([session('a')], true);
    roll.gone('zzz');
    expect(roll.update([session('a')], true).map((e) => [e.session.id, e.leaving])).toEqual([['a', false]]);
  });

  /**
   * Verifies that a leaving ghost keeps the last session it had as a ghost
   */
  it('keeps the last ghost session while leaving after coming back to life', () => {
    const roll = new Ghosts();
    const ghost = session('a');
    roll.update([ghost], true);
    const [entry] = roll.update([session('a', { live: true })], true);
    expect(entry.leaving).toBe(true);
    expect(entry.session).toBe(ghost);
  });

  /**
   * Verifies that ghosts appear fresh, not leaving, once the route snapshot arrives
   */
  it('shows ghosts again once the snapshot is received after a reset', () => {
    const roll = new Ghosts();
    roll.update([session('a')], true);
    roll.update([session('a')], false);
    const out = roll.update([session('a')], true);
    expect(out.map((e) => [e.session.id, e.leaving])).toEqual([['a', false]]);
  });

  /**
   * Verifies that an empty session list with no prior ghosts shows nothing
   */
  it('returns nothing for no sessions', () => {
    expect(new Ghosts().update([], true)).toEqual([]);
  });
});

describe('evaporation', () => {
  it('fades out while rising, then is done', () => {
    expect(evaporation(0)).toEqual({ opacity: 1, rise: 0, done: false });
    const mid = evaporation(EVAPORATE_MS / 2);
    expect(mid.opacity).toBeCloseTo(0.5);
    expect(mid.rise).toBeGreaterThan(EVAPORATE_RISE / 2);
    expect(mid.done).toBe(false);
    expect(evaporation(EVAPORATE_MS)).toEqual({ opacity: 0, rise: EVAPORATE_RISE, done: true });
    expect(evaporation(Infinity).done).toBe(true);
    expect(evaporation(-5).opacity).toBe(1);
  });
});

describe('Ghosts', () => {
  it('shows ghost sessions only', () => {
    const roll = new Ghosts();
    const out = roll.update([session('a'), session('b', { everActive: true }), session('c', { live: true })], true);
    expect(out.map((e) => [e.session.id, e.leaving])).toEqual([['a', false]]);
  });

  it('keeps a departed ghost, leaving, until it is gone', () => {
    const roll = new Ghosts();
    roll.update([session('a')], true);
    const out = roll.update([], true);
    expect(out.map((e) => [e.session.id, e.leaving])).toEqual([['a', true]]);
    // Idempotent for the same sessions.
    expect(roll.update([], true).map((e) => e.leaving)).toEqual([true]);
    roll.gone('a');
    expect(roll.update([], true)).toEqual([]);
  });

  it('makes a ghost that comes back to life leave', () => {
    const roll = new Ghosts();
    roll.update([session('a')], true);
    const out = roll.update([session('a', { live: true })], true);
    expect(out.map((e) => [e.session.id, e.leaving])).toEqual([['a', true]]);
  });

  it('brings back a leaving ghost that becomes a ghost again', () => {
    const roll = new Ghosts();
    roll.update([session('a')], true);
    roll.update([], true);
    const out = roll.update([session('a')], true);
    expect(out.map((e) => e.leaving)).toEqual([false]);
  });

  it('ignores gone for a ghost still shown', () => {
    const roll = new Ghosts();
    roll.update([session('a')], true);
    roll.gone('a');
    expect(roll.update([session('a')], true)).toHaveLength(1);
  });

  it('shows nothing and evaporates nobody before the route snapshot', () => {
    const roll = new Ghosts();
    roll.update([session('a')], true);
    expect(roll.update([session('a')], false)).toEqual([]);
    expect(roll.update([], true)).toEqual([]);
  });
});
