import type { SessionView } from '@agent-office/shared';
import { CORRIDORS, corridorPath, type Point } from './layout.ts';

// Ghosts: the stopped terminal sessions that never did anything (a process the desktop app
// prepared in advance, or the leftover process of a deleted desktop session). They are not
// real agents, so they get no seat: a sheet ghost wanders the corridors, passing through
// walls, and evaporates when the session leaves. Pure, no three.js: testable in node.

/** Wandering speed in m/s, slower than a walking figure. */
export const GHOST_SPEED = 0.7;
/** How long a departing ghost takes to fade out and rise. */
export const EVAPORATE_MS = 1500;
/** How high the evaporating ghost rises, in metres. */
export const EVAPORATE_RISE = 1.6;

/** A stopped terminal session that never did real work, still listed. */
export function isGhost(s: Pick<SessionView, 'origin' | 'live' | 'archived' | 'everActive'>): boolean {
  return s.origin === 'cli' && !s.live && !s.archived && !s.everActive;
}

/** Seeded pseudo-random numbers in [0, 1) (FNV-1a hash of the seed, then mulberry32). */
export function seededRandom(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Corridor ends: the places a ghost drifts towards, one after another. */
export const WANDER_POINTS: readonly Point[] = (() => {
  const out: Point[] = [];
  for (const [a, b] of CORRIDORS) {
    for (const p of [a, b]) if (!out.some((q) => q.x === p.x && q.z === p.z)) out.push(p);
  }
  return out;
})();

/** The closest point on any corridor centre line. */
export function nearestOnCorridor(p: Point): Point {
  let best: Point = WANDER_POINTS[0];
  let bestDist = Infinity;
  for (const [a, b] of CORRIDORS) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
    const q = { x: a.x + dx * t, z: a.z + dz * t };
    const d = Math.hypot(p.x - q.x, p.z - q.z);
    if (d < bestDist) {
      bestDist = d;
      best = q;
    }
  }
  return best;
}

/** A corridor point picked by `random`, used where a ghost appears with no body to leave. */
export function wanderStart(random: () => number): Point {
  return WANDER_POINTS[Math.floor(random() * WANDER_POINTS.length) % WANDER_POINTS.length];
}

/**
 * The next leg of a wander from `from` (on a corridor): the turning points along the
 * corridors to another corridor end, at least 4 m away, picked by `random`.
 */
export function nextWander(random: () => number, from: Point): Point[] {
  const far = WANDER_POINTS.filter((p) => Math.hypot(p.x - from.x, p.z - from.z) >= 4);
  const pool = far.length > 0 ? far : WANDER_POINTS;
  const target = pool[Math.floor(random() * pool.length) % pool.length];
  return corridorPath(from, target);
}

export interface GhostEntry {
  session: SessionView;
  /** The session left the snapshot or stopped being a ghost: it evaporates, then `gone`. */
  leaving: boolean;
}

/**
 * The ghosts on screen, departing ones included until they have evaporated. Same idea as
 * `Stage.leaving`, without the ambush: a ghost cannot be killed.
 */
export class Ghosts {
  private readonly entries = new Map<string, GhostEntry>();

  /**
   * Ghosts to draw for these sessions. Idempotent for the same sessions. Before the route's
   * first snapshot (`snapshotReceived` false) nothing is shown and nobody evaporates: the
   * sessions still belong to the previous environment.
   */
  update(sessions: readonly SessionView[], snapshotReceived: boolean): GhostEntry[] {
    if (!snapshotReceived) {
      this.entries.clear();
      return [];
    }
    const current = new Map(sessions.filter(isGhost).map((s) => [s.id, s]));
    for (const [id, session] of current) {
      const entry = this.entries.get(id);
      if (!entry || entry.leaving || entry.session !== session) this.entries.set(id, { session, leaving: false });
    }
    for (const [id, entry] of this.entries) {
      if (!current.has(id) && !entry.leaving) this.entries.set(id, { session: entry.session, leaving: true });
    }
    return [...this.entries.values()];
  }

  /** A departing ghost finished evaporating. */
  gone(id: string): void {
    if (this.entries.get(id)?.leaving) this.entries.delete(id);
  }
}

/** Fade and rise of a departing ghost `elapsedMs` after it started to leave. */
export function evaporation(elapsedMs: number): { opacity: number; rise: number; done: boolean } {
  const t = Math.min(1, Math.max(0, elapsedMs / EVAPORATE_MS));
  // Ease out: rises quickly at first, then lingers as it vanishes.
  const eased = 1 - (1 - t) * (1 - t);
  return { opacity: 1 - t, rise: eased * EVAPORATE_RISE, done: t >= 1 };
}
