// Which KayKit Adventurers character stands for an agent, and which animation it plays.
// Pure logic, no three.js, so it is testable in node. The clips come from the shared
// `Rig_Medium` animation files and fit every character of the pack.
import type { AgentState, AgentView } from '@agent-office/shared';

/** Character models of the `adventurers` pack in kit-manifest.json. */
export type CharacterModel = 'Knight' | 'Rogue_Hooded';

/**
 * Skins per kind of agent. An agent picks one deterministically from its id, so adding
 * a skin to a list is enough to vary the figures (planned for subagents).
 */
export const CHARACTERS: Record<AgentView['kind'], readonly CharacterModel[]> = {
  main: ['Knight'],
  sub: ['Rogue_Hooded'],
};

/** Stable small hash of a string, the same one on every client. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function characterFor(kind: AgentView['kind'], agentId: string): CharacterModel {
  const skins = CHARACTERS[kind];
  return skins[hash(agentId) % skins.length];
}

/** Clips used by the figures, from Rig_Medium_General and Rig_Medium_MovementBasic. */
export const CLIPS = ['Walking_A', 'Running_A', 'Interact', 'Idle_A', 'Idle_B', 'PickUp', 'Spawn_Ground'] as const;
export type ClipName = (typeof CLIPS)[number];

/**
 * Speeds (units per second, at KIT_SCALE) at which Walking_A and Running_A, played at
 * timeScale 1, keep the feet on the floor. Measured from the clips: twice the foot swing
 * per cycle, divided by the cycle length. KayKit legs are short, far below CRUISE_SPEED.
 */
export const WALK_CLIP_SPEED = 0.57;
export const RUN_CLIP_SPEED = 1.4;
/** Above this speed the figure runs instead of walking. */
export const RUN_THRESHOLD = 1.2;
/**
 * Fastest playback of a walk or run clip. Matching the feet at cruise speed would make the
 * legs flail; above this rate the figure slides a little instead (barely visible from above).
 */
export const MAX_CLIP_RATE = 1.8;
/** Spawn_Ground is sped up a little: the subagent should not wait long before walking. */
export const SPAWN_TIME_SCALE = 1.5;
/** Time in PickUp where the figure is crouched: the kneeling pose at the altar. */
export const KNEEL_POSE_TIME = 0.55;

export interface ClipInput {
  /** The figure moves along its path this frame. */
  moving: boolean;
  /** Current walking speed, units per second. */
  speed: number;
  state: AgentState;
  /** A new subagent is coming out of the ground. */
  spawning: boolean;
  /** The figure is first of the altar queue, at its spot. */
  kneeling: boolean;
  reducedMotion: boolean;
}

export interface ClipChoice {
  name: ClipName;
  loop: boolean;
  timeScale: number;
  /** Held still at `frozenAt` seconds instead of playing. */
  frozen: boolean;
  frozenAt: number;
}

const play = (name: ClipName, timeScale = 1, loop = true): ClipChoice => ({ name, loop, timeScale, frozen: false, frozenAt: 0 });
const hold = (name: ClipName, at = 0): ClipChoice => ({ name, loop: false, timeScale: 0, frozen: true, frozenAt: at });

/**
 * The clip for a frame. Reduced motion keeps every figure on a still pose: the position
 * still changes (that is information), the limbs do not.
 */
export function clipFor(input: ClipInput): ClipChoice {
  const { moving, speed, state, spawning, kneeling, reducedMotion } = input;
  if (spawning && !reducedMotion) return play('Spawn_Ground', SPAWN_TIME_SCALE, false);
  if (moving) {
    if (reducedMotion) return hold('Idle_A');
    return speed >= RUN_THRESHOLD
      ? play('Running_A', Math.min(speed / RUN_CLIP_SPEED, MAX_CLIP_RATE))
      : play('Walking_A', Math.min(Math.max(speed / WALK_CLIP_SPEED, 0.5), MAX_CLIP_RATE));
  }
  if (kneeling) return hold('PickUp', KNEEL_POSE_TIME);
  if (state === 'done' || reducedMotion) return hold('Idle_A');
  if (state === 'working') return play('Interact');
  return play('Idle_B');
}
