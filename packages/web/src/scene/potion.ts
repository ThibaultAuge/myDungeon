// The potion of oblivion: when Claude Code compacts a session's context (hook PreCompact),
// its agent drinks a potion, staggers, and stars turn around its head. A purely visual gag,
// like the slap: nothing is sent to the server and the agent's work is not touched.
// Pure module, no three.js, testable in node.
import type { HookEventSummary, SessionView } from '@agent-office/shared';
import { USE_ITEM_CLIP_TIME } from './characters.ts';

/** The hook that makes an agent drink. */
export const POTION_EVENT = 'PreCompact';

/** The gulp: one Use_Item clip, bottle in hand, the walk paused. */
export const DRINK_S = USE_ITEM_CLIP_TIME;
/** Then the agent staggers, stars around its head, the sway dying down. */
export const STAGGER_S = 3;
/** Whole effect, in seconds and in milliseconds (the HTML stars and bubble). */
export const POTION_S = DRINK_S + STAGGER_S;
export const POTION_EFFECT_MS = Math.round(POTION_S * 1000);

/** Largest sideways lean (roll) and forward lean (pitch) of the stagger, in radians. */
export const SWAY_ROLL = 0.2;
export const SWAY_PITCH = 0.08;
/** Sway frequencies, in hertz: not multiples of each other, so the wobble never repeats exactly. */
const ROLL_HZ = 1.1;
const PITCH_HZ = 0.7;

export type PotionPhase = 'drinking' | 'staggering';

/** Where the effect is, `elapsed` seconds after the agent started drinking; null outside it. */
export function potionPhase(elapsed: number): PotionPhase | null {
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= POTION_S) return null;
  return elapsed < DRINK_S ? 'drinking' : 'staggering';
}

export interface Sway {
  /** Lean to the side (rotation about the forward axis), radians. */
  roll: number;
  /** Lean forward or back, radians. */
  pitch: number;
}

/**
 * The stagger's lean `elapsed` seconds after the agent started drinking. Zero while drinking
 * and after the effect; in between it starts at zero (no jump when the gulp ends) and its
 * amplitude dies down to zero at the end (no jump back to standing).
 */
export function staggerSway(elapsed: number): Sway {
  if (potionPhase(elapsed) !== 'staggering') return { roll: 0, pitch: 0 };
  const s = elapsed - DRINK_S;
  const fade = 1 - s / STAGGER_S;
  const amp = fade * fade;
  return {
    roll: SWAY_ROLL * amp * Math.sin(2 * Math.PI * ROLL_HZ * s),
    pitch: SWAY_PITCH * amp * Math.sin(2 * Math.PI * PITCH_HZ * s),
  };
}

/**
 * The figure that drinks for a hook event, or null: only PreCompact, only an agent of a session
 * shown in this view. A subagent's event targets that subagent (null if it has no figure); the
 * main agent's targets the session's main id, never one rebuilt from the session id (an absorbed
 * session keeps the id of its most recent main agent).
 */
export function potionTarget(event: HookEventSummary, sessions: readonly SessionView[]): string | null {
  if (event.event !== POTION_EVENT) return null;
  const session = sessions.find((s) => s.id === event.sessionId);
  if (!session) return null;
  if (event.agentId === undefined) return session.main.id;
  return session.subagents.some((a) => a.id === event.agentId) ? event.agentId : null;
}

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

/** True while a figure of this agent is in the scene. */
export function hasPotionTarget(id: string): boolean {
  return listeners.has(id);
}

/** Makes an agent drink. Returns true when a figure of that agent is in the scene to show it. */
export function drinkPotion(id: string): boolean {
  const set = listeners.get(id);
  if (!set) return false;
  // A copy: a listener that unsubscribes while being called does not skip the next one.
  for (const listener of [...set]) listener();
  return true;
}

/** Called each time this agent drinks. Returns the unsubscribe function. */
export function onPotion(id: string, listener: Listener): () => void {
  let set = listeners.get(id);
  if (!set) listeners.set(id, (set = new Set()));
  set.add(listener);
  return () => {
    const current = listeners.get(id);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(id);
  };
}

/** The console namespace shared by the gags' test commands, created by the first one. */
export interface GagCommands {
  [name: string]: unknown;
  potion?: (id?: string) => boolean;
}

/**
 * Installs the test command `agentOffice.potion(id?)` on `host` (the window): it makes the agent
 * `id`, or the selected agent when no id is given, drink. Returns true when a figure reacted.
 * Kept in production builds on purpose: purely visual, no request to the server.
 */
export function installPotionCommand(selected: () => string | null, host: object): void {
  const holder = host as { agentOffice?: unknown };
  // Something else already sits under that name (set by hand in the console): replace it.
  if (typeof holder.agentOffice !== 'object' || holder.agentOffice === null) holder.agentOffice = {};
  const commands = holder.agentOffice as GagCommands;
  commands.potion = (id?: string) => {
    const target = typeof id === 'string' ? id : selected();
    return target !== null && drinkPotion(target);
  };
}
