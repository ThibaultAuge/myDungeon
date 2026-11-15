import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentView } from '@agent-office/shared';
import {
  ALTAR_STAGE_MS,
  ALTAR_STAGES,
  PACE_AMPLITUDE,
  PACE_PERIOD,
  altarForceVersion,
  altarHeading,
  altarStage,
  clearForcedAltarStages,
  forceAltarStage,
  forcedAltarStage,
  installAltarCommand,
  isAsleep,
  onAltarForce,
  paceAxis,
  paceHeading,
  paceOffset,
  paceSeed,
  parseStageArg,
  shownAltarStage,
} from '../src/scene/altarWait.ts';

const NOW = 1_700_000_000_000;
type Waiter = Pick<AgentView, 'id' | 'state' | 'waitReason' | 'room' | 'since'>;
const waiter = (waited: number, patch: Partial<Waiter> = {}): Waiter => ({
  id: 'a1',
  state: 'waiting',
  waitReason: 'permission',
  room: 'autel',
  since: NOW - waited,
  ...patch,
});

afterEach(() => clearForcedAltarStages());

describe('altarStage', () => {
  /** Verifies the user's thresholds: 1, 3, 5 and 10 minutes */
  it('pins the stage thresholds', () => {
    expect(ALTAR_STAGE_MS).toEqual({ pacing: 60_000, sitting: 180_000, sleeping: 300_000, webbed: 600_000 });
    expect(Object.isFrozen(ALTAR_STAGE_MS)).toBe(true);
  });

  /** Verifies each stage starts exactly at its threshold and not one millisecond before */
  it.each([
    [0, 'calm'],
    [59_999, 'calm'],
    [60_000, 'pacing'],
    [179_999, 'pacing'],
    [180_000, 'sitting'],
    [299_999, 'sitting'],
    [300_000, 'sleeping'],
    [599_999, 'sleeping'],
    [600_000, 'webbed'],
    [24 * 3_600_000, 'webbed'],
  ] as const)('after %i ms of wait gives %s', (waited, stage) => {
    expect(altarStage(waiter(waited), NOW)).toBe(stage);
  });

  /** Verifies the three altar requests degrade (user decision), not a wait for the next prompt */
  it.each(['permission', 'question', 'error'] as const)('degrades a %s wait', (reason) => {
    expect(altarStage(waiter(600_000, { waitReason: reason }), NOW)).toBe('webbed');
  });

  /** Verifies that only an agent waiting at the altar degrades */
  it.each([
    ['a prompt wait', { waitReason: 'prompt' as const }],
    ['no wait reason', { waitReason: undefined }],
    ['a working agent', { state: 'working' as const }],
    ['a finished agent', { state: 'done' as const }],
    ['an agent outside the altar', { room: 'taverne' as const }],
  ])('keeps %s calm', (_, patch) => {
    expect(altarStage(waiter(600_000, patch), NOW)).toBe('calm');
  });

  /** Verifies a client clock behind the server's, or a broken timestamp, counts as no wait */
  it.each([-5_000, Number.NaN])('treats a waited time of %s as calm', (waited) => {
    expect(altarStage(waiter(waited), NOW)).toBe('calm');
  });

  /** Verifies an infinite wait from a broken timestamp counts as no wait, not as webbed */
  it.each([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('treats a since of %s as calm', (since) => {
    expect(altarStage(waiter(0, { since }), NOW)).toBe('calm');
  });

  /** Verifies the stage only grows as the wait goes on */
  it('never goes back to an earlier stage as time passes', () => {
    const agent = waiter(0);
    let last = 0;
    for (let t = 0; t <= 15 * 60_000; t += 7_000) {
      const rank = ALTAR_STAGES.indexOf(altarStage(agent, NOW + t));
      expect(rank, `at ${t} ms`).toBeGreaterThanOrEqual(last);
      last = rank;
    }
    expect(last).toBe(ALTAR_STAGES.length - 1);
  });

  /** Verifies the asleep stages */
  it('says which stages sleep', () => {
    expect(ALTAR_STAGES.filter(isAsleep)).toEqual(['sleeping', 'webbed']);
  });
});

describe('pacing', () => {
  /** Verifies the pacing stays within its amplitude and starts from the place */
  it('stays within the amplitude around the place', () => {
    expect(paceOffset(0).offset).toBe(0);
    for (let t = 0; t < 2 * PACE_PERIOD; t += 0.05) {
      expect(Math.abs(paceOffset(t).offset)).toBeLessThanOrEqual(PACE_AMPLITUDE + 1e-9);
    }
    expect(paceOffset(PACE_PERIOD / 4).offset).toBeCloseTo(PACE_AMPLITUDE);
    expect(paceOffset((3 * PACE_PERIOD) / 4).offset).toBeCloseTo(-PACE_AMPLITUDE);
  });

  /** Verifies the walking direction matches the way the offset changes */
  it('walks the way the offset moves', () => {
    for (let t = 0.03; t < PACE_PERIOD; t += 0.1) {
      const before = paceOffset(t - 0.01).offset;
      const after = paceOffset(t + 0.01).offset;
      if (Math.abs(after - before) < 1e-6) continue;
      expect(paceOffset(t).dir).toBe(after > before ? 1 : -1);
    }
  });

  /** Verifies a non-finite time does not break the figure */
  it('falls back to the start for a non-finite time', () => {
    expect(paceOffset(Number.NaN)).toEqual({ offset: 0, dir: 1 });
    expect(paceOffset(Number.POSITIVE_INFINITY)).toEqual({ offset: 0, dir: 1 });
  });

  /** Verifies the pacing axis is perpendicular to the facing and the heading follows it */
  it.each([0, Math.PI / 2, Math.PI, -0.7, 2.3])('paces sideways from facing %f', (facing) => {
    const axis = paceAxis(facing);
    expect(Math.hypot(axis.x, axis.z)).toBeCloseTo(1);
    // three.js: rotation.y = facing looks toward (sin, cos).
    expect(axis.x * Math.sin(facing) + axis.z * Math.cos(facing)).toBeCloseTo(0);
    for (const dir of [1, -1] as const) {
      const h = paceHeading(facing, dir);
      expect(Math.sin(h)).toBeCloseTo(dir * axis.x);
      expect(Math.cos(h)).toBeCloseTo(dir * axis.z);
    }
  });

  /** Verifies every agent gets its own stable phase within one period */
  it('gives each agent a stable phase', () => {
    const seeds = ['a', 'b', 's1#main', 'agent-42', ''].map(paceSeed);
    for (const s of seeds) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(PACE_PERIOD);
    }
    expect(paceSeed('agent-42')).toBe(paceSeed('agent-42'));
    expect(new Set(seeds).size).toBe(seeds.length);
  });
});

describe('altarHeading', () => {
  /** Verifies pacing faces its walk, sitting turns its back to the altar, the rest face it */
  it('faces the right way for each stage', () => {
    const facing = 0.4;
    expect(altarHeading('pacing', facing, 1)).toBe(paceHeading(facing, paceOffset(1).dir));
    expect(altarHeading('sitting', facing, 1)).toBeCloseTo(facing + Math.PI);
    for (const stage of ['calm', 'sleeping', 'webbed'] as const) expect(altarHeading(stage, facing, 1)).toBe(facing);
  });
});

describe('forced stages', () => {
  /** Verifies a forced stage wins over the wait and is released by null */
  it('forces and releases a stage', () => {
    const agent = waiter(0, { id: 'forced-1' });
    expect(shownAltarStage(agent, NOW)).toBe('calm');
    forceAltarStage('forced-1', 'webbed');
    expect(forcedAltarStage('forced-1')).toBe('webbed');
    expect(shownAltarStage(agent, NOW)).toBe('webbed');
    // Purely visual: it applies whatever the agent's state.
    expect(shownAltarStage({ ...agent, state: 'working', room: 'atelier' }, NOW)).toBe('webbed');
    forceAltarStage('forced-1', null);
    expect(forcedAltarStage('forced-1')).toBeUndefined();
    expect(shownAltarStage(agent, NOW)).toBe('calm');
  });

  /** Verifies watchers and the snapshot version change only on real changes */
  it('notifies only on a change', () => {
    const watcher = vi.fn();
    const off = onAltarForce(watcher);
    const v0 = altarForceVersion();
    forceAltarStage('forced-2', 'sitting');
    forceAltarStage('forced-2', 'sitting');
    forceAltarStage('forced-3', null);
    expect(watcher).toHaveBeenCalledTimes(1);
    expect(altarForceVersion()).toBe(v0 + 1);
    clearForcedAltarStages();
    clearForcedAltarStages();
    expect(watcher).toHaveBeenCalledTimes(2);
    off();
    forceAltarStage('forced-2', 'pacing');
    expect(watcher).toHaveBeenCalledTimes(2);
  });

  /** Verifies switching a forced stage to another one notifies and is shown */
  it('notifies when a forced stage changes to another stage', () => {
    const watcher = vi.fn();
    const off = onAltarForce(watcher);
    forceAltarStage('forced-4', 'pacing');
    forceAltarStage('forced-4', 'sleeping');
    expect(watcher).toHaveBeenCalledTimes(2);
    expect(shownAltarStage(waiter(0, { id: 'forced-4' }), NOW)).toBe('sleeping');
    off();
  });

  /** Verifies a forced stage only applies to its own agent */
  it('keeps forced stages per agent', () => {
    forceAltarStage('forced-5', 'webbed');
    expect(shownAltarStage(waiter(0, { id: 'other' }), NOW)).toBe('calm');
    expect(shownAltarStage(waiter(200_000, { id: 'other' }), NOW)).toBe('sitting');
  });

  /** Verifies a watcher that unsubscribes while notified does not stop the others */
  it('still notifies every watcher when one unsubscribes during the notification', () => {
    const second = vi.fn();
    let offFirst = () => {};
    const first = vi.fn(() => offFirst());
    offFirst = onAltarForce(first);
    const offSecond = onAltarForce(second);
    forceAltarStage('forced-6', 'sitting');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    forceAltarStage('forced-6', 'pacing');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    offSecond();
  });
});

describe('parseStageArg', () => {
  /** Verifies the French names, the code ids, case and spaces */
  it.each([
    ['calme', 'calm'],
    ['cent-pas', 'pacing'],
    ['assis', 'sitting'],
    ['endormi', 'sleeping'],
    ['toile', 'webbed'],
    [' Toile ', 'webbed'],
    ['WEBBED', 'webbed'],
    ['pacing', 'pacing'],
  ] as const)('reads %j as %s', (arg, stage) => {
    expect(parseStageArg(arg)).toBe(stage);
  });

  /** Verifies null and undefined release */
  it.each([null, undefined])('reads %s as a release', (arg) => {
    expect(parseStageArg(arg)).toBeNull();
  });

  /** Verifies anything else is refused, prototype keys included */
  it.each(['dormir', '', 'toString', '__proto__', 3, {}, true])('refuses %j', (arg) => {
    expect(parseStageArg(arg)).toBeUndefined();
  });
});

describe('installAltarCommand', () => {
  function setup(selected: string | null, atAltar: string[] = []) {
    const target: { agentOffice?: Record<string, unknown> } = {};
    const log = vi.fn();
    const off = installAltarCommand(target, { selected: () => selected, atAltar: () => atAltar, log });
    const autel = target.agentOffice!.autel as (stage?: unknown, id?: unknown) => boolean;
    return { target, log, off, autel };
  }

  /** Verifies the command targets the given id first, then the selection, then the altar */
  it('picks its targets', () => {
    const { autel } = setup('sel', ['q1', 'q2']);
    expect(autel('toile', 'given')).toBe(true);
    expect(forcedAltarStage('given')).toBe('webbed');
    expect(autel('assis')).toBe(true);
    expect(forcedAltarStage('sel')).toBe('sitting');
    const none = setup(null, ['q1', 'q2']);
    expect(none.autel('endormi')).toBe(true);
    expect(forcedAltarStage('q1')).toBe('sleeping');
    expect(forcedAltarStage('q2')).toBe('sleeping');
  });

  /** Verifies a release with no id clears every forced stage, with an id only that one */
  it('releases', () => {
    const { autel } = setup(null, ['q1', 'q2']);
    autel('toile');
    autel(null, 'q1');
    expect(forcedAltarStage('q1')).toBeUndefined();
    expect(forcedAltarStage('q2')).toBe('webbed');
    expect(autel()).toBe(true);
    expect(forcedAltarStage('q2')).toBeUndefined();
  });

  /** Verifies bad arguments change nothing and say why */
  it('refuses bad arguments', () => {
    const { autel, log } = setup('sel');
    expect(autel('dormir')).toBe(false);
    expect(autel('toile', 42)).toBe(false);
    expect(forcedAltarStage('sel')).toBeUndefined();
    expect(log).toHaveBeenCalledTimes(2);
  });

  /** Verifies the selection is the only target, the agents at the altar untouched */
  it('forces only the selected agent when one is selected', () => {
    const { autel } = setup('sel', ['q1']);
    expect(autel('cent-pas')).toBe(true);
    expect(forcedAltarStage('sel')).toBe('pacing');
    expect(forcedAltarStage('q1')).toBeUndefined();
  });

  /** Verifies a release with no id clears every forced stage, even with a selection */
  it('releases every forced stage despite a selection', () => {
    forceAltarStage('elsewhere', 'webbed');
    const { autel } = setup('sel');
    autel('assis');
    expect(autel(null)).toBe(true);
    expect(forcedAltarStage('sel')).toBeUndefined();
    expect(forcedAltarStage('elsewhere')).toBeUndefined();
  });

  /** Verifies releasing when nothing is forced returns false and logs it */
  it('returns false when there is nothing to release', () => {
    const { autel, log } = setup('sel', ['q1']);
    expect(autel()).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('released 0'));
  });

  /** Verifies an unknown stage changes nothing even with a valid agent id */
  it('refuses an unknown stage given with an agent id', () => {
    const { autel } = setup(null);
    expect(autel('dormir', 'given')).toBe(false);
    expect(forcedAltarStage('given')).toBeUndefined();
  });

  /** Verifies a release by id leaves the other forced agents alone */
  it('releases one agent by id without touching the selection', () => {
    const { autel } = setup('sel');
    autel('toile');
    forceAltarStage('given', 'sitting');
    expect(autel(null, 'given')).toBe(true);
    expect(forcedAltarStage('given')).toBeUndefined();
    expect(forcedAltarStage('sel')).toBe('webbed');
  });

  /** Verifies nothing to target is reported */
  it('reports when no agent is targeted', () => {
    const { autel, log } = setup(null, []);
    expect(autel('toile')).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('no agent'));
  });

  /** Verifies the other gags' commands survive install and uninstall */
  it('shares the agentOffice namespace', () => {
    const target: { agentOffice?: Record<string, unknown> } = { agentOffice: { potion: 'keep' } };
    const off = installAltarCommand(target, { selected: () => null, atAltar: () => [], log: () => {} });
    expect(target.agentOffice).toMatchObject({ potion: 'keep', autel: expect.any(Function) });
    off();
    expect(target.agentOffice).toEqual({ potion: 'keep' });
  });

  /** Verifies an uninstall never removes a newer command installed after it */
  it('leaves a newer command in place', () => {
    const target: { agentOffice?: Record<string, unknown> } = {};
    const deps = { selected: () => null, atAltar: () => [], log: () => {} };
    const offOld = installAltarCommand(target, deps);
    installAltarCommand(target, deps);
    const newer = target.agentOffice!.autel;
    offOld();
    expect(target.agentOffice!.autel).toBe(newer);
  });

  /** Verifies a release of an agent with nothing forced reports false */
  it('reports a release where nothing was forced as false', () => {
    const target: { agentOffice?: Record<string, unknown> } = {};
    const log = vi.fn();
    installAltarCommand(target, { selected: () => null, atAltar: () => [], log });
    const autel = target.agentOffice!.autel as (stage?: unknown, id?: unknown) => boolean;
    expect(autel(null, 'never-forced')).toBe(false);
    expect(log).toHaveBeenCalledWith('autel: nothing to release');
    expect(autel('toile', 'never-forced')).toBe(true);
    expect(autel('toile', 'never-forced')).toBe(true);
    expect(autel(null, 'never-forced')).toBe(true);
  });

  /** Verifies the uninstall releases every forced stage: they never outlive the scene */
  it('releases the forced stages on uninstall', () => {
    const target: { agentOffice?: Record<string, unknown> } = {};
    const off = installAltarCommand(target, { selected: () => null, atAltar: () => [], log: () => {} });
    forceAltarStage('scene-1', 'webbed');
    off();
    expect(forcedAltarStage('scene-1')).toBeUndefined();
  });

  /** Verifies a non-object namespace is replaced, as the potion command does */
  it.each([1, 'x', null, true])('replaces a %j namespace with an object', (value) => {
    const target: { agentOffice?: unknown } = { agentOffice: value };
    installAltarCommand(target, { selected: () => null, atAltar: () => [], log: () => {} });
    expect(typeof (target.agentOffice as Record<string, unknown>).autel).toBe('function');
  });
});
