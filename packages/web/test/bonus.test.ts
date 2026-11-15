import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentView } from '@agent-office/shared';
import {
  ANIM_FILES_USED,
  BONUS_CLIPS,
  CLIPS,
  KNEEL_POSE_TIME,
  MAX_CLIP_RATE,
  PACE_CLIP_RATE,
  SIT_CLIP,
  SIT_POSE_TIME,
  SLEEP_CLIP,
  SPAWN_TIME_SCALE,
  WALK_CLIP_SPEED,
  clipFor,
  hold,
  lookFor,
  play,
  type ClipInput,
} from '../src/scene/characters.ts';
import { CLIP_FILE, type KitClip } from '../src/scene/clipCatalog.ts';
import { CHEER_CLIP_TIME, startsCheer } from '../src/scene/cheer.ts';
import {
  DODGE_CLIPS,
  DODGE_CLIP_TIME,
  DODGE_EVERY,
  DODGE_STREAK_MS,
  NO_STREAK,
  dodgeClipFor,
  nextSlapStreak,
  type SlapStreak,
} from '../src/scene/dodge.ts';
import {
  FISHING_AFTER_MS,
  FISHING_BITE_TIME,
  FISHING_CAST_TIME,
  FISHING_CATCH_TIME,
  FISHING_IDLE_MIN_S,
  FISHING_LANE_Z,
  FISHING_OBSTACLES,
  FISHING_REEL_S,
  FISHING_SPACE,
  FISHING_Z,
  MAX_FISHERS,
  assignFishingRanks,
  clearForcedFishing,
  fishingClip,
  fishingExitLead,
  fishingForceVersion,
  fishingIdle,
  fishingReroute,
  fishingSeed,
  fishingSpot,
  fishingX,
  forceFishing,
  installFishingCommand,
  isFishingForced,
  onFishingForce,
  wantsToFish,
} from '../src/scene/fishing.ts';
import { MOAT, PENNANTS, PENNANT_CLEARANCE } from '../src/scene/forest.ts';
import { BOUNDS, GATE, SPAWN, routeBetween, type Point } from '../src/scene/layout.ts';
import { GATE_SPOT, PATH, nearestPathIndex } from '../src/scene/outside.ts';
import { SNEAK_BODIES, SNEAK_CLIP_SPEED, SNEAK_SPEED, sneaks } from '../src/scene/sneak.ts';

// ================================================================ dodge.ts

describe('dodge constants', () => {
  /** Verifies the user's streak rule: slaps under 2 s apart, the third one dodged */
  it('pins the streak window and the dodged slap', () => {
    expect(DODGE_STREAK_MS).toBe(2000);
    expect(DODGE_EVERY).toBe(3);
    expect(DODGE_CLIP_TIME).toBe(0.4);
    expect([...DODGE_CLIPS]).toEqual(['Dodge_Backward', 'Dodge_Left', 'Dodge_Right']);
  });

  /** Verifies the empty streak is frozen, empty, and older than any slap */
  it('starts from a frozen empty streak', () => {
    expect(Object.isFrozen(NO_STREAK)).toBe(true);
    expect(NO_STREAK.count).toBe(0);
    expect(NO_STREAK.at).toBe(-Infinity);
  });
});

describe('nextSlapStreak', () => {
  const T0 = 1_700_000_000_000;

  /** Verifies the first slap of a figure starts a streak at 1 and is not dodged */
  it('counts the first slap as one, not dodged', () => {
    expect(nextSlapStreak(NO_STREAK, T0)).toEqual({ count: 1, at: T0, dodge: false });
  });

  /** Verifies the third slap of a quick streak is dodged and the count resets to zero */
  it('dodges the third quick slap and resets the count', () => {
    let s: SlapStreak = NO_STREAK;
    const first = nextSlapStreak(s, T0);
    s = first;
    const second = nextSlapStreak(s, T0 + 1000);
    s = second;
    const third = nextSlapStreak(s, T0 + 2000);
    expect([first.dodge, second.dodge, third.dodge]).toEqual([false, false, true]);
    expect(second.count).toBe(2);
    expect(third.count).toBe(0);
    expect(third.at).toBe(T0 + 2000);
  });

  /** Verifies a sustained quick slapping dodges every third slap (3rd, 6th, 9th…) */
  it('dodges every third slap of a long quick streak', () => {
    let s: SlapStreak = NO_STREAK;
    const dodged: number[] = [];
    for (let i = 1; i <= 9; i++) {
      const next = nextSlapStreak(s, T0 + i * 500);
      if (next.dodge) dodged.push(i);
      s = next;
    }
    expect(dodged).toEqual([3, 6, 9]);
  });

  /** Verifies a slap exactly 2000 ms after the previous one starts a new streak */
  it('starts a new streak at exactly the window length', () => {
    const prev = { count: 2, at: T0 };
    expect(nextSlapStreak(prev, T0 + DODGE_STREAK_MS)).toEqual({ count: 1, at: T0 + DODGE_STREAK_MS, dodge: false });
  });

  /** Verifies a slap one millisecond inside the window extends the streak */
  it('extends the streak one millisecond inside the window', () => {
    const prev = { count: 1, at: T0 };
    expect(nextSlapStreak(prev, T0 + DODGE_STREAK_MS - 1)).toEqual({ count: 2, at: T0 + DODGE_STREAK_MS - 1, dodge: false });
    expect(nextSlapStreak({ count: 2, at: T0 }, T0 + DODGE_STREAK_MS - 1).dodge).toBe(true);
  });

  /** Verifies two slaps in the same millisecond belong to the same streak */
  it('extends the streak for a zero gap', () => {
    expect(nextSlapStreak({ count: 1, at: T0 }, T0).count).toBe(2);
  });

  /** Verifies a clock going backwards starts a new streak instead of extending it */
  it('restarts the streak when the clock goes backwards', () => {
    expect(nextSlapStreak({ count: 2, at: T0 }, T0 - 1)).toEqual({ count: 1, at: T0 - 1, dodge: false });
  });

  /** Verifies a broken (NaN) timestamp starts a new streak and never dodges */
  it('restarts the streak for a NaN time', () => {
    const next = nextSlapStreak({ count: 2, at: T0 }, Number.NaN);
    expect(next.count).toBe(1);
    expect(next.dodge).toBe(false);
  });

  /** Verifies the previous streak is never mutated */
  it('does not mutate the previous streak', () => {
    const prev = { count: 1, at: T0 };
    nextSlapStreak(prev, T0 + 10);
    expect(prev).toEqual({ count: 1, at: T0 });
    expect(() => nextSlapStreak(NO_STREAK, T0)).not.toThrow();
  });
});

describe('dodgeClipFor', () => {
  /** Verifies the dodges play in turn: backward, left, right, then cycle */
  it.each([
    [1, 'Dodge_Backward'],
    [2, 'Dodge_Left'],
    [3, 'Dodge_Right'],
    [4, 'Dodge_Backward'],
    [5, 'Dodge_Left'],
    [6, 'Dodge_Right'],
    [301, 'Dodge_Backward'],
  ] as const)('gives dodge %i the clip %s', (n, clip) => {
    expect(dodgeClipFor(n)).toBe(clip);
  });

  /** Verifies non-finite counts fall back to the first dodge instead of undefined */
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('falls back to Dodge_Backward for %s', (n) => {
    expect(dodgeClipFor(n)).toBe('Dodge_Backward');
  });

  /** Verifies odd counts (zero, negative, fractional, huge) still give a dodge clip */
  it.each([0, -1, -7, 2.7, 1e12])('always returns a dodge clip for %s', (n) => {
    expect(DODGE_CLIPS).toContain(dodgeClipFor(n));
  });

  /** Verifies a fractional count is truncated */
  it('truncates a fractional count', () => {
    expect(dodgeClipFor(2.7)).toBe('Dodge_Left');
  });
});

// ================================================================ cheer.ts

describe('startsCheer', () => {
  /** Verifies a subagent that turns done from working or waiting cheers */
  it.each(['working', 'waiting'] as const)('cheers a subagent going from %s to done', (prev) => {
    expect(startsCheer('sub', prev, 'done')).toBe(true);
  });

  /** Verifies the main agent never cheers when its session closes */
  it.each(['working', 'waiting'] as const)('never cheers the main agent going from %s to done', (prev) => {
    expect(startsCheer('main', prev, 'done')).toBe(false);
  });

  /** Verifies a figure mounted already done, or staying done, does not cheer */
  it('does not cheer without a real transition to done', () => {
    expect(startsCheer('sub', null, 'done')).toBe(false);
    expect(startsCheer('sub', 'done', 'done')).toBe(false);
  });

  /** Verifies a transition to any state other than done does not cheer */
  it.each([
    ['working', 'waiting'],
    ['waiting', 'working'],
    ['done', 'working'],
  ] as const)('does not cheer going from %s to %s', (prev, next) => {
    expect(startsCheer('sub', prev, next)).toBe(false);
  });

  /** Verifies the cheer length constant is five thirds of a second */
  it('pins the cheer length', () => {
    expect(CHEER_CLIP_TIME).toBeCloseTo(5 / 3, 10);
  });
});

// ================================================================ sneak.ts

describe('sneaks', () => {
  /** Verifies the two Rogue bodies sneak when a subagent is done */
  it.each(['Rogue', 'Rogue_Hooded'] as const)('makes a finished %s subagent sneak', (body) => {
    expect(sneaks('sub', 'done', body)).toBe(true);
  });

  /** Verifies other bodies, including the skeleton, never sneak */
  it.each(['Knight', 'Barbarian', 'Mage', 'Ranger', 'Skeleton_Minion'] as const)('never makes %s sneak', (body) => {
    expect(sneaks('sub', 'done', body)).toBe(false);
  });

  /** Verifies only a finished subagent sneaks, not a working or waiting one */
  it.each(['working', 'waiting'] as const)('does not sneak while %s', (state) => {
    expect(sneaks('sub', state, 'Rogue')).toBe(false);
  });

  /** Verifies the main agent never sneaks, whatever its body */
  it('never makes the main agent sneak', () => {
    expect(sneaks('main', 'done', 'Rogue')).toBe(false);
  });

  /** Verifies the Rogue-looking subagent types sneak through their look's body */
  it('makes the Rogue-looking types sneak and the others walk', () => {
    expect(sneaks('sub', 'done', lookFor('sub', 'dexter').body)).toBe(true);
    expect(sneaks('sub', 'done', lookFor('sub', 'otis').body)).toBe(true);
    expect(sneaks('sub', 'done', lookFor('sub', 'hermione').body)).toBe(false);
  });

  /** Verifies the sneaking bodies list is frozen and the speeds are pinned */
  it('pins the sneak bodies and speeds', () => {
    expect(Object.isFrozen(SNEAK_BODIES)).toBe(true);
    expect([...SNEAK_BODIES]).toEqual(['Rogue', 'Rogue_Hooded']);
    expect(SNEAK_SPEED).toBe(1.5);
    expect(SNEAK_CLIP_SPEED).toBe(0.29);
    // Documented: Sneaking's cycle is twice Walking_A's for a similar stride.
    expect(Math.abs(SNEAK_CLIP_SPEED - WALK_CLIP_SPEED / 2)).toBeLessThan(0.01);
  });
});

// ================================================================ fishing.ts

const NOW = 1_700_000_000_000;
type Fisher = Pick<AgentView, 'kind' | 'state' | 'waitReason' | 'room' | 'since'>;
const fisher = (waited: number, patch: Partial<Fisher> = {}): Fisher => ({
  kind: 'main',
  state: 'waiting',
  waitReason: 'prompt',
  room: 'taverne',
  since: NOW - waited,
  ...patch,
});

describe('wantsToFish', () => {
  /** Verifies the three-minute threshold, exact to the millisecond */
  it('fishes from exactly three minutes of wait', () => {
    expect(FISHING_AFTER_MS).toBe(180_000);
    expect(wantsToFish(fisher(FISHING_AFTER_MS - 1), true, NOW)).toBe(false);
    expect(wantsToFish(fisher(FISHING_AFTER_MS), true, NOW)).toBe(true);
    expect(wantsToFish(fisher(24 * 3_600_000), true, NOW)).toBe(true);
  });

  /** Verifies an agent of a session that is not live never fishes */
  it('does not fish for a session that is not live', () => {
    expect(wantsToFish(fisher(FISHING_AFTER_MS), false, NOW)).toBe(false);
  });

  /** Verifies only the main agent waiting for a prompt in the tavern fishes */
  it.each([
    ['a subagent', { kind: 'sub' as const }],
    ['a working agent', { state: 'working' as const }],
    ['a finished agent', { state: 'done' as const }],
    ['a permission wait', { waitReason: 'permission' as const }],
    ['a question wait', { waitReason: 'question' as const }],
    ['an error wait', { waitReason: 'error' as const }],
    ['no wait reason', { waitReason: undefined }],
    ['an agent at the altar', { room: 'autel' as const }],
  ])('does not fish for %s', (_, patch) => {
    expect(wantsToFish(fisher(FISHING_AFTER_MS * 10, patch), true, NOW)).toBe(false);
  });

  /** Verifies a client clock behind the server's counts as no wait */
  it('does not fish for a negative wait', () => {
    expect(wantsToFish(fisher(-5_000), true, NOW)).toBe(false);
  });

  /** Verifies a broken timestamp never sends the agent fishing */
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('does not fish for a since of %s', (since) => {
    expect(wantsToFish(fisher(0, { since }), true, NOW)).toBe(false);
  });
});

describe('fishing places', () => {
  const BRIDGE_X = (GATE.lo + GATE.hi) / 2;

  /** Verifies even ranks sit east of the drawbridge and odd ranks west, 1.5 m apart */
  it.each([
    [0, BRIDGE_X + 3.2],
    [1, BRIDGE_X - 3.2],
    [2, BRIDGE_X + 4.7],
    [3, BRIDGE_X - 4.7],
    [10, BRIDGE_X + 3.2 + 7.5],
    [11, BRIDGE_X - 3.2 - 7.5],
  ])('places rank %i at x = %f', (rank, x) => {
    expect(fishingX(rank)).toBeCloseTo(x, 9);
  });

  /** Verifies a rank always gives the very same frozen place */
  it('returns the same frozen spot for a rank', () => {
    const a = fishingSpot(4);
    expect(fishingSpot(4)).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.entry)).toBe(true);
    for (const p of a.entry) expect(Object.isFrozen(p)).toBe(true);
    expect(fishingSpot(5)).not.toBe(a);
  });

  /** Verifies the spot's identity, space, facing, anchor and room */
  it.each([0, 1, 7, MAX_FISHERS - 1])('describes fishing place %i', (rank) => {
    const s = fishingSpot(rank);
    expect(s.id).toBe(`moat:${rank}`);
    expect(s.space).toBe(FISHING_SPACE);
    expect(FISHING_SPACE).toBe('moat');
    expect(s.facing).toBe(Math.PI);
    expect(s.anchor).toEqual(GATE_SPOT.anchor);
    expect(s.room).toBe('taverne');
    expect(s.x).toBeCloseTo(fishingX(rank), 9);
    expect(s.z).toBe(FISHING_Z);
  });

  /** Verifies the way in goes through the gate, over the bridge, then along the lane */
  it('walks out through the gate, over the bridge and along the lane', () => {
    const s = fishingSpot(2);
    expect(s.entry).toHaveLength(4);
    const [gate, bank, lane, place] = s.entry;
    expect(gate).toEqual({ x: BRIDGE_X, z: BOUNDS.z1 + 0.2 });
    expect(bank.x).toBe(BRIDGE_X);
    // Past the moat, on the far bank.
    expect(bank.z).toBeGreaterThan(MOAT.z1);
    expect(lane).toEqual({ x: BRIDGE_X, z: FISHING_LANE_Z });
    expect(place.x).toBeCloseTo(s.x, 9);
    expect(place.z).toBe(FISHING_LANE_Z);
    // The lane runs south of the place, which is closer to the water.
    expect(FISHING_LANE_Z).toBeGreaterThan(FISHING_Z);
  });

  /** Verifies the obstacles kept clear of are the pennant poles */
  it('uses the pennants as obstacles', () => {
    expect(FISHING_OBSTACLES).toBe(PENNANTS);
    expect(PENNANTS.length).toBeGreaterThan(0);
  });
});

describe('fishing geometry', () => {
  /** Distance from point p to segment ab. */
  function distanceToSegment(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
    return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
  }

  const ranks = Array.from({ length: MAX_FISHERS }, (_, i) => i);

  /** Verifies every place and every leg of its way in keeps clear of the pennant poles */
  it.each(ranks)('keeps fishing place %i and its way in clear of the pennants', (rank) => {
    const s = fishingSpot(rank);
    const seat = { x: s.x, z: s.z };
    const route: Point[] = [s.anchor, ...s.entry, seat];
    for (const pole of PENNANTS) {
      expect(Math.hypot(seat.x - pole.x, seat.z - pole.z), `seat vs pole ${pole.x}`).toBeGreaterThanOrEqual(PENNANT_CLEARANCE);
      for (let i = 0; i + 1 < route.length; i++) {
        const d = distanceToSegment(pole, route[i], route[i + 1]);
        expect(d, `leg ${i} of rank ${rank} vs pole (${pole.x}, ${pole.z})`).toBeGreaterThanOrEqual(PENNANT_CLEARANCE);
      }
    }
  });

  /** Verifies every place stands on the south bank, out of the water and within the moat's span */
  it.each(ranks)('puts fishing place %i on the south bank', (rank) => {
    const s = fishingSpot(rank);
    expect(s.z).toBeGreaterThan(MOAT.z1);
    expect(s.x).toBeGreaterThan(MOAT.x0);
    expect(s.x).toBeLessThan(MOAT.x1);
  });

  /** Verifies distinct ranks get distinct places at least 1.5 m apart */
  it('gives every rank its own x, 1.5 m apart at least', () => {
    const xs = ranks.map(fishingX).sort((a, b) => a - b);
    expect(new Set(xs).size).toBe(MAX_FISHERS);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(1.5 - 1e-9);
  });
});

describe('fishingReroute', () => {
  /** Distance from point p to segment ab. */
  function distanceToSegment(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
    return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
  }
  const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.z - b.z) < 1e-3;
  const seatOf = (s: { x: number; z: number }): Point => ({ x: s.x, z: s.z });
  const ranks = Array.from({ length: MAX_FISHERS }, (_, i) => i);
  const to = SPAWN;

  /** Verifies a `from` that is not a fishing place gives null, so `reroute` applies */
  it('returns null when from is not a fishing place', () => {
    expect(SPAWN.space).not.toBe(FISHING_SPACE);
    expect(fishingReroute([], SPAWN, GATE_SPOT)).toBeNull();
    expect(fishingReroute([seatOf(GATE_SPOT)], GATE_SPOT, SPAWN)).toBeNull();
    const notMoat = { ...fishingSpot(0), space: 'gate' };
    expect(fishingReroute([], notMoat, to)).toBeNull();
  });

  /** Verifies a figure still inside the castle (a remaining point inside) gives null */
  it('returns null while a remaining point is still inside the castle', () => {
    const from = fishingSpot(0);
    const corridor: Point = { x: 5, z: BOUNDS.z1 - 0.5 };
    expect(fishingReroute([corridor, ...from.entry, seatOf(from)], from, to)).toBeNull();
    // An inside point anywhere in the list counts, not only the first one.
    expect(fishingReroute([...from.entry, corridor, seatOf(from)], from, to)).toBeNull();
  });

  /** Verifies a remaining point exactly on the castle edge counts as inside */
  it('returns null for a remaining point exactly on BOUNDS.z1', () => {
    const from = fishingSpot(1);
    expect(fishingReroute([{ x: 5.5, z: BOUNDS.z1 }, ...from.entry.slice(1), seatOf(from)], from, to)).toBeNull();
  });

  /** Verifies a figure called back mid-bridge retraces entry[1], entry[0], then the anchor */
  it.each(ranks)('retraces the passed entry points of place %i called back mid-bridge', (rank) => {
    const from = fishingSpot(rank);
    const [e0, e1, e2, e3] = from.entry;
    const route = fishingReroute([...from.entry.slice(2), seatOf(from)], from, to);
    expect(route).not.toBeNull();
    expect(route![0]).toEqual(e1);
    expect(route![1]).toEqual(e0);
    expect(route![2]).toEqual(from.anchor);
    for (const p of route!) {
      expect(same(p, e2), `route goes through entry[2] (${p.x}, ${p.z})`).toBe(false);
      expect(same(p, e3), `route goes through entry[3] (${p.x}, ${p.z})`).toBe(false);
    }
    // It still ends at the destination.
    expect(route![route!.length - 1]).toEqual(seatOf(to));
    expect(route).toEqual(routeBetween({ ...from, entry: from.entry.slice(0, 2) }, to));
  });

  /** Verifies every leg walked from mid-bridge back to the castle clears the pennant poles */
  it.each(ranks)('keeps the way back of place %i from mid-bridge clear of the pennants', (rank) => {
    const from = fishingSpot(rank);
    const [, e1, e2] = from.entry;
    const position: Point = { x: (e1.x + e2.x) / 2, z: (e1.z + e2.z) / 2 };
    // The figure is past the gate and the first bridge point: what is left is entry[2] onwards.
    expect(position.z).toBeGreaterThan(BOUNDS.z1);
    const route = fishingReroute([...from.entry.slice(2), seatOf(from)], from, to);
    expect(route).not.toBeNull();
    const legs = [position, ...route!];
    for (const pole of PENNANTS) {
      for (let i = 0; i + 1 < legs.length; i++) {
        const d = distanceToSegment(pole, legs[i], legs[i + 1]);
        expect(d, `leg ${i} of rank ${rank} vs pole (${pole.x}, ${pole.z})`).toBeGreaterThanOrEqual(PENNANT_CLEARANCE);
      }
    }
  });

  /** Verifies a figure seated at the bank (empty remaining) walks the full way back */
  it.each([0, 1, MAX_FISHERS - 1])('walks the full way back from place %i for an empty remaining', (rank) => {
    const from = fishingSpot(rank);
    expect(fishingReroute([], from, to)).toEqual(routeBetween(from, to));
  });

  /** Verifies only the seat left ahead (every entry point passed) is the full way back too */
  it('walks the full way back when only the seat is left ahead', () => {
    const from = fishingSpot(3);
    expect(fishingReroute([seatOf(from)], from, to)).toEqual(routeBetween(from, to));
  });

  /** Verifies a figure just past the gate (all entry points ahead) goes straight to the anchor */
  it('goes straight to the anchor when no entry point is passed yet', () => {
    const from = fishingSpot(2);
    const route = fishingReroute([...from.entry, seatOf(from)], from, to);
    expect(route).toEqual(routeBetween({ ...from, entry: [] }, to));
    expect(route![0]).toEqual(from.anchor);
  });

  /** Verifies a remaining list longer than the way in clamps to no passed entry point */
  it('clamps the passed count at zero for an overlong remaining', () => {
    const from = fishingSpot(0);
    const extra: Point = { x: from.entry[0].x, z: BOUNDS.z1 + 0.1 };
    const route = fishingReroute([extra, extra, ...from.entry, seatOf(from)], from, to);
    expect(route).toEqual(routeBetween({ ...from, entry: [] }, to));
  });

  /** Verifies the fishing place and its way in are left untouched */
  it('does not change the fishing place', () => {
    const from = fishingSpot(5);
    const before = from.entry.map((p) => ({ ...p }));
    fishingReroute([...from.entry.slice(1), seatOf(from)], from, to);
    expect(fishingSpot(5)).toBe(from);
    expect(from.entry.map((p) => ({ ...p }))).toEqual(before);
  });
});

describe('wantsToFish forced by the test command', () => {
  /** Verifies a forced agent fishes at once, with no three-minute wait */
  it('fishes at once when forced', () => {
    expect(wantsToFish(fisher(0), true, NOW, true)).toBe(true);
    expect(wantsToFish(fisher(1), true, NOW, true)).toBe(true);
    expect(wantsToFish(fisher(FISHING_AFTER_MS - 1), true, NOW, true)).toBe(true);
  });

  /** Verifies forcing skips only the wait: every other precondition still applies */
  it.each([
    ['a subagent', { kind: 'sub' as const }],
    ['a working agent', { state: 'working' as const }],
    ['a finished agent', { state: 'done' as const }],
    ['a permission wait', { waitReason: 'permission' as const }],
    ['a question wait', { waitReason: 'question' as const }],
    ['no wait reason', { waitReason: undefined }],
    ['an agent at the altar', { room: 'autel' as const }],
  ])('does not fish when forced for %s', (_, patch) => {
    expect(wantsToFish(fisher(0, patch), true, NOW, true)).toBe(false);
    expect(wantsToFish(fisher(FISHING_AFTER_MS * 10, patch), true, NOW, true)).toBe(false);
  });

  /** Verifies a forced agent of a session that is not live never fishes */
  it('does not fish when forced for a session that is not live', () => {
    expect(wantsToFish(fisher(0), false, NOW, true)).toBe(false);
    expect(wantsToFish(fisher(FISHING_AFTER_MS), false, NOW, true)).toBe(false);
  });

  /** Verifies forcing also ignores a broken or future since, the wait being skipped */
  it.each([Number.NaN, NOW + 60_000])('fishes when forced for a since of %s', (since) => {
    expect(wantsToFish(fisher(0, { since }), true, NOW, true)).toBe(true);
  });

  /** Verifies forced=false (explicit or default) keeps the three-minute wait */
  it('keeps the three-minute wait when not forced', () => {
    expect(wantsToFish(fisher(0), true, NOW, false)).toBe(false);
    expect(wantsToFish(fisher(0), true, NOW)).toBe(false);
    expect(wantsToFish(fisher(FISHING_AFTER_MS - 1), true, NOW, false)).toBe(false);
    expect(wantsToFish(fisher(FISHING_AFTER_MS), true, NOW, false)).toBe(true);
  });
});

describe('fishingExitLead', () => {
  const BRIDGE_X = (GATE.lo + GATE.hi) / 2;
  const seatOf = (s: { x: number; z: number }): Point => ({ x: s.x, z: s.z });
  const ranks = Array.from({ length: MAX_FISHERS }, (_, i) => i);

  /** Distance from point p to segment ab. */
  function distanceToSegment(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
    return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
  }

  /** Verifies a `from` that is not a fishing place gives no lead */
  it('returns [] when from is not a fishing place', () => {
    expect(fishingExitLead([], SPAWN)).toEqual([]);
    expect(fishingExitLead([], GATE_SPOT)).toEqual([]);
    const notMoat = { ...fishingSpot(0), space: 'gate' };
    expect(fishingExitLead([], notMoat)).toEqual([]);
    expect(fishingExitLead([seatOf(notMoat)], notMoat)).toEqual([]);
  });

  /** Verifies a figure still inside the castle gives no lead */
  it.each(ranks)('returns [] for place %i while a remaining point is inside', (rank) => {
    const from = fishingSpot(rank);
    const corridor: Point = { x: 5, z: BOUNDS.z1 - 0.5 };
    expect(fishingExitLead([corridor, ...from.entry, seatOf(from)], from)).toEqual([]);
    // An inside point late in the list still counts, even with few points left.
    expect(fishingExitLead([corridor, seatOf(from)], from)).toEqual([]);
    // Exactly on the castle edge counts as inside.
    expect(fishingExitLead([{ x: BRIDGE_X, z: BOUNDS.z1 }, seatOf(from)], from)).toEqual([]);
  });

  /** Verifies a figure that passed at most two entry points (on the bridge axis) gets no lead */
  it.each(ranks)('returns [] for place %i while still on the bridge axis', (rank) => {
    const from = fishingSpot(rank);
    const seat = seatOf(from);
    // Passed 0, 1 and 2 entry points.
    expect(fishingExitLead([...from.entry, seat], from)).toEqual([]);
    expect(fishingExitLead([...from.entry.slice(1), seat], from)).toEqual([]);
    expect(fishingExitLead([...from.entry.slice(2), seat], from)).toEqual([]);
  });

  /** Verifies an overlong remaining list clamps to no passed point and gives no lead */
  it('returns [] for a remaining list longer than the way in', () => {
    const from = fishingSpot(0);
    const extra: Point = { x: BRIDGE_X, z: BOUNDS.z1 + 0.1 };
    expect(fishingExitLead([extra, extra, ...from.entry, seatOf(from)], from)).toEqual([]);
  });

  /** Verifies a figure on the lane (three points passed) goes back to the bridge axis only */
  it.each(ranks)('leads place %i back to the bridge axis from the lane', (rank) => {
    const from = fishingSpot(rank);
    const lead = fishingExitLead([from.entry[3], seatOf(from)], from);
    expect(lead).toEqual([{ x: BRIDGE_X, z: FISHING_LANE_Z }]);
    expect(lead).toEqual([from.entry[2]]);
  });

  /** Verifies a figure seated at the bank walks back along the lane, then to the axis */
  it.each(ranks)('leads place %i seated at the bank back along the lane', (rank) => {
    const from = fishingSpot(rank);
    const lead = fishingExitLead([], from);
    expect(lead).toHaveLength(2);
    expect(lead[0].x).toBeCloseTo(fishingX(rank), 9);
    expect(lead[0].z).toBe(FISHING_LANE_Z);
    expect(lead[1]).toEqual({ x: BRIDGE_X, z: FISHING_LANE_Z });
    expect(lead).toEqual([from.entry[3], from.entry[2]]);
  });

  /** Verifies only the seat left ahead gives the same lead as seated at the bank */
  it.each(ranks)('leads place %i the same with only the seat left ahead', (rank) => {
    const from = fishingSpot(rank);
    expect(fishingExitLead([seatOf(from)], from)).toEqual(fishingExitLead([], from));
  });

  /** Verifies the lead points are fresh mutable copies: the fishing place stays untouched */
  it.each(ranks)('returns copies for place %i', (rank) => {
    const from = fishingSpot(rank);
    const before = from.entry.map((p) => ({ ...p }));
    const lead = fishingExitLead([], from);
    expect(lead[0]).not.toBe(from.entry[3]);
    expect(lead[1]).not.toBe(from.entry[2]);
    expect(Object.isFrozen(lead[0])).toBe(false);
    lead[0].x = 999;
    lead[1].z = -999;
    lead.reverse();
    expect(fishingSpot(rank)).toBe(from);
    expect(fishingSpot(rank).entry.map((p) => ({ ...p }))).toEqual(before);
    // A second call is not affected by the mutation of the first result.
    expect(fishingExitLead([], from)).toEqual([before[3], before[2]]);
  });

  /**
   * Verifies the doomed fisher's way out (seat, lead points, then the nearest path point)
   * keeps clear of every pennant pole, for every place.
   */
  it.each(ranks)('keeps the way out of place %i clear of the pennants', (rank) => {
    const from = fishingSpot(rank);
    const lead = fishingExitLead([], from);
    expect(lead.length).toBeGreaterThan(0);
    const pathPoint = PATH[nearestPathIndex(lead[lead.length - 1])];
    expect(pathPoint).toBeDefined();
    const legs: Point[] = [seatOf(from), ...lead, pathPoint];
    for (const pole of PENNANTS) {
      for (let i = 0; i + 1 < legs.length; i++) {
        const d = distanceToSegment(pole, legs[i], legs[i + 1]);
        expect(d, `leg ${i} of rank ${rank} vs pole (${pole.x}, ${pole.z})`).toBeGreaterThanOrEqual(PENNANT_CLEARANCE);
      }
    }
  });
});

describe('assignFishingRanks', () => {
  /** Verifies new fishers take the lowest ranks in priority order */
  it('gives new fishers the lowest ranks in order', () => {
    expect([...assignFishingRanks(['a', 'b', 'c'], new Map())]).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
  });

  /** Verifies a fisher keeps its rank and a newcomer fills the lowest free one */
  it('keeps ranks sticky and fills the lowest free rank', () => {
    const out = assignFishingRanks(['a', 'b'], new Map([['b', 0]]));
    expect(out.get('b')).toBe(0);
    expect(out.get('a')).toBe(1);
  });

  /** Verifies a fisher that leaves frees its rank for the next newcomer */
  it('frees the rank of a fisher who left', () => {
    const out = assignFishingRanks(['b', 'c'], new Map([['a', 0], ['b', 1]]));
    expect(out.has('a')).toBe(false);
    expect(out.get('b')).toBe(1);
    expect(out.get('c')).toBe(0);
  });

  /** Verifies a gap left in the middle is reused before higher ranks */
  it('reuses a gap before going higher', () => {
    const out = assignFishingRanks(['a', 'c', 'd'], new Map([['a', 0], ['c', 2]]));
    expect(out.get('d')).toBe(1);
  });

  /** Verifies fishers beyond MAX_FISHERS get no place */
  it('caps the bank at MAX_FISHERS', () => {
    expect(MAX_FISHERS).toBe(12);
    const ids = Array.from({ length: MAX_FISHERS + 2 }, (_, i) => `f${i}`);
    const out = assignFishingRanks(ids, new Map());
    expect(out.size).toBe(MAX_FISHERS);
    expect(out.has(`f${MAX_FISHERS}`)).toBe(false);
    expect(out.has(`f${MAX_FISHERS + 1}`)).toBe(false);
    expect(new Set(out.values())).toEqual(new Set(Array.from({ length: MAX_FISHERS }, (_, i) => i)));
  });

  /** Verifies a full bank of sticky fishers leaves a newcomer without a place */
  it('gives a newcomer nothing when the sticky fishers fill the bank', () => {
    const previous = new Map(Array.from({ length: MAX_FISHERS }, (_, i) => [`f${i}`, i] as [string, number]));
    const out = assignFishingRanks(['new', ...previous.keys()], previous);
    expect(out.has('new')).toBe(false);
    expect(out.size).toBe(MAX_FISHERS);
  });

  /** Verifies no fisher gives an empty map and the previous map is untouched */
  it('handles no fishers without changing the previous map', () => {
    const previous = new Map([['a', 3]]);
    expect(assignFishingRanks([], previous).size).toBe(0);
    expect([...previous]).toEqual([['a', 3]]);
  });
});

describe('fishing seed and idle wait', () => {
  /** Verifies the seed is a stable unsigned 32-bit FNV-1a hash */
  it('hashes ids stably', () => {
    expect(fishingSeed('')).toBe(0x811c9dc5);
    expect(fishingSeed('s1#main')).toBe(fishingSeed('s1#main'));
    expect(fishingSeed('a')).not.toBe(fishingSeed('b'));
    for (const id of ['a', 'agent-42', 's1#main', 'x'.repeat(200)]) {
      const s = fishingSeed(id);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2 ** 32);
    }
  });

  /** Verifies the wait for a bite is 8 plus 0 to 6 whole seconds */
  it.each([
    [0, 8],
    [6, 14],
    [7, 8],
    [-1, 9],
    [3.9, 11],
  ])('waits for a bite with seed %f: %i s', (seed, idle) => {
    expect(FISHING_IDLE_MIN_S).toBe(8);
    expect(fishingIdle(seed)).toBe(idle);
  });

  /** Verifies every real seed waits between 8 and 14 whole seconds */
  it('keeps every wait in [8, 14]', () => {
    for (const id of ['a', 'b', 'c', 'agent-1', 'agent-2', 's9#main']) {
      const idle = fishingIdle(fishingSeed(id));
      expect(Number.isInteger(idle)).toBe(true);
      expect(idle).toBeGreaterThanOrEqual(8);
      expect(idle).toBeLessThanOrEqual(14);
    }
  });
});

describe('fishingClip', () => {
  const SEED = 0; // idle wait of 8 s
  const IDLE = fishingIdle(SEED);
  const EPS = 1e-3;
  const CYCLE = IDLE + FISHING_BITE_TIME + FISHING_REEL_S + FISHING_CATCH_TIME;

  /** Verifies the clip constants match the documented lengths */
  it('pins the fishing clip lengths', () => {
    expect(FISHING_CAST_TIME).toBe(1.933);
    expect(FISHING_BITE_TIME).toBe(2.233);
    expect(FISHING_CATCH_TIME).toBe(3.233);
    expect(FISHING_REEL_S).toBe(2);
  });

  /** Verifies the figure casts once on arrival, also for a negative or broken time */
  it.each([0, FISHING_CAST_TIME - EPS, -1, Number.NaN, Number.NEGATIVE_INFINITY])('casts at t = %f', (t) => {
    expect(fishingClip(t, SEED)).toEqual(play('Fishing_Cast', 1, false));
  });

  /** Verifies the cycle after the cast: idle loop, bite once, reeling loop, catch once */
  it.each([
    [FISHING_CAST_TIME, play('Fishing_Idle')],
    [FISHING_CAST_TIME + IDLE - EPS, play('Fishing_Idle')],
    [FISHING_CAST_TIME + IDLE + EPS, play('Fishing_Bite', 1, false)],
    [FISHING_CAST_TIME + IDLE + FISHING_BITE_TIME - EPS, play('Fishing_Bite', 1, false)],
    [FISHING_CAST_TIME + IDLE + FISHING_BITE_TIME + EPS, play('Fishing_Reeling')],
    [FISHING_CAST_TIME + IDLE + FISHING_BITE_TIME + FISHING_REEL_S - EPS, play('Fishing_Reeling')],
    [FISHING_CAST_TIME + IDLE + FISHING_BITE_TIME + FISHING_REEL_S + EPS, play('Fishing_Catch', 1, false)],
    [FISHING_CAST_TIME + CYCLE - EPS, play('Fishing_Catch', 1, false)],
    [FISHING_CAST_TIME + CYCLE + EPS, play('Fishing_Idle')],
    [FISHING_CAST_TIME + 5 * CYCLE + IDLE + EPS, play('Fishing_Bite', 1, false)],
  ])('plays the right clip at t = %f', (t, choice) => {
    expect(fishingClip(t, SEED)).toEqual(choice);
  });

  /** Verifies the cast is never played again after the first cycle */
  it('never casts again after arriving', () => {
    for (let t = FISHING_CAST_TIME; t < FISHING_CAST_TIME + 3 * CYCLE; t += 0.25) {
      expect(fishingClip(t, SEED).name, `at ${t}`).not.toBe('Fishing_Cast');
    }
  });

  /** Verifies a longer idle wait delays the bite for another seed */
  it('delays the bite with a longer idle wait', () => {
    const t = FISHING_CAST_TIME + 9;
    expect(fishingClip(t, 0).name).toBe('Fishing_Bite'); // idle 8
    expect(fishingClip(t, 6).name).toBe('Fishing_Idle'); // idle 14
  });

  /** Verifies an infinite time falls back to the idle wait instead of breaking */
  it('waits idle for an infinite time', () => {
    expect(fishingClip(Number.POSITIVE_INFINITY, SEED)).toEqual(play('Fishing_Idle'));
  });
});

describe('fishing force registry', () => {
  afterEach(() => clearForcedFishing());

  /** Verifies forcing reports changes and the forced state follows */
  it('forces and calls back an agent', () => {
    expect(isFishingForced('r1')).toBe(false);
    expect(forceFishing('r1', true)).toBe(true);
    expect(isFishingForced('r1')).toBe(true);
    expect(forceFishing('r1', true)).toBe(false);
    expect(forceFishing('r1', false)).toBe(true);
    expect(isFishingForced('r1')).toBe(false);
    expect(forceFishing('r1', false)).toBe(false);
  });

  /** Verifies watchers and the snapshot version change only on real changes */
  it('notifies only on a change', () => {
    const watcher = vi.fn();
    const off = onFishingForce(watcher);
    const v0 = fishingForceVersion();
    forceFishing('r2', true);
    forceFishing('r2', true);
    forceFishing('r3', false);
    expect(watcher).toHaveBeenCalledTimes(1);
    expect(fishingForceVersion()).toBe(v0 + 1);
    clearForcedFishing();
    clearForcedFishing();
    expect(watcher).toHaveBeenCalledTimes(2);
    expect(fishingForceVersion()).toBe(v0 + 2);
    off();
    forceFishing('r2', true);
    expect(watcher).toHaveBeenCalledTimes(2);
  });

  /** Verifies a watcher that unsubscribes while notified does not stop the others */
  it('still notifies every watcher when one unsubscribes during the notification', () => {
    const second = vi.fn();
    let offFirst = () => {};
    const first = vi.fn(() => offFirst());
    offFirst = onFishingForce(first);
    const offSecond = onFishingForce(second);
    forceFishing('r4', true);
    forceFishing('r4', false);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    offSecond();
  });
});

describe('installFishingCommand', () => {
  afterEach(() => clearForcedFishing());

  function setup(selected: string | null, liveMains: string[] = []) {
    const target: { agentOffice?: Record<string, unknown> } = {};
    const log = vi.fn();
    const off = installFishingCommand(target, { selected: () => selected, isLiveMain: (id) => liveMains.includes(id), log });
    const peche = target.agentOffice!.peche as (id?: unknown) => boolean;
    return { target, log, off, peche };
  }

  /** Verifies the command toggles the selected live main agent */
  it('toggles the selected main agent', () => {
    const { peche, log } = setup('sel', ['sel']);
    expect(peche()).toBe(true);
    expect(isFishingForced('sel')).toBe(true);
    expect(log).toHaveBeenLastCalledWith('peche: sel goes fishing');
    expect(peche()).toBe(true);
    expect(isFishingForced('sel')).toBe(false);
    expect(log).toHaveBeenLastCalledWith('peche: sel called back');
  });

  /** Verifies a given id wins over the selection */
  it('targets the given id over the selection', () => {
    const { peche } = setup('sel', ['sel', 'given']);
    expect(peche('given')).toBe(true);
    expect(isFishingForced('given')).toBe(true);
    expect(isFishingForced('sel')).toBe(false);
  });

  /** Verifies an agent that is not the main agent of a live session is refused */
  it('refuses an agent that is not a live main agent', () => {
    const { peche, log } = setup('sub-1', []);
    expect(peche()).toBe(false);
    expect(peche('other')).toBe(false);
    expect(isFishingForced('sub-1')).toBe(false);
    expect(isFishingForced('other')).toBe(false);
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('not the main agent of a live session'));
  });

  /** Verifies a forced agent can be called back even once its session is no longer live */
  it('calls back a forced agent that is no longer a live main agent', () => {
    forceFishing('gone', true);
    const { peche } = setup(null, []);
    expect(peche('gone')).toBe(true);
    expect(isFishingForced('gone')).toBe(false);
  });

  /** Verifies the command reports when no agent is selected or given */
  it('reports when no agent is selected', () => {
    const { peche, log } = setup(null, ['m']);
    expect(peche()).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('no agent selected'));
  });

  /** Verifies an empty string id is refused instead of falling back to the selection */
  it('refuses an empty id', () => {
    const { peche } = setup('sel', ['sel', '']);
    expect(peche('')).toBe(false);
    expect(isFishingForced('sel')).toBe(false);
    expect(isFishingForced('')).toBe(false);
  });

  /** Verifies a non-string id changes nothing and says why */
  it.each([42, {}, true, ['sel']])('refuses the id %j', (id) => {
    const { peche, log } = setup('sel', ['sel']);
    expect(peche(id)).toBe(false);
    expect(isFishingForced('sel')).toBe(false);
    expect(log).toHaveBeenCalledWith('peche: the agent id must be a string');
  });

  /** Verifies null calls every forced fisher back, even with a selection */
  it('calls every forced fisher back with null', () => {
    const { peche, log } = setup('sel', ['sel']);
    forceFishing('a', true);
    forceFishing('b', true);
    expect(peche(null)).toBe(true);
    expect(isFishingForced('a')).toBe(false);
    expect(isFishingForced('b')).toBe(false);
    expect(isFishingForced('sel')).toBe(false);
    expect(log).toHaveBeenCalledWith('peche: called back 2 forced fisher(s)');
  });

  /** Verifies null with nothing forced returns false */
  it('returns false when null has nobody to call back', () => {
    const { peche, log } = setup('sel', ['sel']);
    expect(peche(null)).toBe(false);
    expect(log).toHaveBeenCalledWith('peche: called back 0 forced fisher(s)');
  });

  /** Verifies the other gags' commands survive install and uninstall */
  it('shares the agentOffice namespace', () => {
    const target: { agentOffice?: Record<string, unknown> } = { agentOffice: { potion: 'keep' } };
    const off = installFishingCommand(target, { selected: () => null, isLiveMain: () => false, log: () => {} });
    expect(target.agentOffice).toMatchObject({ potion: 'keep', peche: expect.any(Function) });
    off();
    expect(target.agentOffice).toEqual({ potion: 'keep' });
  });

  /** Verifies the uninstall calls every forced fisher back: they never outlive the scene */
  it('calls the forced fishers back on uninstall', () => {
    const { off } = setup(null);
    forceFishing('scene-1', true);
    off();
    expect(isFishingForced('scene-1')).toBe(false);
  });

  /** Verifies a stale uninstall leaves a newer command and its forced fishers in place */
  it('leaves a newer command in place', () => {
    const target: { agentOffice?: Record<string, unknown> } = {};
    const deps = { selected: () => null, isLiveMain: () => true, log: () => {} };
    const offOld = installFishingCommand(target, deps);
    installFishingCommand(target, deps);
    const newer = target.agentOffice!.peche;
    forceFishing('kept', true);
    offOld();
    expect(target.agentOffice!.peche).toBe(newer);
    expect(isFishingForced('kept')).toBe(true);
  });

  /** Verifies a non-object namespace is replaced, as the other gag commands do */
  it.each([1, 'x', null, true])('replaces a %j namespace with an object', (value) => {
    const target: { agentOffice?: unknown } = { agentOffice: value };
    installFishingCommand(target, { selected: () => null, isLiveMain: () => false, log: () => {} });
    expect(typeof (target.agentOffice as Record<string, unknown>).peche).toBe('function');
  });
});

// ================================================================ clipFor with the bonus clips

describe('clipFor bonus clips', () => {
  const base = (patch: Partial<ClipInput> = {}): ClipInput => ({
    moving: false,
    speed: 0,
    state: 'working',
    spawning: false,
    kneeling: false,
    reducedMotion: false,
    ...patch,
  });
  const FISH = play('Fishing_Reeling');

  /** Verifies a dodge clip given as the hit is played once */
  it.each([...DODGE_CLIPS])('plays the dodge %s once', (clip) => {
    expect(clipFor(base({ hit: clip }))).toEqual(play(clip, 1, false));
  });

  /** Verifies a dodge keeps the pose under reduced motion */
  it('does not dodge under reduced motion', () => {
    expect(clipFor(base({ hit: 'Dodge_Left', reducedMotion: true, state: 'done' }))).toEqual(hold('Idle_A'));
  });

  /** Verifies a finishing subagent plays Cheering once */
  it('plays Cheering once', () => {
    expect(clipFor(base({ cheering: true, state: 'done' }))).toEqual(play('Cheering', 1, false));
  });

  /** Verifies cheering is skipped under reduced motion, leaving the done pose */
  it('does not cheer under reduced motion', () => {
    expect(clipFor(base({ cheering: true, state: 'done', reducedMotion: true }))).toEqual(hold('Idle_A'));
  });

  /** Verifies a slap, the potion and the spawn all win over a cheer */
  it('lets hit, drinking and spawn beat cheering', () => {
    expect(clipFor(base({ cheering: true, hit: 'Hit_B' }))).toEqual(play('Hit_B', 1, false));
    expect(clipFor(base({ cheering: true, hit: 'Dodge_Right' }))).toEqual(play('Dodge_Right', 1, false));
    expect(clipFor(base({ cheering: true, drinking: true }))).toEqual(play('Use_Item', 1, false));
    expect(clipFor(base({ cheering: true, spawning: true }))).toEqual(play('Spawn_Ground', SPAWN_TIME_SCALE, false));
  });

  /** Verifies a cheer wins over walking, sneaking, altar poses and fishing */
  it('lets cheering beat moving, sneaking, altar and fishing', () => {
    expect(clipFor(base({ cheering: true, moving: true, speed: 0.5, sneaking: true, altar: 'sleeping', fishing: FISH }))).toEqual(
      play('Cheering', 1, false),
    );
  });

  /** Verifies a scripted scene still wins over a cheer */
  it('lets a scripted clip beat cheering', () => {
    const scripted = play('Death_A', 1, false);
    expect(clipFor(base({ cheering: true, scripted }))).toBe(scripted);
  });

  /** Verifies a moving sneaking figure plays Sneaking at the speed-matched rate */
  it('sneaks at the rate matching its speed', () => {
    const c = clipFor(base({ sneaking: true, moving: true, speed: SNEAK_CLIP_SPEED, state: 'done' }));
    expect(c.name).toBe('Sneaking');
    expect(c.loop).toBe(true);
    expect(c.frozen).toBe(false);
    expect(c.timeScale).toBeCloseTo(1, 9);
    expect(clipFor(base({ sneaking: true, moving: true, speed: 0.4, state: 'done' })).timeScale).toBeCloseTo(0.4 / SNEAK_CLIP_SPEED, 9);
  });

  /** Verifies the sneak rate is clamped between 0.5 and MAX_CLIP_RATE */
  it.each([
    [0, 0.5],
    [0.05, 0.5],
    [SNEAK_SPEED, MAX_CLIP_RATE],
    [9, MAX_CLIP_RATE],
  ])('clamps the sneak rate at speed %f to %f', (speed, rate) => {
    expect(clipFor(base({ sneaking: true, moving: true, speed, state: 'done' }))).toEqual(play('Sneaking', rate));
  });

  /** Verifies a sneaking figure keeps sneaking above the run threshold instead of running */
  it('sneaks rather than runs at a high speed', () => {
    expect(clipFor(base({ sneaking: true, moving: true, speed: 5 })).name).toBe('Sneaking');
  });

  /** Verifies a sneaking figure standing still keeps the usual done pose */
  it('keeps the done pose for a sneaking figure that does not move', () => {
    expect(clipFor(base({ sneaking: true, moving: false, state: 'done' }))).toEqual(hold('Idle_A'));
  });

  /** Verifies a moving sneaking figure under reduced motion holds a still pose */
  it('holds a still pose for a sneaking figure under reduced motion', () => {
    expect(clipFor(base({ sneaking: true, moving: true, speed: 0.5, reducedMotion: true }))).toEqual(hold('Idle_A'));
  });

  /** Verifies a slap beats sneaking */
  it('lets a hit beat sneaking', () => {
    expect(clipFor(base({ sneaking: true, moving: true, speed: 0.5, hit: 'Dodge_Backward' }))).toEqual(play('Dodge_Backward', 1, false));
  });

  /** Verifies a figure at the bank plays the fishing choice it is given */
  it('plays the given fishing clip', () => {
    expect(clipFor(base({ fishing: FISH, state: 'waiting' }))).toBe(FISH);
    const cast = fishingClip(0, 0);
    expect(clipFor(base({ fishing: cast, state: 'waiting' }))).toBe(cast);
  });

  /** Verifies fishing under reduced motion holds the idle fishing pose */
  it('holds Fishing_Idle under reduced motion', () => {
    expect(clipFor(base({ fishing: FISH, reducedMotion: true }))).toEqual(hold('Fishing_Idle'));
  });

  /** Verifies the altar poses beat fishing */
  it('lets altar poses beat fishing', () => {
    expect(clipFor(base({ fishing: FISH, altar: 'sleeping' }))).toEqual(hold(SLEEP_CLIP));
    expect(clipFor(base({ fishing: FISH, altar: 'sitting' }))).toEqual(hold(SIT_CLIP, SIT_POSE_TIME));
    expect(clipFor(base({ fishing: FISH, altar: 'pacing' }))).toEqual(play('Walking_A', PACE_CLIP_RATE));
  });

  /** Verifies pacing under reduced motion falls through to the still fishing pose */
  it('falls through reduced-motion pacing to the still fishing pose', () => {
    expect(clipFor(base({ fishing: FISH, altar: 'pacing', reducedMotion: true }))).toEqual(hold('Fishing_Idle'));
  });

  /** Verifies a figure walking to the bank walks rather than fishes */
  it('lets moving beat fishing', () => {
    expect(clipFor(base({ fishing: FISH, moving: true, speed: 0.57 })).name).toBe('Walking_A');
  });

  /** Verifies fishing beats kneeling and the state poses */
  it('lets fishing beat kneeling and the done pose', () => {
    expect(clipFor(base({ fishing: FISH, kneeling: true }))).toBe(FISH);
    expect(clipFor(base({ fishing: FISH, state: 'done' }))).toBe(FISH);
    // Without fishing, kneeling is unchanged.
    expect(clipFor(base({ kneeling: true }))).toEqual(hold('PickUp', KNEEL_POSE_TIME));
  });
});

// ================================================================ clip registration

describe('bonus clip registration', () => {
  const BONUS: KitClip[] = [
    'Cheering',
    'Dodge_Backward',
    'Dodge_Left',
    'Dodge_Right',
    'Sneaking',
    'Fishing_Cast',
    'Fishing_Idle',
    'Fishing_Bite',
    'Fishing_Reeling',
    'Fishing_Catch',
  ];

  /** Verifies every bonus clip is listed, loaded and exists in the catalog */
  it('lists and loads every bonus clip', () => {
    expect([...BONUS_CLIPS].sort()).toEqual([...BONUS].sort());
    for (const clip of BONUS) {
      expect(CLIPS, clip).toContain(clip);
      expect(Object.hasOwn(CLIP_FILE, clip), clip).toBe(true);
      expect(ANIM_FILES_USED, clip).toContain(CLIP_FILE[clip]);
    }
  });

  /** Verifies every dodge clip is a bonus clip */
  it('registers every dodge clip', () => {
    for (const clip of DODGE_CLIPS) expect(BONUS_CLIPS).toContain(clip);
  });
});

// ================================================================ GLB facts

const PUBLIC_KAYKIT = fileURLToPath(new URL('../public/kaykit/', import.meta.url));

/** The parts of a glTF JSON chunk read by the clip length and root motion checks. */
interface Gltf {
  nodes?: { name?: string }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; max?: number[] }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  animations?: {
    name?: string;
    samplers: { input: number; output: number }[];
    channels: { sampler: number; target: { node?: number; path: string } }[];
  }[];
}

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const FLOAT = 5126;

/** Minimal binary glTF reader (same chunk walk as dungeon.test.ts): JSON and BIN chunks. */
function readGlb(buf: Buffer): { json: Gltf; bin?: Buffer } {
  if (buf.length < 20 || buf.toString('latin1', 0, 4) !== 'glTF') throw new Error('not a binary glTF');
  let json: Gltf | undefined;
  let bin: Buffer | undefined;
  for (let offset = 12; offset + 8 <= buf.length; ) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + length > buf.length) throw new Error('invalid chunk length');
    if (type === JSON_CHUNK && !json) json = JSON.parse(buf.toString('utf8', start, start + length)) as Gltf;
    else if (type === BIN_CHUNK && !bin) bin = buf.subarray(start, start + length);
    offset = start + length;
  }
  if (!json) throw new Error('no JSON chunk');
  return { json, bin };
}

const glbCache = new Map<string, { json: Gltf; bin?: Buffer }>();
function glbOf(clip: KitClip): { json: Gltf; bin?: Buffer } {
  const file = CLIP_FILE[clip];
  let glb = glbCache.get(file);
  if (!glb) {
    glb = readGlb(fs.readFileSync(path.join(PUBLIC_KAYKIT, 'animations', `${file}.glb`)));
    glbCache.set(file, glb);
  }
  return glb;
}

/** A clip lasts until its last keyframe: the largest time of all its sampler inputs. */
function clipLength(clip: KitClip): number | undefined {
  const { json } = glbOf(clip);
  const anim = json.animations?.find((a) => a.name === clip);
  if (!anim) return undefined;
  return Math.max(...anim.samplers.map((s) => json.accessors?.[s.input]?.max?.[0] ?? 0));
}

/** The float VEC3 values of an accessor (non-sparse, as the KayKit files are). */
function readVec3(json: Gltf, bin: Buffer, index: number): [number, number, number][] {
  const acc = json.accessors![index];
  expect(acc.componentType, 'float accessor').toBe(FLOAT);
  expect(acc.type, 'VEC3 accessor').toBe('VEC3');
  const view = json.bufferViews![acc.bufferView!];
  const stride = view.byteStride ?? 12;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out: [number, number, number][] = [];
  for (let i = 0; i < acc.count; i++) {
    const o = base + i * stride;
    out.push([bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)]);
  }
  return out;
}

/** The keyframes of the `root` node's translation in a clip, or null when it has no such track. */
function rootTranslation(clip: KitClip): [number, number, number][] | null {
  const { json, bin } = glbOf(clip);
  const root = (json.nodes ?? []).findIndex((n) => (n.name ?? '').toLowerCase() === 'root');
  expect(root, `root node in ${CLIP_FILE[clip]}`).toBeGreaterThanOrEqual(0);
  const anim = json.animations?.find((a) => a.name === clip);
  expect(anim, `${clip} found`).toBeDefined();
  const channel = anim!.channels.find((c) => c.target.node === root && c.target.path === 'translation');
  if (!channel) return null;
  expect(bin, 'BIN chunk').toBeDefined();
  return readVec3(json, bin!, anim!.samplers[channel.sampler].output);
}

describe('bonus clips in the GLB files', () => {
  /** Verifies each bonus clip length constant matches its clip in the file within 0.01 s */
  it.each([
    ['Cheering', CHEER_CLIP_TIME],
    ['Dodge_Backward', DODGE_CLIP_TIME],
    ['Dodge_Left', DODGE_CLIP_TIME],
    ['Dodge_Right', DODGE_CLIP_TIME],
    ['Fishing_Cast', FISHING_CAST_TIME],
    ['Fishing_Bite', FISHING_BITE_TIME],
    ['Fishing_Catch', FISHING_CATCH_TIME],
  ] as [KitClip, number][])('times %s as long as the clip in the file', (clip, time) => {
    const length = clipLength(clip);
    expect(length, `${clip} found`).toBeDefined();
    expect(Math.abs(length! - time), `${clip}: ${length} vs ${time}`).toBeLessThan(0.01);
  });

  /** Verifies the looping fishing clips exist with a positive length */
  it.each(['Fishing_Idle', 'Fishing_Reeling'] as KitClip[])('ships %s', (clip) => {
    const length = clipLength(clip);
    expect(length, `${clip} found`).toBeDefined();
    expect(length!).toBeGreaterThan(0);
  });

  /**
   * Verifies Sneaking and Cheering play in place: their root translation never moves
   * (a missing root track is in place too), so the figure's walk alone moves it.
   */
  it.each(['Sneaking', 'Cheering'] as KitClip[])('plays %s in place', (clip) => {
    const keys = rootTranslation(clip);
    if (keys === null) return;
    expect(keys.length).toBeGreaterThan(0);
    const [x0, y0, z0] = keys[0];
    for (const [x, y, z] of keys) {
      expect(Math.hypot(x - x0, y - y0, z - z0)).toBeLessThan(1e-4);
    }
  });

  /**
   * Verifies each dodge moves its root and ends displaced. Accepted by the plan: the figure
   * jumps aside and springs back to its place over the blend out of the clip.
   */
  it.each([...DODGE_CLIPS] as KitClip[])('moves the root in %s', (clip) => {
    const keys = rootTranslation(clip);
    expect(keys, `${clip} root translation track`).not.toBeNull();
    expect(keys!.length).toBeGreaterThanOrEqual(2);
    const [x0, y0, z0] = keys![0];
    const [x1, y1, z1] = keys![keys!.length - 1];
    expect(Math.hypot(x1 - x0, y1 - y0, z1 - z0)).toBeGreaterThan(0.01);
  });
});
