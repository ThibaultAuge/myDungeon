import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLIPS } from '../src/scene/characters.ts';
import {
  HIT_CLIPS,
  SLAP_EFFECT_MS,
  hasSlapTarget,
  hitClipFor,
  onSlap,
  slapAgent,
  watchSlapTargets,
} from '../src/scene/slap.ts';

// The bus is module state: every test uses its own agent ids and every subscription made
// through `sub` (or watcher registered through `watch`) is undone after the test, so no
// listener or watcher leaks from one test to the next.
let seq = 0;
const freshId = (label = 'agent') => `${label}-${++seq}`;
const subscriptions: (() => void)[] = [];
function sub(id: string, listener: () => void): () => void {
  const off = onSlap(id, listener);
  subscriptions.push(off);
  return off;
}
const watches: (() => void)[] = [];
function watch(watcher: () => void): () => void {
  const unwatch = watchSlapTargets(watcher);
  watches.push(unwatch);
  return unwatch;
}

afterEach(() => {
  // Watchers first, so the cleanup of the subscriptions below notifies no test watcher.
  for (const unwatch of watches.splice(0)) unwatch();
  for (const off of subscriptions.splice(0)) off();
});

// ---------------------------------------------------------------- constants

describe('slap constants', () => {
  /** Verifies that the effect lasts a positive, finite, human-visible duration */
  it('keeps the effect on screen for a positive, finite time', () => {
    expect(Number.isFinite(SLAP_EFFECT_MS)).toBe(true);
    expect(SLAP_EFFECT_MS).toBeGreaterThan(0);
  });

  /** Verifies that the two hit clips are distinct, so repeated slaps look different */
  it('lists two distinct hit clips, Hit_A then Hit_B', () => {
    expect([...HIT_CLIPS]).toEqual(['Hit_A', 'Hit_B']);
    expect(new Set(HIT_CLIPS).size).toBe(HIT_CLIPS.length);
  });

  /** Verifies that every hit clip is one the figures load (listed in CLIPS) */
  it('only uses clips listed in CLIPS', () => {
    expect(HIT_CLIPS.filter((c) => !(CLIPS as readonly string[]).includes(c))).toEqual([]);
  });
});

// ---------------------------------------------------------------- hitClipFor

describe('hitClipFor', () => {
  /** Verifies that consecutive slaps alternate between the two hit clips */
  it('alternates between the two clips on consecutive counts', () => {
    const seen = Array.from({ length: 8 }, (_, i) => hitClipFor(i + 1));
    for (let i = 1; i < seen.length; i++) expect(seen[i], `slap ${i + 1}`).not.toBe(seen[i - 1]);
    expect(new Set(seen)).toEqual(new Set(HIT_CLIPS));
  });

  /** Verifies the exact clip for the first slaps (count from 1) and for 0 */
  it.each([
    [0, 'Hit_A'],
    [1, 'Hit_B'],
    [2, 'Hit_A'],
    [3, 'Hit_B'],
    [4, 'Hit_A'],
  ] as const)('gives count %d the clip %s', (count, expected) => {
    expect(hitClipFor(count)).toBe(expected);
  });

  /** Verifies that a negative count still yields a hit clip, mirroring its absolute value */
  it.each([-1, -2, -3, -10, -11])('returns a hit clip for the negative count %d', (count) => {
    expect(HIT_CLIPS).toContain(hitClipFor(count));
    expect(hitClipFor(count)).toBe(hitClipFor(-count));
  });

  /** Verifies that a non-integer count is truncated toward zero, never yielding undefined */
  it.each([
    [0.5, 'Hit_A'],
    [1.9, 'Hit_B'],
    [2.1, 'Hit_A'],
    [-1.5, 'Hit_B'],
    [-0.4, 'Hit_A'],
  ] as const)('truncates the non-integer count %d to give %s', (count, expected) => {
    expect(hitClipFor(count)).toBe(expected);
  });

  /** Verifies that -0 behaves like 0 */
  it('treats -0 as 0', () => {
    expect(hitClipFor(-0)).toBe('Hit_A');
  });

  /** Verifies that very large counts (long sessions) still return a hit clip */
  it.each([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1, -Number.MAX_SAFE_INTEGER, 1e300])(
    'returns a hit clip for the large count %d',
    (count) => {
      expect(HIT_CLIPS).toContain(hitClipFor(count));
    },
  );

  /** Verifies that NaN and infinite counts fall back to the first clip, never undefined */
  it.each([NaN, Infinity, -Infinity])('falls back to Hit_A for the non-finite count %d', (count) => {
    expect(hitClipFor(count)).toBe('Hit_A');
    expect(hitClipFor(count)).toBe(HIT_CLIPS[0]);
  });

  /** Verifies that the result depends only on the count (no hidden state) */
  it('returns the same clip for the same count on every call', () => {
    for (const n of [1, 2, 3, 17]) expect(hitClipFor(n)).toBe(hitClipFor(n));
  });
});

// ---------------------------------------------------------------- bus

describe('slapAgent and onSlap', () => {
  /** Verifies that a subscribed listener is called once per slap of its agent */
  it('calls the listener once per slap', () => {
    const id = freshId();
    const fn = vi.fn();
    sub(id, fn);
    slapAgent(id);
    expect(fn).toHaveBeenCalledTimes(1);
    slapAgent(id);
    slapAgent(id);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  /** Verifies that the listener receives no argument (the slap carries no data) */
  it('calls the listener without arguments', () => {
    const id = freshId();
    const fn = vi.fn();
    sub(id, fn);
    slapAgent(id);
    expect(fn).toHaveBeenCalledWith();
  });

  /** Verifies that every listener of the same agent is called, in subscription order */
  it('calls every listener of the agent, in subscription order', () => {
    const id = freshId();
    const order: string[] = [];
    sub(id, () => order.push('a'));
    sub(id, () => order.push('b'));
    sub(id, () => order.push('c'));
    slapAgent(id);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  /** Verifies that slapping one agent never triggers another agent's listeners */
  it('does not call listeners of other agents', () => {
    const target = freshId();
    const other = freshId();
    const onTarget = vi.fn();
    const onOther = vi.fn();
    sub(target, onTarget);
    sub(other, onOther);
    slapAgent(target);
    expect(onTarget).toHaveBeenCalledTimes(1);
    expect(onOther).not.toHaveBeenCalled();
  });

  /** Verifies that agent ids are matched exactly, not by prefix or case */
  it.each([
    ['upper case', (id: string) => id.toUpperCase()],
    ['trailing space', (id: string) => `${id} `],
    ['prefix', (id: string) => id.slice(0, -1)],
    ['longer id', (id: string) => `${id}y`],
    ['empty id', () => ''],
  ] as const)('does not call the listener for a near-miss id (%s)', (_label, variant) => {
    const id = freshId('agent-x');
    const fn = vi.fn();
    sub(id, fn);
    slapAgent(variant(id));
    expect(fn).not.toHaveBeenCalled();
  });

  /** Verifies that one listener subscribed to two agents fires for each of them */
  it('lets one listener follow several agents independently', () => {
    const a = freshId();
    const b = freshId();
    const fn = vi.fn();
    const offA = sub(a, fn);
    sub(b, fn);
    slapAgent(a);
    slapAgent(b);
    expect(fn).toHaveBeenCalledTimes(2);
    offA();
    slapAgent(a);
    slapAgent(b);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  /** Verifies that slapping an agent nobody listens to does nothing and does not throw */
  it('does nothing when the agent has no listener', () => {
    const fn = vi.fn();
    sub(freshId(), fn);
    expect(() => slapAgent(freshId('nobody'))).not.toThrow();
    expect(() => slapAgent('')).not.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });

  /** Verifies that Object.prototype member names are plain ids, not prototype lookups */
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])('treats %s as an ordinary id', (id) => {
    expect(() => slapAgent(id)).not.toThrow();
    const fn = vi.fn();
    sub(id, fn);
    slapAgent(id);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // ---- unsubscribe

  /** Verifies that an unsubscribed listener is no longer called */
  it('stops calling a listener after unsubscribe', () => {
    const id = freshId();
    const fn = vi.fn();
    const off = sub(id, fn);
    slapAgent(id);
    off();
    slapAgent(id);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  /** Verifies that unsubscribing one listener leaves the agent's other listeners in place */
  it('keeps the other listeners of the agent after one unsubscribes', () => {
    const id = freshId();
    const kept = vi.fn();
    const gone = vi.fn();
    sub(id, kept);
    const off = sub(id, gone);
    off();
    slapAgent(id);
    expect(kept).toHaveBeenCalledTimes(1);
    expect(gone).not.toHaveBeenCalled();
  });

  /** Verifies that calling unsubscribe twice is harmless and removes nothing else */
  it('ignores a second unsubscribe call', () => {
    const id = freshId();
    const kept = vi.fn();
    const gone = vi.fn();
    sub(id, kept);
    const off = sub(id, gone);
    off();
    expect(() => off()).not.toThrow();
    slapAgent(id);
    expect(kept).toHaveBeenCalledTimes(1);
    expect(gone).not.toHaveBeenCalled();
  });

  /** Verifies that a repeated unsubscribe of the last listener does not throw */
  it('ignores a second unsubscribe once the agent has no listener left', () => {
    const id = freshId();
    const off = sub(id, vi.fn());
    off();
    expect(() => off()).not.toThrow();
    expect(() => slapAgent(id)).not.toThrow();
  });

  /** Verifies that an agent can be listened to again after all its listeners left */
  it('accepts new listeners after the last one unsubscribed', () => {
    const id = freshId();
    const first = vi.fn();
    const off = sub(id, first);
    off();
    const second = vi.fn();
    sub(id, second);
    slapAgent(id);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  /** Verifies that a stale unsubscribe of an emptied agent does not remove a newer listener */
  it('keeps a newer listener when an old unsubscribe is called again', () => {
    const id = freshId();
    const off = sub(id, vi.fn());
    off();
    const fresh = vi.fn();
    sub(id, fresh);
    off();
    slapAgent(id);
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  /** Verifies that unsubscribing from one agent does not affect another agent */
  it('does not touch other agents on unsubscribe', () => {
    const a = freshId();
    const b = freshId();
    const onB = vi.fn();
    const off = sub(a, vi.fn());
    sub(b, onB);
    off();
    off();
    slapAgent(b);
    expect(onB).toHaveBeenCalledTimes(1);
  });

  // ---- changes during dispatch

  /** Verifies that a listener unsubscribing itself during a slap does not skip the next one */
  it('still calls the next listener when one unsubscribes itself during the slap', () => {
    const id = freshId();
    const order: string[] = [];
    const offA: { fn?: () => void } = {};
    offA.fn = sub(id, () => {
      order.push('a');
      offA.fn?.();
    });
    sub(id, () => order.push('b'));
    sub(id, () => order.push('c'));
    slapAgent(id);
    expect(order).toEqual(['a', 'b', 'c']);
    slapAgent(id);
    expect(order).toEqual(['a', 'b', 'c', 'b', 'c']);
  });

  /** Verifies that a listener removing a later one mid-slap does not disturb the current slap */
  it('finishes the current slap with the listeners present when it started', () => {
    const id = freshId();
    const later = vi.fn();
    let offLater: () => void = () => {};
    sub(id, () => offLater());
    offLater = sub(id, later);
    slapAgent(id);
    expect(later).toHaveBeenCalledTimes(1);
    slapAgent(id);
    expect(later).toHaveBeenCalledTimes(1);
  });

  /** Verifies that a listener added during a slap is only called from the next slap */
  it('calls a listener added during a slap only from the next slap on', () => {
    const id = freshId();
    const added = vi.fn();
    let done = false;
    sub(id, () => {
      if (done) return;
      done = true;
      sub(id, added);
    });
    slapAgent(id);
    expect(added).not.toHaveBeenCalled();
    slapAgent(id);
    expect(added).toHaveBeenCalledTimes(1);
  });

  /** Verifies that a listener slapping another agent re-entrantly reaches that agent */
  it('supports a listener that slaps another agent', () => {
    const a = freshId();
    const b = freshId();
    const onB = vi.fn();
    sub(a, () => slapAgent(b));
    sub(b, onB);
    slapAgent(a);
    expect(onB).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------- hasSlapTarget

describe('hasSlapTarget', () => {
  /** Verifies that an agent nobody listens to has no slap target */
  it('is false for an agent without listener', () => {
    expect(hasSlapTarget(freshId('nobody'))).toBe(false);
    expect(hasSlapTarget('')).toBe(false);
  });

  /** Verifies that the target appears with the first listener and goes with the last */
  it('is true while a listener exists and false once it unsubscribed', () => {
    const id = freshId();
    const off = sub(id, vi.fn());
    expect(hasSlapTarget(id)).toBe(true);
    off();
    expect(hasSlapTarget(id)).toBe(false);
  });

  /** Verifies that the target stays while at least one of several listeners remains */
  it('stays true until the last of several listeners unsubscribes', () => {
    const id = freshId();
    const offA = sub(id, vi.fn());
    const offB = sub(id, vi.fn());
    offA();
    expect(hasSlapTarget(id)).toBe(true);
    offA();
    expect(hasSlapTarget(id), 'repeated unsubscribe').toBe(true);
    offB();
    expect(hasSlapTarget(id)).toBe(false);
  });

  /** Verifies that a listener on one agent gives no target to other or near-miss ids */
  it('only reports the exact id that has a listener', () => {
    const id = freshId('agent-x');
    sub(id, vi.fn());
    expect(hasSlapTarget(freshId())).toBe(false);
    expect(hasSlapTarget(id.toUpperCase())).toBe(false);
    expect(hasSlapTarget(id.slice(0, -1))).toBe(false);
    expect(hasSlapTarget(`${id} `)).toBe(false);
  });

  /** Verifies that a stale unsubscribe does not remove the target of a newer listener */
  it('stays true for a newer listener when an old unsubscribe is called again', () => {
    const id = freshId();
    const off = sub(id, vi.fn());
    off();
    sub(id, vi.fn());
    off();
    expect(hasSlapTarget(id)).toBe(true);
  });

  /** Verifies that a slap does not change whether the agent has a target */
  it('is not changed by slapping the agent', () => {
    const id = freshId();
    sub(id, vi.fn());
    slapAgent(id);
    expect(hasSlapTarget(id)).toBe(true);
    const nobody = freshId('nobody');
    slapAgent(nobody);
    expect(hasSlapTarget(nobody)).toBe(false);
  });

  /** Verifies that a listener unsubscribing itself during a slap removes the target */
  it('is false after the only listener unsubscribed itself during a slap', () => {
    const id = freshId();
    const self: { off?: () => void } = {};
    self.off = sub(id, () => self.off?.());
    slapAgent(id);
    expect(hasSlapTarget(id)).toBe(false);
  });

  /** Verifies that Object.prototype member names are not reported as targets */
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'treats %s as an ordinary id',
    (id) => {
      expect(hasSlapTarget(id)).toBe(false);
      const off = sub(id, vi.fn());
      expect(hasSlapTarget(id)).toBe(true);
      off();
      expect(hasSlapTarget(id)).toBe(false);
    },
  );
});

// ---------------------------------------------------------------- watchSlapTargets

describe('watchSlapTargets', () => {
  /** Verifies that a watcher is called once when an agent gains its first listener */
  it('calls the watcher when an agent gains its first listener', () => {
    const watcher = vi.fn();
    watch(watcher);
    sub(freshId(), vi.fn());
    expect(watcher).toHaveBeenCalledTimes(1);
    expect(watcher).toHaveBeenCalledWith();
  });

  /** Verifies that the watcher already sees the new target when it is notified */
  it('notifies after the target is registered', () => {
    const id = freshId();
    const seen: boolean[] = [];
    watch(() => seen.push(hasSlapTarget(id)));
    const off = sub(id, vi.fn());
    off();
    expect(seen).toEqual([true, false]);
  });

  /** Verifies that adding a second listener to an agent does not notify watchers */
  it('does not call the watcher for a second listener of the same agent', () => {
    const id = freshId();
    sub(id, vi.fn());
    const watcher = vi.fn();
    watch(watcher);
    sub(id, vi.fn());
    sub(id, vi.fn());
    expect(watcher).not.toHaveBeenCalled();
  });

  /** Verifies that removing a non-last listener does not notify, removing the last does */
  it('calls the watcher only when the last listener of an agent leaves', () => {
    const id = freshId();
    const offA = sub(id, vi.fn());
    const offB = sub(id, vi.fn());
    const watcher = vi.fn();
    watch(watcher);
    offA();
    expect(watcher).not.toHaveBeenCalled();
    offB();
    expect(watcher).toHaveBeenCalledTimes(1);
  });

  /** Verifies that a repeated unsubscribe does not notify watchers again */
  it('does not call the watcher on a repeated unsubscribe', () => {
    const id = freshId();
    const off = sub(id, vi.fn());
    const watcher = vi.fn();
    watch(watcher);
    off();
    off();
    off();
    expect(watcher).toHaveBeenCalledTimes(1);
  });

  /** Verifies that a stale unsubscribe neither notifies nor removes a newer target */
  it('does not call the watcher for a stale unsubscribe after re-subscription', () => {
    const id = freshId();
    const off = sub(id, vi.fn());
    off();
    const watcher = vi.fn();
    watch(watcher);
    sub(id, vi.fn());
    expect(watcher).toHaveBeenCalledTimes(1);
    off();
    expect(watcher).toHaveBeenCalledTimes(1);
    expect(hasSlapTarget(id)).toBe(true);
  });

  /** Verifies that an agent gaining listeners again after emptying notifies again */
  it('notifies again each time an agent gains a first listener', () => {
    const id = freshId();
    const watcher = vi.fn();
    watch(watcher);
    const off = sub(id, vi.fn());
    off();
    sub(id, vi.fn());
    expect(watcher).toHaveBeenCalledTimes(3);
  });

  /** Verifies that each agent gaining its first listener triggers its own notification */
  it('notifies once per agent that gains a target', () => {
    const watcher = vi.fn();
    watch(watcher);
    sub(freshId(), vi.fn());
    sub(freshId(), vi.fn());
    expect(watcher).toHaveBeenCalledTimes(2);
  });

  /** Verifies that slapping an agent does not notify watchers */
  it('does not call the watcher on a slap', () => {
    const id = freshId();
    sub(id, vi.fn());
    const watcher = vi.fn();
    watch(watcher);
    slapAgent(id);
    slapAgent(freshId('nobody'));
    expect(watcher).not.toHaveBeenCalled();
  });

  /** Verifies that unwatch stops further notifications, and a second unwatch is harmless */
  it('stops calling the watcher after unwatch', () => {
    const watcher = vi.fn();
    const unwatch = watch(watcher);
    sub(freshId(), vi.fn());
    unwatch();
    expect(() => unwatch()).not.toThrow();
    sub(freshId(), vi.fn());
    expect(watcher).toHaveBeenCalledTimes(1);
  });

  /** Verifies that every watcher is notified, and unwatching one keeps the others */
  it('calls every watcher, and unwatching one leaves the others', () => {
    const order: string[] = [];
    const unwatchA = watch(() => order.push('a'));
    watch(() => order.push('b'));
    sub(freshId(), vi.fn());
    expect(order).toEqual(['a', 'b']);
    unwatchA();
    sub(freshId(), vi.fn());
    expect(order).toEqual(['a', 'b', 'b']);
  });

  /** Verifies that a watcher unwatching itself during a notification does not skip the next */
  it('still calls the next watcher when one unwatches itself during a notification', () => {
    const order: string[] = [];
    const self: { unwatch?: () => void } = {};
    self.unwatch = watch(() => {
      order.push('a');
      self.unwatch?.();
    });
    watch(() => order.push('b'));
    sub(freshId(), vi.fn());
    expect(order).toEqual(['a', 'b']);
    sub(freshId(), vi.fn());
    expect(order).toEqual(['a', 'b', 'b']);
  });

  /** Verifies that a watcher removing a later one mid-notification does not disturb it */
  it('finishes the current notification with the watchers present when it started', () => {
    const later = vi.fn();
    let unwatchLater: () => void = () => {};
    watch(() => unwatchLater());
    unwatchLater = watch(later);
    sub(freshId(), vi.fn());
    expect(later).toHaveBeenCalledTimes(1);
    sub(freshId(), vi.fn());
    expect(later).toHaveBeenCalledTimes(1);
  });

  /** Verifies that a watcher added during a notification is only called from the next one */
  it('calls a watcher added during a notification only from the next one on', () => {
    const added = vi.fn();
    let done = false;
    watch(() => {
      if (done) return;
      done = true;
      watch(added);
    });
    sub(freshId(), vi.fn());
    expect(added).not.toHaveBeenCalled();
    sub(freshId(), vi.fn());
    expect(added).toHaveBeenCalledTimes(1);
  });
});
