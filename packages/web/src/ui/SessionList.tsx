import type { AgentView, SessionView } from '@agent-office/shared';
import { agentName, elapsed, sessionColor, stateLabel, STATE_COLORS } from '../format.ts';
import { ROOM_NAMES } from '../scene/layout.ts';
import { useOffice } from '../store.ts';
import { useNow } from '../useNow.ts';

/** DOM id of an agent's row, used to give focus back after the detail panel closes. */
export function rowId(agentId: string): string {
  return `agent-row-${agentId.replace(/[^\w-]/g, '_')}`;
}

function AgentButton({ agent, session, now }: { agent: AgentView; session: SessionView; now: number }) {
  const selected = useOffice((s) => s.selectedAgentId === agent.id);
  const select = useOffice((s) => s.select);
  return (
    <button
      type="button"
      id={rowId(agent.id)}
      className={`agent-row${agent.kind === 'sub' ? ' agent-row--sub' : ''}`}
      aria-pressed={selected}
      title={agent.description ? `${agentName(agent, session)} : ${agent.description}` : agentName(agent, session)}
      onClick={() => select(selected ? null : agent.id)}
    >
      <span className="dot" style={{ background: STATE_COLORS[agent.state] }} aria-hidden="true" />
      <span className="agent-row__text">
        <span className="agent-row__name">{agentName(agent, session)}</span>
        <span className="muted">
          {stateLabel(agent)}
          {agent.tool ? ` · ${agent.tool}` : ''}
          {` · ${ROOM_NAMES[agent.room] ?? agent.room}`}
          {/* The ticking timer stays out of the accessible name, which must not change every second. */}
          <span aria-hidden="true"> · {elapsed(agent.since, now)}</span>
        </span>
      </span>
    </button>
  );
}

/** Keyboard and screen-reader equivalent of the 3D scene: every visible agent, grouped by session. */
export function SessionList({ sessions }: { sessions: SessionView[] }) {
  const now = useNow();
  const live = sessions.filter((s) => s.live);
  return (
    <section aria-labelledby="live-title">
      <h2 id="live-title" tabIndex={-1}>
        Sessions en cours
      </h2>
      {live.length === 0 && <p className="muted">Aucune session ouverte dans cet environnement.</p>}
      <ul className="session-list" role="list">
        {live.map((s) => (
          <li key={s.id} className="session-card" style={{ borderLeftColor: sessionColor(s.main.id) }}>
            <AgentButton agent={s.main} session={s} now={now} />
            {s.subagents.length > 0 && (
              <ul role="list" aria-label={`Sous-agents de ${s.title}`}>
                {s.subagents.map((a) => (
                  <li key={a.id}>
                    <AgentButton agent={a} session={s} now={now} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
