import type { AgentView, SessionView } from '@agent-office/shared';
import type { Spot } from './layout.ts';
import { sessionChanges } from './tavern.ts';

// Which main agents enter and leave the stage, as plain bookkeeping (no React, no three.js,
// testable in node). A session that appears in a later snapshot of the route sends its main
// agent in from the forest; a session that leaves the snapshot sends it out to die. The
// route's first snapshot (page load, environment change) does neither.

/** A main agent whose session left, walking out to its death. */
export interface Leaving {
  agent: AgentView;
  session: SessionView;
  /** Its spot when its session left: it walks out from there. */
  spot: Spot;
}

export class Stage {
  /** Doomed main agents by agent id, in order of departure. */
  readonly leaving = new Map<string, Leaving>();
  /** Sessions that appeared: their main agent walks in from the forest when it shows. */
  readonly fromForest = new Set<string>();
  /** Sessions of the previous snapshot of this route; null until the route's first one. */
  private previous: SessionView[] | null = null;
  /**
   * Bumped when a doomed figure is gone, so the same agent id comes back as a new figure.
   * Never cleared, not even on a route change: forgetting a generation could hand a dead
   * figure's key to a live agent again. A few bytes per deleted session.
   */
  private readonly generations = new Map<string, number>();

  /**
   * Takes in a render's sessions. `lastSpots` holds the spots of the previous render: a
   * departed main agent with no spot was never on stage and just disappears. Idempotent for
   * the same `sessions` array. Returns the ids of doomed agents dropped by a route change.
   */
  update(sessions: SessionView[], snapshotReceived: boolean, lastSpots: ReadonlyMap<string, Spot>): string[] {
    if (!snapshotReceived) {
      // New route: nothing that happened before plays out.
      this.previous = null;
      const dropped = [...this.leaving.keys()];
      this.leaving.clear();
      this.fromForest.clear();
      return dropped;
    }
    const prev = this.previous;
    this.previous = sessions;
    if (!prev || prev === sessions) return [];
    const changes = sessionChanges(prev, sessions);
    for (const id of changes.appeared) this.fromForest.add(id);
    for (const s of changes.departed) {
      const spot = lastSpots.get(s.main.id);
      if (spot && !this.leaving.has(s.main.id)) this.leaving.set(s.main.id, { agent: s.main, session: s, spot });
    }
    return [];
  }

  /** True while the agent's previous figure is still dying: the new one waits. */
  hidden(agentId: string): boolean {
    return this.leaving.has(agentId);
  }

  /**
   * React key of an agent's figure. The same while it walks out (the figure keeps its place),
   * a new one once that figure is gone (a reappeared agent never inherits the dead figure).
   */
  key(agentId: string): string {
    const g = this.generations.get(agentId) ?? 0;
    return g === 0 ? agentId : `${agentId}~${g}`;
  }

  /** The doomed figure has sunk out of sight. */
  gone(agentId: string): void {
    if (!this.leaving.delete(agentId)) return;
    this.generations.set(agentId, (this.generations.get(agentId) ?? 0) + 1);
  }

  /** Main agents now on stage have used up their arrival from the forest. */
  shown(agents: readonly AgentView[]): void {
    for (const a of agents) if (a.kind === 'main') this.fromForest.delete(a.sessionId);
  }
}
