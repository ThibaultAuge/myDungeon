import { BOUNDS, GATE, ROOM_BY_ID, corridorPath, doorOf, type Point } from './layout.ts';
import { WANDER_POINTS } from './ghost.ts';

// The rat gag: now and then a rat scurries along the corridors from one hole in the outer
// wall to another; one time in four it detours through the tavern, hops onto a table, steals
// the cheese and runs off with it. The cheese comes back a few seconds later.
// Pure, no three.js: testable in node.

/** Running speed on the floor, in m/s: a dash, three times the first version (2.4) at the user's request. */
export const RAT_SPEED = 7.5;
/** Height of a hop's arc above the higher of its two ends (low, so the short hop stays plausible). */
export const HOP_HEIGHT = 0.22;
/**
 * Duration of one hop (onto the table or down from it). Two hops plus the grab stay under a
 * third of the first version's 1.6 s, so a theft is also at least three times faster.
 */
export const HOP_MS = 150;
/** Pause on the table while the rat grabs the cheese. */
export const GRAB_MS = 230;
/** A natural pass comes every 3 to 6 minutes. */
export const PASS_MIN_MS = 180_000;
export const PASS_MAX_MS = 360_000;
/** Share of the passes that go for the cheese. */
export const THEFT_CHANCE = 0.25;
/** The stolen cheese reappears on the table this long after the rat has gone. */
export const CHEESE_BACK_MS = 8_000;
/** How long the new cheese takes to grow back to full size. */
export const CHEESE_GROW_MS = 400;
/** Height of the long tables' top. */
export const TABLE_TOP = 0.75;
/** A hole lies this far inside the outer wall: the rat comes out of it and goes back in. */
const HOLE_DEPTH = 0.6;
/**
 * The rat grows out of its hole and shrinks back into it over this time, so it never pops:
 * the time it takes to run through the wall, so it is full size at the wall face.
 */
export const EMERGE_MS = (HOLE_DEPTH / RAT_SPEED) * 1000;
/**
 * Distance from the rat's origin to the cheese held in its mouth, in metres, at the size the
 * rat is drawn. The cheese on the table sits exactly there in front of the landing, so the
 * grab has no jump.
 */
export const MOUTH_AHEAD = 0.42;
/** The cheese and the landing are this far off the table's middle line, clear of the stew. */
const TABLE_SIDE = 0.28;

export type RatPass = 'corridor' | 'cheese';

export interface Point3 extends Point {
  y: number;
}

/** One straight leg of a run: a scurry on the floor, a hop, or a pause. */
export interface RatLeg {
  from: Point3;
  to: Point3;
  ms: number;
  hop?: boolean;
  /** The rat holds the cheese in its mouth during this leg. */
  carrying: boolean;
}

export interface RatRun {
  kind: RatPass;
  legs: RatLeg[];
  /** Total duration. */
  ms: number;
  /** When the rat takes the cheese (cheese passes only). */
  grabAt?: number;
}

export interface RatPose extends Point3 {
  /** Y rotation, `atan2(dx, dz)` like the agents. */
  heading: number;
  carrying: boolean;
  /** Running or hopping (false during the grab pause and once done). */
  moving: boolean;
  done: boolean;
}

function onEdge(p: Point): boolean {
  return (
    p.x - BOUNDS.x0 <= HOLE_DEPTH || BOUNDS.x1 - p.x <= HOLE_DEPTH || p.z - BOUNDS.z0 <= HOLE_DEPTH || BOUNDS.z1 - p.z <= HOLE_DEPTH
  );
}

/** The corridor end at the castle gate: open, so no hole there (the rat would vanish on the drawbridge). */
function atGate(p: Point): boolean {
  return GATE.side === 's' && BOUNDS.z1 - p.z <= HOLE_DEPTH && p.x >= GATE.lo && p.x <= GATE.hi;
}

/** Corridor ends against the outer wall, gate excepted: where a rat appears and disappears. */
export const RAT_HOLES: readonly Point[] = WANDER_POINTS.filter((p) => onEdge(p) && !atGate(p));

/** The point inside the wall behind a hole (or past the gate). */
export function holeMouth(hole: Point): Point {
  const toWest = hole.x - BOUNDS.x0;
  const toEast = BOUNDS.x1 - hole.x;
  const toNorth = hole.z - BOUNDS.z0;
  const toSouth = BOUNDS.z1 - hole.z;
  const nearest = Math.min(toWest, toEast, toNorth, toSouth);
  if (nearest === toWest) return { x: hole.x - HOLE_DEPTH, z: hole.z };
  if (nearest === toEast) return { x: hole.x + HOLE_DEPTH, z: hole.z };
  if (nearest === toNorth) return { x: hole.x, z: hole.z - HOLE_DEPTH };
  return { x: hole.x, z: hole.z + HOLE_DEPTH };
}

const TAVERN = ROOM_BY_ID.get('taverne')!;
const TAVERN_DOOR = doorOf(TAVERN);
/** The middle long table of the tavern: the cheese sits at its north end. */
const CHEESE_TABLE = TAVERN.props.filter((p) => p.kind === 'longTable').sort((a, b) => a.z - b.z)[1];

/** Room-relative point of the tavern turned into a world point. */
function inTavern(x: number, z: number): Point {
  return { x: TAVERN.cx + x, z: TAVERN.cz + z };
}

/** Where the rat lands on the table, near its north end, facing south (+z). */
export const TABLE_LANDING: Point3 = { ...inTavern(CHEESE_TABLE.x + TABLE_SIDE, CHEESE_TABLE.z - 1.85), y: TABLE_TOP };
/** The cheese on the table (world position of its centre, on the table top), at the landed rat's mouth. */
export const CHEESE_SPOT: Point3 = { ...TABLE_LANDING, z: TABLE_LANDING.z + MOUTH_AHEAD };
/**
 * The floor way from the tavern door to the foot of the table: along the west wall, then
 * between the first and the middle table. Ends at the foot of the table's north end.
 */
export const TAVERN_WAY: readonly Point[] = [
  TAVERN_DOOR.inside,
  inTavern(-2.4, CHEESE_TABLE.z - 2.75),
  inTavern(CHEESE_TABLE.x + TABLE_SIDE, CHEESE_TABLE.z - 2.75),
];
/** The corridor point in front of the tavern door. */
export const TAVERN_GATE: Point = TAVERN_DOOR.outside;

/** Delay before the next natural pass. */
export function nextPassDelay(random: () => number): number {
  return PASS_MIN_MS + random() * (PASS_MAX_MS - PASS_MIN_MS);
}

/** A natural pass: mostly a corridor run, sometimes a cheese theft. */
export function pickPass(random: () => number): RatPass {
  return random() < THEFT_CHANCE ? 'cheese' : 'corridor';
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length) % items.length];
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** A hole at least 4 m from `from` (any other hole if none is that far). */
function farHole(random: () => number, from: Point): Point {
  const far = RAT_HOLES.filter((h) => dist(h, from) >= 4);
  const others = RAT_HOLES.filter((h) => dist(h, from) > 1e-6);
  return pick(random, far.length > 0 ? far : others.length > 0 ? others : RAT_HOLES);
}

class Legs {
  readonly legs: RatLeg[] = [];
  at: Point3;
  carrying = false;
  ms = 0;

  constructor(start: Point) {
    this.at = { ...start, y: 0 };
  }

  run(points: readonly Point[]): void {
    for (const p of points) {
      const to = { x: p.x, z: p.z, y: 0 };
      const length = dist(this.at, to);
      if (length < 1e-6) continue;
      this.push({ from: this.at, to, ms: (length / RAT_SPEED) * 1000, carrying: this.carrying });
    }
  }

  hop(to: Point3): void {
    this.push({ from: this.at, to, ms: HOP_MS, hop: true, carrying: this.carrying });
  }

  pause(ms: number): void {
    this.push({ from: this.at, to: this.at, ms, carrying: this.carrying });
  }

  private push(leg: RatLeg): void {
    this.legs.push(leg);
    this.at = leg.to;
    this.ms += leg.ms;
  }
}

/** Plans a whole pass, from a hole to another hole. */
export function planRun(kind: RatPass, random: () => number): RatRun {
  const start = pick(random, RAT_HOLES);
  const legs = new Legs(holeMouth(start));
  legs.run([start]);
  if (kind === 'corridor') {
    const end = farHole(random, start);
    legs.run([...corridorPath(start, end), holeMouth(end)]);
    return { kind, legs: legs.legs, ms: legs.ms };
  }
  legs.run([...corridorPath(start, TAVERN_GATE), ...TAVERN_WAY]);
  const foot = legs.at;
  legs.hop(TABLE_LANDING);
  legs.pause(GRAB_MS / 2);
  const grabAt = legs.ms;
  legs.carrying = true;
  legs.pause(GRAB_MS / 2);
  legs.hop(foot);
  const end = farHole(random, TAVERN_GATE);
  legs.run([...[...TAVERN_WAY].reverse(), TAVERN_GATE, ...corridorPath(TAVERN_GATE, end), holeMouth(end)]);
  return { kind, legs: legs.legs, ms: legs.ms, grabAt };
}

function headingOf(leg: RatLeg): number | null {
  const dx = leg.to.x - leg.from.x;
  const dz = leg.to.z - leg.from.z;
  return Math.hypot(dx, dz) < 1e-6 ? null : Math.atan2(dx, dz);
}

/** Where the rat is `ms` after the start of its run. */
export function sampleRun(run: RatRun, ms: number): RatPose {
  let elapsed = Math.max(0, ms);
  let heading = 0;
  for (const leg of run.legs) {
    heading = headingOf(leg) ?? heading;
    if (elapsed <= leg.ms) {
      const t = leg.ms === 0 ? 1 : elapsed / leg.ms;
      const base = leg.from.y + (leg.to.y - leg.from.y) * t;
      const arc = leg.hop ? 4 * HOP_HEIGHT * t * (1 - t) : 0;
      return {
        x: leg.from.x + (leg.to.x - leg.from.x) * t,
        z: leg.from.z + (leg.to.z - leg.from.z) * t,
        y: base + arc,
        heading,
        carrying: leg.carrying,
        moving: headingOf(leg) !== null || !!leg.hop,
        done: false,
      };
    }
    elapsed -= leg.ms;
  }
  const last = run.legs[run.legs.length - 1];
  const end = last?.to ?? { x: 0, y: 0, z: 0 };
  return { ...end, heading, carrying: last?.carrying ?? false, moving: false, done: true };
}

/** Size of the rat `ms` into its run: it grows out of its hole and shrinks back into the next one. */
export function emergeScale(run: RatRun, ms: number): number {
  return Math.max(0, Math.min(1, ms / EMERGE_MS, (run.ms - ms) / EMERGE_MS));
}

/**
 * Scale of the cheese on the table, `sinceGone` ms after the rat that stole it left the
 * scene (it grows back after `CHEESE_BACK_MS`). Null: no cheese was stolen, full size.
 */
export function cheeseScale(sinceGone: number | null): number {
  if (sinceGone === null) return 1;
  const t = (sinceGone - CHEESE_BACK_MS) / CHEESE_GROW_MS;
  return Math.min(1, Math.max(0, t));
}

export interface RatCommandDeps {
  /** Starts a pass now, replacing any running one. */
  start(kind: RatPass): void;
  reducedMotion(): boolean;
  log(message: string): void;
}

const PASS_NAMES: Record<string, RatPass> = { couloir: 'corridor', corridor: 'corridor', fromage: 'cheese', cheese: 'cheese' };

/**
 * Installs `agentOffice.rat(pass?)` on `target` (the window), next to the other gags' test
 * commands, which it never replaces. Returns the uninstall function.
 *
 * The command: `rat()` or `rat('couloir')` starts a corridor run, `rat('fromage')` the
 * cheese theft, replacing a pass already running. It returns true when a rat starts, false
 * otherwise (unknown pass, reduced motion).
 *
 * Developer tool: its console messages are not part of the interface, so stay in English.
 */
export function installRatCommand(target: object, deps: RatCommandDeps): () => void {
  const host = target as { agentOffice?: unknown };
  // Same guard as the other commands: anything but an object is replaced.
  if (typeof host.agentOffice !== 'object' || host.agentOffice === null) host.agentOffice = {};
  const ns = host.agentOffice as Record<string, unknown>;
  const command = (passArg?: unknown): boolean => {
    const name = passArg === undefined ? 'couloir' : passArg;
    const key = typeof name === 'string' ? name.toLowerCase() : '';
    const kind = Object.hasOwn(PASS_NAMES, key) ? PASS_NAMES[key] : undefined;
    if (!kind) {
      const shown = typeof passArg === 'string' ? `'${passArg}'` : typeof passArg;
      deps.log(`rat: unknown pass ${shown}; use 'couloir' or 'fromage'`);
      return false;
    }
    if (deps.reducedMotion()) {
      deps.log('rat: reduced motion is on, no rat runs');
      return false;
    }
    deps.start(kind);
    deps.log(`rat: ${kind === 'cheese' ? 'cheese theft' : 'corridor run'} started`);
    return true;
  };
  ns.rat = command;
  return () => {
    if (ns.rat === command) delete ns.rat;
  };
}
