import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type RefObject } from 'react';
import type { AgentView, DialogueEntry, SessionView } from '@agent-office/shared';
import { agentName, sessionColor, stateLabel } from '../format.ts';
import { useT } from '../i18n/useT.ts';
import { useOffice } from '../store.ts';
import { rowId } from './SessionList.tsx';
import { useTranscript } from './useTranscript.ts';

/** Distance to the bottom under which the view follows new messages. */
const STICK_PX = 24;
/** Distance to the top that loads the previous page. */
const OLDER_PX = 40;

/**
 * @param userName speaker of the `user` lines: the human for a main agent; for a subagent,
 * the agent that delegated to it.
 */
function Entry({ entry, name, userName, timeFmt }: { entry: DialogueEntry; name: string; userName: string; timeFmt: Intl.DateTimeFormat }) {
  const { t } = useT();
  const time = entry.at !== undefined ? <time dateTime={new Date(entry.at).toISOString()}>{timeFmt.format(entry.at)}</time> : null;
  if (entry.role === 'tool') {
    return (
      <li className="dialogue__entry dialogue__entry--tool">
        <span className="dialogue__speaker">{t.dialog.tool}</span> <code>{entry.tool}</code>
        {entry.detail ? <span className="dialogue__detail"> {entry.detail}</span> : null} {time}
      </li>
    );
  }
  return (
    <li className={`dialogue__entry dialogue__entry--${entry.role}`}>
      <p className="dialogue__meta">
        <span className="dialogue__speaker">{entry.role === 'user' ? userName : name}</span> {time}
      </p>
      <p className="dialogue__text">
        {entry.text}
        {entry.truncated && <span className="dialogue__cut"> … ({t.dialog.truncated})</span>}
      </p>
    </li>
  );
}

function Conversation({
  agent,
  session,
  boxRef,
  onClose,
}: {
  agent: AgentView;
  session: SessionView;
  boxRef: RefObject<HTMLElement | null>;
  onClose(): void;
}) {
  const { t, lang } = useT();
  const loginFailed = useOffice((s) => s.loginFailed);
  const { entries, older, status, loadingOlder, loadOlder } = useTranscript(session.id, agent.id);
  const name = agentName(agent, session, t);
  const log = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevFirst = useRef<{ key: string | undefined; height: number }>({ key: undefined, height: 0 });
  const timeFmt = useMemo(() => new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }), [lang]);
  const userName = agent.kind === 'main' ? t.dialog.you : t.panel.mainAgent;
  const olderButton = useRef<HTMLButtonElement>(null);
  const olderHadFocus = useRef(false);
  olderHadFocus.current = !!olderButton.current && document.activeElement === olderButton.current;

  // The "load earlier" button disappears at the start of the file: keep the keyboard in the log.
  useEffect(() => {
    if (older === null && olderHadFocus.current) log.current?.focus();
  }, [older]);

  // Follow new messages when already at the bottom; keep the view still when older ones are prepended.
  useLayoutEffect(() => {
    const el = log.current;
    if (!el) return;
    const first = entries[0]?.key;
    const prev = prevFirst.current;
    if (prev.key !== undefined && first !== prev.key && !stick.current) el.scrollTop += el.scrollHeight - prev.height;
    else if (stick.current) el.scrollTop = el.scrollHeight;
    prevFirst.current = { key: first, height: el.scrollHeight };
  }, [entries]);

  const onScroll = () => {
    const el = log.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    prevFirst.current.height = el.scrollHeight;
    if (el.scrollTop < OLDER_PX && older !== null) void loadOlder();
  };

  let notice: string | null = null;
  if (status === 'signin') notice = loginFailed ? t.dialog.loginFailed : t.dialog.signIn;
  else if (status === 'loading') notice = t.dialog.loading;
  else if (status === 'empty' || (status === 'ready' && entries.length === 0 && older === null)) notice = t.dialog.empty;
  else if (status === 'error') notice = t.dialog.error;
  // Shown even before any entry: the newest part of a transcript may hold nothing to display.
  const showOlder = status !== 'signin' && status !== 'loading' && (entries.length > 0 || older !== null);

  return (
    <section
      ref={boxRef}
      className="agent-dialog"
      role="dialog"
      aria-modal="false"
      aria-label={t.dialog.label(name)}
      style={{ '--session-color': sessionColor(session.main.id) } as CSSProperties}
    >
      {/* The log is silent: only the notices that ask for something are announced. */}
      <p className="sr-only" role="status">
        {status === 'signin' || status === 'error' ? notice : ''}
      </p>
      <div className="agent-dialog__plate">
        <h2>{name}</h2>
        <span className="agent-dialog__state">{stateLabel(agent, t)}</span>
      </div>
      <button type="button" className="agent-dialog__close" aria-label={t.dialog.close} onClick={onClose}>
        ×
      </button>
      {/* Focusable: keyboard users scroll the history with the arrow keys. */}
      <div
        ref={log}
        className="agent-dialog__log"
        role="log"
        // Not live: the history is re-read every 2 s and would be read out endlessly.
        aria-live="off"
        aria-label={t.dialog.label(name)}
        aria-busy={status === 'loading' || loadingOlder}
        tabIndex={0}
        onScroll={onScroll}
      >
        {showOlder && (
          <p className="agent-dialog__older">
            {older !== null ? (
              <button
                ref={olderButton}
                type="button"
                className="link-button"
                aria-disabled={loadingOlder}
                onClick={() => {
                  if (!loadingOlder) void loadOlder();
                }}
              >
                {t.dialog.older}
              </button>
            ) : (
              <span className="muted">{t.dialog.start}</span>
            )}
          </p>
        )}
        {status !== 'signin' && entries.length > 0 && (
          <ol className="dialogue" role="list">
            {entries.map((e) => (
              <Entry key={e.key} entry={e} name={name} userName={userName} timeFmt={timeFmt} />
            ))}
          </ol>
        )}
        {notice && (entries.length === 0 || status === 'signin' || status === 'error') && <p className="agent-dialog__notice">{notice}</p>}
      </div>
    </section>
  );
}

/** RPG-style conversation box of the selected agent, docked at the bottom of the scene. */
export function AgentDialog({ sessions }: { sessions: SessionView[] }) {
  const selectedId = useOffice((s) => s.selectedAgentId);
  const open = useOffice((s) => s.dialogOpen);
  const closeDialog = useOffice((s) => s.closeDialog);
  const { t } = useT();
  const session = selectedId ? sessions.find((s) => s.main.id === selectedId || s.subagents.some((a) => a.id === selectedId)) : undefined;
  const agent = session && (session.main.id === selectedId ? session.main : session.subagents.find((a) => a.id === selectedId));
  const visible = open && !!session && !!agent;
  const box = useRef<HTMLElement>(null);

  const close = useRef(() => {});
  close.current = () => {
    const hadFocus = !!box.current && box.current.contains(document.activeElement);
    closeDialog();
    // Focus was in the box, which unmounts: give it back to the agent's row.
    if (hadFocus && selectedId) requestAnimationFrame(() => (document.getElementById(rowId(selectedId)) ?? document.getElementById('live-title'))?.focus());
  };

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible]);

  return (
    <>
      {/* Non-modal box, focus stays where it was: say that it opened. */}
      <p className="sr-only" role="status">
        {visible ? t.dialog.opened(agentName(agent, session, t)) : ''}
      </p>
      {/* Keyed by agent: another agent gets a fresh conversation, never a frame of the previous one. */}
      {visible && <Conversation key={agent.id} agent={agent} session={session} boxRef={box} onClose={() => close.current()} />}
    </>
  );
}
