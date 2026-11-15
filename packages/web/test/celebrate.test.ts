import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Celebration } from '@agent-office/shared';
import { CLIPS, SPAWN_CLIP_TIME } from '../src/scene/characters.ts';
import {
  BURSTS,
  BURST_SPACING,
  BURST_TIME,
  DELAY_JITTER,
  FIREWORKS_STILL_TIME,
  FIREWORKS_TIME,
  HERALD_SINK,
  LAUNCH_Y,
  ROCKET_ALPHA,
  ROCKET_FADE,
  ROCKET_TIME,
  SPARKS,
  SPARK_DIRECTIONS,
  SPARK_RAMP,
  STILL_FADE,
  STILL_PEAK,
  TRUMPET_TIME,
  stillAlpha,
  TowerPool,
  celebrate,
  fireworkBursts,
  heraldClip,
  heraldDepth,
  heraldDuration,
  heraldPhase,
  installCelebrationCommands,
  onCelebrate,
  rocketAt,
  sparkAt,
  type Burst,
  type HeraldKind,
  type HeraldPhase,
} from '../src/scene/celebrate.ts';

// The bus is module state: every subscription made through `sub` is undone after the test,
// so no listener leaks from one test to the next.
const subscriptions: (() => void)[] = [];
function sub(listener: (kind: Celebration) => void): () => void {
  const off = onCelebrate(listener);
  subscriptions.push(off);
  return off;
}

afterEach(() => {
  for (const off of subscriptions.splice(0)) off();
  vi.restoreAllMocks();
});

/** A deterministic `random` that returns the given values in turn, cycling. */
function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

const KINDS: HeraldKind[] = ['commit', 'push'];
const TOL = 1e-9;

/** A fixed burst for the rocket and spark tests. */
const BURST: Burst = { x: 2, y: 13, z: -5, delay: 1, speed: 5, color: [1, 0.5, 0.2] };

// ---------------------------------------------------------------- bus

describe('celebrate and onCelebrate', () => {
  /** Verifies that celebrating with no scene mounted reports false and does not throw */
  it('returns false when no listener is mounted', () => {
    expect(celebrate('push')).toBe(false);
    expect(celebrate('commit')).toBe(false);
    expect(celebrate('tests')).toBe(false);
  });

  /** Verifies that a mounted listener receives the kind and celebrate reports true */
  it.each(['commit', 'push', 'tests'] as const)('passes the kind %s to the listener and returns true', (kind) => {
    const fn = vi.fn();
    sub(fn);
    expect(celebrate(kind)).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(kind);
  });

  /** Verifies that every listener is called once, in subscription order */
  it('calls every listener in subscription order', () => {
    const order: string[] = [];
    sub((k) => order.push(`a:${k}`));
    sub((k) => order.push(`b:${k}`));
    celebrate('tests');
    expect(order).toEqual(['a:tests', 'b:tests']);
  });

  /** Verifies that an unsubscribed listener is no longer called and the bus reports false */
  it('stops calling a listener after unsubscribe', () => {
    const fn = vi.fn();
    const off = sub(fn);
    celebrate('push');
    off();
    expect(celebrate('push')).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  /** Verifies that a second unsubscribe is harmless and keeps the other listeners */
  it('ignores a repeated unsubscribe', () => {
    const kept = vi.fn();
    sub(kept);
    const off = sub(vi.fn());
    off();
    expect(() => off()).not.toThrow();
    expect(celebrate('commit')).toBe(true);
    expect(kept).toHaveBeenCalledTimes(1);
  });

  /** Verifies that celebrate reports true until the last listener unsubscribes */
  it('keeps the bus true while at least one listener remains', () => {
    const offA = sub(vi.fn());
    const offB = sub(vi.fn());
    offA();
    expect(celebrate('tests')).toBe(true);
    offB();
    expect(celebrate('tests')).toBe(false);
  });

  /** Verifies that a listener unsubscribing itself mid-dispatch does not skip the next one */
  it('still calls the next listener when one unsubscribes itself', () => {
    const order: string[] = [];
    const self: { off?: () => void } = {};
    self.off = sub(() => {
      order.push('a');
      self.off?.();
    });
    sub(() => order.push('b'));
    celebrate('push');
    celebrate('push');
    expect(order).toEqual(['a', 'b', 'b']);
  });

  /** Verifies that a listener added during a dispatch is only called from the next one */
  it('calls a listener added during a dispatch only from the next dispatch', () => {
    const added = vi.fn();
    let done = false;
    sub(() => {
      if (done) return;
      done = true;
      sub(added);
    });
    celebrate('commit');
    expect(added).not.toHaveBeenCalled();
    celebrate('commit');
    expect(added).toHaveBeenCalledTimes(1);
  });

  /** Verifies that a listener removing a later one mid-dispatch does not disturb that dispatch */
  it('finishes the current dispatch with the listeners present when it started', () => {
    const later = vi.fn();
    let offLater: () => void = () => {};
    sub(() => offLater());
    offLater = sub(later);
    celebrate('tests');
    expect(later).toHaveBeenCalledTimes(1);
    celebrate('tests');
    expect(later).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------- console commands

describe('installCelebrationCommands', () => {
  type Commands = { heraut: (kind?: unknown) => boolean; feuArtifice: () => boolean };
  const commandsOf = (host: object) => (host as { agentOffice: Commands }).agentOffice;

  /** Verifies that the commands are created under agentOffice on an empty host */
  it('creates agentOffice with heraut and feuArtifice on a bare host', () => {
    const host = {};
    installCelebrationCommands(host);
    const commands = commandsOf(host);
    expect(typeof commands).toBe('object');
    expect(typeof commands.heraut).toBe('function');
    expect(typeof commands.feuArtifice).toBe('function');
  });

  /** Verifies that an existing agentOffice object is kept, with the other gags' commands */
  it('keeps an existing agentOffice object and its other keys', () => {
    const potion = () => true;
    const existing = { potion, other: 42 };
    const host = { agentOffice: existing };
    installCelebrationCommands(host);
    expect(host.agentOffice).toBe(existing);
    expect(host.agentOffice.potion).toBe(potion);
    expect(host.agentOffice.other).toBe(42);
    expect(typeof commandsOf(host).heraut).toBe('function');
    expect(typeof commandsOf(host).feuArtifice).toBe('function');
  });

  /** Verifies that a non-object value under agentOffice is replaced by a commands object */
  it.each([
    ['a string', 'oops'],
    ['a number', 7],
    ['null', null],
    ['undefined', undefined],
    ['a boolean', true],
    ['a function', () => 'x'],
  ] as const)('replaces %s under agentOffice', (_label, value) => {
    const host: { agentOffice: unknown } = { agentOffice: value };
    installCelebrationCommands(host);
    expect(typeof host.agentOffice).toBe('object');
    expect(host.agentOffice).not.toBeNull();
    expect(typeof commandsOf(host).heraut).toBe('function');
    expect(typeof commandsOf(host).feuArtifice).toBe('function');
  });

  /** Verifies that unrelated keys of the host itself are left untouched */
  it('does not touch other properties of the host', () => {
    const host = { title: 'keep me', agentOffice: undefined as unknown };
    installCelebrationCommands(host);
    expect(host.title).toBe('keep me');
  });

  /** Verifies that installing twice keeps the same holder object and working commands */
  it('can be installed twice without losing the holder', () => {
    const host: { agentOffice?: unknown } = {};
    installCelebrationCommands(host);
    const first = host.agentOffice;
    installCelebrationCommands(host);
    expect(host.agentOffice).toBe(first);
    const seen: Celebration[] = [];
    sub((k) => seen.push(k));
    commandsOf(host).heraut('commit');
    expect(seen).toEqual(['commit']);
  });

  /** Verifies that heraut('commit') plays a commit herald */
  it("plays a commit herald for heraut('commit')", () => {
    const host = {};
    installCelebrationCommands(host);
    const seen: Celebration[] = [];
    sub((k) => seen.push(k));
    expect(commandsOf(host).heraut('commit')).toBe(true);
    expect(seen).toEqual(['commit']);
  });

  /** Verifies that heraut with no or any other argument plays the push fanfare */
  it.each([
    ['no argument', []],
    ["'push'", ['push']],
    ["'tests'", ['tests']],
    ["'COMMIT' (case matters)", ['COMMIT']],
    ["' commit'", [' commit']],
    ['a number', [1]],
    ['null', [null]],
    ['an object', [{ kind: 'commit' }]],
  ] as const)('plays the push fanfare for heraut with %s', (_label, args) => {
    const host = {};
    installCelebrationCommands(host);
    const seen: Celebration[] = [];
    sub((k) => seen.push(k));
    (commandsOf(host).heraut as (...a: unknown[]) => boolean)(...args);
    expect(seen).toEqual(['push']);
  });

  /** Verifies that feuArtifice() sets off the tests fireworks */
  it('sets off fireworks for feuArtifice()', () => {
    const host = {};
    installCelebrationCommands(host);
    const seen: Celebration[] = [];
    sub((k) => seen.push(k));
    expect(commandsOf(host).feuArtifice()).toBe(true);
    expect(seen).toEqual(['tests']);
  });

  /** Verifies that the commands report false when no scene is mounted */
  it('reports false from both commands when no scene listens', () => {
    const host = {};
    installCelebrationCommands(host);
    expect(commandsOf(host).heraut()).toBe(false);
    expect(commandsOf(host).heraut('commit')).toBe(false);
    expect(commandsOf(host).feuArtifice()).toBe(false);
  });
});

// ---------------------------------------------------------------- herald timing

describe('TRUMPET_TIME and heraldDuration', () => {
  /** Verifies that both trumpet times are positive and the push fanfare is longer */
  it('gives a longer, positive trumpet time to a push than to a commit', () => {
    for (const kind of KINDS) expect(TRUMPET_TIME[kind]).toBeGreaterThan(0);
    expect(TRUMPET_TIME.push).toBeGreaterThan(TRUMPET_TIME.commit);
  });

  /** Verifies that the outing is a rise, the trumpet call, then a descent of equal length */
  it.each(KINDS)('lasts two spawn clips plus the trumpet time for %s', (kind) => {
    expect(heraldDuration(kind)).toBeCloseTo(2 * SPAWN_CLIP_TIME + TRUMPET_TIME[kind], 12);
  });

  /** Verifies that a push outing lasts longer than a commit outing */
  it('makes a push outing longer than a commit outing', () => {
    expect(heraldDuration('push')).toBeGreaterThan(heraldDuration('commit'));
  });
});

describe('heraldPhase', () => {
  /** Verifies the phase and in-phase time at the start and boundaries of each phase */
  it.each(KINDS)('walks rising, trumpeting, sinking, gone at the boundaries for %s', (kind) => {
    const S = SPAWN_CLIP_TIME;
    const T = TRUMPET_TIME[kind];
    expect(heraldPhase(0, kind)).toEqual({ phase: 'rising', t: 0 });
    expect(heraldPhase(S / 2, kind).phase).toBe('rising');
    expect(heraldPhase(S / 2, kind).t).toBeCloseTo(S / 2, 12);
    expect(heraldPhase(S - 1e-6, kind).phase).toBe('rising');

    const trumpetStart = heraldPhase(S, kind);
    expect(trumpetStart.phase).toBe('trumpeting');
    expect(trumpetStart.t).toBeCloseTo(0, 12);
    const trumpetMid = heraldPhase(S + T / 2, kind);
    expect(trumpetMid.phase).toBe('trumpeting');
    expect(trumpetMid.t).toBeCloseTo(T / 2, 9);
    expect(heraldPhase(S + T - 1e-6, kind).phase).toBe('trumpeting');

    const sinkStart = heraldPhase(S + T, kind);
    expect(sinkStart.phase).toBe('sinking');
    expect(sinkStart.t).toBeCloseTo(0, 9);
    const sinkMid = heraldPhase(S + T + S / 2, kind);
    expect(sinkMid.phase).toBe('sinking');
    expect(sinkMid.t).toBeCloseTo(S / 2, 9);
    expect(heraldPhase(heraldDuration(kind) - 1e-6, kind).phase).toBe('sinking');

    expect(heraldPhase(heraldDuration(kind), kind)).toEqual({ phase: 'gone', t: 0 });
  });

  /** Verifies that the herald stays gone long after the outing ended */
  it.each(KINDS)('stays gone after the outing for %s', (kind) => {
    for (const elapsed of [heraldDuration(kind) + 0.01, 100, 1e9, Infinity]) {
      expect(heraldPhase(elapsed, kind)).toEqual({ phase: 'gone', t: 0 });
    }
  });

  /** Verifies that a negative elapsed time (clock skew) is clamped to the rise start */
  it.each([-0.001, -1, -1e9, -Infinity])('treats the negative elapsed %d as the rise start', (elapsed) => {
    expect(heraldPhase(elapsed, 'push')).toEqual({ phase: 'rising', t: 0 });
  });

  /** Verifies that a NaN elapsed time never shows a herald stuck mid-phase */
  it('treats a NaN elapsed time as gone', () => {
    expect(heraldPhase(NaN, 'commit')).toEqual({ phase: 'gone', t: 0 });
  });

  /** Verifies that the commit and push outings differ only from the trumpet call on */
  it('rises the same way for both kinds and sinks later for a push', () => {
    const S = SPAWN_CLIP_TIME;
    expect(heraldPhase(S / 3, 'commit')).toEqual(heraldPhase(S / 3, 'push'));
    const afterCommitCall = S + TRUMPET_TIME.commit + 0.1;
    expect(heraldPhase(afterCommitCall, 'commit').phase).toBe('sinking');
    expect(heraldPhase(afterCommitCall, 'push').phase).toBe('trumpeting');
  });

  /** Verifies that phases never go backwards and t stays within each phase over a run */
  it.each(KINDS)('advances monotonically through the phases over time for %s', (kind) => {
    const order: HeraldPhase[] = ['rising', 'trumpeting', 'sinking', 'gone'];
    let last = 0;
    const end = heraldDuration(kind) + 1;
    for (let e = 0; e <= end; e += 1 / 60) {
      const { phase, t } = heraldPhase(e, kind);
      const idx = order.indexOf(phase);
      expect(idx).toBeGreaterThanOrEqual(last);
      last = idx;
      expect(t).toBeGreaterThanOrEqual(-TOL);
      const max = phase === 'trumpeting' ? TRUMPET_TIME[kind] : SPAWN_CLIP_TIME;
      expect(t).toBeLessThanOrEqual(max + TOL);
    }
    expect(last).toBe(3);
  });
});

// ---------------------------------------------------------------- herald clip and depth

describe('heraldClip', () => {
  /** Verifies that the herald plays the ground spawn clip once while rising */
  it('plays Spawn_Ground once, at normal speed, while rising', () => {
    expect(heraldClip('rising', 0.4)).toEqual({ name: 'Spawn_Ground', loop: false, timeScale: 1, frozen: false, frozenAt: 0 });
  });

  /** Verifies that the herald loops the use-item clip while sounding the trumpet */
  it('loops Use_Item while trumpeting', () => {
    const clip = heraldClip('trumpeting', 1);
    expect(clip.name).toBe('Use_Item');
    expect(clip.loop).toBe(true);
    expect(clip.frozen).toBe(false);
    expect(clip.timeScale).toBe(1);
  });

  /** Verifies that sinking holds the spawn clip played backwards, from its end to its start */
  it('holds Spawn_Ground backwards while sinking', () => {
    const S = SPAWN_CLIP_TIME;
    const start = heraldClip('sinking', 0);
    expect(start.name).toBe('Spawn_Ground');
    expect(start.frozen).toBe(true);
    expect(start.timeScale).toBe(0);
    expect(start.frozenAt).toBeCloseTo(S, 12);
    expect(heraldClip('sinking', S / 4).frozenAt).toBeCloseTo((3 * S) / 4, 12);
    expect(heraldClip('sinking', S).frozenAt).toBeCloseTo(0, 12);
  });

  /** Verifies that a sinking time past the clip length never yields a negative frame */
  it.each([SPAWN_CLIP_TIME + 0.01, 10, Infinity])('clamps the frame to 0 for the sinking time %d', (t) => {
    expect(heraldClip('sinking', t).frozenAt).toBe(0);
  });

  /** Verifies that the frame held while sinking only goes backwards over time */
  it('only rewinds the frame while sinking', () => {
    let prev = Infinity;
    for (let t = 0; t <= SPAWN_CLIP_TIME + 0.2; t += 0.05) {
      const at = heraldClip('sinking', t).frozenAt;
      expect(at).toBeLessThanOrEqual(prev);
      prev = at;
    }
  });

  /** Verifies that a gone herald holds a still idle pose */
  it('holds Idle_A once gone', () => {
    const clip = heraldClip('gone', 0);
    expect(clip.name).toBe('Idle_A');
    expect(clip.frozen).toBe(true);
  });

  /** Verifies that every clip the herald uses is loaded by the figures (listed in CLIPS) */
  it('only uses clips listed in CLIPS', () => {
    const phases: HeraldPhase[] = ['rising', 'trumpeting', 'sinking', 'gone'];
    for (const phase of phases) {
      expect(CLIPS as readonly string[]).toContain(heraldClip(phase, 0.5).name);
    }
  });
});

describe('heraldDepth', () => {
  /** Verifies that the herald stays at the tower top while rising and trumpeting */
  it.each([
    ['rising', 0],
    ['rising', 1],
    ['trumpeting', 0],
    ['trumpeting', 5],
  ] as const)('is 0 while %s (t=%d)', (phase, t) => {
    expect(heraldDepth(phase, t)).toBe(0);
  });

  /** Verifies that the herald goes down linearly through the trapdoor while sinking */
  it('goes from 0 to HERALD_SINK over the sinking clip', () => {
    const S = SPAWN_CLIP_TIME;
    expect(heraldDepth('sinking', 0)).toBe(0);
    expect(heraldDepth('sinking', S / 2)).toBeCloseTo(HERALD_SINK / 2, 12);
    expect(heraldDepth('sinking', S)).toBeCloseTo(HERALD_SINK, 12);
  });

  /** Verifies that the depth never goes beyond HERALD_SINK, even late in the phase */
  it.each([SPAWN_CLIP_TIME * 2, 100, Infinity])('caps the sinking depth at HERALD_SINK for t=%d', (t) => {
    expect(heraldDepth('sinking', t)).toBe(HERALD_SINK);
  });

  /** Verifies that a gone herald stays fully below the tower top */
  it('is HERALD_SINK once gone', () => {
    expect(heraldDepth('gone', 0)).toBe(HERALD_SINK);
    expect(HERALD_SINK).toBeGreaterThan(0);
  });

  /** Verifies that over a whole outing the herald only ever goes down, with no jump at the end */
  it.each(KINDS)('never rises again over a whole %s outing', (kind) => {
    let prev = 0;
    for (let e = 0; e <= heraldDuration(kind) + 0.5; e += 1 / 60) {
      const { phase, t } = heraldPhase(e, kind);
      const depth = heraldDepth(phase, t);
      expect(depth).toBeGreaterThanOrEqual(prev - TOL);
      // No visible pop: at most a frame's worth of descent between two frames.
      expect(depth - prev).toBeLessThanOrEqual(HERALD_SINK / (SPAWN_CLIP_TIME * 60) + 1e-6);
      prev = depth;
    }
    expect(prev).toBe(HERALD_SINK);
  });
});

// ---------------------------------------------------------------- TowerPool

describe('TowerPool', () => {
  /** Verifies that random 0 picks the first free tower, until every tower is taken */
  it('hands out every tower once, then null', () => {
    const pool = new TowerPool(4);
    const zero = () => 0;
    expect([pool.claim(zero), pool.claim(zero), pool.claim(zero), pool.claim(zero)]).toEqual([0, 1, 2, 3]);
    expect(pool.claim(zero)).toBeNull();
    expect(pool.claim(zero)).toBeNull();
  });

  /** Verifies that the random value picks among the free towers proportionally */
  it.each([
    [0, 0],
    [0.24, 0],
    [0.25, 1],
    [0.5, 2],
    [0.99, 3],
  ] as const)('picks with random %d the tower %d out of four', (r, expected) => {
    expect(new TowerPool(4).claim(() => r)).toBe(expected);
  });

  /** Verifies that a random value of exactly 1 still yields a valid tower */
  it('clamps a random value of 1 to the last free tower', () => {
    const pool = new TowerPool(4);
    expect(pool.claim(() => 1)).toBe(3);
  });

  /** Verifies that busy towers are skipped when picking */
  it('never returns a tower that is already taken', () => {
    const pool = new TowerPool(4);
    const taken = new Set<number>();
    const random = sequence(0.9, 0.1, 0.6, 0.3);
    for (let i = 0; i < 4; i++) {
      const t = pool.claim(random);
      expect(t).not.toBeNull();
      expect(taken.has(t as number)).toBe(false);
      taken.add(t as number);
    }
    expect([...taken].sort()).toEqual([0, 1, 2, 3]);
  });

  /** Verifies that preferred (standing) towers are picked before the others */
  it('prefers the towers for which preferred is true', () => {
    const pool = new TowerPool(4);
    const standing = (i: number) => i === 1 || i === 3;
    const picks = [pool.claim(() => 0, standing), pool.claim(() => 0, standing)];
    expect(picks.sort()).toEqual([1, 3]);
  });

  /** Verifies that whatever the random value, a single preferred tower is chosen */
  it.each([0, 0.5, 0.999, 1])('returns the only preferred free tower for random %d', (r) => {
    const pool = new TowerPool(4);
    expect(pool.claim(() => r, (i) => i === 2)).toBe(2);
  });

  /** Verifies the fallback to any free tower once the preferred ones are all busy */
  it('falls back to a free tower when every preferred tower is busy', () => {
    const pool = new TowerPool(4);
    const onlyZero = (i: number) => i === 0;
    expect(pool.claim(() => 0, onlyZero)).toBe(0);
    const next = pool.claim(() => 0, onlyZero);
    expect(next).toBe(1);
  });

  /** Verifies the fallback to any free tower when no tower is preferred */
  it('falls back to any free tower when none is preferred', () => {
    const pool = new TowerPool(4);
    expect(pool.claim(() => 0.5, () => false)).toBe(2);
  });

  /** Verifies that null is returned when all towers are busy, preferred or not */
  it('returns null when every tower is busy, whatever preferred says', () => {
    const pool = new TowerPool(2);
    pool.claim(() => 0);
    pool.claim(() => 0);
    expect(pool.claim(() => 0, () => true)).toBeNull();
    expect(pool.claim(() => 0, () => false)).toBeNull();
  });

  /** Verifies that a released tower can be claimed again */
  it('lets a released tower be claimed again', () => {
    const pool = new TowerPool(4);
    for (let i = 0; i < 4; i++) pool.claim(() => 0);
    pool.release(2);
    expect(pool.claim(() => 0)).toBe(2);
    expect(pool.claim(() => 0)).toBeNull();
  });

  /** Verifies that releasing a free tower is harmless and frees nothing else */
  it('ignores releasing a tower that is already free', () => {
    const pool = new TowerPool(2);
    pool.claim(() => 0);
    pool.release(1);
    pool.release(1);
    expect(pool.claim(() => 0)).toBe(1);
    expect(pool.claim(() => 0)).toBeNull();
  });

  /** Verifies that out-of-range indexes are ignored and do not free or grow the pool */
  it.each([-1, 4, 5, 100, NaN, Infinity, -Infinity])('ignores release(%d)', (index) => {
    const pool = new TowerPool(4);
    for (let i = 0; i < 4; i++) pool.claim(() => 0);
    expect(() => pool.release(index)).not.toThrow();
    expect(pool.claim(() => 0)).toBeNull();
  });

  /** Verifies that a pool of zero towers never hands one out */
  it('returns null from an empty pool', () => {
    const pool = new TowerPool(0);
    expect(pool.claim(() => 0)).toBeNull();
    expect(() => pool.release(0)).not.toThrow();
    expect(pool.claim(() => 0)).toBeNull();
  });

  /** Verifies that claim defaults to Math.random and prefers every tower */
  it('uses Math.random when no random is given', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.75);
    const pool = new TowerPool(4);
    expect(pool.claim()).toBe(3);
  });

  /** Verifies that two pools keep their own state */
  it('keeps the state of separate pools independent', () => {
    const a = new TowerPool(1);
    const b = new TowerPool(1);
    expect(a.claim(() => 0)).toBe(0);
    expect(b.claim(() => 0)).toBe(0);
    a.release(0);
    expect(b.claim(() => 0)).toBeNull();
    expect(a.claim(() => 0)).toBe(0);
  });
});

// ---------------------------------------------------------------- fireworks

describe('fireworks constants', () => {
  /** Verifies that the show timings are positive and the still bouquet is shorter */
  it('uses positive timings with a shorter reduced-motion bouquet', () => {
    for (const v of [FIREWORKS_TIME, FIREWORKS_STILL_TIME, ROCKET_TIME, BURST_TIME]) expect(v).toBeGreaterThan(0);
    expect(FIREWORKS_STILL_TIME).toBeLessThan(FIREWORKS_TIME);
    expect(Number.isInteger(SPARKS) && SPARKS > 0).toBe(true);
    expect(Number.isInteger(BURSTS) && BURSTS > 0).toBe(true);
  });

  /** Verifies that the show length covers the latest last rocket and its whole burst */
  it('derives FIREWORKS_TIME from the spacing, jitter, rocket and burst times', () => {
    expect(FIREWORKS_TIME).toBeCloseTo((BURSTS - 1) * BURST_SPACING + DELAY_JITTER + ROCKET_TIME + BURST_TIME, 12);
  });

  /** Verifies that two burst openings are always at least 0.4 s apart (WCAG 2.3.1) */
  it('keeps the minimum gap between bursts at 0.4 s or more', () => {
    expect(DELAY_JITTER).toBeGreaterThanOrEqual(0);
    expect(BURST_SPACING - DELAY_JITTER).toBeGreaterThanOrEqual(0.4 - TOL);
  });

  /** Verifies that every fade fits inside the phase it belongs to and brightness stays in 0-1 */
  it('fits each fade inside its phase and keeps peak brightness within 0-1', () => {
    expect(ROCKET_FADE).toBeGreaterThan(0);
    expect(2 * ROCKET_FADE).toBeLessThanOrEqual(ROCKET_TIME);
    expect(ROCKET_ALPHA).toBeGreaterThan(0);
    expect(ROCKET_ALPHA).toBeLessThanOrEqual(1);
    expect(SPARK_RAMP).toBeGreaterThan(0);
    expect(SPARK_RAMP).toBeLessThan(BURST_TIME);
    expect(STILL_FADE).toBeGreaterThan(0);
    expect(2 * STILL_FADE).toBeLessThanOrEqual(FIREWORKS_STILL_TIME);
    expect(STILL_PEAK).toBeGreaterThan(0);
    expect(STILL_PEAK).toBeLessThanOrEqual(1);
  });
});

describe('fireworkBursts', () => {
  /** Verifies the exact bursts for a neutral random value of 0.5 */
  it('lays out BURSTS bursts across the castle for random 0.5', () => {
    const bursts = fireworkBursts(10, 20, () => 0.5);
    expect(bursts).toHaveLength(BURSTS);
    bursts.forEach((b, i) => {
      expect(b.x).toBeCloseTo(10 + (i - (BURSTS - 1) / 2) * 7, 9);
      expect(b.y).toBeCloseTo(13, 9);
      expect(b.z).toBeCloseTo(20 - 6.5, 9);
      expect(b.delay).toBeCloseTo(i * BURST_SPACING + 0.5 * DELAY_JITTER, 9);
      expect(b.speed).toBeCloseTo(5.5, 9);
    });
  });

  /** Verifies that bursts stay within their bounds for the extreme random values */
  it.each([0, 0.999999])('keeps every burst in range for random %d', (r) => {
    const cx = 3;
    const cz = -7;
    const half = ((BURSTS - 1) / 2) * 7 + 1.5;
    fireworkBursts(cx, cz, () => r).forEach((b, i) => {
      expect(b.delay).toBeGreaterThanOrEqual(i * BURST_SPACING - TOL);
      expect(b.delay).toBeLessThanOrEqual(i * BURST_SPACING + DELAY_JITTER + TOL);
      expect(b.x).toBeGreaterThanOrEqual(cx - half - TOL);
      expect(b.x).toBeLessThanOrEqual(cx + half + TOL);
      expect(b.y).toBeGreaterThanOrEqual(11);
      expect(b.y).toBeLessThanOrEqual(15);
      // Behind the middle of the castle, so it shows in the sky of the default view.
      expect(b.z).toBeLessThanOrEqual(cz - 4);
      expect(b.z).toBeGreaterThanOrEqual(cz - 9);
      expect(b.speed).toBeGreaterThanOrEqual(4.5);
      expect(b.speed).toBeLessThanOrEqual(6.5);
      expect(b.delay).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThan(LAUNCH_Y);
    });
  });

  /** Verifies that bursts go off one after another and spread left to right */
  it('orders the bursts by delay and by x, even with alternating random values', () => {
    const bursts = fireworkBursts(0, 0, sequence(0, 0.999, 0.999, 0, 0.5, 0.999));
    for (let i = 1; i < bursts.length; i++) {
      expect(bursts[i].delay).toBeGreaterThan(bursts[i - 1].delay);
      expect(bursts[i].x).toBeGreaterThan(bursts[i - 1].x);
    }
  });

  /** Verifies that every burst has a valid linear RGB colour and neighbours differ */
  it('gives each burst a valid colour, different from the previous burst', () => {
    const bursts = fireworkBursts(0, 0, () => 0.5);
    bursts.forEach((b, i) => {
      expect(b.color).toHaveLength(3);
      for (const c of b.color) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
      if (i > 0) expect(b.color).not.toEqual(bursts[i - 1].color);
    });
  });

  /** Verifies that the same random sequence gives the same show */
  it('is deterministic for a given random sequence', () => {
    const a = fireworkBursts(1, 2, sequence(0.1, 0.7, 0.3, 0.9));
    const b = fireworkBursts(1, 2, sequence(0.1, 0.7, 0.3, 0.9));
    expect(a).toEqual(b);
  });

  /** Verifies that moving the castle centre moves every burst by the same offset */
  it('follows the castle centre', () => {
    const a = fireworkBursts(0, 0, () => 0.4);
    const b = fireworkBursts(10, -3, () => 0.4);
    a.forEach((burst, i) => {
      expect(b[i].x - burst.x).toBeCloseTo(10, 9);
      expect(b[i].z - burst.z).toBeCloseTo(-3, 9);
      expect(b[i].y).toBe(burst.y);
      expect(b[i].delay).toBe(burst.delay);
    });
  });

  /** Verifies that Math.random is used when no random is given */
  it('uses Math.random by default', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(fireworkBursts(0, 0)).toEqual(fireworkBursts(0, 0, () => 0.5));
  });

  /**
   * Verifies that every burst has faded out before the show ends, whatever the random values
   */
  it.each([0, 0.5, 0.999999])('fits every burst inside FIREWORKS_TIME for random %d', (r) => {
    for (const b of fireworkBursts(0, 0, () => r)) {
      expect(b.delay + ROCKET_TIME + BURST_TIME).toBeLessThanOrEqual(FIREWORKS_TIME + TOL);
    }
  });

  // Worst case for the gap: one burst with maximal jitter followed by one with none. Each burst
  // draws five random values (x, y, z, delay, speed), so the pattern alternates per five draws.
  const high = Array<number>(5).fill(0.999999);
  const low = Array<number>(5).fill(0);
  // Factories, so every test gets a fresh, unshared random sequence.
  const RANDOMS: [string, () => () => number][] = [
    ['random 0', () => () => 0],
    ['random ~1', () => () => 0.999999],
    ['max jitter then none', () => sequence(...high, ...low)],
    ['no jitter then max', () => sequence(...low, ...high)],
  ];

  /** Verifies that burst openings are at least 0.4 s apart, whatever the random values */
  it.each(RANDOMS)('opens bursts at least 0.4 s apart for %s', (_label, makeRandom) => {
    const openings = fireworkBursts(0, 0, makeRandom()).map((b) => b.delay + ROCKET_TIME);
    for (let i = 1; i < openings.length; i++) {
      expect(openings[i] - openings[i - 1]).toBeGreaterThanOrEqual(0.4 - TOL);
    }
  });

  /** Verifies that no more than three bursts open within any one-second window (WCAG 2.3.1) */
  it.each(RANDOMS)('opens at most 3 bursts in any 1 s window for %s', (_label, makeRandom) => {
    const openings = fireworkBursts(0, 0, makeRandom()).map((b) => b.delay + ROCKET_TIME);
    for (const start of openings) {
      const inWindow = openings.filter((o) => o >= start && o < start + 1);
      expect(inWindow.length).toBeLessThanOrEqual(3);
    }
  });
});

describe('SPARK_DIRECTIONS', () => {
  /** Verifies that there is one direction per spark, each a unit vector */
  it('holds SPARKS unit vectors', () => {
    expect(SPARK_DIRECTIONS).toHaveLength(SPARKS);
    for (const [x, y, z] of SPARK_DIRECTIONS) {
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
    }
  });

  /** Verifies that the directions cover the whole sphere, top to bottom, evenly in height */
  it('spreads the directions over both hemispheres', () => {
    const ys = SPARK_DIRECTIONS.map((d) => d[1]);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThan(ys[i - 1]);
    expect(ys[0]).toBeGreaterThan(0.9);
    expect(ys[ys.length - 1]).toBeLessThan(-0.9);
    expect(ys.filter((y) => y > 0)).toHaveLength(SPARKS / 2);
    expect(ys.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 9);
  });

  /** Verifies that no two sparks fly the same way */
  it('has no duplicate direction', () => {
    const keys = new Set(SPARK_DIRECTIONS.map((d) => d.map((v) => v.toFixed(6)).join(',')));
    expect(keys.size).toBe(SPARKS);
  });
});

describe('rocketAt', () => {
  /** Verifies that the rocket is invisible before its delay */
  it.each([0, 0.5, BURST.delay - 1e-6])('is invisible before its delay (time %d)', (time) => {
    expect(rocketAt(BURST, time).alpha).toBe(0);
  });

  /** Verifies that the rocket leaves from the wall top, still invisible, at its delay */
  it('starts at the launch height with alpha 0 at its delay', () => {
    const r = rocketAt(BURST, BURST.delay);
    expect(r).toEqual({ x: BURST.x, y: LAUNCH_Y, z: BURST.z, alpha: 0 });
  });

  /** Verifies that the rocket fades in, holds at ROCKET_ALPHA, then fades out before bursting */
  it.each([
    ['half the fade-in', ROCKET_FADE / 2, ROCKET_ALPHA / 2],
    ['the end of the fade-in', ROCKET_FADE, ROCKET_ALPHA],
    ['mid flight', ROCKET_TIME / 2, ROCKET_ALPHA],
    ['the start of the fade-out', ROCKET_TIME - ROCKET_FADE, ROCKET_ALPHA],
    ['half the fade-out', ROCKET_TIME - ROCKET_FADE / 2, ROCKET_ALPHA / 2],
  ] as const)('has the expected brightness at %s', (_label, t, expected) => {
    expect(rocketAt(BURST, BURST.delay + t).alpha).toBeCloseTo(expected, 6);
  });

  /** Verifies that the rocket brightness never jumps between two frames (WCAG 2.3.1) */
  it('changes brightness smoothly, with no sudden step on or off', () => {
    const step = 0.001;
    const maxStep = (ROCKET_ALPHA * step) / ROCKET_FADE;
    let prev = rocketAt(BURST, BURST.delay - 0.05).alpha;
    let peak = 0;
    for (let k = 0; k <= Math.round((ROCKET_TIME + 0.1) / step); k++) {
      const a = rocketAt(BURST, BURST.delay - 0.05 + k * step).alpha;
      expect(Math.abs(a - prev)).toBeLessThanOrEqual(maxStep * 1.01 + 1e-9);
      expect(a).toBeGreaterThanOrEqual(0);
      peak = Math.max(peak, a);
      prev = a;
    }
    expect(peak).toBeCloseTo(ROCKET_ALPHA, 9);
  });

  /** Verifies that the rocket disappears once it reaches the burst point */
  it.each([BURST.delay + ROCKET_TIME, BURST.delay + ROCKET_TIME + 1, 1e9])('is invisible from the burst on (time %d)', (time) => {
    expect(rocketAt(BURST, time).alpha).toBe(0);
  });

  /** Verifies that the rocket climbs straight up, always rising, below the burst point */
  it('climbs vertically and monotonically toward the burst height', () => {
    let prev = -Infinity;
    for (let k = 0; k < 30; k++) {
      const r = rocketAt(BURST, BURST.delay + (k * ROCKET_TIME) / 30);
      expect(r.alpha).toBeGreaterThanOrEqual(0);
      expect(r.alpha).toBeLessThanOrEqual(ROCKET_ALPHA);
      if (k > 0) expect(r.alpha).toBeGreaterThan(0);
      expect(r.x).toBe(BURST.x);
      expect(r.z).toBe(BURST.z);
      expect(r.y).toBeGreaterThan(prev);
      expect(r.y).toBeGreaterThanOrEqual(LAUNCH_Y);
      expect(r.y).toBeLessThan(BURST.y);
      prev = r.y;
    }
    expect(rocketAt(BURST, BURST.delay + ROCKET_TIME - 1e-6).y).toBeCloseTo(BURST.y, 4);
  });

  /** Verifies that the rocket is fast at first and slows near the top (ease-out) */
  it('covers more than half the climb in the first half of its flight', () => {
    const half = rocketAt(BURST, BURST.delay + ROCKET_TIME / 2).y;
    expect(half - LAUNCH_Y).toBeCloseTo(0.75 * (BURST.y - LAUNCH_Y), 9);
  });
});

describe('sparkAt', () => {
  const open = BURST.delay + ROCKET_TIME;

  /** Verifies that sparks are invisible while the rocket still climbs */
  it.each([0, BURST.delay, open - 1e-6])('is invisible before the burst opens (time %d)', (time) => {
    expect(sparkAt(BURST, 0, time).alpha).toBe(0);
  });

  /** Verifies that every spark starts at the burst point, still dark (no flash on) */
  it('starts every spark at the burst point with alpha 0', () => {
    for (let i = 0; i < SPARKS; i++) {
      const s = sparkAt(BURST, i, open);
      expect(s.alpha).toBeCloseTo(0, 9);
      expect(s.x).toBeCloseTo(BURST.x, 12);
      expect(s.y).toBeCloseTo(BURST.y, 12);
      expect(s.z).toBeCloseTo(BURST.z, 12);
    }
  });

  /** Verifies that sparks are invisible once the burst has lived its time */
  it.each([open + BURST_TIME, open + BURST_TIME + 5])('is invisible after the burst ends (time %d)', (time) => {
    expect(sparkAt(BURST, 7, time).alpha).toBe(0);
  });

  /** Verifies the spark brightness: a ramp over SPARK_RAMP times the quadratic fade-out */
  it.each([SPARK_RAMP / 4, SPARK_RAMP / 2, SPARK_RAMP, 0.5, 1, 1.5])('has the specified brightness at t=%d', (t) => {
    const expected = Math.min(1, t / SPARK_RAMP) * (1 - (t / BURST_TIME) ** 2);
    expect(sparkAt(BURST, 9, open + t).alpha).toBeCloseTo(expected, 6);
  });

  /** Verifies that a spark brightens during the ramp, then only fades, and never exceeds 1 */
  it('brightens over SPARK_RAMP and then fades steadily', () => {
    let prev = 0;
    let peakAt = -1;
    for (let k = 1; k < 160; k++) {
      const t = (k * BURST_TIME) / 160;
      const a = sparkAt(BURST, 4, open + t).alpha;
      expect(a).toBeGreaterThan(0);
      expect(a).toBeLessThanOrEqual(1);
      if (t <= SPARK_RAMP - 0.011) expect(a).toBeGreaterThan(prev);
      if (t >= SPARK_RAMP + 0.011) expect(a).toBeLessThan(prev);
      if (peakAt < 0 && t >= SPARK_RAMP + 0.011) peakAt = t;
      prev = a;
    }
    expect(peakAt).toBeGreaterThan(0);
  });

  /** Verifies that the spark brightness never jumps between two frames (WCAG 2.3.1) */
  it('changes spark brightness smoothly from opening to fade-out', () => {
    const step = 0.001;
    const maxStep = step / SPARK_RAMP;
    let prev = sparkAt(BURST, 11, open - 0.05).alpha;
    for (let k = 0; k <= Math.round((BURST_TIME + 0.1) / step); k++) {
      const a = sparkAt(BURST, 11, open - 0.05 + k * step).alpha;
      expect(Math.abs(a - prev)).toBeLessThanOrEqual(maxStep * 1.01 + 1e-9);
      prev = a;
    }
  });

  /** Verifies that a spark flies further out over its life, visible all along */
  it('moves outward over the life of the burst', () => {
    const i = 15;
    const [dx, , dz] = SPARK_DIRECTIONS[i];
    const horizontal = Math.hypot(dx, dz);
    let prevOut = -1;
    for (let k = 0; k < 40; k++) {
      const s = sparkAt(BURST, i, open + (k * BURST_TIME) / 40);
      if (k > 0) expect(s.alpha).toBeGreaterThan(0);
      const out = Math.hypot(s.x - BURST.x, s.z - BURST.z);
      expect(out).toBeGreaterThanOrEqual(prevOut);
      // Drag: never further than the burst speed allows.
      expect(out).toBeLessThan(BURST.speed * horizontal + TOL);
      prevOut = out;
    }
  });

  /** Verifies that gravity pulls the sparks below their drag-only path */
  it('makes sparks fall under gravity', () => {
    const i = 30;
    const t = 1;
    const s = sparkAt(BURST, i, open + t);
    const out = Math.hypot(s.x - BURST.x, s.z - BURST.z) / Math.hypot(SPARK_DIRECTIONS[i][0], SPARK_DIRECTIONS[i][2]);
    const dragOnlyY = BURST.y + SPARK_DIRECTIONS[i][1] * out;
    expect(s.y).toBeLessThan(dragOnlyY - 0.1);
  });

  /** Verifies that the spark index wraps around the SPARKS directions */
  it('wraps spark indexes modulo SPARKS', () => {
    const time = open + 0.4;
    expect(sparkAt(BURST, 3 + SPARKS, time)).toEqual(sparkAt(BURST, 3, time));
    expect(sparkAt(BURST, 3 + 2 * SPARKS, time)).toEqual(sparkAt(BURST, 3, time));
  });

  /** Verifies that negative spark indexes wrap onto valid directions instead of throwing */
  it.each([
    [-1, SPARKS - 1],
    [-SPARKS, 0],
    [-SPARKS - 3, SPARKS - 3],
    [-2 * SPARKS + 5, 5],
  ] as const)('maps the negative index %d onto spark %d', (negative, positive) => {
    const time = open + 0.4;
    expect(() => sparkAt(BURST, negative, time)).not.toThrow();
    expect(sparkAt(BURST, negative, time)).toEqual(sparkAt(BURST, positive, time));
    expect(sparkAt(BURST, negative, 1, true)).toEqual(sparkAt(BURST, positive, 1, true));
  });

  /** Verifies that different sparks of a burst fly in different directions */
  it('sends different sparks to different places', () => {
    const time = open + 0.5;
    expect(sparkAt(BURST, 0, time)).not.toEqual(sparkAt(BURST, 1, time));
  });

  /** Verifies that reduced motion freezes the burst open, its brightness set by stillAlpha */
  it.each([-10, 0, STILL_FADE / 2, 1, FIREWORKS_STILL_TIME - 0.1, FIREWORKS_STILL_TIME, open + BURST_TIME + 10, 1e9])(
    'freezes the burst open under reduced motion with alpha stillAlpha(time) (time %d)',
    (time) => {
      const s = sparkAt(BURST, 5, time, true);
      const ref = sparkAt(BURST, 5, 1, true);
      expect({ x: s.x, y: s.y, z: s.z }).toEqual({ x: ref.x, y: ref.y, z: ref.z });
      expect(s.alpha).toBe(stillAlpha(time));
    },
  );

  /** Verifies that the still bouquet is the same brightness for every spark and burst */
  it('lights every still spark of every burst equally at a given time', () => {
    const other: Burst = { ...BURST, x: -4, delay: 2.3, speed: 6 };
    for (const i of [0, 20, SPARKS - 1]) {
      expect(sparkAt(BURST, i, 1, true).alpha).toBe(STILL_PEAK);
      expect(sparkAt(other, i, 1, true).alpha).toBe(STILL_PEAK);
    }
  });

  /** Verifies that the still bouquet is a sphere: every spark at the same distance, no fall */
  it('draws the still bouquet as an open sphere around the burst point', () => {
    const radii = Array.from({ length: SPARKS }, (_, i) => {
      const s = sparkAt(BURST, i, 0, true);
      return Math.hypot(s.x - BURST.x, s.y - BURST.y, s.z - BURST.z);
    });
    const r0 = radii[0];
    expect(r0).toBeGreaterThan(0);
    expect(r0).toBeLessThan(BURST.speed);
    for (const r of radii) expect(r).toBeCloseTo(r0, 9);
  });

  /** Verifies that the still offset of each spark points along its own direction */
  it('opens each still spark along its own direction', () => {
    for (const i of [0, 17, SPARKS - 1]) {
      const s = sparkAt(BURST, i, 0, true);
      const v = [s.x - BURST.x, s.y - BURST.y, s.z - BURST.z];
      const len = Math.hypot(v[0], v[1], v[2]);
      const [dx, dy, dz] = SPARK_DIRECTIONS[i];
      expect(v[0] / len).toBeCloseTo(dx, 9);
      expect(v[1] / len).toBeCloseTo(dy, 9);
      expect(v[2] / len).toBeCloseTo(dz, 9);
    }
  });
});

describe('stillAlpha', () => {
  /** Verifies that the still bouquet is invisible before it starts and once it is over */
  it.each([0, -0.001, -10, -Infinity, FIREWORKS_STILL_TIME, FIREWORKS_STILL_TIME + 0.001, 100, Infinity])(
    'is 0 at time %d',
    (time) => {
      expect(stillAlpha(time)).toBe(0);
    },
  );

  /** Verifies that the bouquet fades in over STILL_FADE, holds at STILL_PEAK, then fades out */
  it.each([
    ['half the fade-in', STILL_FADE / 2, STILL_PEAK / 2],
    ['the end of the fade-in', STILL_FADE, STILL_PEAK],
    ['the middle', FIREWORKS_STILL_TIME / 2, STILL_PEAK],
    ['the start of the fade-out', FIREWORKS_STILL_TIME - STILL_FADE, STILL_PEAK],
    ['half the fade-out', FIREWORKS_STILL_TIME - STILL_FADE / 2, STILL_PEAK / 2],
  ] as const)('has the expected brightness at %s', (_label, time, expected) => {
    expect(stillAlpha(time)).toBeCloseTo(expected, 9);
  });

  /** Verifies that the fade-out mirrors the fade-in */
  it('fades out symmetrically to the fade-in', () => {
    for (const time of [0.05, 0.2, 0.4, 0.7]) {
      expect(stillAlpha(FIREWORKS_STILL_TIME - time)).toBeCloseTo(stillAlpha(time), 9);
    }
  });

  /** Verifies that the brightness stays within 0 and STILL_PEAK and never jumps (WCAG 2.3.1) */
  it('stays within 0..STILL_PEAK and changes smoothly over the whole bouquet', () => {
    const step = 0.001;
    const maxStep = (STILL_PEAK * step) / STILL_FADE;
    let prev = stillAlpha(-0.05);
    let peak = 0;
    for (let k = 0; k <= Math.round((FIREWORKS_STILL_TIME + 0.1) / step); k++) {
      const a = stillAlpha(-0.05 + k * step);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(STILL_PEAK);
      expect(Math.abs(a - prev)).toBeLessThanOrEqual(maxStep * 1.01 + 1e-9);
      peak = Math.max(peak, a);
      prev = a;
    }
    expect(peak).toBe(STILL_PEAK);
    expect(prev).toBe(0);
  });
});
