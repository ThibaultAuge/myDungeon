import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DROP_S,
  FEATHER_FALL_S,
  HOVER_S,
  LAND_S,
  LEAVE_S,
  LOST_FEATHER_FALL_S,
  LOST_TIMEOUT_S,
  MAX_PIGEONS,
  MIN_AWAY_S,
  PIGEON_OUTCOMES,
  PLUCKED_FEATHERS,
  Pigeons,
  RETURN_S,
  SPLAT_S,
  arcPoint,
  dropFall,
  feathersAt,
  flightOver,
  freshEvents,
  isPigeonOutcome,
  phaseAt,
  pigeonOutcome,
  pigeonPoint,
  skyOf,
  splatOn,
  splatStart,
  type Flight,
  type Phase,
  type PigeonOutcome,
  type Places,
  type V3,
} from '../src/scene/pigeon.ts';

/** Offset used to stay clear of floating-point phase boundaries, in seconds. */
const EPS = 1e-3;
/** Sampling step of timelines, in seconds. */
const STEP = 0.01;

const PLACES: Places = { nest: [2, 3, -4], head: [8, 1, 6] };

/** Earliest time a pigeon can start back, for a flight launched at 0. */
const EARLIEST_RETURN = LEAVE_S + MIN_AWAY_S;

/** A flight launched at 0 that already knows its outcome and starts back at `returnAt`. */
function flight(outcome: PigeonOutcome | undefined, returnAt: number | undefined = EARLIEST_RETURN, id = 1): Flight {
  return { id, agentId: 'sm', startedAt: 0, outcome, returnAt: outcome === undefined ? undefined : returnAt };
}

/** Sample times from `from` to `to` inclusive. */
function times(from: number, to: number): number[] {
  return Array.from({ length: Math.round((to - from) / STEP) + 1 }, (_, i) => from + i * STEP);
}

/** The distinct phases a flight goes through, in order. */
function phaseSequence(f: Flight, to = 30): Phase[] {
  const out: Phase[] = [];
  for (const t of times(0, to)) {
    const p = phaseAt(f, t).phase;
    if (out.at(-1) !== p) out.push(p);
  }
  return out;
}

function expectClose(actual: V3 | null, expected: V3, digits = 5) {
  expect(actual).not.toBeNull();
  actual!.forEach((v, i) => expect(v).toBeCloseTo(expected[i], digits));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pigeonOutcome', () => {
  /**
   * Verifies that a successful call always brings the pigeon back, without drawing
   */
  it('returns back for ok without using the rng', () => {
    const rng = () => {
      throw new Error('no draw expected');
    };
    expect(pigeonOutcome('ok', rng)).toBe('back');
  });

  /**
   * Verifies that an error draws plucked, lost or dropping by thirds of the rng range
   */
  it.each([
    [0, 'plucked'],
    [0.2, 'plucked'],
    [0.33, 'plucked'],
    [1 / 3, 'lost'],
    [0.5, 'lost'],
    [0.66, 'lost'],
    [2 / 3, 'dropping'],
    [0.9, 'dropping'],
    [0.9999999999, 'dropping'],
  ])('rng %d gives %s', (r, expected) => {
    expect(pigeonOutcome('error', () => r)).toBe(expected);
  });

  /**
   * Verifies that an rng returning 1 (out of contract) still yields a valid outcome
   */
  it('stays in range when the rng returns 1', () => {
    expect(pigeonOutcome('error', () => 1)).toBe('dropping');
  });

  /**
   * Verifies that an error never brings the pigeon back safely
   */
  it('never returns back for an error', () => {
    for (let i = 0; i < 100; i++) expect(pigeonOutcome('error', () => i / 100)).not.toBe('back');
  });

  /**
   * Verifies that Math.random is the default source of randomness
   */
  it('defaults to Math.random', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(pigeonOutcome('error')).toBe('lost');
  });
});

describe('isPigeonOutcome', () => {
  /**
   * Verifies that every declared outcome is recognised
   */
  it.each(PIGEON_OUTCOMES.map((o) => [o]))('accepts %s', (o) => {
    expect(isPigeonOutcome(o)).toBe(true);
  });

  /**
   * Verifies that anything else, including case variants and non-strings, is rejected
   */
  it.each([['Back'], ['ok'], ['error'], [''], [undefined], [null], [1], [{}], [['back']]])('rejects %j', (v) => {
    expect(isPigeonOutcome(v)).toBe(false);
  });
});

describe('phaseAt', () => {
  /**
   * Verifies that the pigeon is leaving during take-off, with progress over LEAVE_S
   */
  it('is leaving during take-off', () => {
    const f = flight(undefined);
    expect(phaseAt(f, 0)).toEqual({ phase: 'leaving', t: 0 });
    const mid = phaseAt(f, LEAVE_S / 2);
    expect(mid.phase).toBe('leaving');
    expect(mid.t).toBeCloseTo(0.5);
  });

  /**
   * Verifies that a time before the launch clamps progress to 0
   */
  it('clamps progress before the launch', () => {
    expect(phaseAt(flight(undefined), -5)).toEqual({ phase: 'leaving', t: 0 });
  });

  /**
   * Verifies that an unanswered call keeps the pigeon away indefinitely
   */
  it('stays away while the call has no outcome', () => {
    const f = flight(undefined);
    expect(phaseAt(f, LEAVE_S + EPS)).toEqual({ phase: 'away', t: 0 });
    expect(phaseAt(f, 10_000)).toEqual({ phase: 'away', t: 0 });
  });

  /**
   * Verifies that the pigeon stays away until its return time even with an outcome
   */
  it('stays away until returnAt', () => {
    const f = flight('back', 10);
    expect(phaseAt(f, 10 - EPS).phase).toBe('away');
    expect(phaseAt(f, 10)).toEqual({ phase: 'returning', t: 0 });
  });

  /**
   * Verifies the phase order of a pigeon that comes back
   */
  it.each([['back'], ['plucked']] as const)('goes leaving → away → returning → landed → gone for %s', (o) => {
    expect(phaseSequence(flight(o))).toEqual(['leaving', 'away', 'returning', 'landed', 'gone']);
  });

  /**
   * Verifies the phase order of a dropping pigeon, which hovers then homes
   */
  it('goes through hovering and homing for dropping', () => {
    expect(phaseSequence(flight('dropping'))).toEqual(['leaving', 'away', 'returning', 'hovering', 'homing', 'landed', 'gone']);
  });

  /**
   * Verifies that a lost pigeon never comes back: gone at its return time
   */
  it('goes straight from away to gone for lost', () => {
    const f = flight('lost', 10);
    expect(phaseSequence(f)).toEqual(['leaving', 'away', 'gone']);
    expect(phaseAt(f, 10)).toEqual({ phase: 'gone', t: 1 });
  });

  /**
   * Verifies the progress inside each phase of a back flight, from the exported durations
   */
  it('reports progress within returning and landed', () => {
    const R = 10;
    const f = flight('back', R);
    const ret = phaseAt(f, R + RETURN_S / 2);
    expect(ret.phase).toBe('returning');
    expect(ret.t).toBeCloseTo(0.5);
    const land = phaseAt(f, R + RETURN_S + LAND_S / 2);
    expect(land.phase).toBe('landed');
    expect(land.t).toBeCloseTo(0.5);
    expect(phaseAt(f, R + RETURN_S + LAND_S + EPS)).toEqual({ phase: 'gone', t: 1 });
  });

  /**
   * Verifies the durations of the hovering and homing phases of a dropping flight
   */
  it('times hovering and homing from the exported durations', () => {
    const R = 10;
    const f = flight('dropping', R);
    const hover = phaseAt(f, R + RETURN_S + HOVER_S / 2);
    expect(hover.phase).toBe('hovering');
    expect(hover.t).toBeCloseTo(0.5);
    const home = phaseAt(f, R + RETURN_S + HOVER_S + RETURN_S / 2);
    expect(home.phase).toBe('homing');
    expect(home.t).toBeCloseTo(0.5);
    expect(phaseAt(f, R + 2 * RETURN_S + HOVER_S + LAND_S / 2).phase).toBe('landed');
    expect(phaseAt(f, R + 2 * RETURN_S + HOVER_S + LAND_S + EPS).phase).toBe('gone');
  });

  /**
   * Verifies that progress always stays within [0, 1]
   */
  it.each(PIGEON_OUTCOMES.map((o) => [o]))('keeps t within [0, 1] for %s', (o) => {
    const f = flight(o);
    for (const now of times(-1, 20)) {
      const { t } = phaseAt(f, now);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
  });
});

describe('dropping: splatStart, splatOn, dropFall', () => {
  const R = 10;

  /**
   * Verifies that the splat lands after the way back plus the fall of the dropping
   */
  it('splatStart is returnAt + RETURN_S + DROP_S for dropping', () => {
    expect(splatStart(flight('dropping', R))).toBeCloseTo(R + RETURN_S + DROP_S);
  });

  /**
   * Verifies that only a dropping flight that has started back has a splat
   */
  it.each([['back'], ['plucked'], ['lost']] as const)('splatStart is undefined for %s', (o) => {
    expect(splatStart(flight(o, R))).toBeUndefined();
  });

  /**
   * Verifies that a dropping flight without return time has no splat yet
   */
  it('splatStart is undefined for dropping without returnAt', () => {
    expect(splatStart({ id: 1, agentId: 'sm', startedAt: 0, outcome: 'dropping' })).toBeUndefined();
  });

  /**
   * Verifies that the splat shows for SPLAT_S seconds from its start
   */
  it('splatOn is true only during SPLAT_S from the splat start', () => {
    const f = flight('dropping', R);
    const at = splatStart(f)!;
    expect(splatOn(f, at - EPS)).toBe(false);
    expect(splatOn(f, at)).toBe(true);
    expect(splatOn(f, at + SPLAT_S / 2)).toBe(true);
    expect(splatOn(f, at + SPLAT_S - EPS)).toBe(true);
    expect(splatOn(f, at + SPLAT_S + EPS)).toBe(false);
  });

  /**
   * Verifies that no splat ever shows for other outcomes
   */
  it.each([['back'], ['plucked'], ['lost']] as const)('splatOn is always false for %s', (o) => {
    const f = flight(o, R);
    expect(times(0, 30).some((t) => splatOn(f, t))).toBe(false);
  });

  /**
   * Verifies that the dropping falls during the DROP_S seconds before the splat
   */
  it('dropFall gives the fall progress before the splat', () => {
    const f = flight('dropping', R);
    const at = splatStart(f)!;
    expect(dropFall(f, at - DROP_S - EPS)).toBeUndefined();
    expect(dropFall(f, at - DROP_S / 2)).toBeCloseTo(0.5);
    expect(dropFall(f, at + EPS)).toBeUndefined();
  });

  /**
   * Verifies that the dropping leaves while the pigeon hovers over the head
   */
  it('drops during the hovering phase', () => {
    const f = flight('dropping', R);
    // Samples right at the fall's start are skipped: float rounding can put them on either side.
    const falling = times(R, R + 10).filter((now) => (dropFall(f, now) ?? 0) > 0.01);
    expect(falling.length).toBeGreaterThan(0);
    for (const t of falling) {
      expect(phaseAt(f, t).phase).toBe('hovering');
    }
  });

  /**
   * Verifies that dropFall is undefined for other outcomes
   */
  it.each([['back'], ['plucked'], ['lost']] as const)('dropFall is always undefined for %s', (o) => {
    const f = flight(o, R);
    expect(times(0, 30).every((t) => dropFall(f, t) === undefined)).toBe(true);
  });
});

describe('flightOver', () => {
  /**
   * Verifies that a flight still in sight is not over
   */
  it('is false before the pigeon is gone', () => {
    expect(flightOver(flight(undefined), 1000)).toBe(false);
    expect(flightOver(flight('back', 10), 10 + RETURN_S / 2)).toBe(false);
  });

  /**
   * Verifies that a back flight is over as soon as the pigeon is gone
   */
  it('is true as soon as a back pigeon is gone', () => {
    const R = 10;
    expect(flightOver(flight('back', R), R + RETURN_S + LAND_S + EPS)).toBe(true);
  });

  /**
   * Verifies that a dropping flight lasts until the splat disappears
   */
  it('waits for the splat to end for dropping', () => {
    const f = flight('dropping', 10);
    const end = splatStart(f)! + SPLAT_S;
    expect(flightOver(f, end - EPS)).toBe(false);
    expect(flightOver(f, end + EPS)).toBe(true);
  });

  /**
   * Verifies that a lost flight lasts until its single feather has fallen
   */
  it('waits for the lost feather for lost', () => {
    const f = flight('lost', 10);
    expect(flightOver(f, 10 + EPS)).toBe(false);
    expect(flightOver(f, 10 + LOST_FEATHER_FALL_S + EPS)).toBe(true);
  });

  /**
   * Verifies that once over, nothing of the flight shows and it stays over
   */
  it.each(PIGEON_OUTCOMES.map((o) => [o]))('hides everything once over and stays over, for %s', (o) => {
    const f = flight(o);
    let over = false;
    // Off-grid samples, so no sample lands exactly on a float-rounded boundary.
    for (const t of times(0.0037, 30)) {
      const now = flightOver(f, t);
      if (over) expect(now).toBe(true);
      over = now;
      if (now) {
        expect(pigeonPoint(f, t, PLACES)).toBeNull();
        expect(feathersAt(f, t, PLACES)).toEqual([]);
        expect(splatOn(f, t)).toBe(false);
        expect(dropFall(f, t)).toBeUndefined();
      }
    }
    expect(over).toBe(true);
  });
});

describe('geometry: skyOf, arcPoint', () => {
  /**
   * Verifies that the sky point is above the nest, same x, further north (lower z)
   */
  it('skyOf lies above and north of the nest', () => {
    const sky = skyOf(PLACES.nest);
    expect(sky[0]).toBe(PLACES.nest[0]);
    expect(sky[1]).toBeGreaterThan(PLACES.nest[1]);
    expect(sky[2]).toBeLessThan(PLACES.nest[2]);
  });

  const A: V3 = [0, 0, 0];
  const B: V3 = [10, 4, -6];

  /**
   * Verifies that the arc starts at a and ends at b
   */
  it('arcPoint goes from a at t=0 to b at t=1', () => {
    expectClose(arcPoint(A, B, 0), A);
    expectClose(arcPoint(A, B, 1), B);
  });

  /**
   * Verifies that progress outside [0, 1] is clamped to the end points
   */
  it('arcPoint clamps t', () => {
    expectClose(arcPoint(A, B, -2), A);
    expectClose(arcPoint(A, B, 3), B);
  });

  /**
   * Verifies that the middle of the arc is raised by exactly `arc` above the chord
   */
  it('arcPoint raises the middle by arc', () => {
    expectClose(arcPoint(A, B, 0.5, 2), [5, 2 + 2, -3]);
    expectClose(arcPoint(A, B, 0.5, 0), [5, 2, -3]);
  });

  /**
   * Verifies that the default arc lifts the middle above the straight line
   */
  it('arcPoint uses a positive default arc', () => {
    expect(arcPoint(A, B, 0.5)[1]).toBeGreaterThan(2);
  });
});

describe('pigeonPoint', () => {
  const R = 10;
  const over: V3 = [PLACES.head[0], PLACES.head[1], PLACES.head[2]];

  /**
   * Verifies that the pigeon leaves from the nest towards the sky
   */
  it('starts at the nest and reaches the sky on take-off', () => {
    const f = flight('back', R);
    expectClose(pigeonPoint(f, 0, PLACES), PLACES.nest);
    expectClose(pigeonPoint(f, LEAVE_S - 1e-6, PLACES), skyOf(PLACES.nest), 3);
  });

  /**
   * Verifies that the pigeon is out of sight while away and once gone
   */
  it('is null while away and once gone', () => {
    expect(pigeonPoint(flight(undefined), LEAVE_S + EPS, PLACES)).toBeNull();
    expect(pigeonPoint(flight('back', R), R - EPS, PLACES)).toBeNull();
    expect(pigeonPoint(flight('back', R), R + RETURN_S + LAND_S + EPS, PLACES)).toBeNull();
    expect(pigeonPoint(flight('lost', R), R + EPS, PLACES)).toBeNull();
  });

  /**
   * Verifies that a back pigeon flies from the sky to the nest and sits there
   */
  it('brings a back pigeon home to the nest', () => {
    const f = flight('back', R);
    expectClose(pigeonPoint(f, R, PLACES), skyOf(PLACES.nest));
    expectClose(pigeonPoint(f, R + RETURN_S - 1e-6, PLACES), PLACES.nest, 3);
    expect(pigeonPoint(f, R + RETURN_S + LAND_S / 2, PLACES)).toEqual(PLACES.nest);
  });

  /**
   * Verifies that a dropping pigeon flies over the head, hovers above it, then homes
   */
  it('sends a dropping pigeon over the head before homing', () => {
    const f = flight('dropping', R);
    const arrive = pigeonPoint(f, R + RETURN_S - 1e-6, PLACES)!;
    expect(arrive[0]).toBeCloseTo(over[0], 3);
    expect(arrive[2]).toBeCloseTo(over[2], 3);
    expect(arrive[1]).toBeGreaterThan(PLACES.head[1]);

    for (const t of times(R + RETURN_S + EPS, R + RETURN_S + HOVER_S - EPS)) {
      const p = pigeonPoint(f, t, PLACES)!;
      expect(p[0]).toBeCloseTo(over[0], 3);
      expect(p[2]).toBeCloseTo(over[2], 3);
      expect(p[1]).toBeGreaterThan(PLACES.head[1]);
    }

    expectClose(pigeonPoint(f, R + 2 * RETURN_S + HOVER_S - 1e-6, PLACES), PLACES.nest, 3);
    expect(pigeonPoint(f, R + 2 * RETURN_S + HOVER_S + LAND_S / 2, PLACES)).toEqual(PLACES.nest);
  });
});

describe('feathersAt', () => {
  const R = 10;

  /**
   * Verifies that a plucked pigeon loses PLUCKED_FEATHERS feathers for FEATHER_FALL_S, on its way back
   */
  it('bursts PLUCKED_FEATHERS feathers for FEATHER_FALL_S on the way back', () => {
    const f = flight('plucked', R);
    const shown = times(0, 30).filter((t) => feathersAt(f, t, PLACES).length > 0);
    for (const t of shown) expect(feathersAt(f, t, PLACES)).toHaveLength(PLUCKED_FEATHERS);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown[0]).toBeGreaterThanOrEqual(R);
    expect(shown[0]).toBeLessThan(R + RETURN_S);
    expect(shown.at(-1)! - shown[0]).toBeCloseTo(FEATHER_FALL_S, 1);
  });

  /**
   * Verifies that the plucked feathers fall (lower at the end of the burst than at its start)
   */
  it('makes plucked feathers fall', () => {
    const f = flight('plucked', R);
    const shown = times(0, 30).filter((t) => feathersAt(f, t, PLACES).length > 0);
    const first = feathersAt(f, shown[0], PLACES);
    const last = feathersAt(f, shown.at(-1)!, PLACES);
    expect(last[0].pos[1]).toBeLessThan(first[0].pos[1]);
  });

  /**
   * Verifies that a lost pigeon drops one feather from returnAt for LOST_FEATHER_FALL_S
   */
  it('drops a single feather for a lost pigeon', () => {
    const f = flight('lost', R);
    expect(feathersAt(f, R - EPS, PLACES)).toEqual([]);
    expect(feathersAt(f, R, PLACES)).toHaveLength(1);
    expect(feathersAt(f, R + LOST_FEATHER_FALL_S - EPS, PLACES)).toHaveLength(1);
    expect(feathersAt(f, R + LOST_FEATHER_FALL_S + EPS, PLACES)).toEqual([]);
  });

  /**
   * Verifies that the lost feather drifts down towards the nest
   */
  it('makes the lost feather fall from above the nest', () => {
    const f = flight('lost', R);
    const start = feathersAt(f, R, PLACES)[0].pos;
    const end = feathersAt(f, R + LOST_FEATHER_FALL_S - EPS, PLACES)[0].pos;
    expect(start[1]).toBeGreaterThan(PLACES.nest[1]);
    expect(end[1]).toBeLessThan(start[1]);
    expect(end[1]).toBeCloseTo(PLACES.nest[1], 1);
  });

  /**
   * Verifies that back, dropping and unanswered flights shed no feathers
   */
  it.each([['back'], ['dropping'], [undefined]] as const)('sheds nothing for %s', (o) => {
    const f = flight(o, R);
    expect(times(0, 30).every((t) => feathersAt(f, t, PLACES).length === 0)).toBe(true);
  });

  /**
   * Verifies that feathers are deterministic for the same flight and time
   */
  it('is deterministic', () => {
    const t = R + RETURN_S;
    const a = feathersAt(flight('plucked', R, 3), t, PLACES);
    const b = feathersAt(flight('plucked', R, 3), t, PLACES);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });
});

describe('Pigeons', () => {
  /**
   * Verifies that launch creates a pending flight with a fresh id
   */
  it('launch adds a pending flight per call', () => {
    const p = new Pigeons();
    const a = p.launch('sm', 1)!;
    const b = p.launch('sm', 2)!;
    expect(a).toMatchObject({ agentId: 'sm', startedAt: 1 });
    expect(a.outcome).toBeUndefined();
    expect(a.returnAt).toBeUndefined();
    expect(b.id).not.toBe(a.id);
    expect(p.flights).toEqual([a, b]);
  });

  /**
   * Verifies that no more than MAX_PIGEONS pigeons fly at once
   */
  it('caps launches at MAX_PIGEONS', () => {
    const p = new Pigeons();
    for (let i = 0; i < MAX_PIGEONS; i++) expect(p.launch('sm', 0)).not.toBeNull();
    expect(p.launch('sm', 0)).toBeNull();
    expect(p.launch('other', 1)).toBeNull();
    expect(p.flights).toHaveLength(MAX_PIGEONS);
  });

  /**
   * Verifies that a gone pigeon frees its slot even while its feather still falls
   */
  it('does not count gone flights against the cap', () => {
    const p = new Pigeons();
    const flights = Array.from({ length: MAX_PIGEONS }, () => p.launch('sm', 0)!);
    expect(p.land('sm', 'lost', 0)).toBe(true);
    const now = EARLIEST_RETURN + EPS;
    expect(phaseAt(flights[0], now).phase).toBe('gone');
    expect(flightOver(flights[0], now)).toBe(false);
    expect(p.launch('sm', now)).not.toBeNull();
    expect(p.flights).toHaveLength(MAX_PIGEONS + 1);
  });

  /**
   * Verifies that outcomes are paired first in, first out, per agent
   */
  it('land pairs outcomes FIFO per agent', () => {
    const p = new Pigeons();
    const a1 = p.launch('a', 0)!;
    const b1 = p.launch('b', 0.1)!;
    const a2 = p.launch('a', 0.2)!;
    expect(p.land('a', 'back', 0.5)).toBe(true);
    expect(a1.outcome).toBe('back');
    expect(a2.outcome).toBeUndefined();
    expect(b1.outcome).toBeUndefined();
    expect(p.land('a', 'plucked', 0.6)).toBe(true);
    expect(a2.outcome).toBe('plucked');
    expect(b1.outcome).toBeUndefined();
  });

  /**
   * Verifies that land returns false and changes nothing without a pending flight
   */
  it('land returns false without a pending flight', () => {
    const p = new Pigeons();
    expect(p.land('sm', 'back', 0)).toBe(false);
    const f = p.launch('sm', 0)!;
    expect(p.land('other', 'back', 0.1)).toBe(false);
    expect(f.outcome).toBeUndefined();
    expect(p.land('sm', 'back', 0.2)).toBe(true);
    expect(p.land('sm', 'lost', 0.3)).toBe(false);
    expect(f.outcome).toBe('back');
  });

  /**
   * Verifies that a fast answer still waits for take-off plus the shortest absence
   */
  it('land never sets returnAt before startedAt + LEAVE_S + MIN_AWAY_S', () => {
    const p = new Pigeons();
    const f = p.launch('sm', 5)!;
    p.land('sm', 'back', 5.1);
    expect(f.returnAt).toBeCloseTo(5 + LEAVE_S + MIN_AWAY_S);
  });

  /**
   * Verifies that a slow answer starts the pigeon back at the answer time
   */
  it('land sets returnAt to now for a slow answer', () => {
    const p = new Pigeons();
    const f = p.launch('sm', 5)!;
    p.land('sm', 'dropping', 30);
    expect(f.returnAt).toBe(30);
  });

  /**
   * Verifies that force launches a flight whose outcome is already set
   */
  it('force launches a settled flight', () => {
    const p = new Pigeons();
    const f = p.force('sm', 'dropping', 3)!;
    expect(f).toMatchObject({ agentId: 'sm', startedAt: 3, outcome: 'dropping' });
    expect(f.returnAt).toBeCloseTo(3 + LEAVE_S + MIN_AWAY_S);
    expect(p.flights).toContain(f);
  });

  /**
   * Verifies that a forced flight does not take the outcome of a real pending call
   */
  it('force leaves pending calls to land', () => {
    const p = new Pigeons();
    const real = p.launch('sm', 0)!;
    const forced = p.force('sm', 'back', 0.1)!;
    expect(p.land('sm', 'plucked', 0.2)).toBe(true);
    expect(real.outcome).toBe('plucked');
    expect(forced.outcome).toBe('back');
  });

  /**
   * Verifies that force respects the MAX_PIGEONS cap
   */
  it('force returns null when the sky is full', () => {
    const p = new Pigeons();
    for (let i = 0; i < MAX_PIGEONS; i++) p.launch('sm', 0);
    expect(p.force('sm', 'back', 0)).toBeNull();
    expect(p.flights).toHaveLength(MAX_PIGEONS);
  });

  /**
   * Verifies that an unanswered call is lost exactly after LOST_TIMEOUT_S
   */
  it('update times out unanswered flights to lost', () => {
    const p = new Pigeons();
    const f = p.launch('sm', 0)!;
    p.update(LOST_TIMEOUT_S - EPS);
    expect(f.outcome).toBeUndefined();
    p.update(LOST_TIMEOUT_S);
    expect(f.outcome).toBe('lost');
    expect(f.returnAt).toBe(LOST_TIMEOUT_S);
    expect(p.land('sm', 'back', LOST_TIMEOUT_S + EPS)).toBe(false);
  });

  /**
   * Verifies that a timed-out flight is removed once its feather has fallen
   */
  it('update removes a timed-out flight after its feather', () => {
    const p = new Pigeons();
    p.launch('sm', 0);
    p.update(LOST_TIMEOUT_S);
    expect(p.flights).toHaveLength(1);
    p.update(LOST_TIMEOUT_S + LOST_FEATHER_FALL_S + EPS);
    expect(p.flights).toEqual([]);
  });

  /**
   * Verifies that update removes over flights and keeps the others
   */
  it('update removes only finished flights', () => {
    const p = new Pigeons();
    const done = p.force('a', 'back', 0)!;
    const pending = p.launch('b', 0)!;
    p.update(EARLIEST_RETURN + RETURN_S + LAND_S + EPS);
    expect(p.flights).not.toContain(done);
    expect(p.flights).toContain(pending);
  });

  /**
   * Verifies that launch first times out stale flights, freeing their slots
   */
  it('launch frees slots of flights that timed out', () => {
    const p = new Pigeons();
    for (let i = 0; i < MAX_PIGEONS; i++) p.launch('sm', 0);
    expect(p.launch('sm', LOST_TIMEOUT_S - EPS)).toBeNull();
    expect(p.launch('sm', LOST_TIMEOUT_S)).not.toBeNull();
  });
});

describe('Pigeons.start', () => {
  /** A Pigeons whose sky is full of pending flights of `agentId`, launched at 0 with `start`. */
  function full(agentId = 'sm'): { p: Pigeons; flights: Flight[] } {
    const p = new Pigeons();
    const flights = Array.from({ length: MAX_PIGEONS }, () => p.start(agentId, 0)!);
    return { p, flights };
  }

  /**
   * Verifies that start below the cap sends a pending pigeon, landed normally
   */
  it('sends a pending pigeon like launch when the sky has room', () => {
    const p = new Pigeons();
    const f = p.start('sm', 2)!;
    expect(f).toMatchObject({ agentId: 'sm', startedAt: 2 });
    expect(f.outcome).toBeUndefined();
    expect(p.flights).toEqual([f]);
    expect(p.land('sm', 'back', 2.5)).toBe(true);
    expect(f.outcome).toBe('back');
  });

  /** The silent flights currently held by `p`. */
  function silents(p: Pigeons): Flight[] {
    return p.flights.filter((f) => f.silent);
  }

  /**
   * Verifies that a blocked start returns null and queues one silent flight for the call
   */
  it('returns null and queues a silent flight when the sky is full', () => {
    const { p, flights } = full();
    expect(p.start('sm', 0.1)).toBeNull();
    expect(p.flights).toHaveLength(MAX_PIGEONS + 1);
    expect(p.flights.slice(0, MAX_PIGEONS)).toEqual(flights);
    const [s] = silents(p);
    expect(s).toMatchObject({ silent: true, agentId: 'sm', startedAt: 0.1 });
    expect(s.outcome).toBeUndefined();
    expect(flights.map((f) => f.id)).not.toContain(s.id);
  });

  /**
   * Verifies that a start with room never creates a silent flight
   */
  it('sends no silent flight when the sky has room', () => {
    const { p, flights } = full();
    expect(flights.every((f) => !f.silent)).toBe(true);
    expect(silents(p)).toEqual([]);
  });

  /**
   * Verifies that with 4 pigeons up and a 5th call blocked, ends pair in call order
   */
  it('pairs 4 flights then the blocked call in call order', () => {
    const { p, flights } = full();
    expect(p.start('sm', 0.1)).toBeNull();
    const [s] = silents(p);
    const outcomes: PigeonOutcome[] = ['back', 'plucked', 'dropping', 'lost'];
    outcomes.forEach((o, i) => {
      expect(p.land('sm', o, 0.2 + i * 0.1)).toBe(true);
      expect(flights[i].outcome).toBe(o);
      for (const f of flights.slice(i + 1)) expect(f.outcome).toBeUndefined();
      expect(s.outcome).toBeUndefined();
    });
    expect(p.land('sm', 'back', 0.7)).toBe(false);
    expect(s.outcome).toBeDefined();
    // Nothing is left to settle.
    expect(p.land('sm', 'back', 0.8)).toBe(false);
    expect(flights.map((f) => f.outcome)).toEqual(outcomes);
  });

  /**
   * Verifies that a silent call settles before a later real flight of the same agent
   */
  it('settles a silent call before a real flight started after it', () => {
    const { p, flights } = full('a');
    expect(p.start('b', 0.1)).toBeNull();
    const [s] = silents(p);
    expect(p.land('a', 'lost', 0.2)).toBe(true);

    // The lost pigeon is gone once it starts back: its slot is free for b.
    const now = EARLIEST_RETURN + EPS;
    const b = p.start('b', now)!;
    expect(b).not.toBeNull();
    expect(b.silent).toBeFalsy();
    expect(p.land('b', 'plucked', now + 0.1)).toBe(false);
    expect(s.outcome).toBeDefined();
    expect(b.outcome).toBeUndefined();
    expect(p.land('b', 'back', now + 0.2)).toBe(true);
    expect(b.outcome).toBe('back');
    for (const f of flights.slice(1)) expect(f.outcome).toBeUndefined();
  });

  /**
   * Verifies that one agent's silent call never takes another agent's call end
   */
  it('keeps each agent queue independent', () => {
    const { p, flights } = full('a');
    expect(p.start('b', 0.1)).toBeNull();
    const [s] = silents(p);
    expect(p.land('a', 'back', 0.2)).toBe(true);
    expect(flights[0].outcome).toBe('back');
    expect(s.outcome).toBeUndefined();
    expect(p.land('c', 'back', 0.3)).toBe(false);
    expect(s.outcome).toBeUndefined();
    expect(p.land('b', 'dropping', 0.4)).toBe(false);
    expect(s.outcome).toBeDefined();
    for (const f of flights.slice(1)) expect(f.outcome).toBeUndefined();
    expect(p.land('a', 'plucked', 0.5)).toBe(true);
    expect(flights[1].outcome).toBe('plucked');
  });

  /**
   * Verifies that pending silent flights take no slot under the MAX_PIGEONS cap
   */
  it('does not count silent flights against the cap', () => {
    const { p } = full('a');
    for (let i = 0; i < 3; i++) expect(p.start('b', 0.1 + i * 0.01)).toBeNull();
    expect(silents(p)).toHaveLength(3);
    expect(p.land('a', 'lost', 0.2)).toBe(true);
    const now = EARLIEST_RETURN + EPS;
    const f = p.start('c', now);
    expect(f).not.toBeNull();
    expect(f!.silent).toBeFalsy();
    expect(silents(p)).toHaveLength(3);
    // The sky is full again: the next call is silent.
    expect(p.start('c', now + 0.1)).toBeNull();
    expect(silents(p)).toHaveLength(4);
  });

  /**
   * Verifies that an unanswered silent call expires after LOST_TIMEOUT_S, then is dropped
   */
  it('times out a silent flight and keeps a later call end for its real flight', () => {
    const { p } = full('a');
    expect(p.start('b', 1)).toBeNull();
    const [s] = silents(p);

    p.update(1 + LOST_TIMEOUT_S - EPS);
    expect(s.outcome).toBeUndefined();
    expect(p.flights).toContain(s);

    p.update(1 + LOST_TIMEOUT_S);
    expect(s.outcome).toBe('lost');
    expect(phaseAt(s, 1 + LOST_TIMEOUT_S).phase).toBe('gone');
    expect(p.flights).not.toContain(s);

    // A later call of b sends a real pigeon (a's pigeons are lost), and its end pairs with it.
    const later = 1 + LOST_TIMEOUT_S + 1;
    const b = p.start('b', later)!;
    expect(b).not.toBeNull();
    expect(b.silent).toBeFalsy();
    expect(p.land('b', 'back', later + 0.5)).toBe(true);
    expect(b.outcome).toBe('back');
  });

  /**
   * Verifies that a silent flight settled by land is removed at the next update
   */
  it('removes a settled silent flight on update', () => {
    const { p, flights } = full();
    expect(p.start('sm', 0.1)).toBeNull();
    const [s] = silents(p);
    for (let i = 0; i < MAX_PIGEONS; i++) p.land('sm', 'back', 0.2);
    expect(p.land('sm', 'back', 0.3)).toBe(false);
    p.update(0.4);
    expect(p.flights).not.toContain(s);
    expect(p.flights).toEqual(flights);
  });

  /**
   * Verifies that a silent flight stays away until settled, then is gone and over
   */
  it('phaseAt and flightOver of a silent flight follow its settlement only', () => {
    const s: Flight = { id: 9, agentId: 'sm', startedAt: 0, silent: true };
    for (const now of [-1, 0, LEAVE_S / 2, LEAVE_S + EPS, 1000]) {
      expect(phaseAt(s, now)).toEqual({ phase: 'away', t: 0 });
      expect(flightOver(s, now)).toBe(false);
    }
    for (const o of PIGEON_OUTCOMES) {
      const settled: Flight = { ...s, outcome: o, returnAt: EARLIEST_RETURN };
      for (const now of [0, EARLIEST_RETURN, 30]) {
        expect(phaseAt(settled, now)).toEqual({ phase: 'gone', t: 1 });
        expect(flightOver(settled, now)).toBe(true);
      }
    }
  });

  /**
   * Verifies that a silent flight is never drawn: no pigeon, feather or dropping
   */
  it.each([[undefined], ...PIGEON_OUTCOMES.map((o) => [o])] as [PigeonOutcome | undefined][])(
    'never draws a silent flight with outcome %s',
    (o) => {
      const s: Flight = {
        id: 9,
        agentId: 'sm',
        startedAt: 0,
        silent: true,
        outcome: o,
        returnAt: o === undefined ? undefined : EARLIEST_RETURN,
      };
      expect(splatStart(s)).toBeUndefined();
      for (const now of times(-1, 30)) {
        expect(pigeonPoint(s, now, PLACES)).toBeNull();
        expect(feathersAt(s, now, PLACES)).toEqual([]);
        expect(splatOn(s, now)).toBe(false);
        expect(dropFall(s, now)).toBeUndefined();
      }
    },
  );

  /**
   * Verifies that a silent flight queued by start and settled by land shows nothing
   */
  it('draws nothing for a silent call ended with dropping', () => {
    const { p } = full();
    expect(p.start('sm', 0.1)).toBeNull();
    const [s] = silents(p);
    for (let i = 0; i < MAX_PIGEONS; i++) p.land('sm', 'back', 0.2);
    p.land('sm', 'dropping', 0.3);
    expect(s.outcome).toBe('dropping');
    expect(splatStart(s)).toBeUndefined();
    for (const now of times(0, 30)) {
      expect(pigeonPoint(s, now, PLACES)).toBeNull();
      expect(splatOn(s, now)).toBe(false);
      expect(dropFall(s, now)).toBeUndefined();
    }
  });

  /**
   * Verifies that a launch blocked by the cap queues no silent flight
   */
  it('launch never creates a silent flight', () => {
    const p = new Pigeons();
    const flights = Array.from({ length: MAX_PIGEONS }, () => p.launch('sm', 0)!);
    expect(p.launch('sm', 0.1)).toBeNull();
    expect(p.flights).toEqual(flights);
    expect(silents(p)).toEqual([]);
    expect(p.land('sm', 'plucked', 0.2)).toBe(true);
    expect(flights[0].outcome).toBe('plucked');
  });

  /**
   * Verifies that a force blocked by the cap queues no silent flight
   */
  it('force never creates a silent flight', () => {
    const { p, flights } = full();
    expect(p.force('sm', 'back', 0.1)).toBeNull();
    expect(p.flights).toEqual(flights);
    expect(silents(p)).toEqual([]);
    expect(p.land('sm', 'dropping', 0.2)).toBe(true);
    expect(flights[0].outcome).toBe('dropping');
  });
});

describe('freshEvents', () => {
  interface Ev {
    seq: number;
  }
  const ev = (seq: number): Ev => ({ seq });

  /**
   * Verifies that the very same list yields no fresh event
   */
  it('returns [] for the same array', () => {
    const list = [ev(3), ev(2), ev(1)];
    expect(freshEvents(list, list)).toEqual([]);
  });

  /**
   * Verifies that a new array holding the same entries yields no fresh event
   */
  it('returns [] when next starts with prev head', () => {
    const [c, b, a] = [ev(3), ev(2), ev(1)];
    expect(freshEvents([c, b, a], [c, b, a])).toEqual([]);
  });

  /**
   * Verifies that with an empty previous list every entry is fresh, oldest first
   */
  it('returns all of next reversed when prev is empty', () => {
    const [c, b, a] = [ev(3), ev(2), ev(1)];
    const out = freshEvents([c, b, a], []);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
    expect(out[2]).toBe(c);
  });

  /**
   * Verifies that two empty lists yield no fresh event
   */
  it('returns [] when both lists are empty', () => {
    expect(freshEvents([], [])).toEqual([]);
  });

  /**
   * Verifies that an emptied next list yields no fresh event
   */
  it('returns [] when next is empty and prev is not', () => {
    expect(freshEvents([], [ev(1)])).toEqual([]);
  });

  /**
   * Verifies that entries added in front of prev are returned oldest first
   */
  it('returns the entries in front of prev head, oldest first', () => {
    const [e, d, c, b, a] = [ev(5), ev(4), ev(3), ev(2), ev(1)];
    const out = freshEvents([e, d, c, b, a], [c, b, a]);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(d);
    expect(out[1]).toBe(e);
  });

  /**
   * Verifies that a list capped at its end (old entries sliced off) still works
   */
  it('works when next was capped and lost its oldest entries', () => {
    const [e, d, c, b, a] = [ev(5), ev(4), ev(3), ev(2), ev(1)];
    const prev = [c, b, a];
    const next = [e, d, c, b, a].slice(0, 3);
    const out = freshEvents(next, prev);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(d);
    expect(out[1]).toBe(e);
  });

  /**
   * Verifies that when prev head is no longer in next, nothing is returned
   */
  it('returns [] when prev head is not found in next', () => {
    const [d, c, b, a] = [ev(4), ev(3), ev(2), ev(1)];
    expect(freshEvents([d, c], [b, a])).toEqual([]);
  });

  /**
   * Verifies that entries are matched by reference, not by equal content
   */
  it('does not match a structurally equal copy of prev head', () => {
    const a = ev(1);
    const copy = ev(1);
    expect(copy).toEqual(a);
    expect(freshEvents([ev(2), copy], [a])).toEqual([]);
  });

  /**
   * Verifies that new events with lower seq than old ones (server restart) are returned
   */
  it('returns new events whose seq restarted below the old ones', () => {
    const old2 = ev(50);
    const old1 = ev(49);
    const new1 = ev(1);
    const new2 = ev(2);
    const out = freshEvents([new2, new1, old2, old1], [old2, old1]);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(new1);
    expect(out[1]).toBe(new2);
  });

  /**
   * Verifies that a new event reusing the seq of an old one (restart) is still fresh
   */
  it('returns a new event reusing an old seq', () => {
    const old = ev(1);
    const reused = ev(1);
    const out = freshEvents([reused, old], [old]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(reused);
  });

  /**
   * Verifies that neither input list is modified
   */
  it('does not mutate its inputs', () => {
    const [c, b, a] = [ev(3), ev(2), ev(1)];
    const next = [c, b, a];
    const prev = [a];
    freshEvents(next, prev);
    freshEvents(next, []);
    expect(next).toEqual([c, b, a]);
    expect(next[0]).toBe(c);
    expect(prev).toEqual([a]);
  });
});
