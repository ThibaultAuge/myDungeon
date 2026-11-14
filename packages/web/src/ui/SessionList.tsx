import type { AgentView, SessionView } from '@agent-office/shared';
import { agentName, elapsed, sessionColor, sessionTitle, stateLabel, statusKind } from '../format.ts';
import { StatusIcon } from './StatusIcon.tsx';
import { useT } from '../i18n/useT.ts';
import { useOffice } from '../store.ts';
import { useNow } from '../useNow.ts';

/** DOM id of an agent's row, used to give focus back after the detail panel closes. */
export function rowId(agentId: string): string {
  return `agent-row-${agentId.replace(/[^\w-]/g, '_')}`;
}

function AgentButton({ agent, session, now }: { agent: AgentView; session: SessionView; now: number }) {
  const selected = useOffice((s) => s.selectedAgentId === agent.id);
  const dialogOpen = useOffice((s) => s.dialogOpen);
  const select = useOffice((s) => s.select);
  const { t } = useT();
  const name = agentName(agent, session, t);
  return (
    <button
      type="button"
      id={rowId(agent.id)}
      className={`agent-row${agent.kind === 'sub' ? ' agent-row--sub' : ''}`}
      aria-pressed={selected && dialogOpen}
      title={agent.description ? t.labelled(name, agent.description) : name}
      // Selected with its conversation closed: a press reopens it instead of deselecting.
      onClick={() => select(selected && dialogOpen ? null : agent.id)}
    >
      <StatusIcon kind={statusKind(agent)} />
      <span className="agent-row__text">
        <span className="agent-row__name">{name}</span>
        <span className="muted">
          {stateLabel(agent, t)}
          {agent.tool ? ` · ${agent.tool}` : ''}
          {` · ${t.rooms[agent.room] ?? agent.room}`}
          {/* The ticking timer stays out of the accessible name, which must not change every second. */}
          <span aria-hidden="true"> · {elapsed(agent.since, now, t)}</span>
        </span>
      </span>
    </button>
  );
}

/** Keyboard and screen-reader equivalent of the 3D scene: every visible agent, grouped by session. */
export function SessionList({ sessions }: { sessions: SessionView[] }) {
  const now = useNow();
  const { t } = useT();
  const live = sessions.filter((s) => s.live);
  return (
    <section aria-labelledby="live-title">
      <h2 id="live-title" tabIndex={-1}>
        {t.sessionList.title}
      </h2>
      {live.length === 0 && <p className="muted">{t.sessionList.empty}</p>}
      <ul className="session-list" role="list">
        {live.map((s) => (
          <li key={s.id} className="session-card" style={{ borderLeftColor: sessionColor(s.main.id) }}>
            <AgentButton agent={s.main} session={s} now={now} />
            {s.subagents.length > 0 && (
              <ul role="list" aria-label={t.sessionList.subagentsOf(sessionTitle(s, t))}>
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
