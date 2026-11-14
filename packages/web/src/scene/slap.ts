// The slap, a nod to the hand of Dungeon Keeper: a purely visual gag. Nothing is sent to
// the server and the agent's work is not touched. Pure module, no three.js, testable in node.
import type { ClipName } from './characters.ts';

/** How long the hand, the stars and the bubble stay on screen, in milliseconds. */
export const SLAP_EFFECT_MS = 1500;

/** The two KayKit hit reactions, played in turn so that repeated slaps do not look the same. */
export const HIT_CLIPS = ['Hit_A', 'Hit_B'] as const satisfies readonly ClipName[];

/** The hit clip for the n-th slap of a figure (n counts from 1). */
export function hitClipFor(count: number): (typeof HIT_CLIPS)[number] {
  // NaN or an infinite count (never passed today) would index nothing: fall back to the first clip.
  const n = Number.isFinite(count) ? Math.abs(Math.trunc(count)) : 0;
  return HIT_CLIPS[n % HIT_CLIPS.length];
}

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();
/** Notified when an agent gains or loses its figure, so the card can show its button or not. */
const targetWatchers = new Set<() => void>();

function notifyTargets(): void {
  for (const watcher of [...targetWatchers]) watcher();
}

/** True while a figure of this agent is in the scene: only then does a slap show anything. */
export function hasSlapTarget(id: string): boolean {
  return listeners.has(id);
}

/** Called when any agent gains or loses its figure (useSyncExternalStore's subscribe). */
export function watchSlapTargets(watcher: () => void): () => void {
  targetWatchers.add(watcher);
  return () => {
    targetWatchers.delete(watcher);
  };
}

/**
 * Slaps an agent: its figure (if it is in the scene) plays the effect. Shared by the right
 * click on the figure and the button of the agent card, so both do exactly the same thing.
 */
export function slapAgent(id: string): void {
  // A copy: a listener that unsubscribes while being called does not skip the next one.
  for (const listener of [...(listeners.get(id) ?? [])]) listener();
}

/** Called on every slap of this agent. Returns the unsubscribe function. */
export function onSlap(id: string, listener: Listener): () => void {
  let set = listeners.get(id);
  const added = !set;
  if (!set) listeners.set(id, (set = new Set()));
  set.add(listener);
  if (added) notifyTargets();
  return () => {
    const current = listeners.get(id);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listeners.delete(id);
      notifyTargets();
    }
  };
}
