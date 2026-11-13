import type { AgentView, SessionView } from '@agent-office/shared';

export const STATE_COLORS = { working: '#1D9E75', waiting: '#EF9F27', done: '#888780' } as const;

export function stateLabel(a: AgentView): string {
  if (a.state === 'working') return 'Travaille';
  if (a.state === 'done') return 'Terminé';
  switch (a.waitReason) {
    case 'permission':
      return 'Attend ta permission';
    case 'question':
      return 'Te pose une question';
    case 'error':
      return 'Bloqué par une erreur';
    default:
      return 'Attend ton prochain message';
  }
}

export function agentName(a: AgentView, s: SessionView): string {
  return a.kind === 'main' ? s.title : a.agentType;
}

export function elapsed(since: number, now: number): string {
  const sec = Math.max(0, Math.round((now - since) / 1000));
  if (sec < 60) return `${sec} s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${String(min % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)} j`;
}

export function ago(at: number, now: number): string {
  return `il y a ${elapsed(at, now)}`;
}

const PALETTE = ['#534AB7', '#378ADD', '#D4537E', '#BA7517', '#0F6E56', '#993C1D', '#7F77DD', '#185FA5'];

/** Stable color per session, keyed on its main agent id (which survives a session merge), shared by its subagents. */
export function sessionColor(sessionId: string): string {
  let h = 0;
  for (let i = 0; i < sessionId.length; i++) h = (h * 31 + sessionId.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
