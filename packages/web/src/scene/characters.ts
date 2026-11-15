// Which KayKit Adventurers character stands for an agent, and which animation it plays.
// Pure logic, no three.js, so it is testable in node. The clips come from the shared
// `Rig_Medium` animation files (KayKit Character Animations 1.1, clipCatalog.ts) and fit every
// character of the Adventurers and Skeletons packs.
import type { AgentState, AgentView } from '@agent-office/shared';
import { animFilesFor, type AnimFile, type KitClip } from './clipCatalog.ts';

/** Character models of the `adventurers` pack in kit-manifest.json. */
export type CharacterModel = 'Knight' | 'Barbarian' | 'Mage' | 'Ranger' | 'Rogue' | 'Rogue_Hooded';

/** The main agent is always the knight; subagents share the other bodies. */
export const MAIN_BODY: CharacterModel = 'Knight';
export const SUB_BODIES: readonly CharacterModel[] = ['Barbarian', 'Mage', 'Ranger', 'Rogue', 'Rogue_Hooded'];

/** Character models of the `skeletons` pack: the enemies outside the castle. */
export type SkeletonModel = 'Skeleton_Minion';

/** A model held in a hand: an Adventurers prop, an RPG Tools item, a skeleton's weapon, or a dungeon bottle. */
export interface PropRef {
  pack: 'adventurers_props' | 'tools' | 'skeleton_props' | 'dungeon';
  model: string;
}

/** What a figure looks like: a body and what it holds. */
export interface Look {
  /** Pack of the body; the adventurers when absent. */
  pack?: 'adventurers' | 'skeletons';
  body: CharacterModel | SkeletonModel;
  right?: PropRef;
  left?: PropRef;
}

const prop = (model: string): PropRef => Object.freeze({ pack: 'adventurers_props', model });
const tool = (model: string): PropRef => Object.freeze({ pack: 'tools', model });

/**
 * One look per subagent type, chosen for its role (user decision). Keys are lower case,
 * like STATIONS in layout.ts. Every subagent of a type, and its resting figure in the
 * tavern, looks the same.
 */
export const LOOKS: Readonly<Record<string, Look>> = {
  hermione: { body: 'Mage', right: prop('spellbook_open') },
  dexter: { body: 'Rogue', right: prop('smokebomb') },
  neo: { body: 'Barbarian', right: tool('lantern'), left: prop('shield_spikes') },
  hancock: { body: 'Barbarian', right: tool('bucket_metal') },
  timmy: { body: 'Ranger', right: tool('magnifying_glass') },
  gatsby: { body: 'Rogue', right: prop('shield_badge_color') },
  oracle: { body: 'Mage', right: prop('staff') },
  curator: { body: 'Mage', right: prop('spellbook_closed') },
  otis: { body: 'Rogue_Hooded', right: tool('journal_open') },
  turing: { body: 'Mage', right: tool('drafting_compass') },
  'samuel-morse': { body: 'Ranger', right: tool('map') },
  barbapapa: { body: 'Rogue', right: tool('hammer') },
  'butt-stallion': { body: 'Barbarian', right: prop('mug_full') },
  grumpy: { body: 'Barbarian', right: tool('map') },
  'phoenix-wright': { body: 'Rogue', right: tool('journal_open') },
  explore: { body: 'Ranger', right: tool('lantern') },
  plan: { body: 'Rogue_Hooded', right: tool('map') },
  'general-purpose': { body: 'Rogue_Hooded', right: prop('dagger') },
  'claude-code-guide': { body: 'Rogue_Hooded', right: tool('lantern') },
  'statusline-setup': { body: 'Rogue', right: tool('wrench_A') },
};

const weapon = (model: string): PropRef => Object.freeze({ pack: 'skeleton_props', model });

/**
 * The three skeletons: all the bare Minion, the only body that reads as a skeleton from
 * above (user decision: the Warrior's helmet and the Rogue's red hood hide the skull).
 * They differ by their weapon.
 */
export const SKELETON_LOOKS: readonly Look[] = Object.freeze([
  Object.freeze({ pack: 'skeletons', body: 'Skeleton_Minion', right: weapon('Skeleton_Blade') }),
  Object.freeze({ pack: 'skeletons', body: 'Skeleton_Minion', right: weapon('Skeleton_Axe') }),
  Object.freeze({ pack: 'skeletons', body: 'Skeleton_Minion', right: weapon('Skeleton_Blade') }),
] satisfies Look[]);

// Shared by every figure of a type: frozen, with their PropRefs and the grips, so that no
// caller can change them all at once.
for (const look of Object.values(LOOKS)) Object.freeze(look);

/**
 * Stable 32-bit FNV-1a hash, the same on every client. A plain `h * 31 + c` would be
 * useless modulo 5 (31 ≡ 1): the body would only depend on the sum of the letters.
 */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/**
 * The look of an agent. A subagent type missing from LOOKS gets a body picked from its
 * type name (stable, so all agents of that type match) and empty hands.
 */
export function lookFor(kind: AgentView['kind'], agentType: string): Look {
  if (kind === 'main') return { body: MAIN_BODY };
  const key = agentType.toLowerCase();
  if (Object.hasOwn(LOOKS, key)) return LOOKS[key];
  if (key === '') return { body: SUB_BODIES[0] };
  return { body: SUB_BODIES[hash(key) % SUB_BODIES.length] };
}

/** How a held model sits in the hand slot, in the model's own units. */
export interface Grip {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
}

const grip = (rotation: [number, number, number], scale: number): Grip =>
  Object.freeze({ position: Object.freeze([0, 0, 0]), rotation: Object.freeze(rotation), scale }) as Grip;

const NEUTRAL_GRIP: Grip = grip([0, 0, 0], 1);

/** A quarter turn. The hand slot's local X points down, so tools (modelled upright along +Y) turn on Z. */
const Q = Math.PI / 2;
const upright = (scale: number): Grip => grip([0, 0, Q], scale);

/**
 * Adjustments for models that were not made to be held (RPG Tools items lie on tables).
 * Adventurers props fit the hand slot as they are. Calibrated by eye on the scene.
 */
export const PROP_GRIP: Readonly<Record<string, Grip>> = {
  magnifying_glass: upright(1),
  journal_open: upright(0.7),
  drafting_compass: upright(1.3),
  hammer: upright(1),
  wrench_A: upright(1.2),
  map: upright(0.7),
  bucket_metal: upright(0.6),
  // Turned the other way, so it hangs from its handle below the hand.
  lantern: grip([0, 0, -Q], 0.55),
  // The potion of oblivion (potion.ts), a dungeon shelf bottle. Modelled standing, like the
  // Adventurers props, so no quarter turn (the tools' one laid it on its side in the hand).
  // Its origin is at its base and its neck at the top (~0.9 units): lowered so the neck sits in
  // the fist and the body hangs below the hand.
  bottle_C_green: Object.freeze({ position: Object.freeze([0, -0.62, 0]), rotation: Object.freeze([0, 0, 0]), scale: 0.8 }) as Grip,
};

/** The potion of oblivion, held in the right hand while the agent drinks it (potion.ts). */
export const POTION_PROP: PropRef = Object.freeze({ pack: 'dungeon', model: 'bottle_C_green' });

export function gripFor(ref: PropRef): Grip {
  return Object.hasOwn(PROP_GRIP, ref.model) ? PROP_GRIP[ref.model] : NEUTRAL_GRIP;
}

// ---- Clips played by the figures, one array per theme
// Each theme lists its clips in its OWN array below, so branches working on different themes
// never edit the same lines: add a clip on a new line inside your theme's brackets, and leave
// the other arrays and these comments alone. Any name of `CLIP_FILE` (clipCatalog.ts) is
// accepted; its file is then loaded with the figures (only files holding a listed clip are).
// A clip listed by two themes is loaded once.

/** Walking, working, waiting, spawn, slap hits, the potion gulp and the death outside. */
export const BASE_CLIPS = [
  'Walking_A',
  'Running_A',
  'Interact',
  'Idle_A',
  'Idle_B',
  'PickUp',
  'Spawn_Ground',
  'Hit_A',
  'Hit_B',
  'Death_A',
  'Use_Item',
] as const satisfies readonly KitClip[];

/** The endless wait at the altar (altarWait.ts): sitting down, then lying asleep. */
export const ALTAR_CLIPS = [
  'Sit_Floor_Down',
  'Sit_Floor_Idle',
  'Sit_Floor_StandUp',
  'Lie_Down',
  'Lie_Idle',
  'Lie_StandUp',
] as const satisfies readonly KitClip[];

/** The skeleton ambush outside the castle (ambush.ts, Ambush.tsx). */
export const AMBUSH_CLIPS = [
  'Skeletons_Spawn_Ground',
  'Skeletons_Taunt',
  'Melee_1H_Attack_Chop',
  'Melee_2H_Attack_Chop',
  'Skeletons_Walking',
  'Skeletons_Death',
] as const satisfies readonly KitClip[];

/** The heralds on the corner towers (celebrate.ts, Herald.tsx). */
export const HERALD_CLIPS = [
  'Ranged_Magic_Raise',
  'Waving',
  'Cheering',
] as const satisfies readonly KitClip[];

/** Work gestures, per room or post. */
export const WORK_CLIPS = [
] as const satisfies readonly KitClip[];

/** Small gags: cheering when done, dodging a slap, sneaking, fishing… */
export const BONUS_CLIPS = [
] as const satisfies readonly KitClip[];

// ---- End of the theme arrays

export type ClipName =
  | (typeof BASE_CLIPS)[number]
  | (typeof ALTAR_CLIPS)[number]
  | (typeof AMBUSH_CLIPS)[number]
  | (typeof HERALD_CLIPS)[number]
  | (typeof WORK_CLIPS)[number]
  | (typeof BONUS_CLIPS)[number];

/** Every clip the figures play, each once (a clip may sit in two theme arrays). */
export const CLIPS: readonly ClipName[] = Object.freeze([
  ...new Set<ClipName>([...BASE_CLIPS, ...ALTAR_CLIPS, ...AMBUSH_CLIPS, ...HERALD_CLIPS, ...WORK_CLIPS, ...BONUS_CLIPS]),
]);

/** The `animations` files that hold a clip of CLIPS: the only ones loaded. */
export const ANIM_FILES_USED: readonly AnimFile[] = Object.freeze(animFilesFor(CLIPS));

/**
 * Speeds (units per second, at KIT_SCALE) at which Walking_A and Running_A, played at
 * timeScale 1, keep the feet on the floor. Measured from the clips: twice the foot swing
 * per cycle, divided by the cycle length. KayKit legs are short, far below CRUISE_SPEED.
 */
export const WALK_CLIP_SPEED = 0.57;
export const RUN_CLIP_SPEED = 1.4;
/** Above this speed the figure runs instead of walking. */
export const RUN_THRESHOLD = 1.2;
/**
 * Fastest playback of a walk or run clip. Matching the feet at cruise speed would make the
 * legs flail; above this rate the figure slides a little instead (barely visible from above).
 */
export const MAX_CLIP_RATE = 1.8;
/**
 * Lengths of the one-shot clips, in seconds at timeScale 1, read from Rig_Medium_General.glb
 * (a test checks them against the file). The death outside the castle is timed on them.
 */
export const SPAWN_CLIP_TIME = 1.3;
export const HIT_CLIP_TIME = 2 / 3;
export const DEATH_CLIP_TIME = 0.8;
export const USE_ITEM_CLIP_TIME = 1.6;

/** Spawn_Ground is sped up a little: the subagent should not wait long before walking. */
export const SPAWN_TIME_SCALE = 1.5;
/** Time in PickUp where the figure is crouched: the kneeling pose at the altar. */
export const KNEEL_POSE_TIME = 0.55;
/**
 * The endless wait at the altar (altarWait.ts): an agent sits down on the floor
 * (Sit_Floor_Down, then Sit_Floor_Idle), later lies down asleep (Lie_Down, then Lie_Idle),
 * and gets up again (Sit_Floor_StandUp, Lie_StandUp) before it walks away. Lengths in
 * seconds at timeScale 1, read from Rig_Medium_Simulation.glb (a test checks them).
 * Pacing plays the walk slowly, in place.
 */
export const SIT_DOWN_TIME = 1;
export const SIT_UP_TIME = 17 / 15;
export const LIE_DOWN_TIME = 3;
export const LIE_UP_TIME = 7 / 3;
export const PACE_CLIP_RATE = 0.6;

/**
 * How the endless wait at the altar poses a figure at its place (see altarWait.ts):
 * `rising-sit` and `rising-lie` get up from the floor before the figure walks off.
 */
export type AltarPose = 'pacing' | 'sitting' | 'sleeping' | 'rising-sit' | 'rising-lie';

export interface ClipInput {
  /** The figure moves along its path this frame. */
  moving: boolean;
  /** Current walking speed, units per second. */
  speed: number;
  state: AgentState;
  /** A new subagent is coming out of the ground. */
  spawning: boolean;
  /** The figure is first of the altar queue, at its spot. */
  kneeling: boolean;
  reducedMotion: boolean;
  /** A clip imposed by a scripted scene (the death outside the castle), over everything else. */
  scripted?: ClipChoice | null;
  /** The figure was just slapped: the hit reaction to play (once). Absent otherwise. */
  hit?: 'Hit_A' | 'Hit_B';
  /** The figure is drinking the potion of oblivion (potion.ts): the gulp, played once. */
  drinking?: boolean;
  /** The endless wait at the altar, for a figure at its place. Absent otherwise. */
  altar?: AltarPose;
  /** Seconds since the altar pose started (altarWait.ts trackAltarPose); endless when absent. */
  altarFor?: number;
}

export interface ClipChoice {
  name: ClipName;
  loop: boolean;
  timeScale: number;
  /** Held still at `frozenAt` seconds instead of playing. */
  frozen: boolean;
  frozenAt: number;
}

export const play = (name: ClipName, timeScale = 1, loop = true): ClipChoice => ({ name, loop, timeScale, frozen: false, frozenAt: 0 });
export const hold = (name: ClipName, at = 0): ClipChoice => ({ name, loop: false, timeScale: 0, frozen: true, frozenAt: at });

/**
 * The clip of a sitting, sleeping or rising figure, `held` seconds into its pose: the way
 * down plays once, then the resting loop. Reduced motion holds the resting pose at once.
 */
export function altarClip(pose: Exclude<AltarPose, 'pacing'>, held: number, still: boolean): ClipChoice {
  if (pose === 'rising-sit') return still ? hold('Sit_Floor_Idle') : play('Sit_Floor_StandUp', 1, false);
  if (pose === 'rising-lie') return still ? hold('Lie_Idle') : play('Lie_StandUp', 1, false);
  if (pose === 'sitting') {
    if (still) return hold('Sit_Floor_Idle');
    return held < SIT_DOWN_TIME ? play('Sit_Floor_Down', 1, false) : play('Sit_Floor_Idle');
  }
  if (still) return hold('Lie_Idle');
  return held < LIE_DOWN_TIME ? play('Lie_Down', 1, false) : play('Lie_Idle');
}

/**
 * The clip for a frame. Reduced motion keeps every figure on a still pose: the position
 * still changes (that is information), the limbs do not.
 */
export function clipFor(input: ClipInput): ClipChoice {
  const { moving, speed, state, spawning, kneeling, reducedMotion, scripted, hit, drinking, altar } = input;
  // Reduced motion wins even over a scripted scene: limbs stay still.
  if (scripted && !reducedMotion) return scripted;
  if (spawning && !reducedMotion) return play('Spawn_Ground', SPAWN_TIME_SCALE, false);
  // A slap (purely visual) interrupts everything but the spawn; reduced motion keeps the pose.
  if (hit && !reducedMotion) return play(hit, 1, false);
  // The potion's gulp (purely visual too) comes right after the slap.
  if (drinking && !reducedMotion) return play('Use_Item', 1, false);
  if (moving) {
    if (reducedMotion) return hold('Idle_A');
    return speed >= RUN_THRESHOLD
      ? play('Running_A', Math.min(speed / RUN_CLIP_SPEED, MAX_CLIP_RATE))
      : play('Walking_A', Math.min(Math.max(speed / WALK_CLIP_SPEED, 0.5), MAX_CLIP_RATE));
  }
  // The endless wait at the altar: sitting and lying stay (held still) under reduced motion;
  // pacing does not (the figure stands still, see AgentFigure).
  if (altar && altar !== 'pacing') return altarClip(altar, input.altarFor ?? Infinity, reducedMotion);
  if (altar === 'pacing' && !reducedMotion) return play('Walking_A', PACE_CLIP_RATE);
  if (kneeling) return hold('PickUp', KNEEL_POSE_TIME);
  if (state === 'done' || reducedMotion) return hold('Idle_A');
  if (state === 'working') return play('Interact');
  return play('Idle_B');
}
