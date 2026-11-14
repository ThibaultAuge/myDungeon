import { describe, expect, it } from 'vitest';
import {
  Ambush,
  BURROW_DEPTH,
  IMPACT_TIME,
  LIE_TIME,
  SINK_DEPTH,
  SINK_TIME,
  SKELETON_COUNT,
  SKELETON_SPEED,
  STRIKE_RANGE,
  TREE_REACH,
  TRUNK_RADIUS,
  VANISH_TIME,
  assignSkeletons,
  nearestTree,
  skeletonClip,
  skeletonDepth,
  skeletonScale,
  skeletonSpawns,
  victimClip,
  victimSink,
  type SkeletonPhase,
  type VictimPhase,
} from '../src/scene/ambush.ts';
import {
  CLIPS,
  DEATH_CLIP_TIME,
  HIT_CLIP_TIME,
  MAX_CLIP_RATE,
  SKELETON_LOOKS,
  SPAWN_CLIP_TIME,
  USE_ITEM_CLIP_TIME,
  WALK_CLIP_SPEED,
} from '../src/scene/characters.ts';
import type { Point } from '../src/scene/layout.ts';
import { killPoint } from '../src/scene/outside.ts';

/** Simulation step, in seconds. */
const DT = 0.05;
const EPS = 1e-9;

/** Steps the ambush until `done` holds; fails instead of looping forever. Returns the time spent. */
function runUntil(a: Ambush, done: () => boolean, max = 4000): number {
  let n = 0;
  while (!done()) {
    if (++n > max) throw new Error('the ambush never reached the expected state');
    a.step(DT);
  }
  return n * DT;
}

/** Skeletons currently sent for a victim. */
const sentFor = (a: Ambush, id: string) => a.skeletons.filter((s) => s.victim === id);

/** True once every skeleton is back underground or in a tree. */
const allFree = (a: Ambush) => a.skeletons.every((s) => s.phase === 'free');

/**
 * Runs a whole ambush, recording when each victim and skeleton phase starts (seconds since
 * the first step) and checking the scene invariants at every step.
 */
function record(a: Ambush, ids: string[], max = 4000) {
  const victims = new Map<string, { phase: VictimPhase; at: number }[]>(ids.map((id) => [id, []]));
  const skeletons = a.skeletons.map(() => [] as { phase: SkeletonPhase; at: number; victim: string }[]);
  const problems: string[] = [];
  let time = 0;
  const snap = (stepped: boolean) => {
    for (const id of ids) {
      const v = a.victim(id);
      const log = victims.get(id)!;
      if (v && log[log.length - 1]?.phase !== v.phase) log.push({ phase: v.phase, at: time });
    }
    a.skeletons.forEach((s, i) => {
      const log = skeletons[i];
      if (log[log.length - 1]?.phase !== s.phase) log.push({ phase: s.phase, at: time, victim: s.victim });
    });
    if (!stepped) return;
    // After a step, a waiting victim means no skeleton was free to send.
    const waiting = ids.filter((id) => a.victim(id)?.phase === 'waiting');
    if (waiting.length && a.skeletons.some((s) => s.phase === 'free')) problems.push(`t=${time}: ${waiting} waits with a free skeleton`);
    if (a.skeletons.length !== SKELETON_COUNT) problems.push(`t=${time}: ${a.skeletons.length} skeletons`);
  };
  snap(false);
  for (let n = 0; n < max; n++) {
    a.step(DT);
    time += DT;
    snap(true);
    if (ids.every((id) => a.victim(id)?.phase === 'gone') && allFree(a)) break;
  }
  return { victims, skeletons, problems, time };
}

const phases = <T extends { phase: string }>(log: T[]) => log.map((e) => e.phase);
const startOf = <T extends { phase: string; at: number }>(log: T[], phase: string) => log.find((e) => e.phase === phase)!.at;

// ---------------------------------------------------------------- constants

describe('ambush constants', () => {
  /**
   * Verifies that there is one skeleton look per skeleton that can be out at once
   */
  it('has a look for every skeleton index', () => {
    expect(SKELETON_COUNT).toBeGreaterThan(0);
    expect(SKELETON_LOOKS).toHaveLength(SKELETON_COUNT);
    expect(new Ambush([]).skeletons.map((s) => s.index)).toEqual(Array.from({ length: SKELETON_COUNT }, (_, i) => i));
  });

  /**
   * Verifies that the blow lands in the middle of the strike clip
   */
  it('lands the blow halfway through Use_Item', () => {
    expect(IMPACT_TIME).toBeCloseTo(USE_ITEM_CLIP_TIME / 2, 12);
  });

  /**
   * Verifies that distances and durations are positive and the trunk radius is below the reach
   */
  it('has positive, consistent distances and times', () => {
    for (const v of [STRIKE_RANGE, LIE_TIME, SINK_TIME, SINK_DEPTH, SKELETON_SPEED, TREE_REACH, TRUNK_RADIUS, VANISH_TIME, BURROW_DEPTH]) {
      expect(v).toBeGreaterThan(0);
    }
    expect(TRUNK_RADIUS).toBeLessThan(TREE_REACH);
  });
});

// ---------------------------------------------------------------- nearestTree

describe('nearestTree', () => {
  /**
   * Verifies that no tree at all yields null
   */
  it('returns null without trees', () => {
    expect(nearestTree({ x: 0, z: 0 }, [])).toBeNull();
  });

  /**
   * Verifies that the closest tree is returned among several in reach
   */
  it('picks the closest tree in reach', () => {
    const near = { x: 1, z: 1 };
    expect(nearestTree({ x: 0, z: 0 }, [{ x: 5, z: 0 }, near, { x: -3, z: 0 }])).toBe(near);
  });

  /**
   * Verifies that a tree beyond TREE_REACH is ignored
   */
  it('ignores trees farther than TREE_REACH', () => {
    expect(nearestTree({ x: 0, z: 0 }, [{ x: TREE_REACH + 0.01, z: 0 }])).toBeNull();
  });

  /**
   * Verifies that a tree exactly at TREE_REACH still counts
   */
  it('accepts a tree exactly at TREE_REACH', () => {
    const t = { x: 0, z: TREE_REACH };
    expect(nearestTree({ x: 0, z: 0 }, [t])).toBe(t);
  });
});

// ---------------------------------------------------------------- assignSkeletons

describe('assignSkeletons', () => {
  /**
   * Verifies the split of free skeletons between waiting victims, in arrival order
   */
  it.each([
    [1, 3, [3]],
    [2, 3, [1, 2]],
    [3, 3, [1, 1, 1]],
    [4, 3, [1, 1, 1, 0]],
    [5, 3, [1, 1, 1, 0, 0]],
    [1, 1, [1]],
    [2, 1, [1, 0]],
    [2, 2, [1, 1]],
    [1, 2, [2]],
  ])('gives %i waiting victims and %i free skeletons %j', (waiting, free, expected) => {
    expect(assignSkeletons(waiting, free)).toEqual(expected);
  });

  /**
   * Verifies that with no free skeleton every waiting victim gets zero
   */
  it.each([1, 2, 4])('gives zeros to %i victims when none is free', (waiting) => {
    expect(assignSkeletons(waiting, 0)).toEqual(Array(waiting).fill(0));
  });

  /**
   * Verifies that no waiting victim yields an empty split
   */
  it('returns [] without waiting victims', () => {
    expect(assignSkeletons(0, 3)).toEqual([]);
  });

  /**
   * Verifies that the split never hands out more than the free skeletons, and serves the first first
   */
  it('never hands out more than the free count and never skips an earlier victim', () => {
    for (let waiting = 0; waiting <= 6; waiting++) {
      for (let free = 0; free <= 6; free++) {
        const out = assignSkeletons(waiting, free);
        expect(out).toHaveLength(waiting);
        // Every free skeleton is handed out as soon as someone waits.
        expect(out.reduce((s, n) => s + n, 0)).toBe(waiting > 0 ? free : 0);
        const firstZero = out.indexOf(0);
        if (firstZero >= 0) expect(out.slice(firstZero).every((n) => n === 0)).toBe(true);
        expect(out.filter((n) => n > 0)).toHaveLength(Math.min(waiting, free));
      }
    }
  });
});

// ---------------------------------------------------------------- skeletonSpawns

describe('skeletonSpawns', () => {
  const victim = { x: 4, z: 20 };

  /**
   * Verifies that every skeleton rises at STRIKE_RANGE from the victim
   */
  it.each([1, 2, 3])('puts %i skeletons at STRIKE_RANGE', (n) => {
    const spawns = skeletonSpawns(victim, n, 'v');
    expect(spawns).toHaveLength(n);
    for (const p of spawns) expect(Math.hypot(p.x - victim.x, p.z - victim.z)).toBeCloseTo(STRIKE_RANGE, 9);
  });

  /**
   * Verifies that the skeletons are evenly spread around the victim
   */
  it('spreads three skeletons a third of a turn apart', () => {
    const [a, b, c] = skeletonSpawns(victim, 3, 'v');
    const d = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.z - q.z);
    const side = STRIKE_RANGE * Math.sqrt(3);
    expect(d(a, b)).toBeCloseTo(side, 9);
    expect(d(b, c)).toBeCloseTo(side, 9);
    expect(d(c, a)).toBeCloseTo(side, 9);
  });

  /**
   * Verifies that the same seed always gives the same points and another seed turns them
   */
  it('is stable for a seed and differs between seeds', () => {
    expect(skeletonSpawns(victim, 3, 'agent-1')).toEqual(skeletonSpawns(victim, 3, 'agent-1'));
    expect(skeletonSpawns(victim, 3, 'agent-1')).not.toEqual(skeletonSpawns(victim, 3, 'agent-2'));
  });

  /**
   * Verifies that zero skeletons yield no spawn point
   */
  it('returns [] for zero skeletons', () => {
    expect(skeletonSpawns(victim, 0, 'v')).toEqual([]);
  });
});

// ---------------------------------------------------------------- Ambush: victims and slots

describe('Ambush: add, arrived, release', () => {
  /**
   * Verifies that add returns the kill point of the lowest free slot
   */
  it('allocates the lowest free slot', () => {
    const a = new Ambush([]);
    expect(a.add('a')).toEqual(killPoint(0));
    expect(a.add('b')).toEqual(killPoint(1));
    expect(a.add('c')).toEqual(killPoint(2));
    expect([a.victim('a')!.slot, a.victim('b')!.slot, a.victim('c')!.slot]).toEqual([0, 1, 2]);
  });

  /**
   * Verifies that adding a known victim again changes nothing and returns the same point
   */
  it('is idempotent', () => {
    const a = new Ambush([]);
    const p = a.add('a');
    expect(a.add('a')).toEqual(p);
    expect(a.add('b')).toEqual(killPoint(1));
    expect(a.victim('a')!.slot).toBe(0);
  });

  /**
   * Verifies that a released slot is given to the next newcomer, others keep theirs
   */
  it('reuses a released slot', () => {
    const a = new Ambush([]);
    a.add('a');
    a.add('b');
    a.add('c');
    a.release('b');
    expect(a.victim('b')).toBeUndefined();
    expect(a.add('d')).toEqual(killPoint(1));
    expect(a.victim('d')!.slot).toBe(1);
    expect(a.add('e')).toEqual(killPoint(3));
  });

  /**
   * Verifies that a new victim starts walking, at time 0
   */
  it('starts a new victim walking', () => {
    const a = new Ambush([]);
    a.add('a');
    expect(a.victim('a')).toMatchObject({ id: 'a', phase: 'walking', t: 0, slot: 0 });
  });

  /**
   * Verifies that a walking victim gets no skeleton, however long it walks
   */
  it('sends no skeleton to a walking victim', () => {
    const a = new Ambush([]);
    a.add('a');
    for (let i = 0; i < 200; i++) a.step(DT);
    expect(a.victim('a')!.phase).toBe('walking');
    expect(allFree(a)).toBe(true);
  });

  /**
   * Verifies that arriving turns a walking victim into a waiting one
   */
  it('makes an arrived victim wait', () => {
    const a = new Ambush([]);
    a.add('a');
    a.arrived('a');
    expect(a.victim('a')!.phase).toBe('waiting');
  });

  /**
   * Verifies that arriving twice keeps the first arrival order
   */
  it('ignores a second arrival', () => {
    const a = new Ambush([]);
    a.add('a');
    a.add('b');
    a.arrived('a');
    a.arrived('b');
    const first = a.victim('a')!.arrivedAt;
    a.arrived('a');
    expect(a.victim('a')!.arrivedAt).toBe(first);
    expect(a.victim('a')!.arrivedAt).toBeLessThan(a.victim('b')!.arrivedAt);
  });

  /**
   * Verifies that arriving or releasing an unknown id is harmless
   */
  it('ignores unknown ids', () => {
    const a = new Ambush([]);
    expect(() => a.arrived('ghost')).not.toThrow();
    expect(() => a.release('ghost')).not.toThrow();
    expect(a.victim('ghost')).toBeUndefined();
    a.step(DT);
    expect(allFree(a)).toBe(true);
  });
});

// ---------------------------------------------------------------- Ambush: timeline

describe('Ambush: timeline of a lone victim', () => {
  /**
   * Verifies that a lone victim goes through every phase in order, up to gone
   */
  it('takes the victim from waiting to gone in order', () => {
    const a = new Ambush([]);
    a.add('v');
    a.arrived('v');
    const { victims, problems } = record(a, ['v']);
    expect(problems).toEqual([]);
    expect(phases(victims.get('v')!)).toEqual(['waiting', 'struck', 'hit', 'dying', 'lying', 'sinking', 'gone']);
  });

  /**
   * Verifies that each victim phase lasts its documented time (within one step)
   */
  it('times each victim phase on the clips and constants', () => {
    const a = new Ambush([]);
    a.add('v');
    a.arrived('v');
    const log = record(a, ['v']).victims.get('v')!;
    const lasts = (phase: VictimPhase) => {
      const i = log.findIndex((e) => e.phase === phase);
      return log[i + 1].at - log[i].at;
    };
    const expected: [VictimPhase, number][] = [
      ['struck', SPAWN_CLIP_TIME + IMPACT_TIME],
      ['hit', HIT_CLIP_TIME],
      ['dying', DEATH_CLIP_TIME],
      ['lying', LIE_TIME],
      ['sinking', SINK_TIME],
    ];
    for (const [phase, time] of expected) {
      expect(lasts(phase), phase).toBeGreaterThanOrEqual(time - EPS);
      expect(lasts(phase), phase).toBeLessThanOrEqual(time + DT + EPS);
    }
  });

  /**
   * Verifies that a lone victim gets every skeleton, which then burrow back without trees
   */
  it('sends all skeletons, which rise, strike and burrow back when no tree is near', () => {
    const a = new Ambush([]);
    a.add('v');
    a.arrived('v');
    const { skeletons } = record(a, ['v']);
    for (const log of skeletons) {
      expect(phases(log)).toEqual(['free', 'rising', 'striking', 'burrowing', 'free']);
      expect(log[1].victim).toBe('v');
      expect(log[log.length - 1].victim).toBe('');
    }
  });

  /**
   * Verifies that the blow lands IMPACT_TIME into the strike and the skeletons leave when the body lies
   */
  it('syncs the hit with the strike and the leaving with the body lying still', () => {
    const a = new Ambush([]);
    a.add('v');
    a.arrived('v');
    const { victims, skeletons } = record(a, ['v']);
    const v = victims.get('v')!;
    for (const log of skeletons) {
      expect(startOf(log, 'rising')).toBeCloseTo(startOf(v, 'struck'), 9);
      const rise = startOf(log, 'striking') - startOf(log, 'rising');
      expect(rise).toBeGreaterThanOrEqual(SPAWN_CLIP_TIME - EPS);
      expect(rise).toBeLessThanOrEqual(SPAWN_CLIP_TIME + DT + EPS);
      expect(Math.abs(startOf(v, 'hit') - startOf(log, 'striking') - IMPACT_TIME)).toBeLessThanOrEqual(DT + EPS);
      expect(startOf(log, 'burrowing')).toBeCloseTo(startOf(v, 'lying'), 9);
      const burrow = startOf(log.slice(1), 'free') - startOf(log, 'burrowing');
      expect(burrow).toBeGreaterThanOrEqual(SPAWN_CLIP_TIME - EPS);
      expect(burrow).toBeLessThanOrEqual(SPAWN_CLIP_TIME + DT + EPS);
    }
  });

  /**
   * Verifies that rising skeletons stand at STRIKE_RANGE, facing the victim, which faces the first
   */
  it('places the skeletons around the victim, all facing it', () => {
    const a = new Ambush([]);
    const p = a.add('v');
    a.arrived('v');
    a.step(DT);
    expect(a.victim('v')!.phase).toBe('struck');
    const spawns = skeletonSpawns(p, SKELETON_COUNT, 'v');
    a.skeletons.forEach((s, i) => {
      expect(s.phase).toBe('rising');
      expect(s.pos).toEqual(spawns[i]);
      expect(Math.hypot(s.pos.x - p.x, s.pos.z - p.z)).toBeCloseTo(STRIKE_RANGE, 9);
      // Heading convention: rotation.y = atan2(dx, dz) faces +z at 0.
      expect(Math.sin(s.heading)).toBeCloseTo((p.x - s.pos.x) / STRIKE_RANGE, 9);
      expect(Math.cos(s.heading)).toBeCloseTo((p.z - s.pos.z) / STRIKE_RANGE, 9);
    });
    const first = a.skeletons[0].pos;
    expect(a.victim('v')!.facing).toBeCloseTo(Math.atan2(first.x - p.x, first.z - p.z), 12);
  });

  /**
   * Verifies that a gone victim stays gone, keeping its slot, until released
   */
  it('keeps a gone victim and its slot until release', () => {
    const a = new Ambush([]);
    a.add('v');
    a.arrived('v');
    record(a, ['v']);
    for (let i = 0; i < 50; i++) a.step(DT);
    expect(a.victim('v')!.phase).toBe('gone');
    expect(a.add('w')).toEqual(killPoint(1));
    a.release('v');
    expect(a.add('x')).toEqual(killPoint(0));
  });
});

describe('Ambush: skeletons leaving into trees', () => {
  /**
   * Finds the first victim id whose skeletons include at least one heading for a tree.
   * The choice is seeded per victim id, so this is deterministic.
   */
  function ambushWithTreeWalker(tree: Point) {
    for (let i = 0; i < 100; i++) {
      const a = new Ambush([tree]);
      const id = `agent-${i}`;
      a.add(id);
      a.arrived(id);
      a.step(DT);
      if (a.skeletons.some((s) => s.tree)) return { a, id };
    }
    throw new Error('no victim id sent a skeleton to the tree');
  }

  /**
   * Verifies that each skeleton picks the tree in reach or underground, and leaves accordingly
   */
  it('walks to the tree when it has one, burrows otherwise', () => {
    const tree = { x: killPoint(0).x + 3, z: killPoint(0).z };
    let walkers = 0;
    let burrowers = 0;
    for (let i = 0; i < 20; i++) {
      const a = new Ambush([tree]);
      const id = `agent-${i}`;
      a.add(id);
      a.arrived(id);
      a.step(DT);
      const trees = a.skeletons.map((s) => s.tree);
      for (const t of trees) if (t) expect(t).toBe(tree);
      const log = record(a, [id]).skeletons;
      log.forEach((l, k) => {
        if (trees[k]) {
          walkers++;
          expect(phases(l)).toEqual(['rising', 'striking', 'walking', 'vanishing', 'free']);
        } else {
          burrowers++;
          expect(phases(l)).toEqual(['rising', 'striking', 'burrowing', 'free']);
        }
      });
    }
    // Both endings are seen over 60 deterministic draws.
    expect(walkers).toBeGreaterThan(0);
    expect(burrowers).toBeGreaterThan(0);
  });

  /**
   * Verifies that a skeleton walks at SKELETON_SPEED and stops TRUNK_RADIUS from the trunk centre
   */
  it('walks at SKELETON_SPEED and stops at the trunk', () => {
    const tree = { x: killPoint(0).x + 3, z: killPoint(0).z };
    const { a } = ambushWithTreeWalker(tree);
    const s = a.skeletons.find((x) => x.tree)!;
    runUntil(a, () => s.phase === 'walking');
    let prev = { ...s.pos };
    for (let guard = 0; s.phase === 'walking'; guard++) {
      expect(guard).toBeLessThan(1000);
      a.step(DT);
      const moved = Math.hypot(s.pos.x - prev.x, s.pos.z - prev.z);
      expect(moved).toBeLessThanOrEqual(SKELETON_SPEED * DT + EPS);
      // Heads straight for the tree.
      expect(Math.hypot(s.pos.x - tree.x, s.pos.z - tree.z)).toBeLessThanOrEqual(Math.hypot(prev.x - tree.x, prev.z - tree.z) + EPS);
      prev = { ...s.pos };
    }
    expect(s.phase).toBe('vanishing');
    expect(Math.hypot(s.pos.x - tree.x, s.pos.z - tree.z)).toBeCloseTo(TRUNK_RADIUS, 6);
  });

  /**
   * Verifies that a skeleton shrinking into its tree frees itself after VANISH_TIME
   */
  it('frees the skeleton after VANISH_TIME in the tree', () => {
    const tree = { x: killPoint(0).x + 3, z: killPoint(0).z };
    const { a } = ambushWithTreeWalker(tree);
    const s = a.skeletons.find((x) => x.tree)!;
    runUntil(a, () => s.phase === 'vanishing');
    const time = runUntil(a, () => s.phase !== 'vanishing');
    expect(s.phase).toBe('free');
    expect(time).toBeGreaterThanOrEqual(VANISH_TIME - EPS);
    expect(time).toBeLessThanOrEqual(VANISH_TIME + DT + EPS);
    expect(s.tree).toBeNull();
    expect(s.victim).toBe('');
  });

  /**
   * Verifies that a tree out of reach is never chosen: every skeleton burrows
   */
  it('burrows every skeleton when the only tree is out of reach', () => {
    const p = killPoint(0);
    const far = { x: p.x + TREE_REACH + STRIKE_RANGE + 1, z: p.z };
    for (let i = 0; i < 10; i++) {
      const a = new Ambush([far]);
      a.add(`agent-${i}`);
      a.arrived(`agent-${i}`);
      a.step(DT);
      expect(a.skeletons.every((s) => s.tree === null)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------- Ambush: several victims

describe('Ambush: several victims', () => {
  /**
   * Verifies that a second victim waits while every skeleton is busy, then gets served
   */
  it('makes a later victim wait until a skeleton is free', () => {
    const a = new Ambush([]);
    a.add('first');
    a.arrived('first');
    a.step(DT);
    expect(sentFor(a, 'first')).toHaveLength(SKELETON_COUNT);
    a.add('second');
    a.arrived('second');
    a.step(DT);
    expect(a.victim('second')!.phase).toBe('waiting');
    runUntil(a, () => a.victim('second')!.phase !== 'waiting');
    // Served only once the first one's skeletons have finished.
    expect(a.victim('first')!.phase === 'lying' || a.victim('first')!.phase === 'sinking' || a.victim('first')!.phase === 'gone').toBe(true);
    expect(a.victim('second')!.phase).toBe('struck');
    expect(sentFor(a, 'second').length).toBeGreaterThan(0);
  });

  /**
   * Verifies that the scene never waits with a free skeleton and every victim ends gone
   */
  it('serves five victims with three skeletons, never idling a skeleton', () => {
    const a = new Ambush([]);
    const ids = ['a', 'b', 'c', 'd', 'e'];
    for (const id of ids) a.add(id);
    for (const id of ids) a.arrived(id);
    a.step(DT);
    // One skeleton each for the first three, the last two wait.
    expect(ids.map((id) => sentFor(a, id).length)).toEqual([1, 1, 1, 0, 0]);
    expect(ids.map((id) => a.victim(id)!.phase)).toEqual(['struck', 'struck', 'struck', 'waiting', 'waiting']);
    const { problems, victims } = record(a, ids);
    expect(problems).toEqual([]);
    for (const id of ids) expect(a.victim(id)!.phase, id).toBe('gone');
    expect(allFree(a)).toBe(true);
    // The two that waited were served after the first three, in arrival order.
    const struck = (id: string) => startOf(victims.get(id)!, 'struck');
    expect(struck('d')).toBeGreaterThan(0);
    expect(struck('d')).toBeLessThanOrEqual(struck('e'));
  });

  /**
   * Verifies that freed skeletons are split by arrival order, the later victim getting the remainder
   */
  it('splits free skeletons between waiting victims by arrival order', () => {
    const a = new Ambush([]);
    a.add('x');
    a.add('y');
    a.arrived('y');
    a.arrived('x');
    a.step(DT);
    expect(sentFor(a, 'y')).toHaveLength(1);
    expect(sentFor(a, 'x')).toHaveLength(2);
    expect(sentFor(a, 'y')[0].pos).toEqual(skeletonSpawns(a.victim('y')!.point, 1, 'y')[0]);
  });

  /**
   * Verifies that at no time more skeletons are sent than SKELETON_COUNT
   */
  it('never has more than SKELETON_COUNT skeletons out', () => {
    const a = new Ambush([]);
    for (let i = 0; i < 6; i++) {
      a.add(`v${i}`);
      a.arrived(`v${i}`);
    }
    for (let n = 0; n < 600; n++) {
      a.step(DT);
      const out = a.skeletons.filter((s) => s.phase !== 'free');
      expect(out.length).toBeLessThanOrEqual(SKELETON_COUNT);
      const sent = [0, 1, 2, 3, 4, 5].reduce((sum, i) => sum + sentFor(a, `v${i}`).length, 0);
      expect(sent).toBeLessThanOrEqual(SKELETON_COUNT);
    }
  });
});

describe('Ambush: release', () => {
  /**
   * Verifies that releasing a victim mid-strike makes its skeletons leave on the next step
   */
  it('sends striking skeletons away when their victim is released', () => {
    const a = new Ambush([]);
    a.add('v');
    a.arrived('v');
    runUntil(a, () => a.skeletons.every((s) => s.phase === 'striking'));
    expect(a.victim('v')!.phase).toBe('struck');
    a.release('v');
    a.step(DT);
    expect(a.skeletons.map((s) => s.phase)).toEqual(Array(SKELETON_COUNT).fill('burrowing'));
    runUntil(a, () => allFree(a));
    expect(a.skeletons.every((s) => s.victim === '')).toBe(true);
  });

  /**
   * Verifies that skeletons still rising for a released victim finish rising, then leave
   */
  it('lets rising skeletons finish rising before leaving', () => {
    const a = new Ambush([]);
    a.add('v');
    a.arrived('v');
    a.step(DT);
    a.release('v');
    a.step(DT);
    expect(a.skeletons.every((s) => s.phase === 'rising')).toBe(true);
    runUntil(a, () => a.skeletons.every((s) => s.phase !== 'rising'));
    runUntil(a, () => a.skeletons.every((s) => s.phase === 'burrowing'), 2);
    runUntil(a, () => allFree(a));
  });

  /**
   * Verifies that skeletons freed by a release go to the next waiting victim
   */
  it('gives the freed skeletons to the next waiting victim', () => {
    const a = new Ambush([]);
    a.add('v');
    a.arrived('v');
    a.add('w');
    a.arrived('w');
    a.step(DT);
    expect(sentFor(a, 'w').length + sentFor(a, 'v').length).toBe(SKELETON_COUNT);
    a.add('z');
    a.arrived('z');
    runUntil(a, () => a.skeletons.every((s) => s.phase === 'striking'));
    a.release('v');
    a.release('w');
    runUntil(a, () => a.victim('z')!.phase !== 'waiting');
    expect(a.victim('z')!.phase).toBe('struck');
    expect(sentFor(a, 'z')).toHaveLength(SKELETON_COUNT);
  });
});

// ---------------------------------------------------------------- Ambush: outings

describe('Ambush: skeleton outings (sortie)', () => {
  /**
   * Verifies that every skeleton starts with no outing
   */
  it('starts every skeleton at sortie 0', () => {
    expect(new Ambush([]).skeletons.map((s) => s.sortie)).toEqual(Array(SKELETON_COUNT).fill(0));
  });

  /**
   * Verifies that waiting with no victim never counts an outing
   */
  it('does not count an outing while no victim waits', () => {
    const a = new Ambush([]);
    a.add('v');
    for (let i = 0; i < 50; i++) a.step(DT);
    expect(a.skeletons.map((s) => s.sortie)).toEqual(Array(SKELETON_COUNT).fill(0));
  });

  /**
   * Verifies that each skeleton sent counts exactly one outing, unsent ones none
   */
  it('increments sortie once per skeleton sent', () => {
    const a = new Ambush([]);
    a.add('a');
    a.add('b');
    a.arrived('a');
    a.step(DT);
    expect(a.skeletons.map((s) => s.sortie)).toEqual(Array(SKELETON_COUNT).fill(1));
    // Further steps of the same outing do not count again.
    runUntil(a, () => a.skeletons.every((s) => s.phase === 'striking'));
    expect(a.skeletons.map((s) => s.sortie)).toEqual(Array(SKELETON_COUNT).fill(1));
  });

  /**
   * Verifies that a skeleton gets a new sortie number on each consecutive outing
   */
  it('differs between two consecutive outings of the same skeleton', () => {
    const a = new Ambush([]);
    a.add('first');
    a.arrived('first');
    a.step(DT);
    const firstOuting = a.skeletons.map((s) => s.sortie);
    runUntil(a, () => allFree(a));
    // Back underground: the count is kept, not reset.
    expect(a.skeletons.map((s) => s.sortie)).toEqual(firstOuting);
    a.add('second');
    a.arrived('second');
    a.step(DT);
    expect(sentFor(a, 'second')).toHaveLength(SKELETON_COUNT);
    a.skeletons.forEach((s, i) => {
      expect(s.sortie).toBe(firstOuting[i] + 1);
      expect(s.sortie).not.toBe(firstOuting[i]);
    });
  });

  /**
   * Verifies that a skeleton freed and re-sent in the same step still gets a new sortie
   */
  it('counts a new outing when a skeleton is freed and re-sent within one step', () => {
    const a = new Ambush([]);
    a.add('first');
    a.arrived('first');
    a.step(DT);
    a.add('second');
    a.arrived('second');
    let before = a.skeletons.map((s) => ({ phase: s.phase, sortie: s.sortie }));
    for (let guard = 0; a.victim('second')!.phase === 'waiting'; guard++) {
      expect(guard).toBeLessThan(4000);
      before = a.skeletons.map((s) => ({ phase: s.phase, sortie: s.sortie }));
      a.step(DT);
    }
    expect(a.victim('second')!.phase).toBe('struck');
    const resent = a.skeletons.filter((s) => s.victim === 'second');
    expect(resent).toHaveLength(SKELETON_COUNT);
    for (const s of resent) {
      const prev = before[s.index];
      // Never observed free between the two outings: only sortie tells them apart.
      expect(prev.phase).toBe('burrowing');
      expect(s.phase).toBe('rising');
      expect(s.sortie).toBe(prev.sortie + 1);
    }
  });
});

// ---------------------------------------------------------------- clips and offsets

describe('victimClip', () => {
  /**
   * Verifies that a victim still walking to its kill point keeps its usual clip
   */
  it('returns null while walking', () => {
    expect(victimClip('walking')).toBeNull();
  });

  /**
   * Verifies that a victim at its kill point loops Idle_B until the blow lands
   */
  it.each(['waiting', 'struck'] as VictimPhase[])('loops Idle_B while %s', (phase) => {
    expect(victimClip(phase)).toEqual({ name: 'Idle_B', loop: true, timeScale: 1, frozen: false, frozenAt: 0 });
  });

  /**
   * Verifies that every non-null victim clip is one of the known CLIPS
   */
  it('only uses known clips', () => {
    const all: VictimPhase[] = ['walking', 'waiting', 'struck', 'hit', 'dying', 'lying', 'sinking', 'gone'];
    for (const phase of all) {
      const c = victimClip(phase);
      if (c) expect(CLIPS).toContain(c.name);
    }
  });

  /**
   * Verifies that the hit plays Hit_A once at normal speed
   */
  it('plays Hit_A once when hit', () => {
    expect(victimClip('hit')).toEqual({ name: 'Hit_A', loop: false, timeScale: 1, frozen: false, frozenAt: 0 });
  });

  /**
   * Verifies that Death_A plays once and stays on its last pose until the body is gone
   */
  it.each(['dying', 'lying', 'sinking', 'gone'] as VictimPhase[])('plays Death_A once while %s', (phase) => {
    expect(victimClip(phase)).toEqual({ name: 'Death_A', loop: false, timeScale: 1, frozen: false, frozenAt: 0 });
  });
});

describe('victimSink', () => {
  /**
   * Verifies that the body stays on the ground before sinking
   */
  it.each(['walking', 'waiting', 'struck', 'hit', 'dying', 'lying'] as VictimPhase[])('is 0 while %s', (phase) => {
    expect(victimSink({ phase, t: 10 })).toBe(0);
  });

  /**
   * Verifies that the body sinks linearly over SINK_TIME
   */
  it.each([0, 0.25, 0.5, 1])('sinks to the same fraction of SINK_DEPTH at %d of SINK_TIME', (frac) => {
    expect(victimSink({ phase: 'sinking', t: frac * SINK_TIME })).toBeCloseTo(frac * SINK_DEPTH, 12);
  });

  /**
   * Verifies that the depth never goes past SINK_DEPTH, and a gone body stays at it
   */
  it('caps the depth at SINK_DEPTH', () => {
    expect(victimSink({ phase: 'sinking', t: SINK_TIME * 3 })).toBe(SINK_DEPTH);
    expect(victimSink({ phase: 'gone', t: 0 })).toBe(SINK_DEPTH);
  });
});

describe('skeletonClip', () => {
  /**
   * Verifies that a rising skeleton plays Spawn_Ground once at normal speed (timed on SPAWN_CLIP_TIME)
   */
  it('plays Spawn_Ground once while rising', () => {
    expect(skeletonClip({ phase: 'rising', t: 0 })).toEqual({ name: 'Spawn_Ground', loop: false, timeScale: 1, frozen: false, frozenAt: 0 });
  });

  /**
   * Verifies that a striking skeleton loops Use_Item
   */
  it('loops Use_Item while striking', () => {
    expect(skeletonClip({ phase: 'striking', t: 3 })).toEqual({ name: 'Use_Item', loop: true, timeScale: 1, frozen: false, frozenAt: 0 });
  });

  /**
   * Verifies that a walking skeleton loops Walking_A at its speed, capped at MAX_CLIP_RATE
   */
  it('loops Walking_A at the capped rate while walking', () => {
    const c = skeletonClip({ phase: 'walking', t: 0 });
    expect(c.name).toBe('Walking_A');
    expect(c.loop).toBe(true);
    expect(c.frozen).toBe(false);
    expect(c.timeScale).toBeCloseTo(Math.min(SKELETON_SPEED / WALK_CLIP_SPEED, MAX_CLIP_RATE), 12);
    expect(c.timeScale).toBeGreaterThan(0);
    expect(c.timeScale).toBeLessThanOrEqual(MAX_CLIP_RATE);
  });

  /**
   * Verifies that a burrowing skeleton plays its rise backwards, from the end to the start
   */
  it.each([
    [0, SPAWN_CLIP_TIME],
    [SPAWN_CLIP_TIME / 2, SPAWN_CLIP_TIME / 2],
    [SPAWN_CLIP_TIME, 0],
    [SPAWN_CLIP_TIME * 2, 0],
  ])('holds Spawn_Ground at the mirrored time while burrowing (t=%d)', (t, at) => {
    const c = skeletonClip({ phase: 'burrowing', t });
    expect(c.name).toBe('Spawn_Ground');
    expect(c.frozen).toBe(true);
    expect(c.timeScale).toBe(0);
    expect(c.frozenAt).toBeCloseTo(at, 12);
  });

  /**
   * Verifies that free and vanishing skeletons hold a still idle pose
   */
  it.each(['free', 'vanishing'] as SkeletonPhase[])('holds Idle_A while %s', (phase) => {
    expect(skeletonClip({ phase, t: 0.3 })).toEqual({ name: 'Idle_A', loop: false, timeScale: 0, frozen: true, frozenAt: 0 });
  });

  /**
   * Verifies that every skeleton clip is one of the known CLIPS
   */
  it('only uses known clips', () => {
    const all: SkeletonPhase[] = ['free', 'rising', 'striking', 'walking', 'vanishing', 'burrowing'];
    for (const phase of all) expect(CLIPS).toContain(skeletonClip({ phase, t: 0 }).name);
  });
});

describe('skeletonDepth', () => {
  /**
   * Verifies that only a burrowing skeleton sinks, linearly over SPAWN_CLIP_TIME, capped
   */
  it('sinks only while burrowing, down to BURROW_DEPTH', () => {
    expect(skeletonDepth({ phase: 'burrowing', t: 0 })).toBe(0);
    expect(skeletonDepth({ phase: 'burrowing', t: SPAWN_CLIP_TIME / 2 })).toBeCloseTo(BURROW_DEPTH / 2, 12);
    expect(skeletonDepth({ phase: 'burrowing', t: SPAWN_CLIP_TIME })).toBeCloseTo(BURROW_DEPTH, 12);
    expect(skeletonDepth({ phase: 'burrowing', t: SPAWN_CLIP_TIME * 4 })).toBe(BURROW_DEPTH);
  });

  /**
   * Verifies that every other phase stays on the ground
   */
  it.each(['free', 'rising', 'striking', 'walking', 'vanishing'] as SkeletonPhase[])('is 0 while %s', (phase) => {
    expect(skeletonDepth({ phase, t: 5 })).toBe(0);
  });
});

describe('skeletonScale', () => {
  /**
   * Verifies that a vanishing skeleton shrinks linearly to 0 over VANISH_TIME, never below
   */
  it('shrinks to 0 while vanishing', () => {
    expect(skeletonScale({ phase: 'vanishing', t: 0 })).toBe(1);
    expect(skeletonScale({ phase: 'vanishing', t: VANISH_TIME / 2 })).toBeCloseTo(0.5, 12);
    expect(skeletonScale({ phase: 'vanishing', t: VANISH_TIME })).toBe(0);
    expect(skeletonScale({ phase: 'vanishing', t: VANISH_TIME * 3 })).toBe(0);
  });

  /**
   * Verifies that every other phase keeps full size
   */
  it.each(['free', 'rising', 'striking', 'walking', 'burrowing'] as SkeletonPhase[])('is 1 while %s', (phase) => {
    expect(skeletonScale({ phase, t: 5 })).toBe(1);
  });
});
