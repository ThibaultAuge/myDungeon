import type { SessionView } from '@agent-office/shared';
import { agentName, elapsed, ROOM_NAMES, stateLabel, STATE_COLORS } from '../format.ts';
import { useOffice } from '../store.ts';
import { useNow } from '../useNow.ts';
import { rowId } from './SessionList.tsx';

export function AgentPanel({ sessions }: { sessions: SessionView[] }) {
  const selectedId = useOffice((s) => s.selectedAgentId);
  const select = useOffice((s) => s.select);
  const now = useNow();
  if (!selectedId) return null;
  const session = sessions.find((s) => s.main.id === selectedId || s.subagents.some((a) => a.id === selectedId));
  const agent = session && (session.main.id === selectedId ? session.main : session.subagents.find((a) => a.id === selectedId));
  if (!session || !agent) return null;
  const parent = session.parent;
  const parentInEnv = parent && sessions.find((s) => s.id === parent.sessionId);

  return (
    <section className="agent-panel" aria-labelledby="agent-panel-title">
      <div className="agent-panel__head">
        <h2 id="agent-panel-title" tabIndex={-1}>
          {agentName(agent, session)}
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Fermer le détail"
          onClick={() => {
            const row = rowId(agent.id);
            select(null);
            // The panel unmounts: give focus back to the agent's row instead of losing it to <body>.
            requestAnimationFrame(() => (document.getElementById(row) ?? document.getElementById('live-title'))?.focus());
          }}
        >
          ×
        </button>
      </div>
      <p className="state-line">
        <span className="dot" style={{ background: STATE_COLORS[agent.state] }} aria-hidden="true" />
        {stateLabel(agent)} depuis {elapsed(agent.since, now)} · {ROOM_NAMES[agent.room]}
      </p>
      <dl>
        <dt>Session</dt>
        <dd>{session.title}</dd>
        <dt>Agent</dt>
        <dd>{agent.kind === 'main' ? 'Agent principal' : `Sous-agent ${agent.agentType}`}</dd>
        {agent.description && (
          <>
            <dt>{agent.kind === 'main' ? 'Dernière demande' : 'Tâche'}</dt>
            <dd>{agent.description}</dd>
          </>
        )}
        {agent.tool && (
          <>
            <dt>Outil</dt>
            <dd>
              <code>{agent.tool}</code>
              {agent.toolDetail ? ` ${agent.toolDetail}` : ''}
            </dd>
          </>
        )}
        {!agent.tool && agent.toolDetail && agent.state === 'waiting' && (
          <>
            <dt>Détail</dt>
            <dd>{agent.toolDetail}</dd>
          </>
        )}
        {parent && (
          <>
            <dt>Lancée depuis</dt>
            <dd>
              {parentInEnv ? (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    select(parentInEnv.main.id);
                    requestAnimationFrame(() => document.getElementById('agent-panel-title')?.focus());
                  }}
                >
                  {parentInEnv.title}
                </button>
              ) : (
                (parent.title ?? 'une autre session')
              )}
            </dd>
          </>
        )}
        <dt>Dossier</dt>
        <dd className="path">{session.cwd}</dd>
      </dl>
      {agent.lastMessage && (
        <>
          <h3>Dernier message</h3>
          <p className="last-message">{agent.lastMessage}</p>
        </>
      )}
    </section>
  );
}
