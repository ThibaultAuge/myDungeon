import type { AgentView, EnvironmentView, SessionView } from '@agent-office/shared';
import type { Messages } from './i18n/index.ts';

export const STATE_COLORS = { working: '#1D9E75', waiting: '#EF9F27', done: '#888780' } as const;

/**
 * What the status icon shows: `waiting` splits into a plain wait for the next prompt and an
 * urgent wait (permission, question or error) that needs the user.
 */
export type StatusKind = 'working' | 'prompt' | 'urgent' | 'done';

export const STATUS_COLORS: Record<StatusKind, string> = {
  working: STATE_COLORS.working,
  prompt: STATE_COLORS.waiting,
  urgent: '#E24B4A',
  done: STATE_COLORS.done,
};

export function statusKind(a: Pick<AgentView, 'state' | 'waitReason'>): StatusKind {
  if (a.state !== 'waiting') return a.state;
  // Same rule as the scene's request bubble and the announcer: anything but a prompt wait is urgent.
  return a.waitReason === 'prompt' ? 'prompt' : 'urgent';
}

export function stateLabel(a: AgentView, t: Messages): string {
  if (a.state === 'working') return t.state.working;
  if (a.state === 'done') return t.state.done;
  switch (a.waitReason) {
    case 'permission':
      return t.state.permission;
    case 'question':
      return t.state.question;
    case 'error':
      return t.state.error;
    default:
      return t.state.prompt;
  }
}

/** The server sends no title when the session has neither a title nor a folder name. */
export function sessionTitle(s: Pick<SessionView, 'title'>, t: Messages): string {
  return s.title ?? t.session.untitled;
}

/** The virtual environment's name comes from the server in French: it is translated here. */
export function envName(e: EnvironmentView, t: Messages): string {
  return e.virtual ? t.env.none : e.name;
}

export function agentName(a: AgentView, s: SessionView, t: Messages): string {
  return a.kind === 'main' ? sessionTitle(s, t) : a.agentType;
}

export function elapsed(since: number, now: number, t: Messages): string {
  const sec = Math.max(0, Math.round((now - since) / 1000));
  if (sec < 60) return t.time.seconds(sec);
  const min = Math.floor(sec / 60);
  if (min < 60) return t.time.minutes(min);
  const h = Math.floor(min / 60);
  if (h < 48) return t.time.hours(h, String(min % 60).padStart(2, '0'));
  return t.time.days(Math.floor(h / 24));
}

export function ago(at: number, now: number, t: Messages): string {
  const h = Math.floor(Math.max(0, Math.round((now - at) / 1000)) / 3600);
  if (h >= 48) return t.time.daysAgo(Math.floor(h / 24));
  return t.time.ago(elapsed(at, now, t));
}

const PALETTE = ['#534AB7', '#378ADD', '#D4537E', '#BA7517', '#0F6E56', '#993C1D', '#7F77DD', '#185FA5'];

/** Stable color per session, keyed on its main agent id (which survives a session merge), shared by its subagents. */
export function sessionColor(sessionId: string): string {
  let h = 0;
  for (let i = 0; i < sessionId.length; i++) h = (h * 31 + sessionId.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
