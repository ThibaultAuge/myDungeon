import { DEATH_CLIP_TIME, HIT_CLIP_TIME, hold, play, SPAWN_CLIP_TIME, USE_ITEM_CLIP_TIME, WALK_CLIP_SPEED, MAX_CLIP_RATE, type ClipChoice } from './characters.ts';
import { seeded } from './dungeon.ts';
import type { Point } from './layout.ts';
import { killPoint } from './outside.ts';

// The death of a main agent whose session was deleted, as a pure state machine (no
// three.js, testable in node). The agent walks out to a kill point on the forest path;
// skeletons rise from the ground around it, strike, and it falls and sinks into the ground.
// Then each skeleton walks into the nearest tree or goes back underground. At most
// SKELETON_COUNT skeletons are out at once; doomed agents with none free wait their turn.

/** Skeletons that can be out at the same time. */
export const SKELETON_COUNT = 3;
/** Distance from a doomed agent at which the skeletons rise, in metres. */
export const STRIKE_RANGE = 1.1;
/** Time into the strike at which the blow lands. */
export const IMPACT_TIME = USE_ITEM_CLIP_TIME / 2;
/** The body lies still this long before sinking. */
export const LIE_TIME = 1.5;
/** Time for the body to sink out of sight, and how deep it goes. */
export const SINK_TIME = 2;
export const SINK_DEPTH = 1.2;
/** Walking speed of a skeleton heading for a tree, in metres per second. */
export const SKELETON_SPEED = 1.6;
/** A skeleton never walks farther than this to a tree: beyond it goes back underground. */
export const TREE_REACH = 9;
/** A skeleton stops this far from the trunk's centre and fades into it. */
export const TRUNK_RADIUS = 0.35;
/** Time for a skeleton to shrink into a tree. */
export const VANISH_TIME = 0.6;
/** How deep a skeleton goes while sinking back underground. */
export const BURROW_DEPTH = 1.6;

export type VictimPhase = 'walking' | 'waiting' | 'struck' | 'hit' | 'dying' | 'lying' | 'sinking' | 'gone';
export type SkeletonPhase = 'free' | 'rising' | 'striking' | 'walking' | 'vanishing' | 'burrowing';

export interface Victim {
  id: string;
  /** Waiting slot along the path: 0 is the first kill point. */
  slot: number;
  point: Point;
  phase: VictimPhase;
  /** Seconds spent in the current phase. */
  t: number;
  /** Order of arrival at the kill point: who gets skeletons first. */
  arrivedAt: number;
  /** Heading to face while struck (towards the first skeleton). */
  facing: number;
}

export interface Skeleton {
  /** Index in SKELETON_LOOKS. */
  index: number;
  phase: SkeletonPhase;
  t: number;
  /** Id of the doomed agent it was sent for; '' when free. */
  victim: string;
  pos: Point;
  heading: number;
  /** Counts its outings: each one is a new figure, never blended from the previous outing. */
  sortie: number;
  /** Where it walks before vanishing; null when it goes back underground. */
  tree: Point | null;
}

const headingTo = (from: Point, to: Point) => Math.atan2(to.x - from.x, to.z - from.z);

/** Nearest tree to `p` within TREE_REACH, or null. */
export function nearestTree(p: Point, trees: readonly Point[]): Point | null {
  let best: Point | null = null;
  let bestD = TREE_REACH;
  for (const t of trees) {
    const d = Math.hypot(t.x - p.x, t.z - p.z);
    if (d <= bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

/**
 * How many free skeletons each waiting victim gets, in arrival order. Every victim served
 * gets at least one; the free ones are spread evenly, the later ones getting the remainder.
 * A lone victim gets all of them. Victims beyond the free count get none (they wait).
 */
export function assignSkeletons(waiting: number, free: number): number[] {
  const out: number[] = [];
  let left = free;
  for (let i = 0; i < waiting; i++) {
    if (left <= 0) {
      out.push(0);
      continue;
    }
    const n = Math.min(left, Math.max(1, Math.floor(left / (waiting - i))));
    out.push(n);
    left -= n;
  }
  return out;
}

/** Points around a victim where `n` skeletons rise, evenly spread, turned by a stable seed. */
export function skeletonSpawns(victim: Point, n: number, seed: string): Point[] {
  const turn = seeded(`ambush:${seed}`)() * Math.PI * 2;
  return Array.from({ length: n }, (_, i) => {
    const a = turn + (i * Math.PI * 2) / n;
    return { x: victim.x + Math.sin(a) * STRIKE_RANGE, z: victim.z + Math.cos(a) * STRIKE_RANGE };
  });
}

/** Seconds a victim spends in a phase before the next one; walking and waiting end on events. */
const VICTIM_TIMES: Partial<Record<VictimPhase, number>> = {
  struck: SPAWN_CLIP_TIME + IMPACT_TIME,
  hit: HIT_CLIP_TIME,
  dying: DEATH_CLIP_TIME,
  lying: LIE_TIME,
  sinking: SINK_TIME,
};
const NEXT_VICTIM_PHASE: Partial<Record<VictimPhase, VictimPhase>> = {
  struck: 'hit',
  hit: 'dying',
  dying: 'lying',
  lying: 'sinking',
  sinking: 'gone',
};

export class Ambush {
  readonly skeletons: Skeleton[];
  private readonly victims = new Map<string, Victim>();
  private arrivals = 0;

  constructor(private readonly trees: readonly Point[]) {
    this.skeletons = Array.from({ length: SKELETON_COUNT }, (_, index) => ({
      index,
      phase: 'free' as SkeletonPhase,
      t: 0,
      victim: '',
      pos: { x: 0, z: 0 },
      heading: 0,
      sortie: 0,
      tree: null,
    }));
  }

  /** Registers a doomed agent and returns its kill point. Idempotent. */
  add(id: string): Point {
    const known = this.victims.get(id);
    if (known) return known.point;
    const used = new Set([...this.victims.values()].map((v) => v.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const point = killPoint(slot);
    this.victims.set(id, { id, slot, point, phase: 'walking', t: 0, arrivedAt: 0, facing: 0 });
    return point;
  }

  /** The doomed agent reached its kill point. */
  arrived(id: string): void {
    const v = this.victims.get(id);
    if (!v || v.phase !== 'walking') return;
    v.phase = 'waiting';
    v.t = 0;
    v.arrivedAt = ++this.arrivals;
  }

  victim(id: string): Readonly<Victim> | undefined {
    return this.victims.get(id);
  }

  /** Forgets a victim once its figure has left the scene. Its skeletons finish on their own. */
  release(id: string): void {
    this.victims.delete(id);
  }

  /** Advances the whole scene by `dt` seconds. */
  step(dt: number): void {
    for (const v of this.victims.values()) {
      v.t += dt;
      const time = VICTIM_TIMES[v.phase];
      const next = NEXT_VICTIM_PHASE[v.phase];
      if (time !== undefined && next && v.t >= time) {
        v.phase = next;
        v.t = 0;
      }
    }
    for (const s of this.skeletons) this.stepSkeleton(s, dt);
    this.send();
  }

  /** Sends the free skeletons to the waiting victims, first arrived first served. */
  private send(): void {
    const free = this.skeletons.filter((s) => s.phase === 'free');
    if (free.length === 0) return;
    const waiting = [...this.victims.values()].filter((v) => v.phase === 'waiting').sort((a, b) => a.arrivedAt - b.arrivedAt);
    const counts = assignSkeletons(waiting.length, free.length);
    waiting.forEach((v, i) => {
      const n = counts[i];
      if (n === 0) return;
      const spawns = skeletonSpawns(v.point, n, v.id);
      spawns.forEach((p, k) => {
        const s = free.shift()!;
        s.phase = 'rising';
        s.sortie++;
        s.t = 0;
        s.victim = v.id;
        s.pos = p;
        s.heading = headingTo(p, v.point);
        const tree = nearestTree(p, this.trees);
        s.tree = tree && seeded(`exit:${v.id}:${k}`)() < 0.5 ? tree : null;
      });
      v.phase = 'struck';
      v.t = 0;
      v.facing = headingTo(v.point, spawns[0]);
    });
  }

  private stepSkeleton(s: Skeleton, dt: number): void {
    if (s.phase === 'free') return;
    s.t += dt;
    const v = this.victims.get(s.victim);
    switch (s.phase) {
      case 'rising':
        if (s.t >= SPAWN_CLIP_TIME) this.go(s, 'striking');
        break;
      case 'striking':
        // Strikes until the body lies still (or its figure is gone), then leaves.
        if (!v || v.phase === 'lying' || v.phase === 'sinking' || v.phase === 'gone') this.go(s, s.tree ? 'walking' : 'burrowing');
        break;
      case 'walking': {
        const tree = s.tree!;
        const dist = Math.hypot(tree.x - s.pos.x, tree.z - s.pos.z) - TRUNK_RADIUS;
        s.heading = headingTo(s.pos, tree);
        const step = SKELETON_SPEED * dt;
        if (dist <= step) {
          const k = Math.max(dist, 0) / (dist + TRUNK_RADIUS || 1);
          s.pos = { x: s.pos.x + (tree.x - s.pos.x) * k, z: s.pos.z + (tree.z - s.pos.z) * k };
          this.go(s, 'vanishing');
        } else {
          const k = step / (dist + TRUNK_RADIUS);
          s.pos = { x: s.pos.x + (tree.x - s.pos.x) * k, z: s.pos.z + (tree.z - s.pos.z) * k };
        }
        break;
      }
      case 'vanishing':
        if (s.t >= VANISH_TIME) this.go(s, 'free');
        break;
      case 'burrowing':
        if (s.t >= SPAWN_CLIP_TIME) this.go(s, 'free');
        break;
    }
  }

  private go(s: Skeleton, phase: SkeletonPhase): void {
    s.phase = phase;
    s.t = 0;
    if (phase === 'free') {
      s.victim = '';
      s.tree = null;
    }
  }
}

/** Clip of a doomed agent once it reached its kill point; null while it still walks. */
export function victimClip(phase: VictimPhase): ClipChoice | null {
  switch (phase) {
    case 'waiting':
    case 'struck':
      // Standing on guard, whatever it was doing when its session left.
      return play('Idle_B');
    case 'hit':
      return play('Hit_A', 1, false);
    case 'dying':
    case 'lying':
    case 'sinking':
    case 'gone':
      return play('Death_A', 1, false);
    default:
      return null;
  }
}

/** How deep a doomed agent's body has sunk, from 0 to SINK_DEPTH. */
export function victimSink(v: Pick<Victim, 'phase' | 't'>): number {
  if (v.phase === 'gone') return SINK_DEPTH;
  if (v.phase !== 'sinking') return 0;
  return SINK_DEPTH * Math.min(1, v.t / SINK_TIME);
}

/** Clip of a skeleton. Going back underground plays its rising clip backwards. */
export function skeletonClip(s: Pick<Skeleton, 'phase' | 't'>): ClipChoice {
  switch (s.phase) {
    case 'rising':
      return play('Spawn_Ground', 1, false);
    case 'striking':
      return play('Use_Item');
    case 'walking':
      return play('Walking_A', Math.min(SKELETON_SPEED / WALK_CLIP_SPEED, MAX_CLIP_RATE));
    case 'burrowing':
      return hold('Spawn_Ground', Math.max(0, SPAWN_CLIP_TIME - s.t));
    default:
      return hold('Idle_A');
  }
}

/** Vertical offset of a skeleton: it sinks while going back underground. */
export function skeletonDepth(s: Pick<Skeleton, 'phase' | 't'>): number {
  return s.phase === 'burrowing' ? BURROW_DEPTH * Math.min(1, s.t / SPAWN_CLIP_TIME) : 0;
}

/** Size factor of a skeleton: it shrinks into its tree. */
export function skeletonScale(s: Pick<Skeleton, 'phase' | 't'>): number {
  return s.phase === 'vanishing' ? Math.max(0, 1 - s.t / VANISH_TIME) : 1;
}
