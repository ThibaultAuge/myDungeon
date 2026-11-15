import { describe, expect, it, vi } from 'vitest';
import { BOUNDS, CORRIDORS, GATE, ROOM_BY_ID, inFootprint, type Point } from '../src/scene/layout.ts';
import { WANDER_POINTS, seededRandom } from '../src/scene/ghost.ts';
import {
  CHEESE_BACK_MS,
  CHEESE_GROW_MS,
  CHEESE_SPOT,
  EMERGE_MS,
  GRAB_MS,
  MOUTH_AHEAD,
  HOP_HEIGHT,
  HOP_MS,
  PASS_MAX_MS,
  PASS_MIN_MS,
  RAT_HOLES,
  RAT_SPEED,
  TABLE_LANDING,
  TABLE_TOP,
  TAVERN_GATE,
  TAVERN_WAY,
  THEFT_CHANCE,
  cheeseScale,
  emergeScale,
  holeMouth,
  installRatCommand,
  nextPassDelay,
  pickPass,
  planRun,
  sampleRun,
  type RatLeg,
  type RatPass,
  type RatRun,
} from '../src/scene/rat.ts';

const EPS = 1e-6;
const HOLE_DEPTH = 0.6;
const SEEDS = Array.from({ length: 60 }, (_, i) => `rat-${i}`);
const TAVERN = ROOM_BY_ID.get('taverne')!;
const MIDDLE_TABLE = TAVERN.props.filter((p) => p.kind === 'longTable').sort((a, b) => a.z - b.z)[1];

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const same = (a: Point, b: Point) => dist(a, b) < EPS;

function onEdge(p: Point): boolean {
  return (
    p.x - BOUNDS.x0 <= HOLE_DEPTH ||
    BOUNDS.x1 - p.x <= HOLE_DEPTH ||
    p.z - BOUNDS.z0 <= HOLE_DEPTH ||
    BOUNDS.z1 - p.z <= HOLE_DEPTH
  );
}

function insideBounds(p: Point): boolean {
  return p.x > BOUNDS.x0 && p.x < BOUNDS.x1 && p.z > BOUNDS.z0 && p.z < BOUNDS.z1;
}

/** True when p lies on one of the corridor centre lines. */
function onCorridor(p: Point): boolean {
  return CORRIDORS.some(([a, b]) => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2;
    if (t < -EPS || t > 1 + EPS) return false;
    return Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z) < EPS;
  });
}

function insideTavern(p: Point): boolean {
  return Math.abs(p.x - TAVERN.cx) < TAVERN.w / 2 && Math.abs(p.z - TAVERN.cz) < TAVERN.d / 2;
}

function isFloorLeg(leg: RatLeg): boolean {
  return !leg.hop && leg.from.y === 0 && leg.to.y === 0;
}

/** Start time of each leg, accumulated in the same order as the planner. */
function legStarts(run: RatRun): number[] {
  const starts: number[] = [];
  let t = 0;
  for (const leg of run.legs) {
    starts.push(t);
    t += leg.ms;
  }
  return starts;
}

function runs(kind: RatPass): RatRun[] {
  return SEEDS.map((s) => planRun(kind, seededRandom(`${kind}-${s}`)));
}

const CORRIDOR_RUNS = runs('corridor');
const CHEESE_RUNS = runs('cheese');
const ALL_RUNS = [...CORRIDOR_RUNS, ...CHEESE_RUNS];

describe('RAT_HOLES', () => {
  /** Verifies that there is at least one hole and each lies against the outer wall */
  it('is non-empty and every hole is on the edge of the map', () => {
    expect(RAT_HOLES.length).toBeGreaterThan(0);
    for (const h of RAT_HOLES) expect(onEdge(h), JSON.stringify(h)).toBe(true);
  });

  /** Verifies that the holes are exactly the corridor ends lying on the edge, except the open castle gate */
  it('keeps every edge corridor end but the gate, and no inner one', () => {
    const gate = (p: Point) => BOUNDS.z1 - p.z <= 0.6 && p.x >= GATE.lo && p.x <= GATE.hi;
    expect(WANDER_POINTS.some(gate)).toBe(true);
    for (const p of WANDER_POINTS) {
      expect(RAT_HOLES.some((h) => same(h, p)), JSON.stringify(p)).toBe(onEdge(p) && !gate(p));
    }
  });

  /** Verifies that every hole is on a corridor, so the rat can run from it */
  it('lies on a corridor', () => {
    for (const h of RAT_HOLES) expect(onCorridor(h), JSON.stringify(h)).toBe(true);
  });
});

describe('holeMouth', () => {
  /** Verifies that every hole's mouth is 0.6 m behind it, outside the map bounds */
  it('puts the mouth of every hole 0.6 m away, outside the bounds', () => {
    for (const h of RAT_HOLES) {
      const m = holeMouth(h);
      expect(dist(m, h)).toBeCloseTo(HOLE_DEPTH);
      expect(insideBounds(m), JSON.stringify(m)).toBe(false);
    }
  });

  /** Verifies that the mouth goes outward through the nearest wall on each side */
  it.each([
    ['west', { x: BOUNDS.x0 + 0.1, z: 0 }, { x: BOUNDS.x0 + 0.1 - HOLE_DEPTH, z: 0 }],
    ['east', { x: BOUNDS.x1 - 0.1, z: 0 }, { x: BOUNDS.x1 - 0.1 + HOLE_DEPTH, z: 0 }],
    ['north', { x: 0, z: BOUNDS.z0 + 0.1 }, { x: 0, z: BOUNDS.z0 + 0.1 - HOLE_DEPTH }],
    ['south', { x: 0, z: BOUNDS.z1 - 0.1 }, { x: 0, z: BOUNDS.z1 - 0.1 + HOLE_DEPTH }],
  ])('goes out through the %s wall', (_, hole, mouth) => {
    const m = holeMouth(hole);
    expect(m.x).toBeCloseTo(mouth.x);
    expect(m.z).toBeCloseTo(mouth.z);
  });

  /** Verifies that the mouth moves away from the map interior, never towards it */
  it('moves away from the map centre', () => {
    const centre = { x: (BOUNDS.x0 + BOUNDS.x1) / 2, z: (BOUNDS.z0 + BOUNDS.z1) / 2 };
    for (const h of RAT_HOLES) expect(dist(holeMouth(h), centre)).toBeGreaterThan(dist(h, centre));
  });
});

describe('planRun shared properties', () => {
  /** Verifies that legs chain end to start, so the rat never teleports between legs */
  it('chains every leg to the next one', () => {
    for (const run of ALL_RUNS) {
      for (let i = 1; i < run.legs.length; i++) {
        const prev = run.legs[i - 1].to;
        const next = run.legs[i].from;
        expect(same(prev, next) && Math.abs(prev.y - next.y) < EPS, `${run.kind} leg ${i}`).toBe(true);
      }
    }
  });

  /** Verifies that the total duration is the sum of the legs, each one positive */
  it('totals the legs durations', () => {
    for (const run of ALL_RUNS) {
      let total = 0;
      for (const leg of run.legs) {
        expect(leg.ms).toBeGreaterThan(0);
        total += leg.ms;
      }
      expect(run.ms).toBeCloseTo(total, 6);
    }
  });

  /** Verifies that floor legs last exactly their length at the rat's running speed */
  it('runs floor legs at RAT_SPEED', () => {
    for (const run of ALL_RUNS) {
      for (const leg of run.legs) {
        if (!isFloorLeg(leg) || same(leg.from, leg.to)) continue;
        expect(leg.ms).toBeCloseTo((dist(leg.from, leg.to) / RAT_SPEED) * 1000, 6);
      }
    }
  });

  /** Verifies that the same random sequence gives the same run */
  it('is deterministic for a given random source', () => {
    expect(planRun('cheese', seededRandom('same'))).toEqual(planRun('cheese', seededRandom('same')));
    expect(planRun('corridor', seededRandom('same'))).toEqual(planRun('corridor', seededRandom('same')));
  });

  /** Verifies that a run starts and ends at the mouth of a hole */
  it('starts and ends at a hole mouth', () => {
    for (const run of ALL_RUNS) {
      const first = run.legs[0];
      const last = run.legs[run.legs.length - 1];
      const startHole = RAT_HOLES.find((h) => same(first.to, h));
      const endHole = RAT_HOLES.find((h) => same(last.from, h));
      expect(startHole, run.kind).toBeDefined();
      expect(endHole, run.kind).toBeDefined();
      expect(same(first.from, holeMouth(startHole!))).toBe(true);
      expect(same(last.to, holeMouth(endHole!))).toBe(true);
      expect(first.from.y).toBe(0);
      expect(last.to.y).toBe(0);
    }
  });

  /** Verifies that different random sources use more than one starting hole */
  it('varies the starting hole across seeds', () => {
    const starts = new Set(ALL_RUNS.map((r) => `${r.legs[0].to.x},${r.legs[0].to.z}`));
    expect(starts.size).toBeGreaterThan(1);
  });
});

describe('planRun corridor', () => {
  /** Verifies that a corridor run has the right kind and no cheese involved */
  it('is a corridor pass without grab, hop or carrying', () => {
    for (const run of CORRIDOR_RUNS) {
      expect(run.kind).toBe('corridor');
      expect(run.grabAt).toBeUndefined();
      for (const leg of run.legs) {
        expect(leg.hop ?? false).toBe(false);
        expect(leg.carrying).toBe(false);
        expect(leg.from.y).toBe(0);
        expect(leg.to.y).toBe(0);
      }
    }
  });

  /** Verifies that every point between the two mouths lies on a corridor */
  it('runs along the corridors between the mouths', () => {
    for (const run of CORRIDOR_RUNS) {
      const points = [run.legs[0].to, ...run.legs.slice(1).map((l) => l.from)];
      for (const p of points) expect(onCorridor(p), JSON.stringify(p)).toBe(true);
    }
  });

  /** Verifies that start and end holes differ and are at least 4 m apart */
  it('ends at another hole at least 4 m away', () => {
    for (const run of CORRIDOR_RUNS) {
      const start = run.legs[0].to;
      const end = run.legs[run.legs.length - 1].from;
      expect(same(start, end)).toBe(false);
      expect(dist(start, end)).toBeGreaterThanOrEqual(4);
    }
  });

  /** Verifies that corridor legs are axis-aligned, as the corridors are */
  it('only moves along axis-aligned segments', () => {
    for (const run of CORRIDOR_RUNS) {
      for (const leg of run.legs) {
        const straight = Math.abs(leg.from.x - leg.to.x) < EPS || Math.abs(leg.from.z - leg.to.z) < EPS;
        expect(straight).toBe(true);
      }
    }
  });
});

describe('planRun cheese', () => {
  /** Verifies that the cheese spot sits on the table top of the middle long table */
  it('places CHEESE_SPOT and TABLE_LANDING on the middle long table', () => {
    expect(CHEESE_SPOT.y).toBe(TABLE_TOP);
    expect(TABLE_LANDING.y).toBe(TABLE_TOP);
    expect(inFootprint(MIDDLE_TABLE, CHEESE_SPOT.x - TAVERN.cx, CHEESE_SPOT.z - TAVERN.cz)).toBe(true);
    expect(inFootprint(MIDDLE_TABLE, TABLE_LANDING.x - TAVERN.cx, TABLE_LANDING.z - TAVERN.cz)).toBe(true);
    expect(insideTavern(CHEESE_SPOT)).toBe(true);
  });

  /** Verifies that the tavern gate is on a corridor and the way ends off any prop */
  it('places TAVERN_GATE on a corridor and TAVERN_WAY inside the tavern', () => {
    expect(onCorridor(TAVERN_GATE)).toBe(true);
    expect(TAVERN_WAY.length).toBeGreaterThan(0);
    for (const p of TAVERN_WAY) expect(insideTavern(p), JSON.stringify(p)).toBe(true);
  });

  /** Verifies that a cheese run has the cheese kind and a grab moment within the run */
  it('is a cheese pass with a grab moment', () => {
    for (const run of CHEESE_RUNS) {
      expect(run.kind).toBe('cheese');
      expect(run.grabAt).toBeDefined();
      expect(run.grabAt!).toBeGreaterThan(0);
      expect(run.grabAt!).toBeLessThan(run.ms);
    }
  });

  /** Verifies that the rat passes the tavern gate on the way in and on the way out */
  it('goes through TAVERN_GATE twice', () => {
    for (const run of CHEESE_RUNS) {
      const hits = run.legs.filter((l) => same(l.to, TAVERN_GATE)).length;
      expect(hits).toBeGreaterThanOrEqual(2);
    }
  });

  /** Verifies that the run follows TAVERN_WAY in order, then hops onto the table */
  it('follows the tavern way to the table foot before hopping', () => {
    for (const run of CHEESE_RUNS) {
      const firstHop = run.legs.findIndex((l) => l.hop);
      const before = run.legs.slice(0, firstHop).map((l) => l.to);
      const tail = before.slice(-TAVERN_WAY.length);
      tail.forEach((p, i) => expect(same(p, TAVERN_WAY[i]), `way point ${i}`).toBe(true));
    }
  });

  /** Verifies exactly two hops: up to the landing, then back down to the table foot */
  it('hops exactly twice, up to the landing and back down', () => {
    const foot = TAVERN_WAY[TAVERN_WAY.length - 1];
    for (const run of CHEESE_RUNS) {
      const hops = run.legs.filter((l) => l.hop);
      expect(hops).toHaveLength(2);
      const [up, down] = hops;
      expect(same(up.from, foot) && up.from.y === 0).toBe(true);
      expect(up.to).toEqual(TABLE_LANDING);
      expect(same(down.from, TABLE_LANDING) && down.from.y === TABLE_TOP).toBe(true);
      expect(same(down.to, foot) && down.to.y === 0).toBe(true);
      expect(up.ms).toBe(HOP_MS);
      expect(down.ms).toBe(HOP_MS);
    }
  });

  /** Verifies that the rat pauses GRAB_MS on the table, grabbing half way */
  it('pauses GRAB_MS on the table with the grab in the middle', () => {
    for (const run of CHEESE_RUNS) {
      const starts = legStarts(run);
      const up = run.legs.findIndex((l) => l.hop);
      const down = run.legs.findIndex((l, i) => i > up && l.hop);
      const onTable = run.legs.slice(up + 1, down);
      const total = onTable.reduce((s, l) => s + l.ms, 0);
      expect(total).toBeCloseTo(GRAB_MS, 6);
      for (const l of onTable) {
        expect(same(l.from, l.to)).toBe(true);
        expect(l.from.y).toBe(TABLE_TOP);
      }
      expect(run.grabAt!).toBeGreaterThan(starts[up + 1]);
      expect(run.grabAt!).toBeLessThan(starts[down]);
    }
  });

  /** Verifies that carrying is false before grabAt and true for every leg after it */
  it('carries the cheese only after grabAt', () => {
    for (const run of CHEESE_RUNS) {
      const starts = legStarts(run);
      run.legs.forEach((leg, i) => {
        const end = starts[i] + leg.ms;
        if (end <= run.grabAt! + EPS) expect(leg.carrying, `leg ${i}`).toBe(false);
        else if (starts[i] >= run.grabAt! - EPS) expect(leg.carrying, `leg ${i}`).toBe(true);
        else throw new Error(`leg ${i} straddles grabAt`);
      });
      expect(run.legs[run.legs.length - 1].carrying).toBe(true);
    }
  });

  /** Verifies that floor legs inside the tavern never cross a piece of furniture */
  it('avoids every tavern prop on the floor', () => {
    for (const run of CHEESE_RUNS) {
      for (const leg of run.legs) {
        if (!isFloorLeg(leg)) continue;
        for (let k = 0; k <= 50; k++) {
          const t = k / 50;
          const p = { x: leg.from.x + (leg.to.x - leg.from.x) * t, z: leg.from.z + (leg.to.z - leg.from.z) * t };
          if (!insideTavern(p)) continue;
          for (const prop of TAVERN.props) {
            expect(inFootprint(prop, p.x - TAVERN.cx, p.z - TAVERN.cz), `${prop.kind} at ${p.x},${p.z}`).toBe(false);
          }
        }
      }
    }
  });

  /** Verifies that points outside the tavern lie on corridors (or are the end mouths) */
  it('keeps every point outside the tavern on a corridor', () => {
    for (const run of CHEESE_RUNS) {
      const points = [run.legs[0].to, ...run.legs.slice(1).map((l) => l.from)];
      for (const p of points) {
        if (insideTavern(p)) continue;
        expect(onCorridor(p), JSON.stringify(p)).toBe(true);
      }
    }
  });

  /** Verifies that only hop legs and the table pause leave the floor */
  it('stays on the floor outside the hops and the table', () => {
    for (const run of CHEESE_RUNS) {
      for (const leg of run.legs) {
        if (leg.hop) continue;
        const onTable = leg.from.y === TABLE_TOP && leg.to.y === TABLE_TOP && same(leg.from, TABLE_LANDING);
        if (!onTable) expect(isFloorLeg(leg)).toBe(true);
      }
    }
  });
});

describe('sampleRun', () => {
  const STEP = 16;

  /** Verifies that no frame jumps further than the rat can run, hops rising smoothly */
  it('moves continuously without jumps', () => {
    const maxH = (RAT_SPEED * STEP) / 1000 + 1e-6;
    const maxV = ((TABLE_TOP + 4 * HOP_HEIGHT) * STEP) / HOP_MS + 1e-6;
    for (const run of CORRIDOR_RUNS.slice(0, 20).concat(CHEESE_RUNS.slice(0, 20))) {
      let prev = sampleRun(run, 0);
      for (let t = STEP; t <= run.ms + 2 * STEP; t += STEP) {
        const pose = sampleRun(run, t);
        expect(dist(prev, pose), `${run.kind} at ${t}`).toBeLessThanOrEqual(maxH);
        expect(Math.abs(pose.y - prev.y), `${run.kind} at ${t}`).toBeLessThanOrEqual(maxV);
        prev = pose;
      }
    }
  });

  /** Verifies that the height is never negative and never above the hop's peak */
  it('keeps y between the floor and the hop peak', () => {
    for (const run of CHEESE_RUNS.slice(0, 20)) {
      for (let t = 0; t <= run.ms; t += 10) {
        const { y } = sampleRun(run, t);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(TABLE_TOP + HOP_HEIGHT + 1e-9);
      }
    }
    for (const run of CORRIDOR_RUNS.slice(0, 20)) {
      for (let t = 0; t <= run.ms; t += 50) expect(sampleRun(run, t).y).toBe(0);
    }
  });

  /** Verifies that the rat is above the floor only during hops or on the table */
  it('leaves the floor only while hopping or on the table', () => {
    for (const run of CHEESE_RUNS.slice(0, 20)) {
      const starts = legStarts(run);
      run.legs.forEach((leg, i) => {
        const mid = sampleRun(run, starts[i] + leg.ms / 2);
        if (leg.hop) expect(mid.y).toBeGreaterThan(0);
        else if (leg.from.y === TABLE_TOP) expect(mid.y).toBeCloseTo(TABLE_TOP);
        else expect(mid.y).toBe(0);
      });
    }
  });

  /** Verifies that the hop peaks HOP_HEIGHT above the midpoint of its two ends */
  it('arcs a hop HOP_HEIGHT above its straight line at mid-hop', () => {
    const run = CHEESE_RUNS[0];
    const starts = legStarts(run);
    const i = run.legs.findIndex((l) => l.hop);
    const mid = sampleRun(run, starts[i] + HOP_MS / 2);
    expect(mid.y).toBeCloseTo(TABLE_TOP / 2 + HOP_HEIGHT);
    expect(mid.moving).toBe(true);
  });

  /** Verifies that the run begins at the first leg's start, a negative time clamped there */
  it('starts at the first point, clamping negative times', () => {
    const run = CORRIDOR_RUNS[0];
    for (const t of [0, -500]) {
      const pose = sampleRun(run, t);
      expect(pose.x).toBeCloseTo(run.legs[0].from.x);
      expect(pose.z).toBeCloseTo(run.legs[0].from.z);
      expect(pose.done).toBe(false);
    }
  });

  /** Verifies that the run is done after run.ms, resting on the last point */
  it('is done at the last point once the run is over', () => {
    for (const run of [CORRIDOR_RUNS[0], CHEESE_RUNS[0]]) {
      const last = run.legs[run.legs.length - 1];
      const atEnd = sampleRun(run, run.ms);
      expect(atEnd.x).toBeCloseTo(last.to.x);
      expect(atEnd.z).toBeCloseTo(last.to.z);
      for (const t of [run.ms + 1, run.ms + 60_000]) {
        const pose = sampleRun(run, t);
        expect(pose.done).toBe(true);
        expect(pose.moving).toBe(false);
        expect(pose.x).toBeCloseTo(last.to.x);
        expect(pose.z).toBeCloseTo(last.to.z);
        expect(pose.y).toBe(0);
        expect(pose.carrying).toBe(last.carrying);
      }
      expect(sampleRun(run, run.ms - 1).done).toBe(false);
    }
  });

  /** Verifies that the heading follows atan2(dx, dz) of the current leg */
  it('faces the direction of the current leg', () => {
    const run = CORRIDOR_RUNS[0];
    const starts = legStarts(run);
    run.legs.forEach((leg, i) => {
      const pose = sampleRun(run, starts[i] + leg.ms / 2);
      expect(pose.heading).toBeCloseTo(Math.atan2(leg.to.x - leg.from.x, leg.to.z - leg.from.z));
      expect(pose.moving).toBe(true);
    });
  });

  /** Verifies that the rat stands still during the grab, keeping its last heading */
  it('stands still during the grab pause, keeping its heading', () => {
    const run = CHEESE_RUNS[0];
    const starts = legStarts(run);
    const up = run.legs.findIndex((l) => l.hop);
    const upHeading = sampleRun(run, starts[up] + HOP_MS / 2).heading;
    for (const t of [run.grabAt! - 1, run.grabAt! + 1]) {
      const pose = sampleRun(run, t);
      expect(pose.moving).toBe(false);
      expect(pose.done).toBe(false);
      expect(pose.heading).toBeCloseTo(upHeading);
      expect(pose.y).toBeCloseTo(TABLE_TOP);
      expect(pose.x).toBeCloseTo(TABLE_LANDING.x);
      expect(pose.z).toBeCloseTo(TABLE_LANDING.z);
    }
  });

  /** Verifies that the sampled pose carries the cheese only after grabAt */
  it('reports carrying around grabAt', () => {
    for (const run of CHEESE_RUNS.slice(0, 10)) {
      expect(sampleRun(run, 0).carrying).toBe(false);
      expect(sampleRun(run, run.grabAt! - 1).carrying).toBe(false);
      expect(sampleRun(run, run.grabAt! + 1).carrying).toBe(true);
      expect(sampleRun(run, run.ms - 1).carrying).toBe(true);
    }
  });

  /** Verifies that an empty run is immediately done at the origin */
  it('handles a run with no legs', () => {
    const pose = sampleRun({ kind: 'corridor', legs: [], ms: 0 }, 100);
    expect(pose).toEqual({ x: 0, y: 0, z: 0, heading: 0, carrying: false, moving: false, done: true });
  });
});

describe('nextPassDelay', () => {
  /** Verifies that the delay maps [0, 1) onto [PASS_MIN_MS, PASS_MAX_MS) linearly */
  it.each([
    [0, PASS_MIN_MS],
    [0.5, (PASS_MIN_MS + PASS_MAX_MS) / 2],
  ])('maps random %f to %i ms', (r, ms) => {
    expect(nextPassDelay(() => r)).toBeCloseTo(ms);
  });

  /** Verifies that the delays stay between 3 and 6 minutes */
  it('stays within 3 to 6 minutes', () => {
    expect(PASS_MIN_MS).toBe(180_000);
    expect(PASS_MAX_MS).toBe(360_000);
    expect(nextPassDelay(() => 0.999999)).toBeLessThan(PASS_MAX_MS);
    const random = seededRandom('delays');
    for (let i = 0; i < 1000; i++) {
      const d = nextPassDelay(random);
      expect(d).toBeGreaterThanOrEqual(PASS_MIN_MS);
      expect(d).toBeLessThanOrEqual(PASS_MAX_MS);
    }
  });
});

describe('pickPass', () => {
  /** Verifies the cheese threshold: strictly below THEFT_CHANCE steals the cheese */
  it.each([
    [0, 'cheese'],
    [THEFT_CHANCE - 1e-9, 'cheese'],
    [THEFT_CHANCE, 'corridor'],
    [0.999, 'corridor'],
  ] as const)('picks %f as %s', (r, pass) => {
    expect(THEFT_CHANCE).toBe(0.25);
    expect(pickPass(() => r)).toBe(pass);
  });

  /** Verifies that about one pass in four is a cheese theft */
  it('steals the cheese about a quarter of the time', () => {
    const random = seededRandom('passes');
    let cheese = 0;
    for (let i = 0; i < 4000; i++) if (pickPass(random) === 'cheese') cheese++;
    expect(cheese / 4000).toBeGreaterThan(0.22);
    expect(cheese / 4000).toBeLessThan(0.28);
  });
});

describe('emergeScale', () => {
  const run = planRun('corridor', seededRandom('emerge'));

  /** Verifies that the rat grows out of its hole at the start and shrinks back at the end */
  it('grows from 0 over EMERGE_MS, stays at 1, then shrinks to 0 at the end', () => {
    expect(emergeScale(run, 0)).toBe(0);
    expect(emergeScale(run, EMERGE_MS / 2)).toBeCloseTo(0.5, 6);
    expect(emergeScale(run, EMERGE_MS)).toBe(1);
    expect(emergeScale(run, run.ms / 2)).toBe(1);
    expect(emergeScale(run, run.ms - EMERGE_MS / 2)).toBeCloseTo(0.5, 6);
    expect(emergeScale(run, run.ms)).toBe(0);
    expect(emergeScale(run, run.ms + 100)).toBe(0);
  });
});

describe('cheese and mouth', () => {
  /** Verifies that the cheese waits exactly at the landed rat's mouth, so the grab has no jump */
  it('puts the cheese MOUTH_AHEAD in front of the landing, along the hop direction', () => {
    const run = planRun('cheese', seededRandom('mouth'));
    const pause = sampleRun(run, run.grabAt!);
    expect(pause.x).toBeCloseTo(TABLE_LANDING.x, 6);
    expect(pause.z).toBeCloseTo(TABLE_LANDING.z, 6);
    expect(CHEESE_SPOT.x).toBeCloseTo(TABLE_LANDING.x + Math.sin(pause.heading) * MOUTH_AHEAD, 6);
    expect(CHEESE_SPOT.z).toBeCloseTo(TABLE_LANDING.z + Math.cos(pause.heading) * MOUTH_AHEAD, 6);
  });
});

describe('cheeseScale', () => {
  /** Verifies that a cheese that was never stolen is at full size */
  it('is full size when nothing was stolen', () => {
    expect(cheeseScale(null)).toBe(1);
  });

  /** Verifies the cheese is gone, then grows back over CHEESE_GROW_MS */
  it.each([
    [-1_000, 0],
    [0, 0],
    [CHEESE_BACK_MS - 1, 0],
    [CHEESE_BACK_MS, 0],
    [CHEESE_BACK_MS + CHEESE_GROW_MS / 2, 0.5],
    [CHEESE_BACK_MS + CHEESE_GROW_MS, 1],
    [CHEESE_BACK_MS + 10 * CHEESE_GROW_MS, 1],
  ])('gives %i ms after the theft a scale of %f', (since, scale) => {
    expect(cheeseScale(since)).toBeCloseTo(scale);
  });

  /** Verifies that the regrowth never shrinks as time passes */
  it('grows monotonically', () => {
    let last = 0;
    for (let t = 0; t <= CHEESE_BACK_MS + 2 * CHEESE_GROW_MS; t += 25) {
      const s = cheeseScale(t);
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
    expect(last).toBe(1);
  });
});

describe('installRatCommand', () => {
  function setup(reduced = false) {
    const target: { agentOffice?: Record<string, unknown> } = {};
    const start = vi.fn();
    const log = vi.fn();
    const deps = { start, reducedMotion: vi.fn(() => reduced), log };
    const off = installRatCommand(target, deps);
    const rat = target.agentOffice!.rat as (pass?: unknown) => boolean;
    return { target, start, log, off, rat, deps };
  }

  /** Verifies that no argument and the corridor names start a corridor run */
  it.each([[undefined], ['couloir'], ['corridor'], ['COULOIR'], ['Corridor']])('starts a corridor run for %j', (arg) => {
    const { rat, start, log } = setup();
    expect(rat(arg)).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith('corridor');
    expect(log).toHaveBeenCalledWith(expect.any(String));
  });

  /** Verifies that the cheese names, any case, start a cheese theft */
  it.each(['fromage', 'cheese', 'FROMAGE', 'Cheese'])('starts a cheese theft for %j', (arg) => {
    const { rat, start } = setup();
    expect(rat(arg)).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith('cheese');
  });

  /** Verifies that unknown or non-string passes are refused with a log, nothing started */
  // Each case is wrapped so it.each never spreads an array argument.
  it.each([['souris'], [''], ['toString'], ['__proto__'], ['hasOwnProperty'], [null], [3], [{}], [true], [['cheese']]])(
    'refuses %j',
    (arg) => {
      const { rat, start, log } = setup();
      expect(rat(arg)).toBe(false);
      expect(start).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledTimes(1);
    },
  );

  /** Verifies that reduced motion refuses every pass with a log, nothing started */
  it.each([undefined, 'couloir', 'fromage'])('refuses %j under reduced motion', (arg) => {
    const { rat, start, log } = setup(true);
    expect(rat(arg)).toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
  });

  /** Verifies that reduced motion is read at each call, not at install time */
  it('reads reduced motion at call time', () => {
    const target: { agentOffice?: Record<string, unknown> } = {};
    let reduced = true;
    const start = vi.fn();
    installRatCommand(target, { start, reducedMotion: () => reduced, log: () => {} });
    const rat = target.agentOffice!.rat as (pass?: unknown) => boolean;
    expect(rat()).toBe(false);
    reduced = false;
    expect(rat()).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
  });

  /** Verifies that the other gags' commands survive install and uninstall */
  it('shares the agentOffice namespace', () => {
    const potion = () => true;
    const target: { agentOffice?: Record<string, unknown> } = { agentOffice: { potion, autel: 'keep' } };
    const off = installRatCommand(target, { start: () => {}, reducedMotion: () => false, log: () => {} });
    expect(target.agentOffice).toMatchObject({ potion, autel: 'keep', rat: expect.any(Function) });
    off();
    expect(target.agentOffice).toEqual({ potion, autel: 'keep' });
  });

  /** Verifies that an existing namespace object is kept, not replaced */
  it('keeps the same namespace object', () => {
    const ns: Record<string, unknown> = {};
    const target = { agentOffice: ns };
    installRatCommand(target, { start: () => {}, reducedMotion: () => false, log: () => {} });
    expect(target.agentOffice).toBe(ns);
    expect(typeof ns.rat).toBe('function');
  });

  /** Verifies that the uninstall removes the command and can be called twice */
  it('removes its command on uninstall', () => {
    const { target, off } = setup();
    off();
    expect('rat' in target.agentOffice!).toBe(false);
    off();
    expect('rat' in target.agentOffice!).toBe(false);
  });

  /** Verifies an uninstall never removes a newer command installed after it */
  it('leaves a newer command in place', () => {
    const target: { agentOffice?: Record<string, unknown> } = {};
    const deps = { start: () => {}, reducedMotion: () => false, log: () => {} };
    const offOld = installRatCommand(target, deps);
    installRatCommand(target, deps);
    const newer = target.agentOffice!.rat;
    offOld();
    expect(target.agentOffice!.rat).toBe(newer);
  });

  /** Verifies an uninstall leaves alone a rat key replaced by something else */
  it('leaves a foreign rat value in place', () => {
    const { target, off } = setup();
    target.agentOffice!.rat = 'other';
    off();
    expect(target.agentOffice!.rat).toBe('other');
  });

  /** Verifies a non-object namespace is replaced, as the other commands do */
  it.each([1, 'x', null, true, undefined])('replaces a %j namespace with an object', (value) => {
    const target: { agentOffice?: unknown } = { agentOffice: value };
    installRatCommand(target, { start: () => {}, reducedMotion: () => false, log: () => {} });
    expect(typeof target.agentOffice).toBe('object');
    expect(typeof (target.agentOffice as Record<string, unknown>).rat).toBe('function');
  });
});
