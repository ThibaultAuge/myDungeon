import { describe, expect, it } from 'vitest';
import type { AgentState } from '@agent-office/shared';
import {
  CLIPS,
  DEATH_CLIP_TIME,
  HIT_CLIP_TIME,
  SKELETON_LOOKS,
  SPAWN_CLIP_TIME,
  USE_ITEM_CLIP_TIME,
  hold,
  play,
  type ClipChoice,
  KNEEL_POSE_TIME,
  LOOKS,
  PACE_CLIP_RATE,
  SIT_CLIP,
  SIT_POSE_TIME,
  SLEEP_CLIP,
  MAIN_BODY,
  MAX_CLIP_RATE,
  PROP_GRIP,
  RUN_CLIP_SPEED,
  RUN_THRESHOLD,
  SPAWN_TIME_SCALE,
  SUB_BODIES,
  WALK_CLIP_SPEED,
  clipFor,
  gripFor,
  lookFor,
  type CharacterModel,
  type ClipInput,
  type Grip,
  type Look,
  type PropRef,
} from '../src/scene/characters.ts';
import { HIT_CLIPS } from '../src/scene/slap.ts';

const STATES: AgentState[] = ['working', 'waiting', 'done'];
/** Agent types that are not in LOOKS, including edge cases (empty, unicode, huge). */
const UNKNOWN_TYPES = ['', 'a', 'my-custom-agent', 'Some_Plugin:Reviewer', 'éà€ unicode type', 'x'.repeat(10_000)];
/** Object.prototype members a naive `LOOKS[key]` lookup would hit. */
const PROTO_KEYS = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', '__defineGetter__'];
const NEUTRAL: Grip = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };

/** A still, waiting, ordinary figure: each test overrides only what it is about. */
const BASE: ClipInput = { moving: false, speed: 0, state: 'waiting', spawning: false, kneeling: false, reducedMotion: false };
const clip = (over: Partial<ClipInput>) => clipFor({ ...BASE, ...over });

const LOOK_ENTRIES = Object.entries(LOOKS);
/** Every prop held by some LOOKS entry, in either hand. */
const HELD: PropRef[] = Object.values(LOOKS).flatMap((l) => [l.right, l.left].filter((p): p is PropRef => !!p));

/** True when a look is a bare fallback: a sub body and nothing in the hands. */
function expectFallback(look: Look, label: string) {
  expect(SUB_BODIES, label).toContain(look.body);
  expect(Object.keys(look), label).toEqual(['body']);
}

// ---------------------------------------------------------------- constants

describe('character constants', () => {
  /** Verifies that the sub body list is non-empty, unique, and never holds the main body */
  it('lists unique sub bodies, without the main body', () => {
    expect(SUB_BODIES.length).toBeGreaterThan(0);
    expect(new Set(SUB_BODIES).size).toBe(SUB_BODIES.length);
    expect(SUB_BODIES).not.toContain(MAIN_BODY);
    expect(MAIN_BODY).toBe<CharacterModel>('Knight');
  });

  /** Verifies that every LOOKS key is lower case, as lookFor lower-cases the type */
  it('keys LOOKS in lower case only', () => {
    expect(LOOK_ENTRIES.length).toBeGreaterThan(0);
    expect(Object.keys(LOOKS).filter((k) => k !== k.toLowerCase())).toEqual([]);
  });

  /** Verifies that every LOOKS body is a sub body, so no subagent looks like the main agent */
  it('gives every LOOKS entry a sub body, never the main one', () => {
    for (const [type, look] of LOOK_ENTRIES) {
      expect(SUB_BODIES, type).toContain(look.body);
      expect(look.body, type).not.toBe(MAIN_BODY);
    }
  });

  /** Verifies that every held prop names a known pack and a non-empty model */
  it('only holds props from the adventurers_props or tools pack', () => {
    expect(HELD.length).toBeGreaterThan(0);
    for (const p of HELD) {
      expect(['adventurers_props', 'tools']).toContain(p.pack);
      expect(p.model.length).toBeGreaterThan(0);
    }
  });

  /** Verifies that the clip list has no duplicate name */
  it('lists each clip once', () => {
    expect(new Set(CLIPS).size).toBe(CLIPS.length);
  });

  /** Verifies that every slap hit clip is listed in CLIPS, so it is loaded and GLB-checked */
  it('lists every hit clip of the slap in CLIPS', () => {
    expect(HIT_CLIPS.length).toBeGreaterThan(0);
    expect(HIT_CLIPS.filter((c) => !(CLIPS as readonly string[]).includes(c))).toEqual([]);
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

describe('clips of the death outside the castle', () => {
  /** Verifies that the hit, death and strike clips are listed for loading */
  it('lists Hit_A, Death_A and Use_Item', () => {
    for (const name of ['Hit_A', 'Death_A', 'Use_Item', 'Spawn_Ground'] as const) expect(CLIPS).toContain(name);
  });

  /** Verifies that the one-shot clip lengths are positive and finite */
  it.each([
    ['SPAWN_CLIP_TIME', SPAWN_CLIP_TIME],
    ['HIT_CLIP_TIME', HIT_CLIP_TIME],
    ['DEATH_CLIP_TIME', DEATH_CLIP_TIME],
    ['USE_ITEM_CLIP_TIME', USE_ITEM_CLIP_TIME],
  ])('has a positive, finite %s', (_label, time) => {
    expect(Number.isFinite(time)).toBe(true);
    expect(time).toBeGreaterThan(0);
  });

  /** Verifies that play builds a running clip, looping at rate 1 by default */
  it('builds a playing clip with play', () => {
    expect(play('Idle_B')).toEqual({ name: 'Idle_B', loop: true, timeScale: 1, frozen: false, frozenAt: 0 });
    expect(play('Death_A', 2, false)).toEqual({ name: 'Death_A', loop: false, timeScale: 2, frozen: false, frozenAt: 0 });
  });

  /** Verifies that hold builds a still pose, at time 0 by default */
  it('builds a frozen pose with hold', () => {
    expect(hold('Idle_A')).toEqual({ name: 'Idle_A', loop: false, timeScale: 0, frozen: true, frozenAt: 0 });
    expect(hold('PickUp', 0.3)).toEqual({ name: 'PickUp', loop: false, timeScale: 0, frozen: true, frozenAt: 0.3 });
  });

  /** Verifies that play and hold return a fresh object each call */
  it('returns fresh clip objects', () => {
    const a = play('Idle_B');
    a.timeScale = 9;
    expect(play('Idle_B').timeScale).toBe(1);
  });
});

describe('SKELETON_LOOKS', () => {
  /** Verifies that the three skeletons are all the bare Minion (no helmet nor hood hiding the skull) */
  it('gives three bare skeletons from the skeletons pack', () => {
    expect(SKELETON_LOOKS).toHaveLength(3);
    expect(SKELETON_LOOKS.map((l) => l.body)).toEqual(['Skeleton_Minion', 'Skeleton_Minion', 'Skeleton_Minion']);
    for (const l of SKELETON_LOOKS) {
      expect(l.pack).toBe('skeletons');
      expect(l.body).toMatch(/^Skeleton_/);
    }
  });

  /** Verifies that every skeleton holds a weapon from the skeleton_props pack */
  it('arms every skeleton from skeleton_props', () => {
    for (const l of SKELETON_LOOKS) {
      expect(l.right?.pack).toBe('skeleton_props');
      expect(l.right?.model.length).toBeGreaterThan(0);
    }
  });

  /** Verifies that skeleton weapons get the neutral grip, made for the hand slot */
  it('holds skeleton weapons with the neutral grip', () => {
    for (const l of SKELETON_LOOKS) expect(gripFor(l.right!)).toEqual(NEUTRAL);
  });

  /** Verifies that the shared looks cannot be changed by a caller */
  it('is frozen', () => {
    expect(Object.isFrozen(SKELETON_LOOKS)).toBe(true);
    for (const l of SKELETON_LOOKS) expect(Object.isFrozen(l)).toBe(true);
  });

  /** Verifies that no agent ever gets a skeleton body */
  it('never gives an agent a skeleton look', () => {
    for (const t of ['', 'neo', 'skeleton', 'Skeleton_Warrior', ...Object.keys(LOOKS)]) {
      expect(lookFor('main', t).pack).toBeUndefined();
      expect(lookFor('sub', t).pack, t).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------- lookFor

describe('lookFor', () => {
  // ---- main agent

  /** Verifies that the main agent is always a bare Knight, whatever its type string */
  it.each(['', 'main', 'hermione', 'Explore', 'general-purpose', 'unknown-type', 'constructor', '__proto__'])(
    'gives the main agent a Knight with empty hands for type %j',
    (type) => {
      expect(lookFor('main', type)).toEqual({ body: MAIN_BODY });
      expect(lookFor('main', type).body).toBe<CharacterModel>('Knight');
    },
  );

  // ---- known types

  /** Verifies that a known subagent type gets its LOOKS entry, body and props */
  it.each(['hermione', 'dexter', 'neo', 'Explore', 'general-purpose', 'samuel-morse', 'plan', 'statusline-setup'])(
    'returns the LOOKS entry for the known type %s',
    (type) => {
      const expected = LOOKS[type.toLowerCase()];
      expect(expected, `${type} is in LOOKS`).toBeDefined();
      expect(lookFor('sub', type)).toEqual(expected);
    },
  );

  /** Verifies that every LOOKS key is reachable through lookFor, in any casing */
  it('returns the matching entry for every LOOKS key, lower or upper case', () => {
    for (const [type, look] of LOOK_ENTRIES) {
      expect(lookFor('sub', type), type).toEqual(look);
      expect(lookFor('sub', type.toUpperCase()), type.toUpperCase()).toEqual(look);
    }
  });

  /** Verifies that the type lookup ignores case */
  it('matches types case-insensitively', () => {
    expect(lookFor('sub', 'HERMIONE')).toEqual(LOOKS.hermione);
    expect(lookFor('sub', 'Hermione')).toEqual(LOOKS.hermione);
    expect(lookFor('sub', 'explore')).toEqual(lookFor('sub', 'Explore'));
    expect(lookFor('sub', 'Explore')).toEqual(LOOKS.explore);
    expect(lookFor('sub', 'Samuel-Morse')).toEqual(LOOKS['samuel-morse']);
  });

  /** Verifies that a few role looks hold the expected props (spot check of the table) */
  it('gives known roles their props: neo two hands, Plan a map, hermione a spellbook', () => {
    expect(lookFor('sub', 'neo')).toEqual({
      body: 'Barbarian',
      right: { pack: 'tools', model: 'lantern' },
      left: { pack: 'adventurers_props', model: 'shield_spikes' },
    });
    expect(lookFor('sub', 'Plan').right).toEqual({ pack: 'tools', model: 'map' });
    expect(lookFor('sub', 'hermione').right).toEqual({ pack: 'adventurers_props', model: 'spellbook_open' });
  });

  /** Verifies that a type near a known key but not equal to it is not matched */
  it.each([' hermione', 'hermione ', 'hermione2', 'samuel_morse', 'general purpose'])(
    'does not match the near-miss type %j',
    (type) => {
      expectFallback(lookFor('sub', type), type);
    },
  );

  // ---- unknown types

  /** Verifies that an unknown type gets a sub body and empty hands */
  it.each(UNKNOWN_TYPES.map((t) => [t.length > 40 ? `${t.slice(0, 20)}... (${t.length})` : t, t]))(
    'falls back to a bare sub body for the unknown type %j',
    (_label, type) => {
      expectFallback(lookFor('sub', type), _label);
    },
  );

  /** Verifies that the fallback is deterministic for the same unknown type */
  it('picks the same fallback body on every call', () => {
    for (const type of UNKNOWN_TYPES) expect(lookFor('sub', type)).toEqual(lookFor('sub', type));
  });

  /** Verifies that the fallback body ignores the casing of the unknown type */
  it.each(['my-custom-agent', 'Some_Plugin:Reviewer', 'ABCdef'])('picks the same body for %s in any casing', (type) => {
    const body = lookFor('sub', type).body;
    expect(lookFor('sub', type.toUpperCase()).body).toBe(body);
    expect(lookFor('sub', type.toLowerCase()).body).toBe(body);
  });

  /** Verifies that an empty type falls back to the first sub body (its hash is 0) */
  it('gives the empty type the first sub body', () => {
    expect(lookFor('sub', '')).toEqual({ body: SUB_BODIES[0] });
  });

  /** Verifies that Object.prototype member names never resolve to a prototype member */
  it.each(PROTO_KEYS)('falls back to a sub body for the prototype key %s', (type) => {
    const look = lookFor('sub', type);
    expectFallback(look, type);
    expect(typeof look.body).toBe('string');
  });

  /** Verifies that prototype keys are handled in upper case too */
  it.each(['CONSTRUCTOR', 'ToString', '__PROTO__'])('falls back to a sub body for %s', (type) => {
    expectFallback(lookFor('sub', type), type);
  });

  /** Verifies that unknown types spread over most bodies rather than piling on one */
  it('spreads 50 unknown types over at least 4 different bodies', () => {
    const types = Array.from({ length: 50 }, (_, i) => `custom-agent-${i}`);
    for (const t of types) expect(Object.hasOwn(LOOKS, t), t).toBe(false);
    const bodies = new Set(types.map((t) => lookFor('sub', t).body));
    for (const b of bodies) expect(SUB_BODIES).toContain(b);
    expect(bodies.size).toBeGreaterThanOrEqual(Math.min(4, SUB_BODIES.length));
  });

  /** Verifies that an unknown subagent never gets the main agent's Knight body */
  it('never gives an unknown subagent the main body', () => {
    const types = [...UNKNOWN_TYPES, ...PROTO_KEYS, ...Array.from({ length: 100 }, (_, i) => `t${i}`)];
    for (const t of types) expect(lookFor('sub', t).body, t.slice(0, 40)).not.toBe(MAIN_BODY);
  });

  /** Verifies that lookFor leaves the LOOKS table untouched */
  it('does not modify LOOKS', () => {
    const before = JSON.stringify(LOOKS);
    for (const t of ['hermione', 'Explore', 'unknown', '__proto__', 'constructor']) {
      lookFor('sub', t);
      lookFor('main', t);
    }
    expect(JSON.stringify(LOOKS)).toBe(before);
    expect(Object.getPrototypeOf(LOOKS)).toBe(Object.prototype);
  });
});

// ---------------------------------------------------------------- grips

describe('PROP_GRIP and gripFor', () => {
  const toolModels = new Set(HELD.filter((p) => p.pack === 'tools').map((p) => p.model));
  const propModels = new Set(HELD.filter((p) => p.pack === 'adventurers_props').map((p) => p.model));

  /** Verifies that every tools item held in LOOKS has a calibrated grip */
  it('has a grip for every tools prop held in LOOKS', () => {
    expect(toolModels.size).toBeGreaterThan(0);
    expect([...toolModels].filter((m) => !Object.hasOwn(PROP_GRIP, m))).toEqual([]);
  });

  /** Verifies that every grip belongs to a tools prop actually held in LOOKS (no stale entry) */
  it('only calibrates tools props that LOOKS uses', () => {
    expect(Object.keys(PROP_GRIP).filter((m) => !toolModels.has(m))).toEqual([]);
  });

  /** Verifies that every grip has a finite positive scale and finite position and rotation */
  it.each(Object.entries(PROP_GRIP))('gives %s a finite, positive grip', (_model, grip) => {
    expect(grip.scale).toBeGreaterThan(0);
    expect(Number.isFinite(grip.scale)).toBe(true);
    expect(grip.position).toHaveLength(3);
    expect(grip.rotation).toHaveLength(3);
    for (const v of [...grip.position, ...grip.rotation]) expect(Number.isFinite(v)).toBe(true);
  });

  /** Verifies that gripFor returns the calibrated grip of a tools prop */
  it.each([...Object.keys(PROP_GRIP)])('returns the PROP_GRIP entry for the tools prop %s', (model) => {
    expect(gripFor({ pack: 'tools', model })).toEqual(PROP_GRIP[model]);
  });

  /** Verifies that an adventurers prop, made for the hand slot, gets the neutral grip */
  it('returns the neutral grip for every adventurers prop held in LOOKS', () => {
    expect(propModels.size).toBeGreaterThan(0);
    for (const model of propModels) expect(gripFor({ pack: 'adventurers_props', model }), model).toEqual(NEUTRAL);
  });

  /** Verifies that an uncalibrated tools model gets the neutral grip */
  it.each(['saw', 'anvil', '', 'unknown_model'])('returns the neutral grip for the uncalibrated model %j', (model) => {
    expect(gripFor({ pack: 'tools', model })).toEqual(NEUTRAL);
  });

  /** Verifies that prototype member names never resolve to a prototype member */
  it.each(PROTO_KEYS)('returns the neutral grip for the prototype key %s', (model) => {
    expect(gripFor({ pack: 'tools', model })).toEqual(NEUTRAL);
  });

  /** Verifies that the neutral grip has a finite positive scale */
  it('has a usable neutral grip', () => {
    const g = gripFor({ pack: 'adventurers_props', model: 'dagger' });
    expect(g.scale).toBe(1);
    expect(Number.isFinite(g.scale)).toBe(true);
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

  // ---- the endless wait at the altar (altarWait.ts)

  /** Verifies each altar pose: slow walk in place, sitting on the heels, lying asleep */
  it('poses the endless wait at the altar', () => {
    expect(clip({ altar: 'pacing' })).toEqual(play('Walking_A', PACE_CLIP_RATE));
    expect(clip({ altar: 'sitting' })).toEqual(hold(SIT_CLIP, SIT_POSE_TIME));
    expect(clip({ altar: 'sleeping' })).toEqual(hold(SLEEP_CLIP));
    expect(SIT_CLIP).toBe('Death_B');
    expect(SLEEP_CLIP).toBe('Death_A_Pose');
    for (const name of [SIT_CLIP, SLEEP_CLIP]) expect(CLIPS).toContain(name);
    expect(PACE_CLIP_RATE).toBeGreaterThan(0);
  });

  /** Verifies the altar poses replace the kneeling and every state */
  it.each(STATES)('lets an altar pose win over kneeling in state %s', (state) => {
    expect(clip({ altar: 'sitting', kneeling: true, state }).name).toBe(SIT_CLIP);
    expect(clip({ altar: 'sleeping', kneeling: true, state }).name).toBe(SLEEP_CLIP);
    expect(clip({ altar: 'pacing', kneeling: true, state }).name).toBe('Walking_A');
  });

  /** Verifies walking, a slap, the spawn and a scripted scene still win over an altar pose */
  it('lets moving, a slap, the spawn and a script win over an altar pose', () => {
    expect(clip({ altar: 'sleeping', moving: true, speed: WALK_CLIP_SPEED }).name).toBe('Walking_A');
    expect(clip({ altar: 'sleeping', moving: true, speed: RUN_CLIP_SPEED }).name).toBe('Running_A');
    expect(clip({ altar: 'sleeping', hit: 'Hit_B' }).name).toBe('Hit_B');
    expect(clip({ altar: 'sitting', spawning: true }).name).toBe('Spawn_Ground');
    expect(clip({ altar: 'sitting', scripted: hold('Death_A') }).name).toBe('Death_A');
  });

  /** Verifies reduced motion keeps the still poses but stops the pacing walk */
  it('keeps still altar poses under reduced motion and stops pacing', () => {
    expect(clip({ altar: 'sitting', reducedMotion: true })).toEqual(hold(SIT_CLIP, SIT_POSE_TIME));
    expect(clip({ altar: 'sleeping', reducedMotion: true })).toEqual(hold(SLEEP_CLIP));
    expect(clip({ altar: 'pacing', reducedMotion: true })).toEqual(hold('Idle_A'));
    expect(clip({ altar: 'pacing', reducedMotion: true, kneeling: true }).name).toBe('PickUp');
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

  // ---- slap hit

  /** Verifies that a slapped still figure plays the given hit clip once at normal speed */
  it.each(HIT_CLIPS)('plays %s once at rate 1 when slapped', (hit) => {
    expect(clip({ hit })).toEqual({ name: hit, loop: false, timeScale: 1, frozen: false, frozenAt: 0 });
  });

  /** Verifies that the hit wins over walking and running */
  it.each(HIT_CLIPS)('lets %s win over a moving figure, walking or running', (hit) => {
    for (const speed of [0, WALK_CLIP_SPEED, RUN_THRESHOLD, RUN_CLIP_SPEED, 100]) {
      expect(clip({ hit, moving: true, speed }), `speed ${speed}`).toEqual({
        name: hit,
        loop: false,
        timeScale: 1,
        frozen: false,
        frozenAt: 0,
      });
    }
  });

  /** Verifies that the hit wins over every agent state, including working and done */
  it.each(STATES)('lets the hit win in state %s', (state) => {
    for (const hit of HIT_CLIPS) {
      const c = clip({ hit, state });
      expect(c.name, hit).toBe(hit);
      expect(c.frozen, hit).toBe(false);
      expect(c.loop, hit).toBe(false);
    }
  });

  /** Verifies that the hit wins over kneeling at the altar, in every state */
  it.each(STATES)('lets the hit win over kneeling in state %s', (state) => {
    for (const hit of HIT_CLIPS) {
      expect(clip({ hit, kneeling: true, state }), hit).toEqual({ name: hit, loop: false, timeScale: 1, frozen: false, frozenAt: 0 });
    }
  });

  /** Verifies that a spawning figure keeps Spawn_Ground even when slapped */
  it.each(HIT_CLIPS)('lets spawning win over %s', (hit) => {
    expect(clip({ hit, spawning: true, moving: true, speed: 5, kneeling: true, state: 'working' })).toEqual({
      name: 'Spawn_Ground',
      loop: false,
      timeScale: SPAWN_TIME_SCALE,
      frozen: false,
      frozenAt: 0,
    });
  });

  /** Verifies that reduced motion ignores the hit and gives the same clip as without it */
  it.each(HIT_CLIPS)('ignores %s under reduced motion', (hit) => {
    const variants: Partial<ClipInput>[] = [
      {},
      { state: 'working' },
      { state: 'done' },
      { moving: true, speed: RUN_CLIP_SPEED },
      { kneeling: true },
      { spawning: true },
    ];
    for (const v of variants) {
      const withHit = clip({ ...v, hit, reducedMotion: true });
      expect(withHit, JSON.stringify(v)).toEqual(clip({ ...v, reducedMotion: true }));
      expect(withHit.name, JSON.stringify(v)).not.toBe(hit);
    }
  });

  /** Verifies that reduced motion keeps the kneeling pose for a slapped figure at the altar */
  it('holds PickUp for a slapped kneeling figure under reduced motion', () => {
    expect(clip({ hit: 'Hit_A', kneeling: true, reducedMotion: true })).toEqual({
      name: 'PickUp',
      loop: false,
      timeScale: 0,
      frozen: true,
      frozenAt: KNEEL_POSE_TIME,
    });
  });

  /** Verifies that an absent hit leaves the usual choice unchanged */
  it('chooses as before when hit is undefined', () => {
    for (const v of [{}, { state: 'working' as const }, { moving: true, speed: 2 }, { kneeling: true }]) {
      expect(clip({ ...v, hit: undefined }), JSON.stringify(v)).toEqual(clip(v));
    }
  });

  // ---- invariants over every combination

  const SPEEDS = [-1, 0, WALK_CLIP_SPEED, RUN_THRESHOLD - 1e-9, RUN_THRESHOLD, RUN_CLIP_SPEED, 100];
  const HITS: ClipInput['hit'][] = [undefined, ...HIT_CLIPS];
  const ALL: ClipInput[] = [];
  for (const moving of [false, true])
    for (const spawning of [false, true])
      for (const kneeling of [false, true])
        for (const reducedMotion of [false, true])
          for (const state of STATES)
            for (const hit of HITS)
              for (const speed of SPEEDS) ALL.push({ moving, spawning, kneeling, reducedMotion, state, speed, hit });

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

  /** Verifies that only Spawn_Ground and the hit clips play once; every other playing clip loops */
  it('plays only the spawn and hit clips without looping', () => {
    const once = new Set<string>(['Spawn_Ground', ...HIT_CLIPS]);
    for (const input of ALL) {
      const c = clipFor(input);
      if (!c.frozen) expect(c.loop, JSON.stringify(input)).toBe(!once.has(c.name));
    }
  });

  /** Verifies that a hit clip is returned exactly when slapped, not spawning, no reduced motion */
  it('returns the hit clip if and only if a hit applies', () => {
    for (const input of ALL) {
      const c = clipFor(input);
      const applies = !!input.hit && !input.spawning && !input.reducedMotion;
      expect(c.name === input.hit, JSON.stringify(input)).toBe(applies);
      expect((HIT_CLIPS as readonly string[]).includes(c.name), JSON.stringify(input)).toBe(applies);
    }
  });

  /** Verifies that the scripted one-shot clips (hit, death, strike) never come from clipFor alone, a slap aside */
  it('never picks Hit_A, Death_A or Use_Item without a scripted clip or a slap', () => {
    for (const input of ALL.filter((i) => !i.hit)) {
      expect(['Hit_A', 'Death_A', 'Use_Item'], JSON.stringify(input)).not.toContain(clipFor(input).name);
    }
  });

  // ---- scripted

  const SCRIPTED: ClipChoice[] = [play('Death_A', 1, false), play('Hit_A', 1, false), play('Use_Item'), hold('Spawn_Ground', 0.4)];

  /** Verifies that a scripted clip wins over spawning, moving, kneeling and every state */
  it.each(SCRIPTED.map((c) => [c.name, c] as const))('returns the scripted %s clip over everything else', (_name, scripted) => {
    for (const input of ALL.filter((i) => !i.reducedMotion)) {
      expect(clipFor({ ...input, scripted }), JSON.stringify(input)).toEqual(scripted);
    }
  });

  /** Verifies that reduced motion ignores a scripted clip and keeps the still pose */
  it.each(SCRIPTED.map((c) => [c.name, c] as const))('ignores the scripted %s clip under reduced motion', (_name, scripted) => {
    for (const input of ALL.filter((i) => i.reducedMotion)) {
      const c = clipFor({ ...input, scripted });
      expect(c, JSON.stringify(input)).toEqual(clipFor(input));
      expect(c.frozen, JSON.stringify(input)).toBe(true);
    }
  });

  /** Verifies that a null or missing scripted clip leaves the usual choice unchanged */
  it('ignores a null scripted clip', () => {
    for (const input of ALL) expect(clipFor({ ...input, scripted: null }), JSON.stringify(input)).toEqual(clipFor(input));
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
