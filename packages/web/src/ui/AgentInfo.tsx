import { useEffect, useRef, type CSSProperties } from 'react';
import type { AgentView, SessionView } from '@agent-office/shared';
import {
  agentName,
  ago,
  branchLabel,
  elapsed,
  modelLabel,
  rawLabel,
  serverUrl,
  sessionColor,
  sessionTitle,
  stateLabel,
  statusKind,
} from '../format.ts';
import { useT } from '../i18n/useT.ts';
import { useOffice } from '../store.ts';
import { useNow } from '../useNow.ts';
import { rowId } from './SessionList.tsx';
import { StatusIcon } from './StatusIcon.tsx';

export const INFO_TITLE_ID = 'agent-info-title';

function Servers({ session }: { session: SessionView }) {
  const { t } = useT();
  const links = session.servers.flatMap((s) => {
    const url = serverUrl(s.port);
    return url ? [{ url, process: s.process }] : [];
  });
  if (links.length === 0) return <dd className="muted">{t.info.none}</dd>;
  return (
    <dd>
      <ul className="agent-info__servers">
        {links.map(({ url, process }) => (
          <li key={url}>
            <a href={url} target="_blank" rel="noopener noreferrer" aria-label={t.info.openServer(url)}>
              {url}
            </a>
            {process && <span className="muted"> · {process}</span>}
          </li>
        ))}
      </ul>
    </dd>
  );
}

function SessionDetails({ session, agent, now }: { session: SessionView; agent: AgentView; now: number }) {
  const { t } = useT();
  const { info } = session;
  const branch = branchLabel(info, t);
  const active = session.subagents.filter((a) => a.state !== 'done').length;
  const activity = [
    info.completedTurns !== undefined ? t.info.turns(info.completedTurns) : undefined,
    t.info.activeSubagents(active),
  ].filter(Boolean);

  return (
    <dl>
      {/* The plate already names a main agent by its session. */}
      {agent.kind === 'sub' && (
        <>
          <dt>{t.info.sessionName}</dt>
          <dd>{sessionTitle(session, t)}</dd>
        </>
      )}
      <dt>{t.info.origin}</dt>
      <dd>
        {session.origin === 'desktop' ? t.info.desktop : t.info.cli} · {session.live ? t.info.live : t.info.ended}
      </dd>
      <dt>{t.info.worktree}</dt>
      <dd>{info.worktree ? t.info.worktreeYes(info.worktree.name) : t.info.no}</dd>
      <dt>{t.panel.folder}</dt>
      <dd className="path" title={session.cwd}>
        {session.cwd}
      </dd>
      {branch && (
        <>
          <dt>{t.info.branch}</dt>
          <dd>
            <code>{branch}</code>
          </dd>
        </>
      )}
      {info.model && (
        <>
          <dt>{t.info.model}</dt>
          <dd>{modelLabel(info.model)}</dd>
        </>
      )}
      {info.effort && (
        <>
          <dt>{t.info.effort}</dt>
          <dd>{rawLabel(info.effort, t.info.efforts)}</dd>
        </>
      )}
      {info.permissionMode && (
        <>
          <dt>{t.info.permissions}</dt>
          <dd>{rawLabel(info.permissionMode, t.info.permissionModes)}</dd>
        </>
      )}
      {/* A terminal session's createdAt is when the office first saw it, not when it started. */}
      {session.origin === 'desktop' && session.createdAt > 0 && (
        <>
          <dt>{t.info.started}</dt>
          <dd>
            <time dateTime={new Date(session.createdAt).toISOString()}>{ago(session.createdAt, now, t)}</time>
          </dd>
        </>
      )}
      <dt>{t.info.activity}</dt>
      <dd>{activity.join(' · ')}</dd>
      {info.cliVersion && (
        <>
          <dt>{t.info.version}</dt>
          <dd>{info.cliVersion}</dd>
        </>
      )}
      <dt>{t.info.servers}</dt>
      <Servers session={session} />
    </dl>
  );
}

/**
 * Card docked at the top right of the scene while an agent is selected: the agent's
 * activity and its session's working context (worktree, folder, branch, model, servers).
 * Same parchment look as the conversation box below it.
 */
export function AgentInfo({ sessions }: { sessions: SessionView[] }) {
  const selectedId = useOffice((s) => s.selectedAgentId);
  const select = useOffice((s) => s.select);
  const now = useNow();
  const { t } = useT();
  /** True while the focus is inside the card. Removing a focused node fires no blur, so it stays true then. */
  const hasFocus = useRef(false);
  const session = selectedId ? sessions.find((s) => s.main.id === selectedId || s.subagents.some((a) => a.id === selectedId)) : undefined;
  const agent = session && (session.main.id === selectedId ? session.main : session.subagents.find((a) => a.id === selectedId));
  const shown = !!session && !!agent;

  // The card can also vanish on its own (agent gone from a snapshot, navigation): when it
  // held the focus, give it to the session list instead of leaving it on <body>.
  useEffect(() => {
    if (!shown) return;
    return () => {
      if (!hasFocus.current) return;
      hasFocus.current = false;
      requestAnimationFrame(() => {
        // The close button already moved the focus to the row; only a lost focus is rescued.
        if (document.activeElement === document.body || !document.activeElement) document.getElementById('live-title')?.focus();
      });
    };
  }, [shown]);

  if (!session || !agent) return null;
  const parent = session.parent;
  const parentInEnv = parent && sessions.find((s) => s.id === parent.sessionId);
  const name = agentName(agent, session, t);

  return (
    <section
      className="agent-info"
      onFocus={() => (hasFocus.current = true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hasFocus.current = false;
      }}
      aria-labelledby={INFO_TITLE_ID}
      style={{ '--session-color': sessionColor(session.main.id) } as CSSProperties}
    >
      <div className="agent-info__plate">
        {/* The plate cuts long names: the title shows them in full. */}
        <h2 id={INFO_TITLE_ID} tabIndex={-1} title={name}>
          {name}
        </h2>
      </div>
      <button
        type="button"
        className="agent-info__close"
        aria-label={t.panel.close}
        onClick={() => {
          const row = rowId(agent.id);
          select(null);
          // The card unmounts: give focus back to the agent's row instead of losing it to <body>.
          requestAnimationFrame(() => (document.getElementById(row) ?? document.getElementById('live-title'))?.focus());
        }}
      >
        ×
      </button>
      {/* Focusable: the card scrolls, and keyboard users must be able to scroll it. */}
      <div className="agent-info__body" role="group" aria-label={t.info.label(name)} tabIndex={0}>
        <p className="state-line">
          <StatusIcon kind={statusKind(agent)} />
          {t.panel.stateSince(stateLabel(agent, t), elapsed(agent.since, now, t))} · {t.rooms[agent.room] ?? agent.room}
        </p>
        <h3>{t.info.session}</h3>
        <SessionDetails session={session} agent={agent} now={now} />
        <h3>{t.info.agent}</h3>
        <dl>
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
                      requestAnimationFrame(() => document.getElementById(INFO_TITLE_ID)?.focus());
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
        </dl>
        {agent.lastMessage && (
          <>
            <h3>{t.panel.lastMessage}</h3>
            <p className="last-message">{agent.lastMessage}</p>
          </>
        )}
      </div>
    </section>
  );
}
