import { useEffect } from 'react';
import type { AgentView, HookEventSummary, SessionView } from '@agent-office/shared';
import { useOffice } from '../store.ts';
import { MISHAP_SETTLE_MS, mishapFor, mishapTarget, triggerMishap } from './mishap.ts';

function findAgent(sessions: SessionView[], sessionId: string, id: string): AgentView | undefined {
  const s = sessions.find((x) => x.id === sessionId);
  if (!s) return undefined;
  return s.main.id === id ? s.main : s.subagents.find((a) => a.id === id);
}

/**
 * Turns the hook events of the current route into mishaps (a failed command in the engine
 * room, a failed test run). Renders nothing. The console test commands
 * (`agentOffice.boiler`, `agentOffice.flask`) are installed by `installMishapCommands`.
 */
export function MishapWatcher() {
  useEffect(() => {
    // Events already in the list when the scene mounts are history: never replayed.
    const seen = new WeakSet<HookEventSummary>(useOffice.getState().events);
    // Failures wait for the snapshot that follows them: the event is sent at once while
    // snapshots are throttled, so until then the agent may still be shown in its previous
    // room (or not exist yet, for a subagent whose first hook is the failure).
    let pending: HookEventSummary[] = [];
    let settle: ReturnType<typeof setTimeout> | undefined;
    const resolve = () => {
      clearTimeout(settle);
      settle = undefined;
      const { sessions } = useOffice.getState();
      const batch = pending;
      pending = [];
      for (const ev of batch) {
        const id = mishapTarget(ev);
        const agent = findAgent(sessions, ev.sessionId, id);
        // Only the sessions of this dungeon: an event of another environment shows nothing.
        if (!agent) continue;
        const kind = mishapFor(ev, agent.room);
        if (kind) triggerMishap(id, kind);
      }
    };
    const unsubscribe = useOffice.subscribe((state, prev) => {
      // A newer snapshot: the failures queued before it can be decided now.
      if (state.sessions !== prev.sessions && pending.length > 0) resolve();
      if (state.events === prev.events) return;
      // Newest first: stop at the first event already handled. A WeakSet rather than `seq`,
      // which starts over when the server restarts.
      const fresh: HookEventSummary[] = [];
      for (const ev of state.events) {
        if (seen.has(ev)) break;
        seen.add(ev);
        if (ev.event === 'PostToolUseFailure') fresh.push(ev);
      }
      if (fresh.length === 0) return;
      pending.push(...fresh.reverse());
      // No snapshot coming (it may have gone out just before the event): decide anyway.
      settle ??= setTimeout(resolve, MISHAP_SETTLE_MS);
    });
    return () => {
      unsubscribe();
      clearTimeout(settle);
    };
  }, []);
  return null;
}
