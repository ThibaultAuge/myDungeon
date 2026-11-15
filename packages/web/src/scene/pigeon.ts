// Samuel-Morse's pigeons: one leaves the dovecote's aviary on each HTTP call of an agent
// working there, and comes back with the outcome. Pure, no three.js: times in seconds,
// positions as [x, y, z]. Rendering lives in Pigeons.tsx.

export type V3 = readonly [number, number, number];

/** How the pigeon comes back: `back` on a success, one of the other three, drawn at random, on an error. */
export type PigeonOutcome = 'back' | 'plucked' | 'lost' | 'dropping';
export const PIGEON_OUTCOMES: readonly PigeonOutcome[] = ['back', 'plucked', 'lost', 'dropping'];
const ERROR_OUTCOMES: readonly PigeonOutcome[] = ['plucked', 'lost', 'dropping'];

/** Pigeons in the air at once; further calls send none. */
export const MAX_PIGEONS = 4;
/** Take-off, from the aviary to the sky. */
export const LEAVE_S = 1.6;
/** Shortest time out of sight: a curl often answers before the pigeon is gone. */
export const MIN_AWAY_S = 0.8;
/** Way back, from the sky to the aviary or to the agent's head. */
export const RETURN_S = 1.8;
/** Settling on the perch before vanishing. */
export const LAND_S = 0.6;
/** Hovering over the agent's head; the dropping leaves at its start. */
export const HOVER_S = 0.7;
/** Fall of the dropping onto the head. */
export const DROP_S = 0.45;
/** How long the dropping stays on the head. */
export const SPLAT_S = 6;
/** A call that never ends: the pigeon is lost. */
export const LOST_TIMEOUT_S = 60;
/** Fall of the feathers of a plucked pigeon, and of the lost pigeon's single feather. */
export const FEATHER_FALL_S = 2.6;
export const LOST_FEATHER_FALL_S = 4;
/** Feathers torn off a plucked pigeon. */
export const PLUCKED_FEATHERS = 8;

/** Height of the sky point above the aviary, and its shift north (away from the camera). */
const SKY_RISE = 10;
const SKY_NORTH = 6;
/** Hover height above the head, and arc height of the flights. */
const HOVER_ABOVE = 1.1;
const ARC = 1.5;
/** Height above the aviary where the lost pigeon's feather appears. */
const LOST_FEATHER_FROM = 4;
/** Share of the way back at which the plucked pigeon loses its feathers: near the aviary, in view. */
const BURST_AT = 0.75;

export function pigeonOutcome(result: 'ok' | 'error', rng: () => number = Math.random): PigeonOutcome {
  if (result === 'ok') return 'back';
  const i = Math.min(ERROR_OUTCOMES.length - 1, Math.floor(rng() * ERROR_OUTCOMES.length));
  return ERROR_OUTCOMES[i];
}

export function isPigeonOutcome(v: unknown): v is PigeonOutcome {
  return typeof v === 'string' && (PIGEON_OUTCOMES as readonly string[]).includes(v);
}

export interface Flight {
  id: number;
  agentId: string;
  startedAt: number;
  /** Set when the call ends (or times out). */
  outcome?: PigeonOutcome;
  /** When the pigeon starts back: never before take-off plus the shortest absence. */
  returnAt?: number;
}

export type Phase = 'leaving' | 'away' | 'returning' | 'hovering' | 'homing' | 'landed' | 'gone';

/** Phase of a flight at `now`, and the progress (0..1) within it. */
export function phaseAt(f: Flight, now: number): { phase: Phase; t: number } {
  const dt = now - f.startedAt;
  if (dt < LEAVE_S) return { phase: 'leaving', t: Math.max(0, dt) / LEAVE_S };
  if (f.outcome === undefined || f.returnAt === undefined || now < f.returnAt) return { phase: 'away', t: 0 };
  if (f.outcome === 'lost') return { phase: 'gone', t: 1 };
  let r = now - f.returnAt;
  if (r < RETURN_S) return { phase: 'returning', t: r / RETURN_S };
  r -= RETURN_S;
  if (f.outcome === 'dropping') {
    if (r < HOVER_S) return { phase: 'hovering', t: r / HOVER_S };
    r -= HOVER_S;
    if (r < RETURN_S) return { phase: 'homing', t: r / RETURN_S };
    r -= RETURN_S;
  }
  if (r < LAND_S) return { phase: 'landed', t: r / LAND_S };
  return { phase: 'gone', t: 1 };
}

/** When the dropping lands on the head, for a `dropping` flight that has started back. */
export function splatStart(f: Flight): number | undefined {
  if (f.outcome !== 'dropping' || f.returnAt === undefined) return undefined;
  return f.returnAt + RETURN_S + DROP_S;
}

/** Whether the dropping sits on the head at `now`. */
export function splatOn(f: Flight, now: number): boolean {
  const from = splatStart(f);
  return from !== undefined && now >= from && now < from + SPLAT_S;
}

/** Where the dropping is while it falls (progress 0..1), or undefined outside its fall. */
export function dropFall(f: Flight, now: number): number | undefined {
  const land = splatStart(f);
  if (land === undefined) return undefined;
  const t = (now - (land - DROP_S)) / DROP_S;
  return t >= 0 && t < 1 ? t : undefined;
}

/** When the plucked pigeon loses its feathers, on its way back. */
function featherBurstAt(f: Flight): number | undefined {
  return f.outcome === 'plucked' && f.returnAt !== undefined ? f.returnAt + RETURN_S * BURST_AT : undefined;
}

/** True once nothing of the flight shows any more (pigeon, feathers, dropping). */
export function flightOver(f: Flight, now: number): boolean {
  if (phaseAt(f, now).phase !== 'gone') return false;
  if (f.outcome === 'dropping') return now >= splatStart(f)! + SPLAT_S;
  if (f.outcome === 'lost') return now >= f.returnAt! + LOST_FEATHER_FALL_S;
  if (f.outcome === 'plucked') return now >= featherBurstAt(f)! + FEATHER_FALL_S;
  return true;
}

/** The places a flight goes through. `head` is the dropping's target: the agent's head, or the lectern. */
export interface Places {
  nest: V3;
  head: V3;
}

export function skyOf(nest: V3): V3 {
  return [nest[0], nest[1] + SKY_RISE, nest[2] - SKY_NORTH];
}

const ease = (t: number) => t * t * (3 - 2 * t);

/** A point on the arc from `a` to `b` at progress `t`, raised by `arc` in the middle. */
export function arcPoint(a: V3, b: V3, t: number, arc = ARC): V3 {
  const e = ease(Math.min(1, Math.max(0, t)));
  return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e + Math.sin(Math.PI * e) * arc, a[2] + (b[2] - a[2]) * e];
}

/** Where the pigeon is at `now`, or null when it is out of sight. */
export function pigeonPoint(f: Flight, now: number, places: Places): V3 | null {
  const { phase, t } = phaseAt(f, now);
  const sky = skyOf(places.nest);
  const over: V3 = [places.head[0], places.head[1] + HOVER_ABOVE, places.head[2]];
  switch (phase) {
    case 'leaving':
      return arcPoint(places.nest, sky, t);
    case 'returning':
      return arcPoint(sky, f.outcome === 'dropping' ? over : places.nest, t);
    case 'hovering':
      return [over[0], over[1] + Math.sin(t * Math.PI * 4) * 0.08, over[2]];
    case 'homing':
      return arcPoint(over, places.nest, t);
    case 'landed':
      return places.nest;
    default:
      return null;
  }
}

/** A feather in the air: position and spin angle. */
export interface Feather {
  pos: V3;
  spin: number;
}

/**
 * Feathers falling at `now`: a burst from the plucked pigeon on its way back, or the lost
 * pigeon's single feather drifting down over the aviary. Deterministic per flight.
 */
export function feathersAt(f: Flight, now: number, places: Places): Feather[] {
  if (f.outcome === 'plucked') {
    const at = featherBurstAt(f)!;
    const t = (now - at) / FEATHER_FALL_S;
    if (t < 0 || t >= 1) return [];
    const from = arcPoint(skyOf(places.nest), places.nest, BURST_AT);
    const out: Feather[] = [];
    for (let i = 0; i < PLUCKED_FEATHERS; i++) {
      const a = (i / PLUCKED_FEATHERS) * Math.PI * 2 + f.id;
      const spread = 0.4 + 1.1 * Math.sqrt(t);
      out.push({
        pos: [
          from[0] + Math.cos(a) * spread + Math.sin(t * 9 + i) * 0.15,
          from[1] + 0.3 * Math.sin(t * Math.PI) - 3.2 * t * t,
          from[2] + Math.sin(a) * spread,
        ],
        spin: t * 8 + i,
      });
    }
    return out;
  }
  if (f.outcome === 'lost' && f.returnAt !== undefined) {
    const t = (now - f.returnAt) / LOST_FEATHER_FALL_S;
    if (t < 0 || t >= 1) return [];
    const n = places.nest;
    return [{ pos: [n[0] + Math.sin(t * 7) * 0.5, n[1] + LOST_FEATHER_FROM * (1 - t), n[2] + Math.cos(t * 5) * 0.2], spin: t * 6 }];
  }
  return [];
}

/**
 * The pigeons in the air. Calls and outcomes are paired first in, first out per agent.
 * Idempotent clock: every method takes `now`.
 */
export class Pigeons {
  readonly flights: Flight[] = [];
  private nextId = 1;

  /** A pigeon leaves for `agentId`'s call; null when too many are in the air. */
  launch(agentId: string, now: number): Flight | null {
    this.update(now);
    if (this.flights.filter((f) => phaseAt(f, now).phase !== 'gone').length >= MAX_PIGEONS) return null;
    const f: Flight = { id: this.nextId++, agentId, startedAt: now };
    this.flights.push(f);
    return f;
  }

  /** The call of `agentId` launched first and not ended yet gets its outcome. False when there is none. */
  land(agentId: string, outcome: PigeonOutcome, now: number): boolean {
    const f = this.flights.find((x) => x.agentId === agentId && x.outcome === undefined);
    if (!f) return false;
    this.settle(f, outcome, now);
    return true;
  }

  /** The test command: a pigeon leaves and its outcome is already known. */
  force(agentId: string, outcome: PigeonOutcome, now: number): Flight | null {
    const f = this.launch(agentId, now);
    if (f) this.settle(f, outcome, now);
    return f;
  }

  /** Times out calls that never ended and forgets finished flights. */
  update(now: number): void {
    for (const f of this.flights) {
      if (f.outcome === undefined && now - f.startedAt >= LOST_TIMEOUT_S) this.settle(f, 'lost', now);
    }
    for (let i = this.flights.length - 1; i >= 0; i--) {
      if (flightOver(this.flights[i], now)) this.flights.splice(i, 1);
    }
  }

  private settle(f: Flight, outcome: PigeonOutcome, now: number): void {
    f.outcome = outcome;
    f.returnAt = Math.max(now, f.startedAt + LEAVE_S + MIN_AWAY_S);
  }
}
