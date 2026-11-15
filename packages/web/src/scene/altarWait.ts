// The endless wait at the altar: the longer an agent waits for the human, the worse it
// looks (paces, sits down, falls asleep, gathers cobwebs). A purely visual gag: nothing is
// sent to the server. Pure module, no three.js, testable in node.
import type { AgentView } from '@agent-office/shared';

/** How far an agent waiting at the altar has given up, from fresh to buried in cobwebs. */
export type AltarStage = 'calm' | 'pacing' | 'sitting' | 'sleeping' | 'webbed';

export const ALTAR_STAGES = ['calm', 'pacing', 'sitting', 'sleeping', 'webbed'] as const satisfies readonly AltarStage[];

/** Waiting time (ms) from which each stage starts. User decision: 1, 3, 5 and 10 minutes. */
export const ALTAR_STAGE_MS: Readonly<Record<Exclude<AltarStage, 'calm'>, number>> = Object.freeze({
  pacing: 60_000,
  sitting: 3 * 60_000,
  sleeping: 5 * 60_000,
  webbed: 10 * 60_000,
});

/**
 * The stage of an agent at `now` (epoch ms). Only agents waiting for the human at the altar
 * (permission, question, error) degrade; `since` is the start of that wait (the server resets
 * it on every state or reason change). A client clock behind the server's counts as no wait.
 */
export function altarStage(agent: Pick<AgentView, 'state' | 'waitReason' | 'room' | 'since'>, now: number): AltarStage {
  if (agent.state !== 'waiting' || agent.room !== 'autel' || !agent.waitReason || agent.waitReason === 'prompt') return 'calm';
  const waited = now - agent.since;
  if (!Number.isFinite(waited) || waited <= 0) return 'calm';
  if (waited >= ALTAR_STAGE_MS.webbed) return 'webbed';
  if (waited >= ALTAR_STAGE_MS.sleeping) return 'sleeping';
  if (waited >= ALTAR_STAGE_MS.sitting) return 'sitting';
  if (waited >= ALTAR_STAGE_MS.pacing) return 'pacing';
  return 'calm';
}

/** True for the stages where the agent lies asleep (Zzz). */
export function isAsleep(stage: AltarStage): stage is 'sleeping' | 'webbed' {
  return stage === 'sleeping' || stage === 'webbed';
}

/** Half the width of the pacing, metres, sideways from the agent's place. */
export const PACE_AMPLITUDE = 0.35;
/** Seconds for one full back and forth. */
export const PACE_PERIOD = 4;

/**
 * Where a pacing agent is at time `t` (seconds): a sideways offset from its place, in
 * [-PACE_AMPLITUDE, PACE_AMPLITUDE] along `paceAxis`, and the direction it walks along that
 * axis (+1 or -1). A sine, so it slows down at each end before turning.
 */
export function paceOffset(t: number): { offset: number; dir: 1 | -1 } {
  const phase = ((Number.isFinite(t) ? t : 0) / PACE_PERIOD) * 2 * Math.PI;
  return { offset: PACE_AMPLITUDE * Math.sin(phase), dir: Math.cos(phase) >= 0 ? 1 : -1 };
}

/**
 * Unit vector, in the floor plane, of the agent's local +x (sideways) for a facing angle
 * (rotation about Y, three.js convention: facing 0 looks toward +z). Pacing moves along it.
 */
export function paceAxis(facing: number): { x: number; z: number } {
  return { x: Math.cos(facing), z: -Math.sin(facing) };
}

/** The facing angle of an agent walking along its pacing axis in direction `dir`. */
export function paceHeading(facing: number, dir: 1 | -1): number {
  return facing + (dir === 1 ? Math.PI / 2 : -Math.PI / 2);
}

// ---- Forced stages: the test command shows a stage without waiting for minutes. ----

const forced = new Map<string, AltarStage>();
const watchers = new Set<() => void>();
/** Bumped on every change: the snapshot `useSyncExternalStore` compares. */
let version = 0;

function notify(): void {
  version++;
  for (const watcher of [...watchers]) watcher();
}

/** Forces (or with null, releases) the stage shown by an agent's figure, whatever its wait. */
export function forceAltarStage(id: string, stage: AltarStage | null): void {
  if (stage === null ? !forced.delete(id) : forced.get(id) === stage) return;
  if (stage !== null) forced.set(id, stage);
  notify();
}

/** Releases every forced stage. */
export function clearForcedAltarStages(): void {
  if (forced.size === 0) return;
  forced.clear();
  notify();
}

/** The stage forced on this agent, or undefined. */
export function forcedAltarStage(id: string): AltarStage | undefined {
  return forced.get(id);
}

/** useSyncExternalStore's subscribe. */
export function onAltarForce(watcher: () => void): () => void {
  watchers.add(watcher);
  return () => {
    watchers.delete(watcher);
  };
}

/** useSyncExternalStore's snapshot: changes whenever a forced stage does. */
export function altarForceVersion(): number {
  return version;
}

/** The stage to show: the forced one if any, else the one the wait gives. */
export function shownAltarStage(agent: Pick<AgentView, 'id' | 'state' | 'waitReason' | 'room' | 'since'>, now: number): AltarStage {
  return forced.get(agent.id) ?? altarStage(agent, now);
}

/** Names accepted by the console command: the French ones of the user, plus the code ids. */
const STAGE_NAMES: Readonly<Record<string, AltarStage>> = Object.freeze({
  calme: 'calm',
  'cent-pas': 'pacing',
  assis: 'sitting',
  endormi: 'sleeping',
  toile: 'webbed',
  calm: 'calm',
  pacing: 'pacing',
  sitting: 'sitting',
  sleeping: 'sleeping',
  webbed: 'webbed',
});

/**
 * Reads the console command's stage argument: a known name (case-insensitive), null or
 * undefined to release. Anything else is an error, undefined is returned and nothing changes.
 */
export function parseStageArg(arg: unknown): AltarStage | null | undefined {
  if (arg === null || arg === undefined) return null;
  if (typeof arg !== 'string') return undefined;
  const key = arg.trim().toLowerCase();
  return Object.hasOwn(STAGE_NAMES, key) ? STAGE_NAMES[key] : undefined;
}

export interface AltarCommandDeps {
  /** Id of the selected agent, or null. */
  selected(): string | null;
  /** Ids of the agents waiting at the altar right now. */
  atAltar(): string[];
  log(message: string): void;
}

/**
 * Installs `agentOffice.autel(stage?, id?)` on `target` (the window), next to the other gags'
 * test commands, which it never replaces. Returns the uninstall function.
 *
 * - `autel('toile')` forces a stage on the selected agent, or on every agent at the altar if
 *   none is selected; `autel('endormi', '<agent id>')` on that agent.
 * - `autel()` or `autel(null)` releases the forced stage(s), so the real wait shows again.
 *
 * Developer tool: its console messages are not part of the interface, so stay in English.
 */
export function installAltarCommand(target: object, deps: AltarCommandDeps): () => void {
  const host = target as { agentOffice?: Record<string, unknown> };
  const ns = (host.agentOffice ??= {});
  const command = (stageArg?: unknown, id?: unknown): string[] => {
    const stage = parseStageArg(stageArg);
    if (stage === undefined) {
      deps.log(`autel: unknown stage ${JSON.stringify(stageArg)}; use ${Object.keys(STAGE_NAMES).slice(0, 5).join(', ')} or null`);
      return [];
    }
    if (id !== undefined && typeof id !== 'string') {
      deps.log('autel: the agent id must be a string');
      return [];
    }
    if (stage === null && id === undefined) {
      const ids = [...forced.keys()];
      clearForcedAltarStages();
      deps.log(`autel: released ${ids.length} forced stage(s)`);
      return ids;
    }
    const selected = deps.selected();
    const ids = id !== undefined ? [id] : selected ? [selected] : deps.atAltar();
    if (ids.length === 0) deps.log('autel: no agent selected and none at the altar; pass an agent id');
    for (const one of ids) forceAltarStage(one, stage);
    if (ids.length > 0) deps.log(`autel: ${stage ?? 'released'} on ${ids.join(', ')}`);
    return ids;
  };
  ns.autel = command;
  return () => {
    if (ns.autel === command) delete ns.autel;
  };
}

/**
 * A per-agent time offset (seconds, in [0, PACE_PERIOD)) so that a queue of pacing agents
 * does not walk in step. FNV-1a of the id.
 */
export function paceSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h / 0x1_0000_0000) * PACE_PERIOD;
}

/**
 * Where a figure at its place faces, `t` seconds into its pacing: pacing faces the way it
 * walks; sitting turns its back to the altar (sulking, and facing the camera, which looks
 * at the altar from the south); otherwise the place's own direction.
 */
export function altarHeading(stage: AltarStage, facing: number, t: number): number {
  if (stage === 'pacing') return paceHeading(facing, paceOffset(t).dir);
  if (stage === 'sitting') return facing + Math.PI;
  return facing;
}
