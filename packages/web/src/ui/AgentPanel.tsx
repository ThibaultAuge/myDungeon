import type { SessionView } from '@agent-office/shared';
import { agentName, elapsed, sessionTitle, stateLabel, statusKind } from '../format.ts';
import { StatusIcon } from './StatusIcon.tsx';
import { useT } from '../i18n/useT.ts';
import { useOffice } from '../store.ts';
import { useNow } from '../useNow.ts';
import { rowId } from './SessionList.tsx';

export function AgentPanel({ sessions }: { sessions: SessionView[] }) {
  const selectedId = useOffice((s) => s.selectedAgentId);
  const select = useOffice((s) => s.select);
  const now = useNow();
  const { t } = useT();
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
          {agentName(agent, session, t)}
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label={t.panel.close}
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
        <StatusIcon kind={statusKind(agent)} />
        {t.panel.stateSince(stateLabel(agent, t), elapsed(agent.since, now, t))} · {t.rooms[agent.room] ?? agent.room}
      </p>
      <dl>
        <dt>{t.panel.session}</dt>
        <dd>{sessionTitle(session, t)}</dd>
        <dt>{t.panel.agent}</dt>
        <dd>{agent.kind === 'main' ? t.panel.mainAgent : t.panel.subagent(agent.agentType)}</dd>
        {agent.description && (
          <>
            <dt>{agent.kind === 'main' ? t.panel.lastRequest : t.panel.task}</dt>
            <dd>{agent.description}</dd>
          </>
        )}
        {agent.tool && (
          <>
            <dt>{t.panel.tool}</dt>
            <dd>
              <code>{agent.tool}</code>
              {agent.toolDetail ? ` ${agent.toolDetail}` : ''}
            </dd>
          </>
        )}
        {!agent.tool && agent.state === 'waiting' && (agent.toolDetail || agent.waitReason === 'error') && (
          <>
            <dt>{t.panel.detail}</dt>
            {/* An error without a message from the API gets a generic, translated one. */}
            <dd>{agent.toolDetail || t.panel.apiError}</dd>
          </>
        )}
        {parent && (
          <>
            <dt>{t.panel.launchedFrom}</dt>
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
                  {sessionTitle(parentInEnv, t)}
                </button>
              ) : (
                (parent.title || t.panel.otherSession)
              )}
            </dd>
          </>
        )}
        <dt>{t.panel.folder}</dt>
        <dd className="path">{session.cwd}</dd>
      </dl>
      {agent.lastMessage && (
        <>
          <h3>{t.panel.lastMessage}</h3>
          <p className="last-message">{agent.lastMessage}</p>
        </>
      )}
    </section>
  );
}
