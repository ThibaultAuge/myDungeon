// Fishing in the moat: a main agent that has waited a long time for a prompt walks out of the
// castle and fishes from the south bank, until it has work again (user decision). Purely
// visual: nothing is sent to the server. Pure module, no three.js, testable in node.
import type { AgentView } from '@agent-office/shared';
import { play, type ClipChoice } from './characters.ts';
import { MOAT, PENNANTS } from './forest.ts';
import { gagCommands } from './gagCommands.ts';
import { BOUNDS, GATE, routeBetween, type Point, type Spot } from './layout.ts';
import { GATE_SPOT } from './outside.ts';

/** Waiting time for a prompt (ms) after which a main agent goes fishing. */
export const FISHING_AFTER_MS = 3 * 60_000;
/** `Spot.space` of the fishing places: the figure fishes once it stands at one. */
export const FISHING_SPACE = 'moat';
/** Fishing places along the bank; further fishers stay in the tavern. */
export const MAX_FISHERS = 12;

/** Lengths of the fishing clips, in seconds at timeScale 1 (a test checks them against the file). */
export const FISHING_CAST_TIME = 1.933;
export const FISHING_BITE_TIME = 2.233;
export const FISHING_CATCH_TIME = 3.233;
/** How long a fisher reels in a catch (Fishing_Reeling loops meanwhile). */
export const FISHING_REEL_S = 2;
/** Shortest wait for a bite; each fisher waits this plus 0 to 6 whole seconds, every time. */
export const FISHING_IDLE_MIN_S = 8;

/**
 * True when this agent goes fishing at `now` (epoch ms): the main agent of a live session,
 * waiting for a prompt in the tavern for at least FISHING_AFTER_MS. A client clock behind the
 * server's counts as no wait.
 */
export function wantsToFish(
  agent: Pick<AgentView, 'kind' | 'state' | 'waitReason' | 'room' | 'since'>,
  live: boolean,
  now: number,
  /** Sent fishing by the test command: no three-minute wait. */
  forced = false,
): boolean {
  if (agent.kind !== 'main' || !live) return false;
  if (agent.state !== 'waiting' || agent.waitReason !== 'prompt' || agent.room !== 'taverne') return false;
  if (forced) return true;
  const waited = now - agent.since;
  return Number.isFinite(waited) && waited >= FISHING_AFTER_MS;
}

/** Z of the fishing places, on the south bank, facing the water. */
export const FISHING_Z = MOAT.z1 + 0.35;
/** Z of the way along the bank, south of the pennants framing the drawbridge landing. */
export const FISHING_LANE_Z = MOAT.z1 + 1.9;
const BRIDGE_X = (GATE.lo + GATE.hi) / 2;

/** X of fishing place `rank`: even ranks east of the drawbridge, odd ranks west, 1.5 m apart. */
export function fishingX(rank: number): number {
  const side = rank % 2 === 0 ? 1 : -1;
  return BRIDGE_X + side * (3.2 + 1.5 * Math.floor(rank / 2));
}

const spots = new Map<number, Spot>();

/**
 * Fishing place `rank` (0 to MAX_FISHERS - 1). The same frozen object for a rank, so a figure
 * keeps its spot across renders. The way in goes out through the gate, over the drawbridge and
 * along the bank behind the pennants; `routeBetween` walks it back reversed.
 */
export function fishingSpot(rank: number): Spot {
  let spot = spots.get(rank);
  if (!spot) {
    const x = fishingX(rank);
    const entry: Point[] = [
      { x: BRIDGE_X, z: BOUNDS.z1 + 0.2 },
      { x: BRIDGE_X, z: MOAT.z1 + 0.5 },
      { x: BRIDGE_X, z: FISHING_LANE_Z },
      { x, z: FISHING_LANE_Z },
    ].map((p) => Object.freeze(p));
    spot = Object.freeze({
      id: `moat:${rank}`,
      x,
      z: FISHING_Z,
      // North, towards the water.
      facing: Math.PI,
      space: FISHING_SPACE,
      anchor: GATE_SPOT.anchor,
      entry: Object.freeze(entry) as Point[],
      room: 'taverne',
    }) as Spot;
    spots.set(rank, spot);
  }
  return spot;
}

/**
 * The way back of a fisher called back (new spot `to`) while it walks out to its place `from`
 * and is already past the gate: it retraces the entry points it has passed, so it never cuts
 * across the pennants. Null when `from` is no fishing place, or the figure is still inside the
 * castle: `reroute` then applies. `remaining` is what is left of its route to `from`.
 */
export function fishingReroute(remaining: readonly Point[], from: Spot, to: Spot): Point[] | null {
  const passed = passedEntry(remaining, from);
  return passed === null ? null : routeBetween({ ...from, entry: from.entry.slice(0, passed) }, to);
}

/**
 * How many of a fishing place's entry points a figure past the gate has passed, or null when
 * `from` is no fishing place or the figure is still inside. Relies on every route to a spot
 * ending with its entry points then the place (`routeBetween`, `reroute`), and on the fishing
 * entry points never being merged with a neighbour.
 */
function passedEntry(remaining: readonly Point[], from: Spot): number | null {
  if (from.space !== FISHING_SPACE || remaining.some((p) => p.z <= BOUNDS.z1)) return null;
  // `remaining` is the entry points still ahead, then the place itself.
  const ahead = Math.max(0, remaining.length - 1);
  return Math.max(0, from.entry.length - ahead);
}

/** Index of the entry point where the bank lane meets the drawbridge's axis. */
const LANE_JUNCTION = 2;

/**
 * The first waypoints of a fisher whose session ended, before `exitRoute` takes it to the
 * skeletons: back along the bank lane to the drawbridge's axis, so it never walks through the
 * pennants. Empty when `from` is no fishing place, the figure is still inside, or it is already
 * on the axis (the bridge): the straight way to the path is then clear.
 */
export function fishingExitLead(remaining: readonly Point[], from: Spot): Point[] {
  const passed = passedEntry(remaining, from);
  if (passed === null || passed <= LANE_JUNCTION) return [];
  return from.entry.slice(LANE_JUNCTION, passed).reverse().map((p) => ({ ...p }));
}

/** The pennant poles the fishing places and their way in keep clear of. */
export const FISHING_OBSTACLES: readonly Point[] = PENNANTS;

/**
 * Sticky fishing places: each fisher keeps its rank while it fishes, a new one takes the lowest
 * free rank. `fishers` are in order of priority (longest wait first). Beyond MAX_FISHERS, none.
 */
export function assignFishingRanks(fishers: readonly string[], previous: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const wanted = new Set(fishers);
  for (const [id, rank] of previous) if (wanted.has(id)) out.set(id, rank);
  const taken = new Set(out.values());
  let free = 0;
  for (const id of fishers) {
    if (out.has(id)) continue;
    while (taken.has(free)) free++;
    if (free >= MAX_FISHERS) break;
    out.set(id, free);
    taken.add(free);
  }
  return out;
}

/** A per-agent seed (FNV-1a of the id), so that fishers on the bank do not bite in step. */
export function fishingSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** Wait for a bite of a fisher, seconds. */
export function fishingIdle(seed: number): number {
  return FISHING_IDLE_MIN_S + (Math.abs(Math.trunc(seed)) % 7);
}

/**
 * The fishing clip `t` seconds after arriving at the bank: one cast, then forever a wait,
 * a bite, reeling in and the catch.
 */
export function fishingClip(t: number, seed: number): ClipChoice {
  if (!(t >= 0) || t < FISHING_CAST_TIME) return play('Fishing_Cast', 1, false);
  const idle = fishingIdle(seed);
  const cycle = idle + FISHING_BITE_TIME + FISHING_REEL_S + FISHING_CATCH_TIME;
  const u = Number.isFinite(t) ? (t - FISHING_CAST_TIME) % cycle : 0;
  if (u < idle) return play('Fishing_Idle');
  if (u < idle + FISHING_BITE_TIME) return play('Fishing_Bite', 1, false);
  if (u < idle + FISHING_BITE_TIME + FISHING_REEL_S) return play('Fishing_Reeling');
  return play('Fishing_Catch', 1, false);
}

// ---- Test command: send an agent fishing without waiting three minutes.

const forced = new Set<string>();
const watchers = new Set<() => void>();
let version = 0;

function notify(): void {
  version++;
  for (const watcher of [...watchers]) watcher();
}

/** True when the console command sends this agent fishing, whatever its wait. */
export function isFishingForced(id: string): boolean {
  return forced.has(id);
}

/** Sends (true) or calls back (false) an agent. Returns whether anything changed. */
export function forceFishing(id: string, on: boolean): boolean {
  if (on === forced.has(id)) return false;
  if (on) forced.add(id);
  else forced.delete(id);
  notify();
  return true;
}

export function clearForcedFishing(): void {
  if (forced.size === 0) return;
  forced.clear();
  notify();
}

/** useSyncExternalStore's subscribe. */
export function onFishingForce(watcher: () => void): () => void {
  watchers.add(watcher);
  return () => {
    watchers.delete(watcher);
  };
}

/** useSyncExternalStore's snapshot. */
export function fishingForceVersion(): number {
  return version;
}

export interface FishingCommandDeps {
  /** Id of the selected agent, or null. */
  selected(): string | null;
  /** True when this id is the main agent of a live session. */
  isLiveMain(id: string): boolean;
  log(message: string): void;
}

/**
 * Installs `agentOffice.peche(id?)` on `target` (the window), next to the other gags'
 * commands. `peche()` sends the selected main agent fishing, or calls it back if it already
 * is; `peche('<agent id>')` does it for that agent; `peche(null)` calls every forced fisher
 * back. Forcing only skips the three-minute wait: the agent still fishes only while it waits for
 * a prompt in the tavern (`wantsToFish` with `forced`), so work still calls it back.
 * Returns true when something changed. Developer tool: messages stay in English.
 */
export function installFishingCommand(target: object, deps: FishingCommandDeps): () => void {
  const ns = gagCommands(target);
  const command = (id?: unknown): boolean => {
    if (id === null) {
      const n = forced.size;
      clearForcedFishing();
      deps.log(`peche: called back ${n} forced fisher(s)`);
      return n > 0;
    }
    if (id !== undefined && typeof id !== 'string') {
      deps.log('peche: the agent id must be a string');
      return false;
    }
    const one = id ?? deps.selected();
    if (!one) {
      deps.log('peche: no agent selected; pass the id of a main agent');
      return false;
    }
    if (!forced.has(one) && !deps.isLiveMain(one)) {
      deps.log(`peche: ${one} is not the main agent of a live session`);
      return false;
    }
    const on = !forced.has(one);
    forceFishing(one, on);
    deps.log(`peche: ${one} ${on ? 'goes fishing' : 'called back'}`);
    return true;
  };
  ns.peche = command;
  return () => {
    if (ns.peche !== command) return;
    delete ns.peche;
    clearForcedFishing();
  };
}
