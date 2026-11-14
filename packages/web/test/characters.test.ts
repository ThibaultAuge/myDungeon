import { describe, expect, it } from 'vitest';
import type { AgentState, AgentView } from '@agent-office/shared';
import {
  CHARACTERS,
  CLIPS,
  KNEEL_POSE_TIME,
  MAX_CLIP_RATE,
  RUN_CLIP_SPEED,
  RUN_THRESHOLD,
  SPAWN_TIME_SCALE,
  WALK_CLIP_SPEED,
  characterFor,
  clipFor,
  type CharacterModel,
  type ClipInput,
} from '../src/scene/characters.ts';

const KINDS: AgentView['kind'][] = ['main', 'sub'];
const STATES: AgentState[] = ['working', 'waiting', 'done'];
const IDS = ['', 'a', 'agent-1', 'agent-2', 'sess_0f3c9a2b-sub-7', 'éà€ unicode id', 'x'.repeat(10_000)];

/** A still, waiting, ordinary figure: each test overrides only what it is about. */
const BASE: ClipInput = { moving: false, speed: 0, state: 'waiting', spawning: false, kneeling: false, reducedMotion: false };
const clip = (over: Partial<ClipInput>) => clipFor({ ...BASE, ...over });

/** Runs `fn` with a temporary skin list for a kind, restoring the real one afterwards. */
function withSkins(kind: AgentView['kind'], skins: string[], fn: () => void) {
  const table = CHARACTERS as Record<AgentView['kind'], readonly string[]>;
  const saved = table[kind];
  table[kind] = skins;
  try {
    fn();
  } finally {
    table[kind] = saved;
  }
}

// ---------------------------------------------------------------- constants

describe('character constants', () => {
  /** Verifies that every agent kind has at least one skin, each listed once */
  it.each(KINDS)('gives the %s kind at least one unique skin', (kind) => {
    expect(CHARACTERS[kind].length).toBeGreaterThan(0);
    expect(new Set(CHARACTERS[kind]).size).toBe(CHARACTERS[kind].length);
  });

  /** Verifies that the clip list has no duplicate name */
  it('lists each clip once', () => {
    expect(new Set(CLIPS).size).toBe(CLIPS.length);
  });

  /** Verifies that speeds and rates are positive and consistent with each other */
  it('has positive, consistent speeds and rates', () => {
    expect(WALK_CLIP_SPEED).toBeGreaterThan(0);
    expect(RUN_CLIP_SPEED).toBeGreaterThan(WALK_CLIP_SPEED);
    expect(RUN_THRESHOLD).toBeGreaterThan(WALK_CLIP_SPEED);
    expect(MAX_CLIP_RATE).toBeGreaterThan(1);
    expect(SPAWN_TIME_SCALE).toBeGreaterThan(0);
    expect(KNEEL_POSE_TIME).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- characterFor

describe('characterFor', () => {
  /** Verifies that the same kind and id always give the same skin */
  it.each(KINDS)('is deterministic for the %s kind', (kind) => {
    for (const id of IDS) expect(characterFor(kind, id)).toBe(characterFor(kind, id));
  });

  /** Verifies that the chosen skin always belongs to the agent kind's list */
  it.each(KINDS)('picks a skin from the %s list, including for empty and huge ids', (kind) => {
    for (const id of IDS) expect(CHARACTERS[kind]).toContain(characterFor(kind, id));
  });

  /** Verifies that the main agent is a Knight and subagents are hooded rogues today */
  it('maps main to Knight and sub to Rogue_Hooded with the current lists', () => {
    for (const id of IDS) {
      expect(characterFor('main', id)).toBe<CharacterModel>('Knight');
      expect(characterFor('sub', id)).toBe<CharacterModel>('Rogue_Hooded');
    }
  });

  /** Verifies that a longer skin list is used: picks stay in it, stable, and vary by id */
  it('spreads agents over every skin once a list grows', () => {
    const skins = ['Knight', 'Rogue_Hooded', 'Mage'];
    withSkins('sub', skins, () => {
      const ids = Array.from({ length: 60 }, (_, i) => `agent-${i}`);
      const picks = ids.map((id) => characterFor('sub', id));
      for (const p of picks) expect(skins).toContain(p);
      expect(new Set(picks).size).toBe(skins.length);
      expect(ids.map((id) => characterFor('sub', id))).toEqual(picks);
    });
  });

  /** Verifies that adding skins to one kind never changes the other kind's pick */
  it('keeps kinds independent', () => {
    const before = IDS.map((id) => characterFor('main', id));
    withSkins('sub', ['Rogue_Hooded', 'Mage'], () => {
      expect(IDS.map((id) => characterFor('main', id))).toEqual(before);
    });
  });
});

// ---------------------------------------------------------------- clipFor

describe('clipFor', () => {
  // ---- spawning

  /** Verifies that a spawning subagent plays Spawn_Ground once, sped up */
  it('plays Spawn_Ground once at SPAWN_TIME_SCALE while spawning', () => {
    expect(clip({ spawning: true })).toEqual({
      name: 'Spawn_Ground',
      loop: false,
      timeScale: SPAWN_TIME_SCALE,
      frozen: false,
      frozenAt: 0,
    });
  });

  /** Verifies that spawning wins over moving, kneeling and every state */
  it.each(STATES)('lets spawning win over moving and kneeling in state %s', (state) => {
    expect(clip({ spawning: true, moving: true, speed: 5, kneeling: true, state }).name).toBe('Spawn_Ground');
  });

  /** Verifies that with reduced motion a spawning figure holds a still pose instead */
  it('skips the spawn animation under reduced motion', () => {
    expect(clip({ spawning: true, reducedMotion: true })).toEqual({
      name: 'Idle_A',
      loop: false,
      timeScale: 0,
      frozen: true,
      frozenAt: 0,
    });
  });

  /** Verifies that a reduced-motion spawning figure that moves holds Idle_A, not a walk */
  it('holds Idle_A for a reduced-motion figure spawning while moving', () => {
    const c = clip({ spawning: true, reducedMotion: true, moving: true, speed: 3 });
    expect(c.name).toBe('Idle_A');
    expect(c.frozen).toBe(true);
  });

  // ---- moving

  /** Verifies that a moving figure under reduced motion holds Idle_A at time 0 */
  it.each([0, WALK_CLIP_SPEED, RUN_THRESHOLD, 100])('holds Idle_A when moving at %d with reduced motion', (speed) => {
    expect(clip({ moving: true, speed, reducedMotion: true })).toEqual({
      name: 'Idle_A',
      loop: false,
      timeScale: 0,
      frozen: true,
      frozenAt: 0,
    });
  });

  /** Verifies that walking at the clip's own speed plays Walking_A looped at rate 1 */
  it('walks at rate 1 at WALK_CLIP_SPEED', () => {
    expect(WALK_CLIP_SPEED).toBeLessThan(RUN_THRESHOLD);
    expect(clip({ moving: true, speed: WALK_CLIP_SPEED })).toEqual({
      name: 'Walking_A',
      loop: true,
      timeScale: 1,
      frozen: false,
      frozenAt: 0,
    });
  });

  /** Verifies that the walk rate follows the speed between the floor and the cap */
  it('scales the walk rate with the speed', () => {
    const c = clip({ moving: true, speed: WALK_CLIP_SPEED * 1.5 });
    expect(c.name).toBe('Walking_A');
    expect(c.timeScale).toBeCloseTo(1.5, 9);
  });

  /** Verifies that a very slow walk never plays below half speed */
  it.each([0, WALK_CLIP_SPEED * 0.1, WALK_CLIP_SPEED * 0.25])('floors the walk rate at 0.5 for speed %d', (speed) => {
    const c = clip({ moving: true, speed });
    expect(c.name).toBe('Walking_A');
    expect(c.timeScale).toBe(0.5);
  });

  /** Verifies that the walk rate is exactly 0.5 at the floor boundary */
  it('reaches the walk floor exactly at half the clip speed', () => {
    expect(clip({ moving: true, speed: WALK_CLIP_SPEED * 0.5 }).timeScale).toBeCloseTo(0.5, 9);
  });

  /** Verifies that a negative speed (stale value) never plays the walk backwards */
  it('keeps a positive walk rate for a negative speed', () => {
    const c = clip({ moving: true, speed: -1 });
    expect(c.name).toBe('Walking_A');
    expect(c.timeScale).toBe(0.5);
  });

  /** Verifies that a fast walk below the run threshold is capped at MAX_CLIP_RATE */
  it('caps the walk rate at MAX_CLIP_RATE below the run threshold', () => {
    const speed = WALK_CLIP_SPEED * MAX_CLIP_RATE * 1.05;
    expect(speed).toBeLessThan(RUN_THRESHOLD);
    const c = clip({ moving: true, speed });
    expect(c.name).toBe('Walking_A');
    expect(c.timeScale).toBe(MAX_CLIP_RATE);
  });

  /** Verifies that just below RUN_THRESHOLD the figure still walks, within the cap */
  it('walks just below RUN_THRESHOLD', () => {
    const c = clip({ moving: true, speed: RUN_THRESHOLD - 1e-9 });
    expect(c.name).toBe('Walking_A');
    expect(c.timeScale).toBeLessThanOrEqual(MAX_CLIP_RATE);
    expect(c.timeScale).toBeGreaterThanOrEqual(0.5);
  });

  /** Verifies that exactly at RUN_THRESHOLD the figure runs, feet matched to the speed */
  it('runs exactly at RUN_THRESHOLD', () => {
    const c = clip({ moving: true, speed: RUN_THRESHOLD });
    expect(c).toEqual({ name: 'Running_A', loop: true, timeScale: c.timeScale, frozen: false, frozenAt: 0 });
    expect(c.timeScale).toBeCloseTo(RUN_THRESHOLD / RUN_CLIP_SPEED, 9);
  });

  /** Verifies that running at the run clip's own speed plays it at rate 1 */
  it('runs at rate 1 at RUN_CLIP_SPEED', () => {
    expect(RUN_CLIP_SPEED).toBeGreaterThanOrEqual(RUN_THRESHOLD);
    const c = clip({ moving: true, speed: RUN_CLIP_SPEED });
    expect(c.name).toBe('Running_A');
    expect(c.timeScale).toBeCloseTo(1, 9);
  });

  /** Verifies that the run rate reaches exactly MAX_CLIP_RATE at its boundary speed */
  it('reaches the run cap at RUN_CLIP_SPEED * MAX_CLIP_RATE', () => {
    const c = clip({ moving: true, speed: RUN_CLIP_SPEED * MAX_CLIP_RATE });
    expect(c.name).toBe('Running_A');
    expect(c.timeScale).toBeCloseTo(MAX_CLIP_RATE, 9);
  });

  /** Verifies that a very fast figure runs no faster than MAX_CLIP_RATE */
  it.each([RUN_CLIP_SPEED * MAX_CLIP_RATE * 2, 1e6, Infinity])('caps the run rate for speed %d', (speed) => {
    const c = clip({ moving: true, speed });
    expect(c.name).toBe('Running_A');
    expect(c.timeScale).toBe(MAX_CLIP_RATE);
  });

  /** Verifies that moving wins over kneeling and every agent state */
  it.each(STATES)('lets moving win over kneeling in state %s', (state) => {
    expect(clip({ moving: true, speed: WALK_CLIP_SPEED, kneeling: true, state }).name).toBe('Walking_A');
    expect(clip({ moving: true, speed: RUN_CLIP_SPEED, kneeling: true, state }).name).toBe('Running_A');
  });

  /** Verifies that a non-zero speed alone does not make a still figure walk */
  it('ignores the speed when the figure is not moving', () => {
    expect(clip({ moving: false, speed: 5, state: 'working' }).name).toBe('Interact');
  });

  // ---- kneeling

  /** Verifies that a kneeling figure holds PickUp at the crouched pose time */
  it('holds PickUp at KNEEL_POSE_TIME when kneeling', () => {
    expect(clip({ kneeling: true })).toEqual({
      name: 'PickUp',
      loop: false,
      timeScale: 0,
      frozen: true,
      frozenAt: KNEEL_POSE_TIME,
    });
  });

  /** Verifies that kneeling wins over every state and over reduced motion */
  it.each(STATES)('lets kneeling win in state %s, with or without reduced motion', (state) => {
    for (const reducedMotion of [false, true]) {
      const c = clip({ kneeling: true, state, reducedMotion });
      expect(c.name).toBe('PickUp');
      expect(c.frozenAt).toBe(KNEEL_POSE_TIME);
    }
  });

  // ---- still states

  /** Verifies that a finished agent holds Idle_A still */
  it('holds Idle_A at 0 when done', () => {
    expect(clip({ state: 'done' })).toEqual({ name: 'Idle_A', loop: false, timeScale: 0, frozen: true, frozenAt: 0 });
  });

  /** Verifies that reduced motion freezes working and waiting figures on Idle_A */
  it.each(['working', 'waiting'] as AgentState[])('holds Idle_A when %s under reduced motion', (state) => {
    expect(clip({ state, reducedMotion: true })).toEqual({
      name: 'Idle_A',
      loop: false,
      timeScale: 0,
      frozen: true,
      frozenAt: 0,
    });
  });

  /** Verifies that a working agent loops Interact at normal speed */
  it('loops Interact when working', () => {
    expect(clip({ state: 'working' })).toEqual({ name: 'Interact', loop: true, timeScale: 1, frozen: false, frozenAt: 0 });
  });

  /** Verifies that a waiting agent loops Idle_B at normal speed */
  it('loops Idle_B when waiting', () => {
    expect(clip({ state: 'waiting' })).toEqual({ name: 'Idle_B', loop: true, timeScale: 1, frozen: false, frozenAt: 0 });
  });

  // ---- invariants over every combination

  const SPEEDS = [-1, 0, WALK_CLIP_SPEED, RUN_THRESHOLD - 1e-9, RUN_THRESHOLD, RUN_CLIP_SPEED, 100];
  const ALL: ClipInput[] = [];
  for (const moving of [false, true])
    for (const spawning of [false, true])
      for (const kneeling of [false, true])
        for (const reducedMotion of [false, true])
          for (const state of STATES)
            for (const speed of SPEEDS) ALL.push({ moving, spawning, kneeling, reducedMotion, state, speed });

  /** Verifies that every returned clip name is one of the known CLIPS */
  it('always returns a clip from CLIPS', () => {
    for (const input of ALL) expect(CLIPS, JSON.stringify(input)).toContain(clipFor(input).name);
  });

  /** Verifies that a frozen clip has rate 0 and no loop, a playing one a positive capped rate */
  it('keeps frozen and playing clips consistent', () => {
    const cap = Math.max(MAX_CLIP_RATE, SPAWN_TIME_SCALE);
    for (const input of ALL) {
      const c = clipFor(input);
      const at = JSON.stringify(input);
      if (c.frozen) {
        expect(c.timeScale, at).toBe(0);
        expect(c.loop, at).toBe(false);
        expect(c.frozenAt, at).toBeGreaterThanOrEqual(0);
      } else {
        expect(c.timeScale, at).toBeGreaterThan(0);
        expect(c.timeScale, at).toBeLessThanOrEqual(cap);
        expect(c.frozenAt, at).toBe(0);
      }
    }
  });

  /** Verifies that reduced motion never animates the limbs, whatever the input */
  it('always freezes the figure under reduced motion', () => {
    for (const input of ALL.filter((i) => i.reducedMotion)) {
      expect(clipFor(input).frozen, JSON.stringify(input)).toBe(true);
    }
  });

  /** Verifies that only Spawn_Ground plays once; every other playing clip loops */
  it('plays only the spawn clip without looping', () => {
    for (const input of ALL) {
      const c = clipFor(input);
      if (!c.frozen) expect(c.loop, JSON.stringify(input)).toBe(c.name !== 'Spawn_Ground');
    }
  });

  /** Verifies that the input is left untouched and the result is deterministic */
  it('is pure', () => {
    const input: ClipInput = { ...BASE, moving: true, speed: 2 };
    const copy = { ...input };
    const a = clipFor(input);
    expect(input).toEqual(copy);
    expect(clipFor(input)).toEqual(a);
  });
});
