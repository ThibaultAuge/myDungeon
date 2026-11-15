// Celebrations, a purely visual gag: a herald sounds his trumpet on a corner tower after a
// successful git commit (short) or push (long fanfare), fireworks go off after a passing test
// suite. The server only sends the kind (never the command). Pure module, no three.js.
import type { Celebration } from '@agent-office/shared';
import { hold, play, SPAWN_CLIP_TIME, type ClipChoice } from './characters.ts';

export type HeraldKind = 'commit' | 'push';

type Listener = (kind: Celebration) => void;
const listeners = new Set<Listener>();

/**
 * Plays a celebration in the scene. Shared by server events and the console. Returns true when
 * a scene is mounted to show it (a herald still needs a free tower).
 */
export function celebrate(kind: Celebration): boolean {
  // A copy: a listener that unsubscribes while being called does not skip the next one.
  for (const listener of [...listeners]) listener(kind);
  return listeners.size > 0;
}

/** Called on every celebration. Returns the unsubscribe function. */
export function onCelebrate(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Installs the test commands `agentOffice.heraut(kind?)` (`'commit'`: short call, `'push'`:
 * long fanfare, the default) and `agentOffice.feuArtifice()` on `host` (the window), next to the
 * other gags' commands. Kept in production builds on purpose: purely visual, client only.
 */
export function installCelebrationCommands(host: object): void {
  const holder = host as { agentOffice?: unknown };
  // Something else already sits under that name (set by hand in the console): replace it.
  if (typeof holder.agentOffice !== 'object' || holder.agentOffice === null) holder.agentOffice = {};
  const commands = holder.agentOffice as Record<string, unknown>;
  commands.heraut = (kind?: unknown) => celebrate(kind === 'commit' ? 'commit' : 'push');
  commands.feuArtifice = () => celebrate('tests');
}

// --- Herald ---------------------------------------------------------------------------

/** Time the herald sounds his trumpet, in seconds: a short call for a commit, a fanfare for a push. */
export const TRUMPET_TIME: Record<HeraldKind, number> = { commit: 2.4, push: 6 };

export type HeraldPhase = 'rising' | 'trumpeting' | 'sinking' | 'gone';

/** Where the herald is in his outing, `elapsed` seconds after it started; `t` is the time in that phase. */
export function heraldPhase(elapsed: number, kind: HeraldKind): { phase: HeraldPhase; t: number } {
  const trumpet = TRUMPET_TIME[kind];
  if (elapsed < SPAWN_CLIP_TIME) return { phase: 'rising', t: Math.max(0, elapsed) };
  if (elapsed < SPAWN_CLIP_TIME + trumpet) return { phase: 'trumpeting', t: elapsed - SPAWN_CLIP_TIME };
  if (elapsed < 2 * SPAWN_CLIP_TIME + trumpet) return { phase: 'sinking', t: elapsed - SPAWN_CLIP_TIME - trumpet };
  return { phase: 'gone', t: 0 };
}

/** Whole outing length in seconds. */
export function heraldDuration(kind: HeraldKind): number {
  return 2 * SPAWN_CLIP_TIME + TRUMPET_TIME[kind];
}

/** How far the herald goes down through the tower's trapdoor as he leaves. */
export const HERALD_SINK = 1.2;

/** The herald's clip: he climbs out of the trapdoor, raises the trumpet, then goes back down. */
export function heraldClip(phase: HeraldPhase, t: number): ClipChoice {
  switch (phase) {
    case 'rising':
      return play('Spawn_Ground', 1, false);
    case 'trumpeting':
      return play('Use_Item');
    case 'sinking':
      // The rising clip held backwards, as the skeletons burrow.
      return hold('Spawn_Ground', Math.max(0, SPAWN_CLIP_TIME - t));
    default:
      return hold('Idle_A');
  }
}

/** Depth below the tower top: 0 until he leaves, then down to `HERALD_SINK`. */
export function heraldDepth(phase: HeraldPhase, t: number): number {
  if (phase === 'sinking') return HERALD_SINK * Math.min(1, t / SPAWN_CLIP_TIME);
  return phase === 'gone' ? HERALD_SINK : 0;
}

/** Free towers: one herald per tower at most. */
export class TowerPool {
  private readonly busy: boolean[];

  constructor(count: number) {
    this.busy = new Array<boolean>(count).fill(false);
  }

  /** A random free tower, now taken, or null when every tower already has its herald. */
  claim(random: () => number = Math.random): number | null {
    const free = this.busy.flatMap((b, i) => (b ? [] : [i]));
    if (free.length === 0) return null;
    const pick = free[Math.min(free.length - 1, Math.floor(random() * free.length))];
    this.busy[pick] = true;
    return pick;
  }

  release(index: number): void {
    if (index >= 0 && index < this.busy.length) this.busy[index] = false;
  }
}

// --- Fireworks -------------------------------------------------------------------------

/** Whole show length in seconds. A new test success restarts it. */
export const FIREWORKS_TIME = 4.2;
/** Under reduced motion: one still bouquet shown this long, nothing moves. */
export const FIREWORKS_STILL_TIME = 1.5;
/** A rocket climbs this long before it bursts. */
export const ROCKET_TIME = 0.6;
/** A burst lives this long after it opens. */
export const BURST_TIME = 1.6;
/** Sparks of one burst. */
export const SPARKS = 60;
/** Bursts per show. */
export const BURSTS = 5;
/** Height the rockets leave from (top of the castle walls). */
export const LAUNCH_Y = 3;
const GRAVITY = 2.2;

export interface Burst {
  x: number;
  y: number;
  z: number;
  /** Start of the rocket, seconds after the show starts. */
  delay: number;
  /** Speed of the sparks when it bursts (sets its size). */
  speed: number;
  /** Linear RGB, 0–1. */
  color: [number, number, number];
}

const COLORS: [number, number, number][] = [
  [1, 0.35, 0.3],
  [1, 0.85, 0.3],
  [0.4, 0.8, 1],
  [0.6, 1, 0.45],
  [1, 0.5, 0.95],
];

/**
 * The bursts of one show, above the castle (centre `cx`, `cz`): spread over its width, a little
 * behind the middle so they show in the sky of the default view. `random` makes each show differ.
 */
export function fireworkBursts(cx: number, cz: number, random: () => number = Math.random): Burst[] {
  return Array.from({ length: BURSTS }, (_, i) => ({
    x: cx + (i - (BURSTS - 1) / 2) * 7 + (random() - 0.5) * 3,
    y: 11 + random() * 4,
    z: cz - 4 - random() * 5,
    delay: i * 0.5 + random() * 0.3,
    speed: 4.5 + random() * 2,
    color: COLORS[i % COLORS.length],
  }));
}

/** Directions of the sparks: evenly spread on a sphere (Fibonacci lattice). */
export const SPARK_DIRECTIONS: readonly [number, number, number][] = Array.from({ length: SPARKS }, (_, i) => {
  const y = 1 - (2 * (i + 0.5)) / SPARKS;
  const r = Math.sqrt(1 - y * y);
  const a = i * Math.PI * (3 - Math.sqrt(5));
  return [Math.cos(a) * r, y, Math.sin(a) * r];
});

export interface Spark {
  x: number;
  y: number;
  z: number;
  /** 0 (invisible) to 1. */
  alpha: number;
}

/** The rocket of a burst at show time `time`: climbing, or invisible before and after. */
export function rocketAt(b: Burst, time: number): Spark {
  const t = time - b.delay;
  if (t < 0 || t >= ROCKET_TIME) return { x: b.x, y: b.y, z: b.z, alpha: 0 };
  const k = t / ROCKET_TIME;
  // Fast at first, slowing as it nears the top.
  const up = 1 - (1 - k) ** 2;
  return { x: b.x, y: LAUNCH_Y + (b.y - LAUNCH_Y) * up, z: b.z, alpha: 1 };
}

/**
 * Spark `i` of a burst at show time `time`: it flies out from the burst point, falls a little
 * and fades. `still` (reduced motion) freezes every burst open, at full brightness.
 */
export function sparkAt(b: Burst, i: number, time: number, still = false): Spark {
  const [dx, dy, dz] = SPARK_DIRECTIONS[i % SPARKS];
  const t = still ? BURST_TIME * 0.35 : time - b.delay - ROCKET_TIME;
  if (t < 0 || t >= BURST_TIME) return { x: b.x, y: b.y, z: b.z, alpha: 0 };
  // The sparks slow down (drag) and fall.
  const out = b.speed * (1 - Math.exp(-2.5 * t));
  return {
    x: b.x + dx * out,
    y: b.y + dy * out - (still ? 0 : 0.5 * GRAVITY * t * t),
    z: b.z + dz * out,
    alpha: still ? 1 : 1 - (t / BURST_TIME) ** 2,
  };
}
