// Rogue-looking subagents sneak back to the tavern once their task is done, as if slipping
// away (user decision). Purely visual. Pure module, no three.js, testable in node.
import type { AgentState, AgentView } from '@agent-office/shared';
import type { CharacterModel, SkeletonModel } from './characters.ts';

/** The bodies that sneak. */
export const SNEAK_BODIES: readonly CharacterModel[] = Object.freeze(['Rogue', 'Rogue_Hooded']);

/**
 * Top speed of a sneaking figure, m/s (the cruise speed is 9). Slow enough that the creeping
 * reads, and its feet slide less than a running figure's do at cruise speed.
 */
export const SNEAK_SPEED = 1.5;
/**
 * Speed (units per second, at KIT_SCALE) at which Sneaking at timeScale 1 keeps the feet on
 * the floor. Its cycle (2.13 s) is twice Walking_A's for a similar stride: half WALK_CLIP_SPEED.
 */
export const SNEAK_CLIP_SPEED = 0.29;

/** True when this figure sneaks while it walks: a finished subagent with a Rogue body. */
export function sneaks(kind: AgentView['kind'], state: AgentState, body: CharacterModel | SkeletonModel): boolean {
  return kind === 'sub' && state === 'done' && (SNEAK_BODIES as readonly string[]).includes(body);
}
