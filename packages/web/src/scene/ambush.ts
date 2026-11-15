import { DEATH_CLIP_TIME, HIT_CLIP_TIME, hold, play, MAX_CLIP_RATE, SKELETON_LOOKS, type ClipChoice, type ClipName } from './characters.ts';
import { seeded } from './dungeon.ts';
import type { Point } from './layout.ts';
import { killPoint } from './outside.ts';

// The death of a main agent whose session was deleted, as a pure state machine (no
// three.js, testable in node). The agent walks out to a kill point on the forest path;
// skeletons climb out of the ground around it, taunt it, strike, and it falls and sinks into
// the ground. Then each skeleton walks into the nearest tree, or collapses into a pile of bones
// that sinks back underground. At most
// SKELETON_COUNT skeletons are out at once; doomed agents with none free wait their turn.

/** Skeletons that can be out at the same time. */
export const SKELETON_COUNT = 3;
/** Distance from a doomed agent at which the skeletons rise, in metres. */
export const STRIKE_RANGE = 1.1;

// ---- Measured clips (KayKit Character Animations 1.1, Rig_Medium). A test checks the clip
// lengths against the files; the impact times and SKELETON_WALK_CLIP_SPEED were measured by
// hand (bones sampled with three.js, confirmed by eye) and are only range-checked.
/** Length of Skeletons_Spawn_Ground: the skeleton climbs out from about 2.8 m underground. */
export const RISE_CLIP_TIME = 3.5667;
/** The rise is played faster, so the knight does not wait too long. */
export const RISE_RATE = 1.5;
/** Seconds a skeleton takes to rise. */
export const RISE_TIME = RISE_CLIP_TIME / RISE_RATE;
/** Length of Skeletons_Taunt, played once between the rise and the first blow. */
export const TAUNT_CLIP_TIME = 1.0333;
/**
 * Lengths of the attacks, and when the blow lands in each: the moment the right hand moves
 * fastest, measured on the clips.
 */
export const CHOP_1H_CLIP_TIME = 1.0667;
export const CHOP_1H_IMPACT = 0.6;
export const CHOP_2H_CLIP_TIME = 1.6333;
export const CHOP_2H_IMPACT = 0.75;
/** Length of Skeletons_Death: the skeleton collapses into a pile of bones (still from ~0.4 s). */
export const SKELETON_DEATH_CLIP_TIME = 2;
/**
 * Speed (units per second, at KIT_SCALE) at which Skeletons_Walking keeps the feet on the
 * ground, measured like WALK_CLIP_SPEED (twice the foot swing per cycle over the cycle length).
 */
export const SKELETON_WALK_CLIP_SPEED = 0.41;

/** The attack of a skeleton, matching its weapon: the axe chops with both hands. */
export interface Attack {
  clip: ClipName;
  /** Time into the clip at which the blow lands. */
  impact: number;
}
const CHOP_1H: Attack = Object.freeze({ clip: 'Melee_1H_Attack_Chop', impact: CHOP_1H_IMPACT });
const CHOP_2H: Attack = Object.freeze({ clip: 'Melee_2H_Attack_Chop', impact: CHOP_2H_IMPACT });
export function attackFor(index: number): Attack {
  return SKELETON_LOOKS[index]?.right?.model === 'Skeleton_Axe' ? CHOP_2H : CHOP_1H;
}
/** Seconds from a skeleton's rise to its first blow landing. */
export const strikeAt = (index: number): number => RISE_TIME + TAUNT_CLIP_TIME + attackFor(index).impact;

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
/** Time for a pile of bones to sink out of sight, and how deep it goes. */
export const BURROW_TIME = 1.2;
export const BURROW_DEPTH = 0.8;

export type VictimPhase = 'walking' | 'waiting' | 'struck' | 'hit' | 'dying' | 'lying' | 'sinking' | 'gone';
export type SkeletonPhase = 'free' | 'rising' | 'taunting' | 'striking' | 'walking' | 'vanishing' | 'collapsing' | 'burrowing';

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
  /** Seconds in `struck` before the first skeleton's blow lands (its rise, taunt and swing). */
  strikeAt: number;
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
  hit: HIT_CLIP_TIME,
  dying: DEATH_CLIP_TIME,
  lying: LIE_TIME,
  sinking: SINK_TIME,
};
/** Seconds `v` spends in its current phase, or undefined when it ends on an event. */
function phaseTime(v: Victim): number | undefined {
  return v.phase === 'struck' ? v.strikeAt : VICTIM_TIMES[v.phase];
}
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
    this.victims.set(id, { id, slot, point, phase: 'walking', t: 0, arrivedAt: 0, facing: 0, strikeAt: 0 });
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
      const time = phaseTime(v);
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
      let first = 0;
      spawns.forEach((p, k) => {
        const s = free.shift()!;
        if (k === 0) first = s.index;
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
      v.strikeAt = strikeAt(first);
    });
  }

  private stepSkeleton(s: Skeleton, dt: number): void {
    if (s.phase === 'free') return;
    s.t += dt;
    const v = this.victims.get(s.victim);
    switch (s.phase) {
      case 'rising':
        if (s.t >= RISE_TIME) this.go(s, 'taunting');
        break;
      case 'taunting':
        if (s.t >= TAUNT_CLIP_TIME) this.go(s, 'striking');
        break;
      case 'striking':
        // Strikes until the body lies still (or its figure is gone), then leaves.
        if (!v || v.phase === 'lying' || v.phase === 'sinking' || v.phase === 'gone') this.go(s, s.tree ? 'walking' : 'collapsing');
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
      case 'collapsing':
        if (s.t >= SKELETON_DEATH_CLIP_TIME) this.go(s, 'burrowing');
        break;
      case 'burrowing':
        if (s.t >= BURROW_TIME) this.go(s, 'free');
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

/**
 * Clip of a skeleton. It strikes with the attack of its weapon; going back underground, it
 * collapses into a pile of bones that stays still while it sinks.
 */
export function skeletonClip(s: Pick<Skeleton, 'phase' | 'index'>): ClipChoice {
  switch (s.phase) {
    case 'rising':
      return play('Skeletons_Spawn_Ground', RISE_RATE, false);
    case 'taunting':
      return play('Skeletons_Taunt', 1, false);
    case 'striking':
      return play(attackFor(s.index).clip);
    case 'walking':
      return play('Skeletons_Walking', Math.min(SKELETON_SPEED / SKELETON_WALK_CLIP_SPEED, MAX_CLIP_RATE));
    case 'collapsing':
      return play('Skeletons_Death', 1, false);
    case 'burrowing':
      return hold('Skeletons_Death', SKELETON_DEATH_CLIP_TIME);
    default:
      return hold('Idle_A');
  }
}

/** Vertical offset of a skeleton: its pile of bones sinks while going back underground. */
export function skeletonDepth(s: Pick<Skeleton, 'phase' | 't'>): number {
  return s.phase === 'burrowing' ? BURROW_DEPTH * Math.min(1, s.t / BURROW_TIME) : 0;
}

/** Size factor of a skeleton: it shrinks into its tree. */
export function skeletonScale(s: Pick<Skeleton, 'phase' | 't'>): number {
  return s.phase === 'vanishing' ? Math.max(0, 1 - s.t / VANISH_TIME) : 1;
}
