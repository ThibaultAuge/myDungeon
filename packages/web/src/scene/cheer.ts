// A subagent that finishes its task cheers once where it stands before walking back to the
// tavern. Purely visual. Pure module, no three.js, testable in node.
import type { AgentState, AgentView } from '@agent-office/shared';

/** Length of Cheering, in seconds at timeScale 1 (a test checks it against the file). */
export const CHEER_CLIP_TIME = 5 / 3;

/**
 * True when a figure should cheer: a subagent whose state just turned `done` from another
 * state. The main agent never cheers (user decision): it turns `done` when its session
 * closes, which is no achievement. A figure mounted already done (`prev` null) does not.
 */
export function startsCheer(kind: AgentView['kind'], prev: AgentState | null, next: AgentState): boolean {
  return kind === 'sub' && prev !== null && prev !== 'done' && next === 'done';
}
