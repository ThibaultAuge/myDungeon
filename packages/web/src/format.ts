import type { AgentView, EnvironmentView, SessionInfo, SessionView } from '@agent-office/shared';
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

/**
 * Display name of a subagent type: each word starts with a capital (`oracle` → `Oracle`,
 * `samuel-morse` → `Samuel-Morse`, `plugin:agent` → `Plugin:Agent`). Ids stay as they are.
 */
export function typeLabel(agentType: string): string {
  return agentType.replace(/(^|[-:])(\p{Ll})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
}

export function agentName(a: AgentView, s: SessionView, t: Messages): string {
  return a.kind === 'main' ? sessionTitle(s, t) : typeLabel(a.agentType);
}

/** The short presentation of an agent type: its known role, or a generic line for a type of its own. */
export function agentRole(agentType: string, t: Messages): string {
  const key = agentType.toLowerCase();
  return Object.hasOwn(t.agentRoles, key) ? t.agentRoles[key as keyof Messages['agentRoles']] : t.restCard.unknownRole;
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

/** Link to a server the session started; only an integer port ever reaches the URL. */
export function serverUrl(port: number): string | undefined {
  return Number.isInteger(port) && port > 0 && port <= 65535 ? `http://localhost:${port}` : undefined;
}

/** `claude-opus-5-5` → `Opus 5.5`, with any suffix kept (`[1m]`); other ids as they are. */
export function modelLabel(model: string): string {
  // A dated id (`claude-haiku-4-5-20251001`) drops its date.
  const m = /^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?(.*)$/.exec(model);
  if (!m) return model;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}${m[4] ? ` ${m[4]}` : ''}`;
}

/** Translated effort or permission mode, falling back to the raw value for one this version does not know. */
export function rawLabel(raw: string, labels: Record<string, string>): string {
  return Object.hasOwn(labels, raw) ? labels[raw] : raw;
}

export function branchLabel(info: SessionInfo, t: Messages): string | undefined {
  if (!info.branch) return undefined;
  return info.sourceBranch && info.sourceBranch !== info.branch ? t.info.branchFrom(info.branch, info.sourceBranch) : info.branch;
}

const PALETTE = ['#534AB7', '#378ADD', '#D4537E', '#BA7517', '#0F6E56', '#993C1D', '#7F77DD', '#185FA5'];

/** Stable color per session, keyed on its main agent id (which survives a session merge), shared by its subagents. */
export function sessionColor(sessionId: string): string {
  let h = 0;
  for (let i = 0; i < sessionId.length; i++) h = (h * 31 + sessionId.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
