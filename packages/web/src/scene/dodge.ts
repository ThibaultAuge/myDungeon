// The dodge of the slap gag: an agent slapped again and again learns, and ducks the third
// slap of a streak (user decision). Purely visual. Pure module, no three.js, testable in node.
import type { KitClip } from './clipCatalog.ts';

/** Two slaps less than this far apart (ms) belong to the same streak. */
export const DODGE_STREAK_MS = 2000;
/** The slap of a streak that is dodged; the streak then starts again from zero. */
export const DODGE_EVERY = 3;

/** The three KayKit dodges, played in turn. Each moves the figure aside and back (root motion). */
export const DODGE_CLIPS = ['Dodge_Backward', 'Dodge_Left', 'Dodge_Right'] as const satisfies readonly KitClip[];
export type DodgeClip = (typeof DODGE_CLIPS)[number];
/** Length of every dodge clip, in seconds at timeScale 1 (a test checks it against the file). */
export const DODGE_CLIP_TIME = 0.4;

/** A figure's slap streak: how many slaps in a row, and when the last one landed (ms). */
export interface SlapStreak {
  count: number;
  at: number;
}

export const NO_STREAK: SlapStreak = Object.freeze({ count: 0, at: -Infinity });

/**
 * The streak after a slap at `now` (ms), and whether that slap is dodged. A slap too long
 * after the previous one starts a new streak; a clock going backwards also does.
 */
export function nextSlapStreak(prev: SlapStreak, now: number): SlapStreak & { dodge: boolean } {
  const gap = now - prev.at;
  const count = gap >= 0 && gap < DODGE_STREAK_MS ? prev.count + 1 : 1;
  const dodge = count >= DODGE_EVERY;
  return { count: dodge ? 0 : count, at: now, dodge };
}

/** The dodge clip for the n-th dodge of a figure (n counts from 1). */
export function dodgeClipFor(count: number): DodgeClip {
  const n = Number.isFinite(count) ? Math.abs(Math.trunc(count)) : 1;
  return DODGE_CLIPS[(n + DODGE_CLIPS.length - 1) % DODGE_CLIPS.length];
}
