import path from 'node:path';
import { z } from 'zod';
import type {
  AgentView,
  EnvironmentView,
  HookEventSummary,
  RoomId,
  SessionView,
  WaitReason,
} from '@agent-office/shared';
import { NO_ENV_ID } from '@agent-office/shared';
import { matchEnvironment, type Environment, type Inventory, type LiveProcess } from './inventory.ts';

// State machine of the office. No I/O here: every function takes the state and `now`,
// so the whole behaviour is testable with fixtures.

/** After a hook, the inventory's busy/idle status is ignored for this long (hooks are more precise). */
export const HOOK_AUTHORITY_MS = 30_000;
/** Finished subagents leave the scene after this delay. */
export const DONE_SUBAGENT_TTL_MS = 10 * 60_000;
/** Finished terminal sessions (no desktop record to keep them in history) are forgotten after this delay. */
export const DONE_CLI_SESSION_TTL_MS = 60 * 60_000;
/** Finished sessions listed in an environment's history. */
export const HISTORY_LIMIT = 30;
const DETAIL_MAX = 200;

export interface OfficeState {
  environments: Environment[];
  sessions: Map<string, SessionView>;
  /** Claude Code session id (the one hooks carry) → office session id. */
  cliIndex: Map<string, string>;
  lastHookAt: Map<string, number>;
  /** Last hook of each subagent, to retire the ones whose SubagentStop was missed. */
  agentHookAt: Map<string, number>;
  /** Agent tool calls of a session not yet matched to a SubagentStart. */
  pendingSpawns: Map<string, { agentType: string; description?: string }[]>;
}

/** A subagent silent for this long is considered finished (its SubagentStop was missed). */
export const SUBAGENT_SILENCE_MS = 15 * 60_000;
const MAX_PENDING_SPAWNS = 20;

export function createState(): OfficeState {
  return {
    environments: [],
    sessions: new Map(),
    cliIndex: new Map(),
    lastHookAt: new Map(),
    agentHookAt: new Map(),
    pendingSpawns: new Map(),
  };
}

export const hookEventSchema = z
  .object({
    hook_event_name: z.string(),
    session_id: z.string().min(1),
    cwd: z.string().optional(),
    agent_id: z.string().optional(),
    agent_type: z.string().optional(),
    tool_name: z.string().optional(),
    tool_input: z.unknown().optional(),
    prompt: z.string().optional(),
    last_assistant_message: z.string().optional(),
    notification_type: z.string().optional(),
    message: z.string().optional(),
    error: z.unknown().optional(),
    source: z.string().optional(),
  })
  .passthrough();

export type HookEvent = z.infer<typeof hookEventSchema>;

const TOOL_ROOMS: Record<string, RoomId> = {
  Read: 'biblio',
  Grep: 'biblio',
  Glob: 'biblio',
  LS: 'biblio',
  WebFetch: 'biblio',
  WebSearch: 'biblio',
  Edit: 'atelier',
  MultiEdit: 'atelier',
  Write: 'atelier',
  NotebookEdit: 'atelier',
  Bash: 'serveur',
  PowerShell: 'serveur',
  BashOutput: 'serveur',
  Monitor: 'serveur',
};

export function toolRoom(tool: string | undefined): RoomId | undefined {
  return tool ? TOOL_ROOMS[tool] : undefined;
}

export function truncate(s: string | undefined, max = DETAIL_MAX): string | undefined {
  if (s === undefined) return undefined;
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}

const DETAIL_KEYS = ['file_path', 'notebook_path', 'pattern', 'command', 'url', 'query', 'description', 'path'];

/** The one argument worth showing for a tool call, truncated. */
export function toolDetail(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const rec = input as Record<string, unknown>;
  for (const k of DETAIL_KEYS) {
    if (typeof rec[k] === 'string' && rec[k]) return truncate(rec[k] as string);
  }
  return undefined;
}

function newAgent(id: string, sessionId: string, kind: 'main' | 'sub', agentType: string, now: number): AgentView {
  return { id, sessionId, kind, agentType, state: 'working', room: 'accueil', since: now };
}

/** Applies a patch and restarts the elapsed-time clock when the activity changed. */
function patchAgent(a: AgentView, patch: Partial<AgentView>, now: number): void {
  const changed =
    (patch.state !== undefined && patch.state !== a.state) ||
    ('tool' in patch && patch.tool !== a.tool) ||
    (patch.waitReason !== undefined && patch.waitReason !== a.waitReason);
  Object.assign(a, patch);
  if (patch.state && patch.state !== 'waiting') a.waitReason = undefined;
  if (changed) a.since = now;
}

function setWaiting(a: AgentView, reason: WaitReason, now: number, extra: Partial<AgentView> = {}): void {
  patchAgent(a, { state: 'waiting', waitReason: reason, room: 'accueil', ...extra }, now);
}

function setDone(a: AgentView, now: number): void {
  if (a.state === 'done') return;
  patchAgent(a, { state: 'done', room: 'accueil', tool: undefined, toolDetail: undefined }, now);
  a.tool = undefined;
  a.toolDetail = undefined;
}

function markSessionDone(s: SessionView, now: number): void {
  s.live = false;
  setDone(s.main, now);
  for (const sub of s.subagents) setDone(sub, now);
}

function createSession(
  id: string,
  origin: 'desktop' | 'cli',
  fields: { title: string | null; cwd: string; envId: string | null; now: number },
): SessionView {
  return {
    id,
    origin,
    cliSessionIds: [],
    envId: fields.envId,
    title: fields.title,
    cwd: fields.cwd,
    live: false,
    archived: false,
    createdAt: fields.now,
    lastActivityAt: fields.now,
    main: { ...newAgent(`${id}#main`, id, 'main', 'Session principale', fields.now), state: 'done' },
    subagents: [],
  };
}

/**
 * Derives the main agent from the process busy/idle flag, used only when hooks are silent.
 * Never overrides a wait the hooks reported (permission, question, error), never moves a
 * working agent out of its room, and ignores an unknown status.
 */
function mainFromLiveStatus(s: SessionView, p: LiveProcess, now: number): void {
  if (p.status === 'unknown') return;
  if (s.main.state === 'waiting' && s.main.waitReason !== 'prompt') return;
  if (p.status === 'busy') patchAgent(s.main, { state: 'working' }, now);
  else setWaiting(s.main, 'prompt', now);
}

/** Forgets a session and every index entry pointing to it. */
function removeSession(state: OfficeState, s: SessionView): void {
  state.sessions.delete(s.id);
  state.lastHookAt.delete(s.id);
  state.pendingSpawns.delete(s.id);
  for (const cid of s.cliSessionIds) if (state.cliIndex.get(cid) === s.id) state.cliIndex.delete(cid);
  for (const a of s.subagents) state.agentHookAt.delete(a.id);
}

/**
 * Merges a temporary `cli:` session (created by a hook before the inventory saw the desktop
 * record) into `target`. The most recent main agent wins and keeps its id, so the figure,
 * its colour and the selection survive; subagents are merged by id; `live` never goes down.
 */
function absorb(state: OfficeState, target: SessionView, cliId: string): void {
  const tmpId = `cli:${cliId}`;
  const tmp = state.sessions.get(tmpId);
  if (!tmp || tmp === target) return;
  const tmpHook = state.lastHookAt.get(tmpId) ?? 0;
  const targetHook = state.lastHookAt.get(target.id) ?? 0;
  if (tmpHook >= targetHook) {
    target.main = { ...tmp.main, sessionId: target.id };
    if (tmpHook > 0) state.lastHookAt.set(target.id, tmpHook);
  }
  const known = new Set(target.subagents.map((a) => a.id));
  for (const a of tmp.subagents) if (!known.has(a.id)) target.subagents.push({ ...a, sessionId: target.id });
  target.live = target.live || tmp.live;
  target.lastActivityAt = Math.max(target.lastActivityAt, tmp.lastActivityAt);
  const spawns = state.pendingSpawns.get(tmpId);
  if (spawns) state.pendingSpawns.set(target.id, [...(state.pendingSpawns.get(target.id) ?? []), ...spawns]);
  state.sessions.delete(tmpId);
  state.lastHookAt.delete(tmpId);
  state.pendingSpawns.delete(tmpId);
}

/** Merges a fresh read of the local files into the state. */
export function applyInventory(state: OfficeState, inv: Inventory, now: number): void {
  // An unreadable presets file (mid-write) keeps the previous environments.
  if (inv.presetsOk !== false || state.environments.length === 0) state.environments = inv.environments;
  const environments = state.environments;
  const envIds = new Set(environments.map((e) => e.id));
  const present = inv.presentIds ?? new Set(inv.desktopSessions.map((d) => d.localId));
  const complete = inv.complete ?? true;
  const liveByCli = new Map(inv.live.map((p) => [p.cliSessionId, p]));
  const liveByHost = new Map(inv.live.filter((p) => p.hostSessionId).map((p) => [p.hostSessionId!, p]));
  const seen = new Set<string>();

  for (const ds of inv.desktopSessions) {
    seen.add(ds.localId);
    const envId = ds.envId && envIds.has(ds.envId) ? ds.envId : matchEnvironment(ds.matchFolders, environments);
    let s = state.sessions.get(ds.localId);
    if (!s) {
      s = createSession(ds.localId, 'desktop', { title: ds.title, cwd: ds.cwd, envId, now });
      state.sessions.set(s.id, s);
    }
    const hostLive = liveByHost.get(ds.localId);
    const cliIds = [...ds.cliSessionIds, ...(hostLive ? [hostLive.cliSessionId] : [])];
    for (const cid of cliIds) {
      absorb(state, s, cid);
      state.cliIndex.set(cid, s.id);
    }
    Object.assign(s, {
      cliSessionIds: [...new Set(cliIds)],
      envId,
      title: ds.title,
      cwd: ds.cwd,
      archived: ds.archived,
      createdAt: ds.createdAt || s.createdAt,
      lastActivityAt: Math.max(ds.lastActivityAt, s.lastActivityAt),
      parent: ds.parent,
    });
    reconcileLive(state, s, hostLive ?? cliIds.map((c) => liveByCli.get(c)).find(Boolean), now);
  }

  for (const p of inv.live) {
    if (p.hostSessionId && seen.has(p.hostSessionId)) continue;
    const known = state.cliIndex.get(p.cliSessionId);
    if (known && seen.has(known)) continue;
    // A stale index entry towards a removed desktop session never gives a cli session a `local_` id.
    const id = known && state.sessions.has(known) ? known : `cli:${p.cliSessionId}`;
    let s = state.sessions.get(id);
    if (!s) {
      s = createSession(id, 'cli', {
        title: p.name || path.basename(p.cwd) || null,
        cwd: p.cwd,
        envId: matchEnvironment([p.cwd], environments),
        now,
      });
      s.cliSessionIds = [p.cliSessionId];
      state.sessions.set(id, s);
      state.cliIndex.set(p.cliSessionId, id);
    }
    seen.add(id);
    reconcileLive(state, s, p, now);
  }

  for (const s of state.sessions.values()) {
    if (s.origin === 'cli') {
      // Presets may have been added or edited since the session was created.
      s.envId = s.cwd ? matchEnvironment([s.cwd], environments) : null;
    }
    if (seen.has(s.id)) continue;
    if (s.origin === 'desktop') {
      // Deleted only on positive evidence: every folder listed and the file absent.
      // A file the app is writing (unparseable for a moment) keeps its live state.
      if (complete && !present.has(s.id)) removeSession(state, s);
    } else if (s.live && (state.lastHookAt.get(s.id) ?? 0) < now - HOOK_AUTHORITY_MS) {
      markSessionDone(s, now);
    }
  }
}

function reconcileLive(state: OfficeState, s: SessionView, p: LiveProcess | undefined, now: number): void {
  const hookFresh = (state.lastHookAt.get(s.id) ?? 0) >= now - HOOK_AUTHORITY_MS;
  if (!p) {
    if (s.live && !hookFresh) markSessionDone(s, now);
    return;
  }
  if (!s.live) {
    s.live = true;
    mainFromLiveStatus(s, p, now);
  } else if (!hookFresh) {
    mainFromLiveStatus(s, p, now);
  }
}

function resolveSession(state: OfficeState, ev: HookEvent, now: number): SessionView {
  const known = state.cliIndex.get(ev.session_id);
  const s = known ? state.sessions.get(known) : undefined;
  if (s) return s;
  const id = `cli:${ev.session_id}`;
  const cwd = ev.cwd ?? '';
  const created = createSession(id, 'cli', {
    title: path.basename(cwd) || null,
    cwd,
    envId: cwd ? matchEnvironment([cwd], state.environments) : null,
    now,
  });
  created.cliSessionIds = [ev.session_id];
  state.sessions.set(id, created);
  state.cliIndex.set(ev.session_id, id);
  return created;
}

const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest']);

/**
 * The subagent an event belongs to. `undefined`: the event is the main agent's.
 * `'ignore'`: an internal agent (no type) that has no figure.
 */
function findOrCreateSub(state: OfficeState, s: SessionView, ev: HookEvent, now: number): AgentView | 'ignore' | undefined {
  if (!ev.agent_id) return undefined;
  let sub = s.subagents.find((a) => a.id === ev.agent_id);
  if (!sub && TOOL_EVENTS.has(ev.hook_event_name)) {
    if (!ev.agent_type) return 'ignore';
    // SubagentStart was missed (server started mid-run): create the agent from its first tool call.
    sub = newAgent(ev.agent_id, s.id, 'sub', ev.agent_type, now);
    sub.description = takeSpawn(state, s.id, ev.agent_type)?.description;
    s.subagents.push(sub);
  }
  if (sub) state.agentHookAt.set(sub.id, now);
  return sub;
}

function takeSpawn(state: OfficeState, sessionId: string, agentType: string) {
  const list = state.pendingSpawns.get(sessionId) ?? [];
  const idx = list.findIndex((p) => p.agentType === agentType);
  return idx >= 0 ? list.splice(idx, 1)[0] : undefined;
}

/** Applies one hook event. Returns the session it was attached to. */
export function applyHook(state: OfficeState, ev: HookEvent, now: number): SessionView {
  const s = resolveSession(state, ev, now);
  state.lastHookAt.set(s.id, now);
  s.lastActivityAt = now;
  const name = ev.hook_event_name;
  if (name !== 'SessionEnd') s.live = true;

  const sub = findOrCreateSub(state, s, ev, now);
  if (sub === 'ignore') return s;
  const target = sub ?? s.main;
  const tool = ev.tool_name;

  switch (name) {
    case 'SessionStart':
      if (s.main.state !== 'working') setWaiting(s.main, 'prompt', now);
      break;
    case 'UserPromptSubmit':
      patchAgent(s.main, { state: 'working', tool: undefined, toolDetail: truncate(ev.prompt), description: truncate(ev.prompt) }, now);
      s.main.tool = undefined;
      break;
    case 'PreToolUse': {
      if (tool === 'AskUserQuestion') {
        setWaiting(target, 'question', now, { tool, toolDetail: questionText(ev.tool_input) });
        break;
      }
      if (target === s.main && (tool === 'Agent' || tool === 'Task')) {
        const input = (ev.tool_input ?? {}) as Record<string, unknown>;
        const list = state.pendingSpawns.get(s.id) ?? [];
        list.push({
          agentType: typeof input.subagent_type === 'string' ? input.subagent_type : 'general-purpose',
          description: truncate(typeof input.description === 'string' ? input.description : undefined),
        });
        state.pendingSpawns.set(s.id, list.slice(-MAX_PENDING_SPAWNS));
      }
      patchAgent(
        target,
        { state: 'working', tool, toolDetail: toolDetail(ev.tool_input), room: toolRoom(tool) ?? target.room },
        now,
      );
      break;
    }
    case 'PostToolUse':
    case 'PostToolUseFailure':
      if (target.state !== 'done') patchAgent(target, { state: 'working' }, now);
      break;
    case 'PermissionRequest':
      setWaiting(target, 'permission', now, { tool, toolDetail: toolDetail(ev.tool_input) });
      break;
    case 'Notification':
      if (ev.notification_type === 'permission_prompt') {
        // A subagent's request already set that subagent waiting through PermissionRequest:
        // the delayed notification must not paint the main agent red as well.
        const subWaits = s.subagents.some((a) => a.state === 'waiting' && a.waitReason === 'permission');
        if (sub) setWaiting(sub, 'permission', now, { toolDetail: truncate(ev.message) });
        else if (!subWaits) setWaiting(s.main, 'permission', now, { toolDetail: truncate(ev.message) });
      } else if (ev.notification_type === 'idle_prompt' && s.main.state !== 'working') setWaiting(s.main, 'prompt', now);
      break;
    case 'SubagentStart': {
      if (!ev.agent_id || !ev.agent_type) break; // internal agents (prompt suggestions…) have no type
      if (s.subagents.some((a) => a.id === ev.agent_id)) break;
      const created = newAgent(ev.agent_id, s.id, 'sub', ev.agent_type, now);
      created.description = takeSpawn(state, s.id, ev.agent_type)?.description;
      s.subagents.push(created);
      state.agentHookAt.set(created.id, now);
      break;
    }
    case 'SubagentStop': {
      const stopped = ev.agent_id ? s.subagents.find((a) => a.id === ev.agent_id) : undefined;
      if (!stopped) break;
      setDone(stopped, now);
      stopped.lastMessage = truncate(ev.last_assistant_message, 400);
      break;
    }
    case 'Stop':
      setWaiting(s.main, 'prompt', now, { tool: undefined, toolDetail: undefined });
      s.main.lastMessage = truncate(ev.last_assistant_message, 400);
      state.pendingSpawns.delete(s.id);
      break;
    case 'StopFailure':
      setWaiting(s.main, 'error', now, { tool: undefined, toolDetail: typeof ev.error === 'string' ? truncate(ev.error) : undefined });
      state.pendingSpawns.delete(s.id);
      break;
    case 'SessionEnd':
      markSessionDone(s, now);
      state.pendingSpawns.delete(s.id);
      break;
    default:
      break;
  }
  return s;
}

function questionText(input: unknown): string | undefined {
  const qs = (input as { questions?: { question?: unknown }[] } | undefined)?.questions;
  const q = Array.isArray(qs) ? qs[0]?.question : undefined;
  return typeof q === 'string' ? truncate(q) : undefined;
}

/** Removes finished subagents and old terminal sessions. */
export function prune(state: OfficeState, now: number): void {
  for (const s of state.sessions.values()) {
    for (const a of s.subagents) {
      const last = state.agentHookAt.get(a.id) ?? a.since;
      // A subagent waiting on the user is silent by design: never retire it.
      if (a.state === 'working' && now - last > SUBAGENT_SILENCE_MS) setDone(a, now);
    }
    s.subagents = s.subagents.filter((a) => {
      const keep = a.state !== 'done' || now - a.since < DONE_SUBAGENT_TTL_MS;
      if (!keep) state.agentHookAt.delete(a.id);
      return keep;
    });
    if (s.origin === 'cli' && !s.live && now - s.lastActivityAt > DONE_CLI_SESSION_TTL_MS) removeSession(state, s);
  }
}

export function envKey(s: SessionView): string {
  return s.envId ?? NO_ENV_ID;
}

export function environmentsView(state: OfficeState): EnvironmentView[] {
  const active = new Map<string, number>();
  let orphans = 0;
  for (const s of state.sessions.values()) {
    if (!s.envId) orphans++;
    if (s.live) active.set(envKey(s), (active.get(envKey(s)) ?? 0) + 1);
  }
  const list: EnvironmentView[] = state.environments.map((e) => ({
    id: e.id,
    name: e.name,
    folders: e.folders,
    activeSessions: active.get(e.id) ?? 0,
  }));
  if (orphans > 0) {
    list.push({ id: NO_ENV_ID, name: 'Hors environnement', folders: [], virtual: true, activeSessions: active.get(NO_ENV_ID) ?? 0 });
  }
  return list;
}

/** Live sessions plus the most recent finished, non-archived ones. */
export function sessionsView(state: OfficeState, envId: string): SessionView[] {
  const all = [...state.sessions.values()].filter((s) => envKey(s) === envId);
  const live = all.filter((s) => s.live);
  const history = all
    .filter((s) => !s.live && !s.archived)
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    .slice(0, HISTORY_LIMIT);
  return [...live.sort((a, b) => a.createdAt - b.createdAt), ...history];
}

export function summarize(ev: HookEvent, s: SessionView, now: number, seq = 0): HookEventSummary {
  return {
    seq,
    at: now,
    event: ev.hook_event_name,
    sessionId: s.id,
    envId: s.envId,
    agentId: ev.agent_id,
    agentType: ev.agent_type,
    tool: ev.tool_name,
    detail: toolDetail(ev.tool_input) ?? truncate(ev.prompt ?? ev.message, 120),
  };
}
