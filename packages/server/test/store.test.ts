import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@agent-office/shared';
import { OfficeStore } from '../src/store.ts';
import { DONE_SUBAGENT_TTL_MS } from '../src/reducer.ts';
import { CLI_A, ENV_ALPHA, desk, hook, inventory, proc } from './fixtures/builders.ts';

const NO_ENV = 'hors-environnement';

describe('OfficeStore', () => {
  let now: number;
  let store: OfficeStore;

  beforeEach(() => {
    vi.useFakeTimers();
    now = 1000;
    store = new OfficeStore(() => now);
  });

  afterEach(() => {
    store.close();
    vi.useRealTimers();
  });

  function collect(envId: string | null) {
    const msgs: ServerMessage[] = [];
    const unsubscribe = store.subscribe({ envId, send: (m) => msgs.push(m) });
    return { msgs, unsubscribe };
  }

  const snapshots = (msgs: ServerMessage[]) => msgs.filter((m) => m.type === 'snapshot');
  const events = (msgs: ServerMessage[]) => msgs.filter((m) => m.type === 'event');

  /**
   * Verifies that an environment subscriber immediately receives a snapshot at clock time
   */
  it('sends an immediate snapshot on subscribe', () => {
    const { msgs } = collect(ENV_ALPHA.id);
    expect(msgs).toEqual([{ type: 'snapshot', envId: ENV_ALPHA.id, sessions: [], environments: [], roster: [], at: 1000 }]);
  });

  /**
   * Verifies that a debug subscriber (no env) gets no snapshot on subscribe
   */
  it('sends nothing on subscribe without env', () => {
    const { msgs } = collect(null);
    expect(msgs).toEqual([]);
  });

  /**
   * Verifies that a hook is pushed at once as an event, and the snapshot after 100 ms
   */
  it('pushes the event immediately and a batched snapshot after 100 ms', () => {
    const { msgs } = collect(NO_ENV);
    msgs.length = 0;

    const summary = store.ingestHook(hook('UserPromptSubmit', { cwd: 'D:/elsewhere', prompt: 'go' }));
    expect(msgs).toEqual([{ type: 'event', event: summary }]);
    expect(summary).toMatchObject({ at: 1000, event: 'UserPromptSubmit', sessionId: `cli:${CLI_A}`, envId: null });

    vi.advanceTimersByTime(99);
    expect(snapshots(msgs)).toHaveLength(0);
    vi.advanceTimersByTime(1);
    const snaps = snapshots(msgs);
    expect(snaps).toHaveLength(1);
    const snap = snaps[0] as Extract<ServerMessage, { type: 'snapshot' }>;
    expect(snap.sessions.map((s) => s.id)).toEqual([`cli:${CLI_A}`]);
    expect(snap.environments).toEqual([
      { id: NO_ENV, name: 'Hors environnement', folders: [], virtual: true, activeSessions: 1 },
    ]);
  });

  /**
   * Verifies that several hooks within the window produce a single snapshot
   */
  it('batches several hooks into one snapshot', () => {
    const { msgs } = collect(NO_ENV);
    msgs.length = 0;
    store.ingestHook(hook('UserPromptSubmit', { cwd: 'D:/elsewhere', prompt: 'go' }));
    vi.advanceTimersByTime(50);
    store.ingestHook(hook('PreToolUse', { tool_name: 'Read' }));
    store.ingestHook(hook('PostToolUse', { tool_name: 'Read' }));
    vi.advanceTimersByTime(50);
    expect(events(msgs)).toHaveLength(3);
    expect(snapshots(msgs)).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(snapshots(msgs)).toHaveLength(1);
  });

  /**
   * Verifies that a debug subscriber receives events but never snapshots
   */
  it('sends only events to a subscriber without env', () => {
    const { msgs } = collect(null);
    store.ingestHook(hook('Stop'));
    vi.advanceTimersByTime(200);
    expect(msgs.map((m) => m.type)).toEqual(['event']);
  });

  /**
   * Verifies that each subscriber receives the snapshot of its own environment
   */
  it('sends each subscriber the snapshot of its environment', () => {
    const alpha = collect(ENV_ALPHA.id);
    const orphan = collect(NO_ENV);
    alpha.msgs.length = 0;
    orphan.msgs.length = 0;
    store.ingestInventory(inventory({ desktopSessions: [desk()], live: [proc()] }));
    vi.advanceTimersByTime(100);
    const a = snapshots(alpha.msgs)[0] as Extract<ServerMessage, { type: 'snapshot' }>;
    const o = snapshots(orphan.msgs)[0] as Extract<ServerMessage, { type: 'snapshot' }>;
    expect(a.envId).toBe(ENV_ALPHA.id);
    expect(a.sessions).toHaveLength(1);
    expect(o.envId).toBe(NO_ENV);
    expect(o.sessions).toEqual([]);
  });

  /**
   * Verifies that an unsubscribed client receives nothing more
   */
  it('stops sending after unsubscribe', () => {
    const { msgs, unsubscribe } = collect(NO_ENV);
    unsubscribe();
    msgs.length = 0;
    store.ingestHook(hook('Stop'));
    vi.advanceTimersByTime(200);
    expect(msgs).toEqual([]);
  });

  /**
   * Verifies that close cancels a pending snapshot and drops subscribers
   */
  it('close cancels the pending broadcast', () => {
    const { msgs } = collect(NO_ENV);
    msgs.length = 0;
    store.ingestHook(hook('Stop'));
    store.close();
    vi.advanceTimersByTime(200);
    expect(snapshots(msgs)).toEqual([]);
  });

  /**
   * Verifies that recent events keep only the last 200, oldest first
   */
  it('caps recentEvents at 200', () => {
    for (let i = 0; i < 205; i++) {
      now = i;
      store.ingestHook(hook('PostToolUse'));
    }
    const recent = store.recentEvents();
    expect(recent).toHaveLength(200);
    expect(recent[0]?.at).toBe(5);
    expect(recent.at(-1)?.at).toBe(204);
  });

  /**
   * Verifies that recentEvents returns a copy that callers cannot corrupt
   */
  it('returns a copy of recent events', () => {
    store.ingestHook(hook('Stop'));
    store.recentEvents().length = 0;
    expect(store.recentEvents()).toHaveLength(1);
  });

  /**
   * Verifies that tick prunes finished subagents using the store clock
   */
  it('tick prunes expired subagents', () => {
    store.ingestHook(hook('SubagentStart', { agent_id: 'ag-1', agent_type: 'Explore' }));
    store.ingestHook(hook('SubagentStop', { agent_id: 'ag-1' }));
    const session = store.state.sessions.get(`cli:${CLI_A}`)!;
    expect(session.subagents).toHaveLength(1);
    now += DONE_SUBAGENT_TTL_MS;
    store.tick();
    expect(store.state.sessions.get(`cli:${CLI_A}`)?.subagents).toEqual([]);
  });

  /**
   * Verifies that snapshot reflects the inventory and is stamped with the clock
   */
  it('snapshot reflects ingested inventory', () => {
    now = 5000;
    store.ingestInventory(inventory({ desktopSessions: [desk()], live: [proc()] }));
    const snap = store.snapshot(ENV_ALPHA.id) as Extract<ServerMessage, { type: 'snapshot' }>;
    expect(snap.at).toBe(5000);
    expect(snap.sessions[0]).toMatchObject({ live: true, main: { state: 'working' } });
    expect(snap.environments.find((e) => e.id === ENV_ALPHA.id)?.activeSessions).toBe(1);
  });

  /**
   * Verifies that the snapshot roster merges global, per-env and seen types for its environment
   */
  it('snapshot carries the roster of its environment', () => {
    store.ingestInventory(
      inventory({ definedAgents: { global: ['dexter'], byEnv: new Map([[ENV_ALPHA.id, ['neo']], ['env-beta', ['oracle']]]) } }),
    );
    store.ingestHook(hook('SubagentStart', { agent_id: 'ag-1', agent_type: 'Explore' }));
    const roster = (envId: string) => (store.snapshot(envId) as Extract<ServerMessage, { type: 'snapshot' }>).roster;
    expect(roster(ENV_ALPHA.id)).toEqual(['dexter', 'Explore', 'neo']);
    expect(roster('env-beta')).toEqual(['dexter', 'oracle']);
    expect(roster(NO_ENV)).toEqual(['dexter']);
  });

  /**
   * Verifies that the batched broadcast after a new subagent type includes the updated roster
   */
  it('broadcasts the updated roster after a new subagent type', () => {
    const { msgs } = collect(ENV_ALPHA.id);
    store.ingestInventory(inventory());
    vi.advanceTimersByTime(100);
    msgs.length = 0;
    store.ingestHook(hook('SubagentStart', { agent_id: 'ag-1', agent_type: 'hermione' }));
    vi.advanceTimersByTime(100);
    const snaps = snapshots(msgs) as Extract<ServerMessage, { type: 'snapshot' }>[];
    expect(snaps).toHaveLength(1);
    expect(snaps[0].roster).toEqual(['hermione']);
  });
});
