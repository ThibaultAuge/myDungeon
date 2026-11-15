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
    const autel = target.agentOffice!.autel as (stage?: unknown, id?: unknown) => string[];
    return { target, log, off, autel };
  }

  /** Verifies the command targets the given id first, then the selection, then the altar */
  it('picks its targets', () => {
    const { autel } = setup('sel', ['q1', 'q2']);
    expect(autel('toile', 'given')).toEqual(['given']);
    expect(forcedAltarStage('given')).toBe('webbed');
    expect(autel('assis')).toEqual(['sel']);
    expect(forcedAltarStage('sel')).toBe('sitting');
    const none = setup(null, ['q1', 'q2']);
    expect(none.autel('endormi')).toEqual(['q1', 'q2']);
    expect(forcedAltarStage('q2')).toBe('sleeping');
  });

  /** Verifies a release with no id clears every forced stage, with an id only that one */
  it('releases', () => {
    const { autel } = setup(null, ['q1', 'q2']);
    autel('toile');
    autel(null, 'q1');
    expect(forcedAltarStage('q1')).toBeUndefined();
    expect(forcedAltarStage('q2')).toBe('webbed');
    expect(autel()).toEqual(['q2']);
    expect(forcedAltarStage('q2')).toBeUndefined();
  });

  /** Verifies bad arguments change nothing and say why */
  it('refuses bad arguments', () => {
    const { autel, log } = setup('sel');
    expect(autel('dormir')).toEqual([]);
    expect(autel('toile', 42)).toEqual([]);
    expect(forcedAltarStage('sel')).toBeUndefined();
    expect(log).toHaveBeenCalledTimes(2);
  });

  /** Verifies nothing to target is reported */
  it('reports when no agent is targeted', () => {
    const { autel, log } = setup(null, []);
    expect(autel('toile')).toEqual([]);
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
});
