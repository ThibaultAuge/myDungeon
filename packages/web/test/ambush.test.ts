import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  Ambush,
  BURROW_DEPTH,
  BURROW_TIME,
  CHOP_1H_CLIP_TIME,
  CHOP_1H_IMPACT,
  CHOP_2H_CLIP_TIME,
  CHOP_2H_IMPACT,
  LIE_TIME,
  RISE_CLIP_TIME,
  RISE_RATE,
  RISE_TIME,
  SINK_DEPTH,
  SINK_TIME,
  SKELETON_COUNT,
  SKELETON_DEATH_CLIP_TIME,
  SKELETON_SPEED,
  SKELETON_WALK_CLIP_SPEED,
  STRIKE_RANGE,
  TAUNT_CLIP_TIME,
  TREE_REACH,
  TRUNK_RADIUS,
  VANISH_TIME,
  assignSkeletons,
  attackFor,
  nearestTree,
  skeletonClip,
  skeletonDepth,
  skeletonScale,
  skeletonSpawns,
  strikeAt,
  victimClip,
  victimSink,
  type SkeletonPhase,
  type VictimPhase,
} from '../src/scene/ambush.ts';
import { AMBUSH_CLIPS, CLIPS, DEATH_CLIP_TIME, HIT_CLIP_TIME, MAX_CLIP_RATE, SKELETON_LOOKS } from '../src/scene/characters.ts';
import { CLIP_FILE, type KitClip } from '../src/scene/clipCatalog.ts';
import type { Point } from '../src/scene/layout.ts';
import { killPoint } from '../src/scene/outside.ts';

/** Simulation step, in seconds. */
const DT = 0.05;
const EPS = 1e-9;

/** Every skeleton phase, in the order of an outing. */
const SKELETON_PHASES: SkeletonPhase[] = ['free', 'rising', 'taunting', 'striking', 'walking', 'vanishing', 'collapsing', 'burrowing'];
/** Every skeleton index. */
const INDEXES = Array.from({ length: SKELETON_COUNT }, (_, i) => i);

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

/** Index of the first skeleton sent for a victim (free skeletons are taken in index order). */
const firstIndex = (a: Ambush, id: string) => Math.min(...sentFor(a, id).map((s) => s.index));

/** True once every skeleton is back underground or in a tree. */
const allFree = (a: Ambush) => a.skeletons.every((s) => s.phase === 'free');

/** Expects a duration measured on the DT-stepped simulation to match `expected` within one step. */
function expectWithinStep(actual: number, expected: number, label: string) {
  expect(actual, label).toBeGreaterThanOrEqual(expected - EPS);
  expect(actual, label).toBeLessThanOrEqual(expected + DT + EPS);
}

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
/** Time spent in the first occurrence of `phase` in a log. */
const lasts = <T extends { phase: string; at: number }>(log: T[], phase: string) => {
  const i = log.findIndex((e) => e.phase === phase);
  return log[i + 1].at - log[i].at;
};

// ---------------------------------------------------------------- constants

describe('ambush constants', () => {
  /**
   * Verifies that there is one skeleton look per skeleton that can be out at once
   */
  it('has a look for every skeleton index', () => {
    expect(SKELETON_COUNT).toBeGreaterThan(0);
    expect(SKELETON_LOOKS).toHaveLength(SKELETON_COUNT);
    expect(new Ambush([]).skeletons.map((s) => s.index)).toEqual(INDEXES);
  });

  /**
   * Verifies that the rise lasts exactly the spawn clip played at RISE_RATE
   */
  it('times the rise on the spawn clip at RISE_RATE', () => {
    expect(RISE_RATE).toBeGreaterThan(0);
    expect(RISE_TIME).toBeCloseTo(RISE_CLIP_TIME / RISE_RATE, 12);
    expect(RISE_TIME * RISE_RATE).toBeCloseTo(RISE_CLIP_TIME, 12);
  });

  /**
   * Verifies that each chop's blow lands strictly inside its own clip
   */
  it('lands each chop strictly inside its clip', () => {
    expect(CHOP_1H_IMPACT).toBeGreaterThan(0);
    expect(CHOP_1H_IMPACT).toBeLessThan(CHOP_1H_CLIP_TIME);
    expect(CHOP_2H_IMPACT).toBeGreaterThan(0);
    expect(CHOP_2H_IMPACT).toBeLessThan(CHOP_2H_CLIP_TIME);
  });

  /**
   * Verifies that distances and durations are positive and the trunk radius is below the reach
   */
  it('has positive, consistent distances and times', () => {
    for (const v of [
      STRIKE_RANGE,
      LIE_TIME,
      SINK_TIME,
      SINK_DEPTH,
      SKELETON_SPEED,
      SKELETON_WALK_CLIP_SPEED,
      TREE_REACH,
      TRUNK_RADIUS,
      VANISH_TIME,
      BURROW_TIME,
      BURROW_DEPTH,
      RISE_CLIP_TIME,
      TAUNT_CLIP_TIME,
      SKELETON_DEATH_CLIP_TIME,
    ]) {
      expect(v).toBeGreaterThan(0);
    }
    expect(TRUNK_RADIUS).toBeLessThan(TREE_REACH);
  });
});

// ---------------------------------------------------------------- measured clips

/** The `animations` pack, as served to the browser. */
const ANIMATIONS = fileURLToPath(new URL('../public/kaykit/animations/', import.meta.url));

interface AnimJson {
  animations?: { name?: string; samplers: { input: number }[] }[];
  accessors?: { max?: number[] }[];
}
const animJsonCache = new Map<string, AnimJson>();

/** The JSON chunk of an animations GLB: bytes 12..16 hold its length, it starts at byte 20. */
function animJson(file: string): AnimJson {
  let json = animJsonCache.get(file);
  if (!json) {
    const buf = fs.readFileSync(path.join(ANIMATIONS, `${file}.glb`));
    const length = buf.readUInt32LE(12);
    json = JSON.parse(buf.toString('utf8', 20, 20 + length)) as AnimJson;
    animJsonCache.set(file, json);
  }
  return json;
}

/** Length of a clip in its GLB file: the latest keyframe time over all its samplers. */
function clipLength(clip: KitClip): number {
  const json = animJson(CLIP_FILE[clip]);
  const anim = json.animations?.find((a) => a.name === clip);
  if (!anim) throw new Error(`${clip} not found in ${CLIP_FILE[clip]}.glb`);
  return Math.max(...anim.samplers.map((s) => json.accessors![s.input].max![0]));
}

describe('ambush clip lengths measured from the GLB files', () => {
  /**
   * Verifies that each measured clip length constant matches its animation in the GLB file
   */
  it.each([
    ['Skeletons_Spawn_Ground', RISE_CLIP_TIME],
    ['Skeletons_Taunt', TAUNT_CLIP_TIME],
    ['Melee_1H_Attack_Chop', CHOP_1H_CLIP_TIME],
    ['Melee_2H_Attack_Chop', CHOP_2H_CLIP_TIME],
    ['Skeletons_Death', SKELETON_DEATH_CLIP_TIME],
  ] as [KitClip, number][])('measures %s at %d s', (clip, constant) => {
    expect(clipLength(clip)).toBeCloseTo(constant, 3);
  });

  /**
   * Verifies that both chops' impacts fall strictly inside the clip length found in the GLB
   */
  it.each([
    ['Melee_1H_Attack_Chop', CHOP_1H_IMPACT],
    ['Melee_2H_Attack_Chop', CHOP_2H_IMPACT],
  ] as [KitClip, number][])('lands the %s blow inside the measured clip', (clip, impact) => {
    expect(impact).toBeGreaterThan(0);
    expect(impact).toBeLessThan(clipLength(clip));
  });

  /**
   * Verifies that each skeleton's attack impact lies inside the GLB length of the clip it plays
   */
  it.each(INDEXES)('lands skeleton %i blow inside its attack clip', (index) => {
    const { clip, impact } = attackFor(index);
    expect(impact).toBeGreaterThan(0);
    expect(impact).toBeLessThan(clipLength(clip));
  });
});

// ---------------------------------------------------------------- attackFor and strikeAt

describe('attackFor', () => {
  /**
   * Verifies that the blade skeletons (indexes 0 and 2) chop with one hand
   */
  it.each([0, 2])('gives blade skeleton %i the one-handed chop', (index) => {
    expect(SKELETON_LOOKS[index].right?.model).toBe('Skeleton_Blade');
    expect(attackFor(index)).toEqual({ clip: 'Melee_1H_Attack_Chop', impact: CHOP_1H_IMPACT });
  });

  /**
   * Verifies that the axe skeleton (index 1) chops with both hands
   */
  it('gives the axe skeleton the two-handed chop', () => {
    expect(SKELETON_LOOKS[1].right?.model).toBe('Skeleton_Axe');
    expect(attackFor(1)).toEqual({ clip: 'Melee_2H_Attack_Chop', impact: CHOP_2H_IMPACT });
  });

  /**
   * Verifies that the two-handed chop is chosen exactly for the skeletons holding the axe
   */
  it('matches the attack to every skeleton weapon', () => {
    for (const index of INDEXES) {
      const axe = SKELETON_LOOKS[index].right?.model === 'Skeleton_Axe';
      expect(attackFor(index).clip, `skeleton ${index}`).toBe(axe ? 'Melee_2H_Attack_Chop' : 'Melee_1H_Attack_Chop');
    }
  });

  /**
   * Verifies that an index without a look falls back to the one-handed chop
   */
  it.each([-1, SKELETON_COUNT, 99])('falls back to the one-handed chop for unknown index %i', (index) => {
    expect(attackFor(index)).toEqual({ clip: 'Melee_1H_Attack_Chop', impact: CHOP_1H_IMPACT });
  });

  /**
   * Verifies that every attack clip is a known clip of the ambush theme
   */
  it('only uses ambush clips', () => {
    for (const index of INDEXES) {
      expect(CLIPS).toContain(attackFor(index).clip);
      expect(AMBUSH_CLIPS as readonly string[]).toContain(attackFor(index).clip);
    }
  });
});

describe('strikeAt', () => {
  /**
   * Verifies that the first blow lands after the rise, the taunt and the weapon's impact time
   */
  it.each(INDEXES)('adds rise, taunt and impact for skeleton %i', (index) => {
    expect(strikeAt(index)).toBeCloseTo(RISE_TIME + TAUNT_CLIP_TIME + attackFor(index).impact, 12);
  });

  /**
   * Verifies that the axe skeleton lands its first blow later than a blade skeleton
   */
  it('lands the axe blow later than the blade blow', () => {
    expect(strikeAt(1) - strikeAt(0)).toBeCloseTo(CHOP_2H_IMPACT - CHOP_1H_IMPACT, 12);
    expect(strikeAt(0)).toBe(strikeAt(2));
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
   * Verifies that a new victim starts walking, at time 0, with no blow scheduled yet
   */
  it('starts a new victim walking', () => {
    const a = new Ambush([]);
    a.add('a');
    expect(a.victim('a')).toMatchObject({ id: 'a', phase: 'walking', t: 0, slot: 0, strikeAt: 0 });
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
   * Verifies that a lone victim's blow is timed on its first skeleton, the blade at index 0
   */
  it('schedules the blow of skeleton 0 for a lone victim', () => {
    const a = new Ambush([]);
    a.add('v');
    a.arrived('v');
    a.step(DT);
    expect(firstIndex(a, 'v')).toBe(0);
    expect(a.victim('v')!.strikeAt).toBe(strikeAt(0));
  });

  /**
   * Verifies that each victim phase lasts its documented time (within one step)
   */
  it('times each victim phase on the clips and constants', () => {
    const a = new Ambush([]);
    a.add('v');
    a.arrived('v');
    const log = record(a, ['v']).victims.get('v')!;
    const expected: [VictimPhase, number][] = [
      ['struck', strikeAt(0)],
      ['hit', HIT_CLIP_TIME],
      ['dying', DEATH_CLIP_TIME],
      ['lying', LIE_TIME],
      ['sinking', SINK_TIME],
    ];
    for (const [phase, time] of expected) expectWithinStep(lasts(log, phase), time, phase);
  });

  /**
   * Verifies that a lone victim gets every skeleton, which rise, taunt, strike, collapse and burrow
   */
  it('sends all skeletons, which collapse and burrow back when no tree is near', () => {
    const a = new Ambush([]);
    a.add('v');
    a.arrived('v');
    const { skeletons } = record(a, ['v']);
    for (const log of skeletons) {
      expect(phases(log)).toEqual(['free', 'rising', 'taunting', 'striking', 'collapsing', 'burrowing', 'free']);
      expect(log[1].victim).toBe('v');
      expect(log[log.length - 1].victim).toBe('');
    }
  });

  /**
   * Verifies that each skeleton phase lasts its clip or constant time (within one step)
   */
  it('times rising, taunting, collapsing and burrowing on the clips', () => {
    const a = new Ambush([]);
    a.add('v');
    a.arrived('v');
    const { skeletons } = record(a, ['v']);
    for (const log of skeletons) {
      expectWithinStep(lasts(log, 'rising'), RISE_TIME, 'rising');
      expectWithinStep(lasts(log, 'taunting'), TAUNT_CLIP_TIME, 'taunting');
      expectWithinStep(lasts(log, 'collapsing'), SKELETON_DEATH_CLIP_TIME, 'collapsing');
      expectWithinStep(lasts(log, 'burrowing'), BURROW_TIME, 'burrowing');
    }
  });

  /**
   * Verifies that the hit lands strikeAt after the struck start, during the first skeleton's chop
   */
  it('syncs the hit with the first skeleton chop', () => {
    const a = new Ambush([]);
    a.add('v');
    a.arrived('v');
    const { victims, skeletons } = record(a, ['v']);
    const v = victims.get('v')!;
    for (const log of skeletons) expect(startOf(log, 'rising')).toBeCloseTo(startOf(v, 'struck'), 9);
    expectWithinStep(startOf(v, 'hit') - startOf(v, 'struck'), strikeAt(0), 'struck → hit');
    // The first skeleton is already chopping when the blow lands, near its impact time.
    const first = skeletons[0];
    const intoChop = startOf(v, 'hit') - startOf(first, 'striking');
    expect(intoChop).toBeGreaterThan(0);
    expect(intoChop).toBeLessThan(CHOP_1H_CLIP_TIME);
    expect(Math.abs(intoChop - CHOP_1H_IMPACT)).toBeLessThanOrEqual(2 * DT + EPS);
  });

  /**
   * Verifies that the skeletons start collapsing in the same step the body starts lying still
   */
  it('makes the skeletons collapse when the body lies still', () => {
    const a = new Ambush([]);
    a.add('v');
    a.arrived('v');
    const { victims, skeletons } = record(a, ['v']);
    const v = victims.get('v')!;
    for (const log of skeletons) {
      expect(startOf(log, 'collapsing')).toBeCloseTo(startOf(v, 'lying'), 9);
      expect(startOf(log, 'burrowing')).toBeGreaterThan(startOf(log, 'collapsing'));
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

describe('Ambush: blow timed on the first skeleton weapon', () => {
  /**
   * Builds an ambush where 'blade' arrives first and takes skeleton 0, so 'axe' gets
   * skeletons 1 and 2 and its first one (spawns[0]) is the axe skeleton.
   */
  function ambushWithAxeFirst() {
    const a = new Ambush([]);
    a.add('blade');
    a.add('axe');
    a.arrived('blade');
    a.arrived('axe');
    a.step(DT);
    return a;
  }

  /**
   * Verifies that a victim whose first skeleton holds the axe gets the two-handed strikeAt
   */
  it('gives the axe strikeAt to a victim first served by the axe skeleton', () => {
    const a = ambushWithAxeFirst();
    expect(sentFor(a, 'blade').map((s) => s.index)).toEqual([0]);
    expect(sentFor(a, 'axe').map((s) => s.index)).toEqual([1, 2]);
    expect(a.victim('blade')!.strikeAt).toBe(strikeAt(0));
    expect(a.victim('axe')!.strikeAt).toBe(strikeAt(1));
    expect(a.victim('axe')!.strikeAt).toBeGreaterThan(a.victim('blade')!.strikeAt);
  });

  /**
   * Verifies that the axe victim faces the axe skeleton, the one at its first spawn point
   */
  it('faces the axe victim towards the axe skeleton', () => {
    const a = ambushWithAxeFirst();
    const v = a.victim('axe')!;
    const axe = a.skeletons[1];
    expect(axe.pos).toEqual(skeletonSpawns(v.point, 2, 'axe')[0]);
    expect(v.facing).toBeCloseTo(Math.atan2(axe.pos.x - v.point.x, axe.pos.z - v.point.z), 12);
  });

  /**
   * Verifies that the axe victim stays struck for the two-handed strikeAt (within one step)
   */
  it('lands the axe blow strikeAt(1) after the struck start', () => {
    const a = ambushWithAxeFirst();
    const { victims, problems } = record(a, ['blade', 'axe']);
    expect(problems).toEqual([]);
    // record starts after the sending step: struck is the first phase seen.
    expectWithinStep(lasts(victims.get('axe')!, 'struck'), strikeAt(1), 'axe struck');
    expectWithinStep(lasts(victims.get('blade')!, 'struck'), strikeAt(0), 'blade struck');
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
  it('walks to the tree when it has one, collapses and burrows otherwise', () => {
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
          expect(phases(l)).toEqual(['rising', 'taunting', 'striking', 'walking', 'vanishing', 'free']);
        } else {
          burrowers++;
          expect(phases(l)).toEqual(['rising', 'taunting', 'striking', 'collapsing', 'burrowing', 'free']);
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
    expect(a.victim('second')!.strikeAt).toBe(strikeAt(firstIndex(a, 'second')));
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
    // Each served victim's blow is timed on its own skeleton's weapon.
    expect(['a', 'b', 'c'].map((id) => a.victim(id)!.strikeAt)).toEqual([strikeAt(0), strikeAt(1), strikeAt(2)]);
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
   * Verifies that releasing a victim mid-strike makes its skeletons collapse on the next step
   */
  it('makes striking skeletons collapse when their victim is released', () => {
    const a = new Ambush([]);
    a.add('v');
    a.arrived('v');
    runUntil(a, () => a.skeletons.every((s) => s.phase === 'striking'));
    expect(a.victim('v')!.phase).toBe('struck');
    a.release('v');
    a.step(DT);
    expect(a.skeletons.map((s) => s.phase)).toEqual(Array(SKELETON_COUNT).fill('collapsing'));
    runUntil(a, () => a.skeletons.every((s) => s.phase === 'burrowing'));
    runUntil(a, () => allFree(a));
    expect(a.skeletons.every((s) => s.victim === '')).toBe(true);
  });

  /**
   * Verifies that skeletons rising for a released victim still rise and taunt, then collapse
   */
  it('lets rising skeletons finish rising and taunting before leaving', () => {
    const a = new Ambush([]);
    a.add('v');
    a.arrived('v');
    a.step(DT);
    a.release('v');
    a.step(DT);
    expect(a.skeletons.every((s) => s.phase === 'rising')).toBe(true);
    runUntil(a, () => a.skeletons.every((s) => s.phase !== 'rising'));
    expect(a.skeletons.every((s) => s.phase === 'taunting')).toBe(true);
    runUntil(a, () => a.skeletons.every((s) => s.phase !== 'taunting'));
    // Leaving is only decided while striking: one step there, then away.
    expect(a.skeletons.every((s) => s.phase === 'striking')).toBe(true);
    a.step(DT);
    expect(a.skeletons.every((s) => s.phase === 'collapsing')).toBe(true);
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
    expect(a.victim('z')!.strikeAt).toBe(strikeAt(0));
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
   * Verifies that a rising skeleton plays Skeletons_Spawn_Ground once at RISE_RATE
   */
  it.each(INDEXES)('plays Skeletons_Spawn_Ground once at RISE_RATE while rising (skeleton %i)', (index) => {
    expect(skeletonClip({ phase: 'rising', index })).toEqual({
      name: 'Skeletons_Spawn_Ground',
      loop: false,
      timeScale: RISE_RATE,
      frozen: false,
      frozenAt: 0,
    });
  });

  /**
   * Verifies that a taunting skeleton plays Skeletons_Taunt once at normal speed
   */
  it('plays Skeletons_Taunt once while taunting', () => {
    expect(skeletonClip({ phase: 'taunting', index: 0 })).toEqual({ name: 'Skeletons_Taunt', loop: false, timeScale: 1, frozen: false, frozenAt: 0 });
  });

  /**
   * Verifies that a striking skeleton loops the chop of its own weapon
   */
  it.each([
    [0, 'Melee_1H_Attack_Chop'],
    [1, 'Melee_2H_Attack_Chop'],
    [2, 'Melee_1H_Attack_Chop'],
  ])('loops the weapon chop while striking (skeleton %i → %s)', (index, name) => {
    expect(skeletonClip({ phase: 'striking', index })).toEqual({ name, loop: true, timeScale: 1, frozen: false, frozenAt: 0 });
    expect(skeletonClip({ phase: 'striking', index }).name).toBe(attackFor(index).clip);
  });

  /**
   * Verifies that a walking skeleton loops Skeletons_Walking at its speed, capped at MAX_CLIP_RATE
   */
  it('loops Skeletons_Walking at the capped rate while walking', () => {
    const c = skeletonClip({ phase: 'walking', index: 0 });
    expect(c.name).toBe('Skeletons_Walking');
    expect(c.loop).toBe(true);
    expect(c.frozen).toBe(false);
    expect(c.timeScale).toBeCloseTo(Math.min(SKELETON_SPEED / SKELETON_WALK_CLIP_SPEED, MAX_CLIP_RATE), 12);
    expect(c.timeScale).toBeGreaterThan(0);
    expect(c.timeScale).toBeLessThanOrEqual(MAX_CLIP_RATE);
  });

  /**
   * Verifies that a collapsing skeleton plays Skeletons_Death once at normal speed
   */
  it('plays Skeletons_Death once while collapsing', () => {
    expect(skeletonClip({ phase: 'collapsing', index: 1 })).toEqual({ name: 'Skeletons_Death', loop: false, timeScale: 1, frozen: false, frozenAt: 0 });
  });

  /**
   * Verifies that a burrowing skeleton holds the last pose of Skeletons_Death (the bone pile)
   */
  it('holds Skeletons_Death at its end while burrowing', () => {
    expect(skeletonClip({ phase: 'burrowing', index: 2 })).toEqual({
      name: 'Skeletons_Death',
      loop: false,
      timeScale: 0,
      frozen: true,
      frozenAt: SKELETON_DEATH_CLIP_TIME,
    });
  });

  /**
   * Verifies that free and vanishing skeletons hold a still idle pose
   */
  it.each(['free', 'vanishing'] as SkeletonPhase[])('holds Idle_A while %s', (phase) => {
    expect(skeletonClip({ phase, index: 0 })).toEqual({ name: 'Idle_A', loop: false, timeScale: 0, frozen: true, frozenAt: 0 });
  });

  /**
   * Verifies that every skeleton clip, for every phase and weapon, is one of the known CLIPS
   */
  it('only uses known clips', () => {
    for (const phase of SKELETON_PHASES) {
      for (const index of INDEXES) expect(CLIPS, `${phase} / ${index}`).toContain(skeletonClip({ phase, index }).name);
    }
  });

  /**
   * Verifies that every skeleton clip other than the idle hold belongs to the ambush theme
   */
  it('takes every animated skeleton clip from AMBUSH_CLIPS', () => {
    for (const phase of SKELETON_PHASES) {
      for (const index of INDEXES) {
        const { name } = skeletonClip({ phase, index });
        if (name !== 'Idle_A') expect(AMBUSH_CLIPS as readonly string[], `${phase} / ${index}`).toContain(name);
      }
    }
  });
});

describe('skeletonDepth', () => {
  /**
   * Verifies that only a burrowing skeleton sinks, linearly over BURROW_TIME, capped
   */
  it('sinks only while burrowing, down to BURROW_DEPTH', () => {
    expect(skeletonDepth({ phase: 'burrowing', t: 0 })).toBe(0);
    expect(skeletonDepth({ phase: 'burrowing', t: BURROW_TIME / 2 })).toBeCloseTo(BURROW_DEPTH / 2, 12);
    expect(skeletonDepth({ phase: 'burrowing', t: BURROW_TIME })).toBeCloseTo(BURROW_DEPTH, 12);
    expect(skeletonDepth({ phase: 'burrowing', t: BURROW_TIME * 4 })).toBe(BURROW_DEPTH);
  });

  /**
   * Verifies that every other phase, collapsing included, stays on the ground
   */
  it.each(['free', 'rising', 'taunting', 'striking', 'walking', 'vanishing', 'collapsing'] as SkeletonPhase[])('is 0 while %s', (phase) => {
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
  it.each(['free', 'rising', 'taunting', 'striking', 'walking', 'collapsing', 'burrowing'] as SkeletonPhase[])('is 1 while %s', (phase) => {
    expect(skeletonScale({ phase, t: 5 })).toBe(1);
  });
});
