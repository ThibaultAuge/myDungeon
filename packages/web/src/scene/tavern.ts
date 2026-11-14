import type { AgentView, SessionView } from '@agent-office/shared';
import type { SeatMemory } from './layout.ts';

// The tavern's life cycle, as pure functions (no three.js, testable in node).
// At rest, the tavern holds one neutral figure per agent type of the roster. When a session
// calls an agent of that type, the resting figure stands up, takes the session's colour and
// walks to its post; extra agents of the same type come out of the lockers. A finished agent
// turns neutral again and walks back to the tavern; on arrival it leaves the scene, and the
// type rests again as a single figure once none of its agents is on stage.

/** Colour of agents that work for no session: the resting ones and the ones walking back. */
export const NEUTRAL_COLOR = '#A8A496';

/** Id of the resting figure of an agent type. Never collides with an agent id, which has no colon prefix. */
export function restId(agentType: string): string {
  return `rest:${agentType.toLowerCase()}`;
}

/** The figure resting in the tavern for an agent type. */
export function restingAgent(agentType: string): AgentView {
  return { id: restId(agentType), sessionId: '', kind: 'sub', agentType, state: 'done', room: 'taverne', since: 0 };
}

/** Roster types shown resting: those with no subagent on stage, working or walking back. */
export function restingTypes(roster: string[], onStage: AgentView[]): string[] {
  const busy = new Set(onStage.filter((a) => a.kind === 'sub').map((a) => a.agentType.toLowerCase()));
  return roster.filter((t) => !busy.has(t.toLowerCase()));
}

/**
 * Where a figure starts when it appears: `rest` (the resting figure of its type stands up),
 * `lockers` (an extra copy comes out of the lockers) or `seat` (already in place: main
 * agents, and finished subagents found on loading, which are home already).
 */
export type Origin = 'rest' | 'lockers' | 'seat' | 'forest';

/**
 * Origins of the figures appearing in this frame. `wasResting` holds the lower-case types
 * that rested in the previous frame. When several agents of a type appear together, the
 * oldest one takes the resting figure's place and the others come from the lockers.
 * The main agent of a session in `fromForest` (a session that just appeared) walks in from
 * the forest; other main agents are already in place.
 */
export function startOrigins(
  newcomers: AgentView[],
  wasResting: ReadonlySet<string>,
  fromForest: ReadonlySet<string> = new Set(),
): Map<string, Origin> {
  const out = new Map<string, Origin>();
  const claimed = new Set<string>();
  const ordered = [...newcomers].sort((a, b) => a.since - b.since || a.id.localeCompare(b.id));
  for (const a of ordered) {
    if (a.kind === 'main' && fromForest.has(a.sessionId)) {
      out.set(a.id, 'forest');
      continue;
    }
    if (a.kind === 'main' || a.state === 'done') {
      out.set(a.id, 'seat');
      continue;
    }
    const type = a.agentType.toLowerCase();
    if (wasResting.has(type) && !claimed.has(type)) {
      claimed.add(type);
      out.set(a.id, 'rest');
    } else {
      out.set(a.id, 'lockers');
    }
  }
  return out;
}

/** Sessions that appeared and sessions that left between two snapshots of the same route. */
export interface SessionChanges {
  /** Ids of the sessions that appeared. */
  appeared: string[];
  /** The sessions that left, as they last were. */
  departed: SessionView[];
}

/**
 * Compares two snapshots. A temporary terminal session (`cli:<id>`) merged into a desktop
 * session that lists `<id>` in its `cliSessionIds` neither leaves nor makes the desktop
 * session appear: it is the same session under a new id.
 */
export function sessionChanges(prev: readonly SessionView[], next: readonly SessionView[]): SessionChanges {
  const prevIds = new Set(prev.map((s) => s.id));
  const nextIds = new Set(next.map((s) => s.id));
  const absorbedInto = (s: SessionView) =>
    s.id.startsWith('cli:') && next.some((n) => n.id !== s.id && n.cliSessionIds.includes(s.id.slice(4)));
  const absorbs = (s: SessionView) => s.cliSessionIds.some((c) => prevIds.has(`cli:${c}`) && !nextIds.has(`cli:${c}`));
  return {
    appeared: next.filter((s) => !prevIds.has(s.id) && !absorbs(s)).map((s) => s.id),
    departed: prev.filter((s) => !nextIds.has(s.id) && !absorbedInto(s)),
  };
}

/**
 * Gives a resting figure that is about to appear the seat of the agent of its type that
 * just came back, so the figure sits exactly where that agent arrived. Must run before
 * `assignSpots`, which forgets the seats of agents no longer shown.
 */
export function inheritSeats(memory: SeatMemory, resting: string[], returned: AgentView[]): void {
  for (const type of resting) {
    const id = restId(type);
    if (memory.has(id)) continue;
    const from = returned.find((a) => a.agentType.toLowerCase() === type.toLowerCase() && memory.has(a.id));
    if (from) memory.set(id, memory.get(from.id)!);
  }
}
