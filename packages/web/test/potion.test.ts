import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentView, HookEventSummary, SessionView } from '@agent-office/shared';
import { EVENTS } from '../../../scripts/hooks-lib.mjs';
import { CLIPS, USE_ITEM_CLIP_TIME } from '../src/scene/characters.ts';
import { slapAgent } from '../src/scene/slap.ts';
import {
  DRINK_S,
  POTION_EFFECT_MS,
  POTION_EVENT,
  POTION_S,
  STAGGER_S,
  SWAY_PITCH,
  SWAY_ROLL,
  drinkPotion,
  hasPotionTarget,
  installPotionCommand,
  onPotion,
  potionPhase,
  potionTarget,
  staggerSway,
  type GagCommands,
} from '../src/scene/potion.ts';

// The bus is module state: every test uses its own agent ids and every subscription made
// through `sub` is undone after the test, so no listener leaks from one test to the next.
let seq = 0;
const freshId = (label = 'agent') => `${label}-${++seq}`;
const subscriptions: (() => void)[] = [];
function sub(id: string, listener: () => void): () => void {
  const off = onPotion(id, listener);
  subscriptions.push(off);
  return off;
}

afterEach(() => {
  for (const off of subscriptions.splice(0)) off();
});

// ---------------------------------------------------------------- fixtures

function agent(id: string, sessionId: string, kind: 'main' | 'sub'): AgentView {
  return { id, sessionId, kind, agentType: kind === 'main' ? 'main' : 'Explore', state: 'working', room: 'hall' as AgentView['room'], since: 0 };
}

function session(id: string, mainId: string, subIds: string[] = []): SessionView {
  return {
    id,
    origin: 'cli',
    cliSessionIds: [],
    envId: null,
    title: null,
    cwd: '',
    live: true,
    everActive: true,
    archived: false,
    createdAt: 0,
    lastActivityAt: 0,
    info: {},
    servers: [],
    main: agent(mainId, id, 'main'),
    subagents: subIds.map((s) => agent(s, id, 'sub')),
  };
}

function event(over: Partial<HookEventSummary>): HookEventSummary {
  return { seq: 1, at: 0, event: POTION_EVENT, sessionId: 'cli:s1', envId: null, ...over };
}

const SESSIONS: SessionView[] = [
  // An absorbed session: its main agent's id is not rebuilt from the session id.
  session('cli:s1', 'cli:older#main', ['sub-a', 'sub-b']),
  session('local_s2', 'local_s2#main', ['sub-c']),
];

// ---------------------------------------------------------------- constants

describe('potion constants', () => {
  /** Verifies that the potion listens to the PreCompact hook */
  it('reacts to PreCompact', () => {
    expect(POTION_EVENT).toBe('PreCompact');
  });

  /** Verifies that the hook relay installs the event the potion listens to */
  it('is relayed by the hook installer', () => {
    expect(EVENTS).toContain(POTION_EVENT);
  });

  /** Verifies that the gulp lasts exactly one Use_Item clip, a clip the figures load */
  it('times the gulp on the Use_Item clip', () => {
    expect(DRINK_S).toBe(USE_ITEM_CLIP_TIME);
    expect(CLIPS).toContain('Use_Item');
  });

  /** Verifies that the phases are positive, finite and add up to the whole effect */
  it('has positive, finite phases adding up to POTION_S', () => {
    for (const v of [DRINK_S, STAGGER_S, POTION_S]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
    expect(POTION_S).toBe(DRINK_S + STAGGER_S);
  });

  /** Verifies that the HTML effect lasts as long as the 3D effect, in milliseconds */
  it('gives the HTML effect the same duration as the 3D effect', () => {
    expect(POTION_EFFECT_MS).toBe(Math.round(POTION_S * 1000));
    expect(Number.isInteger(POTION_EFFECT_MS)).toBe(true);
  });

  /** Verifies that the sway amplitudes are positive and small enough to stay a lean */
  it('has small, positive sway amplitudes', () => {
    for (const v of [SWAY_ROLL, SWAY_PITCH]) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(Math.PI / 4);
    }
  });
});

// ---------------------------------------------------------------- potionPhase

describe('potionPhase', () => {
  /** Verifies the phase at and around each boundary of the effect */
  it.each([
    [0, 'drinking'],
    [-0, 'drinking'],
    [DRINK_S / 2, 'drinking'],
    [DRINK_S - 1e-9, 'drinking'],
    [DRINK_S, 'staggering'],
    [DRINK_S + 1e-9, 'staggering'],
    [POTION_S - 1e-9, 'staggering'],
    [POTION_S, null],
    [POTION_S + 1, null],
  ] as const)('gives elapsed %d the phase %s', (elapsed, expected) => {
    expect(potionPhase(elapsed)).toBe(expected);
  });

  /** Verifies that a negative elapsed time (the "not drinking" marker -1) is outside the effect */
  it.each([-1e-9, -1, -1000])('is null for the negative elapsed %d', (elapsed) => {
    expect(potionPhase(elapsed)).toBeNull();
  });

  /** Verifies that non-finite elapsed times are outside the effect */
  it.each([NaN, Infinity, -Infinity])('is null for the non-finite elapsed %d', (elapsed) => {
    expect(potionPhase(elapsed)).toBeNull();
  });
});

// ---------------------------------------------------------------- staggerSway

describe('staggerSway', () => {
  const ZERO = { roll: 0, pitch: 0 };
  /** Samples of the whole stagger, every 10 ms. */
  const STAGGER = Array.from({ length: Math.floor(STAGGER_S * 100) }, (_, i) => DRINK_S + i / 100);

  /** Verifies that the figure stands straight outside the stagger phase */
  it.each([-1, 0, DRINK_S / 2, DRINK_S - 1e-9, POTION_S, POTION_S + 1, NaN, Infinity, -Infinity])(
    'is zero at elapsed %d',
    (elapsed) => {
      expect(staggerSway(elapsed)).toEqual(ZERO);
    },
  );

  /** Verifies that the stagger starts from standing, with no jump when the gulp ends */
  it('starts at zero when the stagger begins', () => {
    expect(staggerSway(DRINK_S)).toEqual(ZERO);
    const just = staggerSway(DRINK_S + 1e-6);
    expect(Math.abs(just.roll)).toBeLessThan(1e-4);
    expect(Math.abs(just.pitch)).toBeLessThan(1e-4);
  });

  /** Verifies that the sway dies down to about zero right before the effect ends */
  it('decays to about zero near the end of the effect', () => {
    const end = staggerSway(POTION_S - 1e-6);
    expect(Math.abs(end.roll)).toBeLessThan(1e-9);
    expect(Math.abs(end.pitch)).toBeLessThan(1e-9);
  });

  /** Verifies that the lean never exceeds SWAY_ROLL sideways nor SWAY_PITCH forward */
  it('stays within the sway amplitudes', () => {
    for (const t of STAGGER) {
      const s = staggerSway(t);
      expect(Number.isFinite(s.roll), `${t}`).toBe(true);
      expect(Number.isFinite(s.pitch), `${t}`).toBe(true);
      expect(Math.abs(s.roll), `${t}`).toBeLessThanOrEqual(SWAY_ROLL);
      expect(Math.abs(s.pitch), `${t}`).toBeLessThanOrEqual(SWAY_PITCH);
    }
  });

  /** Verifies that the figure visibly sways both ways on both axes during the stagger */
  it('actually sways, to both sides, on both axes', () => {
    const rolls = STAGGER.map((t) => staggerSway(t).roll);
    const pitches = STAGGER.map((t) => staggerSway(t).pitch);
    expect(Math.max(...rolls)).toBeGreaterThan(SWAY_ROLL / 2);
    expect(Math.min(...rolls)).toBeLessThan(0);
    expect(Math.max(...pitches)).toBeGreaterThan(SWAY_PITCH / 2);
    expect(Math.min(...pitches)).toBeLessThan(0);
  });

  /** Verifies that the sway is wider in the first second of the stagger than in its last */
  it('dies down over the stagger', () => {
    const peak = (from: number, to: number) =>
      Math.max(...STAGGER.filter((t) => t >= from && t < to).map((t) => Math.abs(staggerSway(t).roll)));
    expect(peak(POTION_S - 1, POTION_S)).toBeLessThan(peak(DRINK_S, DRINK_S + 1));
  });

  /** Verifies that the sway has no jump between consecutive frames (smooth lean) */
  it('changes smoothly from one frame to the next', () => {
    const frame = 1 / 60;
    for (let t = DRINK_S; t + frame < POTION_S; t += frame) {
      const a = staggerSway(t);
      const b = staggerSway(t + frame);
      expect(Math.abs(b.roll - a.roll), `${t}`).toBeLessThan(0.05);
      expect(Math.abs(b.pitch - a.pitch), `${t}`).toBeLessThan(0.05);
    }
  });

  /** Verifies that the sway depends only on the elapsed time (no hidden state) */
  it('returns the same lean for the same elapsed time', () => {
    for (const t of [DRINK_S + 0.3, DRINK_S + 1.7]) expect(staggerSway(t)).toEqual(staggerSway(t));
  });
});

// ---------------------------------------------------------------- potionTarget

describe('potionTarget', () => {
  /** Verifies that hooks other than PreCompact make nobody drink */
  it.each(['PreToolUse', 'Stop', 'SessionStart', 'SubagentStop', 'precompact', 'PostCompact', ''])(
    'is null for the event %j',
    (name) => {
      expect(potionTarget(event({ event: name }), SESSIONS)).toBeNull();
      expect(potionTarget(event({ event: name, agentId: 'sub-a' }), SESSIONS)).toBeNull();
    },
  );

  /** Verifies that a compaction of a session not shown in this view makes nobody drink */
  it('is null for an unknown session', () => {
    expect(potionTarget(event({ sessionId: 'cli:other' }), SESSIONS)).toBeNull();
    expect(potionTarget(event({ sessionId: 'cli:other', agentId: 'sub-a' }), SESSIONS)).toBeNull();
    expect(potionTarget(event({}), [])).toBeNull();
  });

  /** Verifies that the main agent's compaction targets session.main.id, not a rebuilt id */
  it('targets the session main id, even when it differs from `${sessionId}#main`', () => {
    expect(potionTarget(event({ sessionId: 'cli:s1' }), SESSIONS)).toBe('cli:older#main');
    expect(potionTarget(event({ sessionId: 'local_s2' }), SESSIONS)).toBe('local_s2#main');
  });

  /** Verifies that a known subagent's compaction targets that subagent */
  it('targets a known subagent of the session', () => {
    expect(potionTarget(event({ sessionId: 'cli:s1', agentId: 'sub-b' }), SESSIONS)).toBe('sub-b');
    expect(potionTarget(event({ sessionId: 'local_s2', agentId: 'sub-c' }), SESSIONS)).toBe('sub-c');
  });

  /** Verifies that a subagent without a figure, or one of another session, makes nobody drink */
  it('is null for a subagent unknown in that session', () => {
    expect(potionTarget(event({ sessionId: 'cli:s1', agentId: 'ghost' }), SESSIONS)).toBeNull();
    expect(potionTarget(event({ sessionId: 'cli:s1', agentId: 'sub-c' }), SESSIONS), 'other session').toBeNull();
  });

  /** Verifies that a subagent event never falls back to the main agent */
  it('never targets the main agent for a subagent event', () => {
    expect(potionTarget(event({ sessionId: 'cli:s1', agentId: 'cli:s1#main' }), SESSIONS)).toBeNull();
  });

  /** Verifies that the sessions passed in are left untouched */
  it('does not modify the sessions', () => {
    const before = JSON.stringify(SESSIONS);
    potionTarget(event({ agentId: 'sub-a' }), SESSIONS);
    potionTarget(event({}), SESSIONS);
    expect(JSON.stringify(SESSIONS)).toBe(before);
  });
});

// ---------------------------------------------------------------- bus

describe('drinkPotion and onPotion', () => {
  /** Verifies that a subscribed listener is called once per potion and the call returns true */
  it('calls the listener once per potion and reports that a figure reacted', () => {
    const id = freshId();
    const fn = vi.fn();
    sub(id, fn);
    expect(drinkPotion(id)).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith();
    drinkPotion(id);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  /** Verifies that a potion for an agent nobody listens to returns false without throwing */
  it('returns false when the agent has no listener', () => {
    const fn = vi.fn();
    sub(freshId(), fn);
    expect(drinkPotion(freshId('nobody'))).toBe(false);
    expect(drinkPotion('')).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  /** Verifies that every listener of the agent is called in subscription order, others untouched */
  it('calls every listener of the agent in order, and only them', () => {
    const id = freshId();
    const other = vi.fn();
    const order: string[] = [];
    sub(id, () => order.push('a'));
    sub(id, () => order.push('b'));
    sub(freshId(), other);
    drinkPotion(id);
    expect(order).toEqual(['a', 'b']);
    expect(other).not.toHaveBeenCalled();
  });

  /** Verifies that ids are matched exactly, not by prefix or case */
  it('does not call the listener for a near-miss id', () => {
    const id = freshId('agent-x');
    const fn = vi.fn();
    sub(id, fn);
    for (const v of [id.toUpperCase(), `${id} `, id.slice(0, -1), `${id}y`]) expect(drinkPotion(v), v).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  /** Verifies that Object.prototype member names are plain ids, not prototype lookups */
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])('treats %s as an ordinary id', (id) => {
    expect(drinkPotion(id)).toBe(false);
    const fn = vi.fn();
    sub(id, fn);
    expect(drinkPotion(id)).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  /** Verifies that the potion bus is separate from the slap bus */
  it('is not triggered by a slap', () => {
    const id = freshId();
    const fn = vi.fn();
    sub(id, fn);
    slapAgent(id);
    expect(fn).not.toHaveBeenCalled();
  });

  /** Verifies that an unsubscribed listener is no longer called and the call returns false */
  it('stops calling a listener after unsubscribe', () => {
    const id = freshId();
    const fn = vi.fn();
    const off = sub(id, fn);
    off();
    expect(drinkPotion(id)).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  /** Verifies that a repeated or stale unsubscribe neither throws nor removes a newer listener */
  it('ignores a repeated unsubscribe, even after re-subscription', () => {
    const id = freshId();
    const off = sub(id, vi.fn());
    off();
    expect(() => off()).not.toThrow();
    const fresh = vi.fn();
    sub(id, fresh);
    off();
    expect(drinkPotion(id)).toBe(true);
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  /** Verifies that a listener unsubscribing itself during dispatch does not skip the next one */
  it('still calls the next listener when one unsubscribes itself during the potion', () => {
    const id = freshId();
    const order: string[] = [];
    const self: { off?: () => void } = {};
    self.off = sub(id, () => {
      order.push('a');
      self.off?.();
    });
    sub(id, () => order.push('b'));
    sub(id, () => order.push('c'));
    drinkPotion(id);
    expect(order).toEqual(['a', 'b', 'c']);
    drinkPotion(id);
    expect(order).toEqual(['a', 'b', 'c', 'b', 'c']);
  });

  /** Verifies that the only listener unsubscribing itself mid-dispatch still counts as reacted */
  it('returns true when the only listener unsubscribes itself, then false next time', () => {
    const id = freshId();
    const self: { off?: () => void } = {};
    const fn = vi.fn(() => self.off?.());
    self.off = sub(id, fn);
    expect(drinkPotion(id)).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(drinkPotion(id)).toBe(false);
  });

  /** Verifies that a listener added during a potion is only called from the next potion */
  it('calls a listener added during a potion only from the next one on', () => {
    const id = freshId();
    const added = vi.fn();
    let done = false;
    sub(id, () => {
      if (done) return;
      done = true;
      sub(id, added);
    });
    drinkPotion(id);
    expect(added).not.toHaveBeenCalled();
    drinkPotion(id);
    expect(added).toHaveBeenCalledTimes(1);
  });
});

describe('hasPotionTarget', () => {
  /** Verifies that the target exists from the first listener until the last one leaves */
  it('is true while at least one listener exists', () => {
    const id = freshId();
    expect(hasPotionTarget(id)).toBe(false);
    const offA = sub(id, vi.fn());
    const offB = sub(id, vi.fn());
    expect(hasPotionTarget(id)).toBe(true);
    offA();
    expect(hasPotionTarget(id)).toBe(true);
    offB();
    expect(hasPotionTarget(id)).toBe(false);
  });

  /** Verifies that a potion does not change whether the agent has a target */
  it('is not changed by a potion', () => {
    const id = freshId();
    sub(id, vi.fn());
    drinkPotion(id);
    expect(hasPotionTarget(id)).toBe(true);
    const nobody = freshId('nobody');
    drinkPotion(nobody);
    expect(hasPotionTarget(nobody)).toBe(false);
  });
});

// ---------------------------------------------------------------- installPotionCommand

describe('installPotionCommand', () => {
  type Host = { agentOffice?: GagCommands | null; [key: string]: unknown };

  /** Verifies that the command is installed on a host without namespace, creating it */
  it('creates the agentOffice namespace with a potion function', () => {
    const host: Host = {};
    installPotionCommand(() => null, host);
    expect(typeof host.agentOffice?.potion).toBe('function');
  });

  /** Verifies that a null namespace is replaced by a fresh one holding the command */
  it('creates the namespace when it is null', () => {
    const host: Host = { agentOffice: null };
    installPotionCommand(() => null, host);
    expect(typeof host.agentOffice?.potion).toBe('function');
  });

  /** Verifies that without an id the command makes the selected agent drink */
  it('makes the selected agent drink when no id is given', () => {
    const selected = freshId();
    const fn = vi.fn();
    sub(selected, fn);
    const host: Host = {};
    installPotionCommand(() => selected, host);
    expect(host.agentOffice!.potion!()).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  /** Verifies that the selection is read when the command runs, not when it is installed */
  it('follows the selection made after installation', () => {
    let selected: string | null = null;
    const host: Host = {};
    installPotionCommand(() => selected, host);
    const id = freshId();
    const fn = vi.fn();
    sub(id, fn);
    expect(host.agentOffice!.potion!()).toBe(false);
    selected = id;
    expect(host.agentOffice!.potion!()).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  /** Verifies that an explicit id wins over the selection */
  it('makes the given agent drink rather than the selected one', () => {
    const selected = freshId('selected');
    const target = freshId('target');
    const onSelected = vi.fn();
    const onTarget = vi.fn();
    sub(selected, onSelected);
    sub(target, onTarget);
    const host: Host = {};
    installPotionCommand(() => selected, host);
    expect(host.agentOffice!.potion!(target)).toBe(true);
    expect(onTarget).toHaveBeenCalledTimes(1);
    expect(onSelected).not.toHaveBeenCalled();
  });

  /** Verifies that with no selection and no id the command returns false without throwing */
  it('returns false when nothing is selected', () => {
    const host: Host = {};
    installPotionCommand(() => null, host);
    expect(host.agentOffice!.potion!()).toBe(false);
  });

  /** Verifies that the command returns false for an agent with no figure in the scene */
  it('returns false for an agent without figure', () => {
    const host: Host = {};
    installPotionCommand(() => freshId('nobody'), host);
    expect(host.agentOffice!.potion!()).toBe(false);
    expect(host.agentOffice!.potion!(freshId('nobody'))).toBe(false);
  });

  /** Verifies that an existing namespace and its other commands are kept */
  it('keeps the existing namespace and its other keys', () => {
    const slap = vi.fn(() => true);
    const ns: GagCommands = { slap, version: 3 };
    const host: Host = { agentOffice: ns, other: 'kept' };
    installPotionCommand(() => null, host);
    expect(host.agentOffice).toBe(ns);
    expect(ns.slap).toBe(slap);
    expect(ns.version).toBe(3);
    expect(typeof ns.potion).toBe('function');
    expect(host.other).toBe('kept');
  });

  /** Verifies that installing twice leaves one working command */
  it('can be installed again and still works', () => {
    const id = freshId();
    const fn = vi.fn();
    sub(id, fn);
    const host: Host = {};
    installPotionCommand(() => null, host);
    installPotionCommand(() => id, host);
    expect(host.agentOffice!.potion!()).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
