import { Component, memo, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import { Html, useAnimations } from '@react-three/drei';
import { LoopOnce, LoopRepeat, Vector3, type AnimationClip, type Group, type Mesh, type Object3D, type SkinnedMesh } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AgentState, AgentView } from '@agent-office/shared';
import { STATE_COLORS, statusKind } from '../format.ts';
import { reducedMotion } from '../motion.ts';
import { altarHeading, isAsleep, paceAxis, paceOffset, paceSeed, type AltarStage } from './altarWait.ts';
import { AltarCobwebs } from './AltarCobwebs.tsx';
import { victimClip, victimSink, type Ambush } from './ambush.ts';
import { clipFor, CLIPS, gripFor, lookFor, POTION_PROP, SPAWN_TIME_SCALE, type AltarPose, type ClipChoice, type ClipName, type Look, type PropRef } from './characters.ts';
import { CLICK_MAX_DRAG_PX, nearestTarget, setPointerHover, TARGET_USER_DATA } from './cursor.ts';
import { DestinationBadge } from './DestinationIcon.tsx';
import { destinationOf } from './destinations.ts';
import { KIT_SCALE } from './dungeon.ts';
import { useAnimFiles, useKitGLTF } from './kit.ts';
import { reroute, SPAWN, type Point, type Spot } from './layout.ts';
import { exitRoute, groundY, routeFrom } from './outside.ts';
import { DRINK_S, onPotion, POTION_EFFECT_MS, POTION_S, potionPhase, staggerSway } from './potion.ts';
import { PotionEffect } from './PotionEffect.tsx';
import { RequestBubble } from './RequestBubble.tsx';
import { SnoreBubble } from './SnoreBubble.tsx';
import { hitClipFor, onSlap, slapAgent, SLAP_EFFECT_MS } from './slap.ts';
import { SlapEffect } from './SlapEffect.tsx';
import { SlapHand } from './SlapHand.tsx';
import { SWING_IMPACT } from './slapSwing.ts';
import { playSlapSound, preloadSlapSound } from '../ui/slapSound.ts';
import { MISHAP_BUBBLE_MS, onMishap, SOOT_MS, type MishapKind } from './mishap.ts';
import { CHEER_CLIP_TIME, startsCheer } from './cheer.ts';
import { dodgeClipFor, nextSlapStreak, NO_STREAK, type DodgeClip, type SlapStreak } from './dodge.ts';
import { FISHING_SPACE, fishingClip, fishingExitLead, fishingReroute, fishingSeed } from './fishing.ts';
import { FishingRod } from './FishingRod.tsx';
import { sneaks, SNEAK_SPEED } from './sneak.ts';
import { MishapEffect } from './MishapEffect.tsx';
import { Soot } from './Soot.tsx';
import { advance, approach, nextSpeed, remainingDistance, turnToward } from './walk.ts';
import { advanceThrow, onThrow, placeClip, seatOf } from './workGestures.ts';

/** Live positions of the figures, read by the camera to follow the selected agent. */
export const agentPositions = new Map<string, Vector3>();

/** Time to blend from one clip to the next, in seconds. */
const FADE = 0.2;
/** Turn rates (per second, exponential): smooth turns at corners, slower towards the desk. */
const WALK_TURN_RATE = 14;
const REST_TURN_RATE = 6;
/** Height of the name tag and of the waiting bubble, above the tallest helmet. */
const TAG_Y = 2.45;
const BUBBLE_Y = 2.1;
/** Height of the slap effect (hand, stars, bubble): around the head. */
const SLAP_Y = 1.5;
/** Height of the potion's stars: a ring around the top of the head. */
const POTION_Y = 1.75;
/** Pause of the walk after a slap until the character reports its hit clip's real length. */
const HIT_FALLBACK = 0.6;
/** Fastest sideways easing (m/s) of a pacing figure, above the pace's own peak speed. */
const PACE_EASE = 1;

/** What the figure does this frame, written by the walk and read by the character. */
export interface Motion {
  moving: boolean;
  speed: number;
  kneeling: boolean;
  /** Seconds of spawn clip left; -1 until the character has loaded and set it. */
  spawnLeft: number;
  /** A clip imposed by a scripted scene (the death outside), or null. */
  scripted: ClipChoice | null;
  /** Hit reaction of the last slap, and that slap's number (a new number restarts the clip). */
  hit: 'Hit_A' | 'Hit_B' | DodgeClip | null;
  hitId: number;
  /** Seconds until the 3D hand reaches the face: the hit clip waits for it. */
  hitWait: number;
  /** Seconds of hit reaction left: the walk pauses meanwhile (and during the wait). */
  hitLeft: number;
  /**
   * Seconds since the agent started drinking the potion of oblivion; absent or -1 when it is not.
   * Optional, like every gag field, so figures that never drink (skeletons) need not set it.
   */
  potionAt?: number;
  /** Number of the last potion (a new number restarts the gulp). */
  potionId?: number;
  /** The endless wait at the altar (altarWait.ts), for a figure at its place; null or absent otherwise. */
  altar?: AltarPose | null;
  /** Seconds of cheering left (cheer.ts): the walk waits meanwhile. Absent or 0 when none. */
  cheerLeft?: number;
  /** A finished Rogue-looking subagent sneaking home (sneak.ts). */
  sneaking?: boolean;
  /** The fishing clip of a figure standing at its moat place (fishing.ts), or null. */
  fishing?: ClipChoice | null;
  /** Work gesture or seated pose at the figure's place (workGestures.ts); null or absent otherwise. */
  place?: ClipChoice | null;
  /** Seconds since the figure threw its pigeon (workGestures.ts); absent or -1 when it is not. */
  throwAt?: number;
}

/** Share of the gap to close this frame for an exponential turn; all of it under reduced motion. */
function turnFraction(rate: number, dt: number, still: boolean): number {
  return still ? 1 : 1 - Math.exp(-rate * dt);
}

/**
 * The animation clips shared by every character (agents, ambush skeletons, heralds), loaded
 * once: only the `animations` files that hold a clip of CLIPS are fetched.
 */
function useClips(): AnimationClip[] {
  const files = useAnimFiles();
  return useMemo(() => {
    const wanted = new Set<string>(CLIPS);
    const clips = files.flatMap((f) => f.animations).filter((c) => wanted.has(c.name));
    if (import.meta.env.DEV) {
      const found = clips.map((c) => c.name);
      const missing = CLIPS.filter((n) => !found.includes(n));
      // A missing clip leaves a figure in its bind pose without any other sign.
      if (missing.length || found.length !== new Set(found).size) console.warn('KayKit clips missing or duplicated', { missing, found });
    }
    return clips;
  }, [files]);
}

/** A model held in a hand: a plain clone (shared geometry and materials) inside the hand bone. */
function Held({ prop, bone, holder }: { prop: PropRef; bone: Object3D; holder?: RefObject<Group | null> }) {
  const { scene } = useKitGLTF(prop.pack, prop.model);
  const object = useMemo(() => {
    const o = scene.clone();
    o.traverse((c) => {
      if ((c as Mesh).isMesh) c.castShadow = true;
    });
    return o;
  }, [scene]);
  const grip = gripFor(prop);
  return createPortal(
    <group ref={holder} position={grip.position} rotation={grip.rotation} scale={grip.scale}>
      <primitive object={object} />
    </group>,
    bone,
  );
}

/**
 * The animated KayKit character. It suspends while its files load, so it sits in its own
 * Suspense and error boundary: the tag, ring and disc next to it never wait for it.
 */
export function Character({
  look,
  state,
  motion,
  extra,
  rod,
}: {
  look: Look;
  state: AgentState;
  motion: RefObject<Motion>;
  /** Fishing at the moat (fishing.ts): a rod in the right hand, shown while a fishing clip plays. */
  rod?: boolean;
  /**
   * Mounted for a while (the potion): shown in the right hand instead of the look's prop during
   * the gulp only, on the frame clock (not a timer), so it never drifts from the clip. Loads on its own.
   */
  extra?: PropRef;
}) {
  // One skinned clone per figure: the skeleton is its own, geometry and materials are shared.
  const { scene } = useKitGLTF(look.pack ?? 'adventurers', look.body);
  const model = useMemo(() => {
    const m = cloneSkinned(scene) as Object3D;
    m.traverse((o) => {
      if ((o as Mesh).isMesh) o.castShadow = true;
    });
    // Hidden until the first clip is applied: no bind-pose (T-pose) frame.
    m.visible = false;
    return m;
  }, [scene]);
  // The cloned skeletons own a bone texture each; geometry and materials are shared, kept.
  useEffect(
    () => () =>
      model.traverse((o) => {
        if ((o as SkinnedMesh).isSkinnedMesh) (o as SkinnedMesh).skeleton.dispose();
      }),
    [model],
  );
  // GLTFLoader strips the dots from node names: `handslot.r` becomes `handslotr`.
  const hands = useMemo(() => {
    const right = model.getObjectByName('handslotr');
    const left = model.getObjectByName('handslotl');
    if (import.meta.env.DEV && (!right || !left)) console.warn('KayKit hand slot missing', look.body);
    return { right, left };
  }, [model, look.body]);
  const clips = useClips();
  const { actions, mixer } = useAnimations(clips, model);
  /** Clips being played and their blend weight; the current one goes to 1, the others to 0. */
  const weights = useRef(new Map<ClipName, number>());
  const current = useRef<ClipName | null>(null);
  /** Number of the last slap whose hit clip was started. */
  const lastHit = useRef(0);
  /** Number of the last potion whose gulp was started. */
  const lastPotion = useRef(0);
  /** The look's right-hand prop and the potion bottle: one of them shows, set every frame. */
  const rightProp = useRef<Group>(null);
  const bottle = useRef<Group>(null);
  const rodRef = useRef<Group>(null);

  useFrame((_, delta) => {
    const m = motion.current;
    const still = reducedMotion();
    if (m.spawnLeft < 0) {
      const spawn = actions.Spawn_Ground;
      m.spawnLeft = still || !spawn ? 0 : spawn.getClip().duration / SPAWN_TIME_SCALE;
    }
    const choice = clipFor({
      moving: m.moving,
      speed: m.speed,
      state,
      spawning: m.spawnLeft > 0,
      kneeling: m.kneeling,
      reducedMotion: still,
      scripted: m.scripted,
      hit: m.hitWait <= 0 && m.hitLeft > 0 && m.hit ? m.hit : undefined,
      drinking: potionPhase(m.potionAt ?? -1) === 'drinking',
      altar: m.altar ?? undefined,
      cheering: (m.cheerLeft ?? 0) > 0,
      sneaking: m.sneaking,
      fishing: m.fishing ?? undefined,
      place: m.place,
    });
    if (rodRef.current) rodRef.current.visible = choice.name.startsWith('Fishing_');
    // The bottle shows only while the gulp clip itself plays (a slap or a spawn takes over the hand).
    const gulp = choice.name === 'Use_Item' && !m.scripted;
    if (bottle.current) bottle.current.visible = gulp;
    // The look's prop hides only once the bottle has loaded: never an empty hand meanwhile.
    if (rightProp.current) rightProp.current.visible = !(gulp && bottle.current);
    // When Suspense hides and shows the scene again (while the kit loads), React runs the
    // effect cleanups: drei's useAnimations then stops every action, but these refs survive.
    // A current clip that is no longer active means: start over.
    if (current.current !== null && !actions[current.current]?.isScheduled()) {
      weights.current.clear();
      current.current = null;
    }
    const next = actions[choice.name];
    // A missing clip (flagged in development) shows the bind pose rather than no figure.
    if (!next) {
      model.visible = true;
      return;
    }
    // A new slap starts its hit clip over, even when the same clip is playing or fading out,
    // and the walk waits for the clip's real length.
    if (choice.name === m.hit && m.hitId !== lastHit.current) {
      lastHit.current = m.hitId;
      m.hitLeft = next.getClip().duration;
      if (current.current === choice.name) next.reset().play();
      else weights.current.delete(choice.name);
    }
    // Same for a new potion: the gulp starts over.
    if (gulp && m.potionId !== lastPotion.current) {
      lastPotion.current = m.potionId ?? 0;
      if (current.current === choice.name) next.reset().play();
      else weights.current.delete(choice.name);
    }
    const first = current.current === null;
    if (current.current !== choice.name) {
      // A clip still fading out is picked up where it is; a new one starts from the beginning.
      if (!weights.current.has(choice.name)) {
        next.reset();
        next.setLoop(choice.loop ? LoopRepeat : LoopOnce, Infinity);
        next.clampWhenFinished = !choice.loop;
        next.play();
        weights.current.set(choice.name, first ? 1 : 0);
      }
      current.current = choice.name;
    }
    if (choice.frozen) {
      next.paused = true;
      next.time = choice.frozenAt;
    } else {
      next.paused = false;
      next.timeScale = choice.timeScale;
    }

    // Blend from each clip's current weight (not a fixed 1 → 0 curve), normalised so the
    // weights always add up to 1: quick changes never snap a pose.
    const step = still ? 1 : delta / FADE;
    let total = 0;
    for (const [clip, w] of weights.current) {
      const target = clip === choice.name ? 1 : 0;
      // A weight already on its target stays put (it used to flicker, down to 0 on slow frames).
      const nw = approach(w, target, step);
      weights.current.set(clip, nw);
      total += nw;
    }
    for (const [clip, w] of weights.current) {
      const action = actions[clip];
      if (clip !== choice.name && w <= 0) {
        action?.stop();
        weights.current.delete(clip);
      } else {
        action?.setEffectiveWeight(total > 0 ? w / total : 0);
      }
    }
    if (first) {
      mixer.update(0);
      model.visible = true;
    }
  });

  return (
    <>
      <primitive object={model} scale={KIT_SCALE} />
      {look.right && hands.right && <Held prop={look.right} bone={hands.right} holder={rightProp} />}
      {extra && hands.right && (
        // Its own Suspense: loading the bottle never hides the character.
        <Suspense fallback={null}>
          <Held prop={extra} bone={hands.right} holder={bottle} />
        </Suspense>
      )}
      {look.left && hands.left && <Held prop={look.left} bone={hands.left} />}
      {rod && hands.right && <FishingRod bone={hands.right} holder={rodRef} />}
    </>
  );
}

/** If a character cannot load, the figure falls back to a plain capsule instead of breaking the scene. */
class CharacterBoundary extends Component<{ fallback: ReactNode; onError(): void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('KayKit character failed to load', error);
    this.props.onError();
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

interface Props {
  agent: AgentView;
  name: string;
  color: string;
  spot: Spot;
  /** Where the figure appears, read on mount only: the lockers, a resting seat, or its own spot. */
  start: Spot;
  selected: boolean;
  /**
   * Absent for figures that cannot be selected (stopped sessions, doomed figures). It also
   * switches on every pointer interaction: hover, right-click slap and the slap anchor.
   */
  onSelect?(id: string): void;
  /** Called once when a finished agent reaches its spot in the tavern. */
  onArrive?(id: string): void;
  /**
   * Set when the agent's session was deleted: the figure walks out of the castle to be
   * killed by the skeletons of this ambush. Stays the same object once set.
   */
  exit?: Ambush;
  /** Called once when a doomed figure has sunk out of sight. */
  onGone?(id: string): void;
  /** How far the agent has given up waiting at the altar (altarWait.ts); calm when absent. */
  altarStage?: AltarStage;
}

/**
 * Memoised: the scene re-renders every second for the clock, and a figure whose props did
 * not change (same agent object, spot and callbacks) has nothing to redraw.
 */
export const AgentFigure = memo(AgentFigureImpl);

function AgentFigureImpl({ agent, name, color, spot, start, selected, onSelect, onArrive, exit, onGone, altarStage = 'calm' }: Props) {
  const group = useRef<Group>(null);
  /** Leans the character (not its disc, ring or tag) while it staggers after the potion. */
  const sway = useRef<Group>(null);
  const ring = useRef<Mesh>(null);
  const bubble = useRef<Mesh>(null);
  /** The tag's HTML anchor: `data-travelling` shows the destination badge while walking. */
  const anchor = useRef<HTMLDivElement>(null);
  const badge = useRef<HTMLSpanElement>(null);
  const destination = destinationOf(spot);
  // drei's Html loses the content of a tag mounted before the canvas is connected to its
  // events (its target changes and the new root is never rendered): wait for the connection.
  const connected = useThree((s) => !!s.events.connected);
  const pos = useMemo(() => new Vector3(start.x, 0, start.z), []); // eslint-disable-line react-hooks/exhaustive-deps
  const path = useRef<Point[]>(start.id === spot.id ? [] : routeFrom(start, spot));
  const last = useRef<Spot>(spot);
  const arrived = useRef(false);
  const gone = useRef(false);
  // A figure coming out of the lockers rises from the ground before it walks; one coming
  // from a resting seat just walks, and one already finished does not rise.
  const motion = useRef<Motion>({
    moving: false,
    speed: 0,
    kneeling: false,
    spawnLeft: start.id === SPAWN.id && agent.state !== 'done' ? -1 : 0,
    scripted: null,
    hit: null,
    hitId: 0,
    hitWait: 0,
    hitLeft: 0,
    potionAt: -1,
    potionId: 0,
    altar: null,
  });
  /** Sideways shift of a pacing agent from its place, eased so it never jumps. */
  const paceShift = useRef(0);
  /** Cobwebs over a sleeper, shown only while the lying pose is (set every frame). */
  const webs = useRef<Group>(null);
  const paceStart = useMemo(() => paceSeed(agent.id), [agent.id]);
  const look = lookFor(agent.kind, agent.agentType);
  const sneaking = sneaks(agent.kind, agent.state, look.body);
  const fishes = spot.space === FISHING_SPACE && !exit;
  /** Seconds since the figure reached its moat place, -1 when it is not fishing. */
  const fishingAt = useRef(-1);
  const fishSeed = useMemo(() => fishingSeed(agent.id), [agent.id]);
  /** Number of the slap on screen (a new one remounts the effect), null when none is. */
  const [slap, setSlap] = useState<number | null>(null);
  const slaps = useRef(0);
  /** The slap streak (dodge.ts) and the number of dodges, for the dodge clip in turn. */
  const streak = useRef<SlapStreak>(NO_STREAK);
  const dodges = useRef(0);
  /** The slap on screen was dodged: no stars, a "missed" bubble. */
  const [dodged, setDodged] = useState(false);
  /** Number of the potion on screen (a new one remounts the stars), null when none is. */
  const [potion, setPotion] = useState<number | null>(null);
  /** The bottle is mounted for the whole effect; Character shows it during the gulp only. */
  const [bottleOn, setBottleOn] = useState(false);
  const potions = useRef(0);
  /** Read by the potion listener, which outlives renders: a doomed figure drinks nothing. */
  const doomed = useRef(!!exit);
  doomed.current = !!exit;
  /** Where the right button went down on this figure, to tell a click from a camera drag. */
  const rightDown = useRef<{ x: number; y: number } | null>(null);

  // The slap is a purely visual gag: hit clip, hand, stars, bubble and sound, nothing else.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Fetched once for the whole scene, so the first slap is heard at once.
    preloadSlapSound();
    const off = onSlap(agent.id, () => {
      const n = ++slaps.current;
      const m = motion.current;
      // A slap ends a gulp at once: the agent goes straight on to staggering (never a second gulp).
      if (potionPhase(m.potionAt ?? -1) === 'drinking') m.potionAt = DRINK_S;
      // A figure still rising from the ground (or loading) skips the hit; hand, stars and sound still show.
      const skip = reducedMotion() || m.spawnLeft !== 0;
      // The third slap of a quick streak is dodged (dodge.ts); a slap with no visible reaction
      // does not count, so "missed" never shows over a figure that did not move.
      let dodge = false;
      if (!skip) {
        const next = nextSlapStreak(streak.current, performance.now());
        streak.current = { count: next.count, at: next.at };
        dodge = next.dodge;
      }
      m.hit = skip ? null : dodge ? dodgeClipFor(++dodges.current) : hitClipFor(n);
      m.hitId = n;
      m.hitLeft = skip ? 0 : HIT_FALLBACK;
      // The hand sweeps in first: the cheek reacts, and sounds, when it lands. A dodge starts
      // at once, so the hand passes through empty air, and makes no sound.
      const swing = !reducedMotion();
      m.hitWait = skip || dodge ? 0 : SWING_IMPACT;
      if (!dodge) playSlapSound(swing ? SWING_IMPACT : 0);
      setDodged(dodge);
      setSlap(n);
      clearTimeout(timer);
      timer = setTimeout(() => setSlap(null), SLAP_EFFECT_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
      // Suspense can run this cleanup and the effect again: never leave an effect stuck on screen.
      setSlap(null);
    };
  }, [agent.id]);

  // The dovecote throw (workGestures.ts): the agent releases each pigeon that leaves for it.
  // A throw already under way goes on (accepted: no restart for a second bird).
  useEffect(
    () =>
      onThrow(agent.id, () => {
        const m = motion.current;
        if (!reducedMotion() && (m.throwAt ?? -1) < 0) m.throwAt = 0;
      }),
    [agent.id],
  );
  // Where at its place the figure stands, for its gesture: parsed once per spot.
  const seat = useMemo(() => seatOf(spot.id, spot.room, spot.station), [spot.id, spot.room, spot.station]);

  // A failed command (mishap.ts): soot on the figure and a comic bubble, nothing else.
  const [mishap, setMishap] = useState<{ n: number; kind: MishapKind; bubble: boolean } | null>(null);
  /** A ref, as for the slaps: a re-run of the effect must never reuse a number `Soot` already armed. */
  const mishaps = useRef(0);
  useEffect(() => {
    if (exit) return;
    let bubbleTimer: ReturnType<typeof setTimeout> | undefined;
    let sootTimer: ReturnType<typeof setTimeout> | undefined;
    const off = onMishap(agent.id, (kind) => {
      setMishap({ n: ++mishaps.current, kind, bubble: true });
      clearTimeout(bubbleTimer);
      clearTimeout(sootTimer);
      bubbleTimer = setTimeout(() => setMishap((m) => m && { ...m, bubble: false }), MISHAP_BUBBLE_MS);
      sootTimer = setTimeout(() => setMishap(null), SOOT_MS);
    });
    return () => {
      off();
      clearTimeout(bubbleTimer);
      clearTimeout(sootTimer);
      setMishap(null);
    };
  }, [agent.id, exit]);
  // The potion of oblivion (PreCompact) is purely visual too: gulp, stagger, stars and bubble.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onPotion(agent.id, () => {
      if (doomed.current) return;
      const n = ++potions.current;
      const m = motion.current;
      // A figure still rising from the ground (or loading) does not drink at all: stars with no
      // gulp would look like a glitch. Under reduced motion: no gulp, no stagger, still stars and bubble.
      if (m.spawnLeft !== 0 && !reducedMotion()) return;
      const skip = reducedMotion();
      m.potionAt = skip ? -1 : 0;
      m.potionId = n;
      setPotion(n);
      setBottleOn(!skip);
      clearTimeout(timer);
      timer = setTimeout(() => {
        setPotion(null);
        setBottleOn(false);
      }, POTION_EFFECT_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
      // Suspense can run this cleanup and the effect again: never leave an effect stuck on screen,
      // and reset the 3D half with the HTML half.
      motion.current.potionAt = -1;
      setPotion(null);
      setBottleOn(false);
    };
  }, [agent.id]);

  // A subagent that just finished cheers once where it stands (cheer.ts), then walks home.
  const prevState = useRef<AgentState>(agent.state);
  useEffect(() => {
    const prev = prevState.current;
    prevState.current = agent.state;
    const m = motion.current;
    if (exit || reducedMotion() || m.spawnLeft !== 0 || !startsCheer(agent.kind, prev, agent.state)) return;
    m.cheerLeft = CHEER_CLIP_TIME;
  }, [agent.state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Doomed: out of the castle to the kill point. Under reduced motion, no walk and no fight.
  useEffect(() => {
    if (!exit) return;
    if (reducedMotion()) {
      gone.current = true;
      onGone?.(agent.id);
      return;
    }
    exit.add(agent.id);
    const slot = exit.victim(agent.id)?.slot ?? 0;
    // A fisher first walks back along the bank lane: never through the pennants (fishing.ts).
    const lead = fishingExitLead(path.current, last.current);
    path.current = lead.length > 0 ? [...lead, ...exitRoute(lead[lead.length - 1], [], last.current, slot)] : exitRoute(pos, path.current, last.current, slot);
  }, [exit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (exit || last.current.id === spot.id) return;
    // From where the agent is, not from where it was going: never through a wall.
    path.current = fishingReroute(path.current, last.current, spot) ?? reroute(path.current, last.current, spot);
    last.current = spot;
  }, [spot]);

  useEffect(() => {
    agentPositions.set(agent.id, pos);
    return () => {
      agentPositions.delete(agent.id);
    };
  }, [agent.id, pos]);

  // A figure that leaves the scene while hovered gets no pointer-out: give the cursor back.
  const cursorKey = `agent:${agent.id}`;
  useEffect(() => () => setPointerHover(cursorKey, false), [cursorKey]);
  // Same when the figure stops being selectable under the pointer (its session stopped).
  const selectable = !!onSelect;
  useEffect(() => {
    if (!selectable) setPointerHover(cursorKey, false);
  }, [selectable, cursorKey]);

  useFrame(({ clock }, delta) => {
    const g = group.current;
    if (!g) return;
    const m = motion.current;
    const still = reducedMotion();
    // Reduced motion: agents still move between rooms (that is information), the ambient loops stop.
    const t = still ? 0 : clock.elapsedTime;
    const dt = Math.min(delta, 0.05);

    // The spawn clip plays in place (or the character is still loading): no walking yet.
    // Under reduced motion there is no spawn clip, so the walk never waits for the model.
    if (still && m.spawnLeft < 0) m.spawnLeft = 0;
    if (m.spawnLeft > 0) m.spawnLeft = Math.max(0, m.spawnLeft - delta);
    const spawning = m.spawnLeft !== 0;
    // A slapped figure stops for its hit reaction, then sets off again from standstill.
    if (still) m.hitLeft = m.hitWait = 0;
    const hitting = m.hitWait > 0 || m.hitLeft > 0;
    if (m.hitWait > 0) m.hitWait = Math.max(0, m.hitWait - delta);
    else if (m.hitLeft > 0) m.hitLeft = Math.max(0, m.hitLeft - delta);
    // The potion: the walk pauses for the gulp, then the figure staggers (walking or not).
    const drunk = m.potionAt ?? -1;
    if (still || exit) m.potionAt = -1;
    else if (drunk >= 0) m.potionAt = drunk + delta >= POTION_S ? -1 : drunk + delta;
    const gulping = potionPhase(m.potionAt ?? -1) === 'drinking';
    // The cheer of a finished subagent: the walk home waits for it.
    if (still || exit) m.cheerLeft = 0;
    const cheering = (m.cheerLeft ?? 0) > 0;
    if (cheering) m.cheerLeft = Math.max(0, (m.cheerLeft ?? 0) - delta);
    m.sneaking = sneaking;
    // The endless wait at the altar; reduced motion keeps a pacing agent in its calm pose.
    const stage: AltarStage = exit || (still && altarStage === 'pacing') ? 'calm' : altarStage;
    // A slap or a gulp freezes the pacing where it is (heading and sideways shift).
    const paceFrozen = stage === 'pacing' && (hitting || gulping);
    // Only while the potion acts, plus one frame to stand straight again: no work when idle.
    if (sway.current && drunk >= 0) {
      const lean = staggerSway(m.potionAt ?? -1);
      sway.current.rotation.set(lean.pitch, 0, lean.roll);
    }

    m.moving = false;
    const doomed = exit?.victim(agent.id);
    // Reduced motion switched on during a death: it ends now, as if it had started that way.
    if (exit && still && !gone.current) {
      gone.current = true;
      onGone?.(agent.id);
      return;
    }
    if ((hitting || gulping || cheering) && !exit && path.current.length > 0) {
      // A slap or a gulp pauses an ordinary walk; a figure walking out to its death never stops.
      m.speed = 0;
    } else if (!spawning && path.current.length > 0) {
      // A reroute keeps the current speed: the agent changes course without stopping.
      // Accepted limit: if the new destination is within the braking distance, the speed
      // drops to the braking curve in one frame, and a route that doubles back turns at speed.
      m.speed = nextSpeed(m.speed, remainingDistance(pos, path.current), dt);
      if (sneaking) m.speed = Math.min(m.speed, SNEAK_SPEED);
      const heading = advance(pos, path.current, m.speed * dt);
      if (heading !== null) g.rotation.y = turnToward(g.rotation.y, heading, turnFraction(WALK_TURN_RATE, dt, still));
      m.moving = path.current.length > 0;
    } else if (doomed) {
      m.speed = 0;
      if (doomed.phase === 'walking') exit!.arrived(agent.id);
      if (doomed.phase !== 'walking' && doomed.phase !== 'waiting') {
        g.rotation.y = turnToward(g.rotation.y, doomed.facing, turnFraction(REST_TURN_RATE, dt, still));
      }
      if (doomed.phase === 'gone' && !gone.current) {
        gone.current = true;
        onGone?.(agent.id);
      }
    } else if (!spawning) {
      m.speed = 0;
      // `last` catches up with `spot` in an effect: until then the agent has not set off yet.
      if (onArrive && agent.state === 'done' && last.current.id === spot.id && !arrived.current) {
        arrived.current = true;
        onArrive(agent.id);
      }
      // The endless wait at the altar: pacing faces the way it walks, sitting turns its back.
      if (!paceFrozen) {
        const heading = altarHeading(stage, spot.facing, clock.elapsedTime + paceStart);
        g.rotation.y = turnToward(g.rotation.y, heading, turnFraction(stage === 'pacing' ? WALK_TURN_RATE : REST_TURN_RATE, dt, still));
      }
    }
    // The endless wait at the altar poses a figure standing at its place (never a doomed one).
    const atPlace = !exit && !spawning && path.current.length === 0;
    m.altar = atPlace && stage !== 'calm' ? (isAsleep(stage) ? 'sleeping' : stage) : null;
    // Fishing at its moat place (fishing.ts): the clock starts on arrival, once the walk there
    // has been set (`last` catches up with `spot` in an effect, as for `onArrive`).
    const fishingTime = atPlace && fishes && last.current.id === spot.id ? (fishingAt.current < 0 ? 0 : fishingAt.current + delta) : -1;
    fishingAt.current = fishingTime;
    m.fishing = fishingTime >= 0 ? fishingClip(fishingTime, fishSeed) : null;
    // Zzz and cobwebs follow the pose actually shown, not the stage: never over a figure that
    // walks (the queue moves up), or stands up for a slap or a gulp.
    const asleep = m.altar === 'sleeping' && !hitting && !gulping;
    if (webs.current) webs.current.visible = asleep;
    m.kneeling = !exit && path.current.length === 0 && !!spot.kneel && m.altar === null;
    // The room's work gesture or the seated pose of the figure at its place (workGestures.ts).
    m.throwAt = still ? -1 : advanceThrow(m.throwAt ?? -1, delta);
    m.place =
      atPlace && m.altar === null
        ? placeClip({
            room: spot.room,
            station: spot.station,
            seat,
            state: agent.state,
            reducedMotion: still,
            throwing: m.throwAt >= 0,
          })
        : null;
    m.scripted = doomed && path.current.length === 0 ? victimClip(doomed.phase) : null;
    // Touch the DOM only when walking starts or stops: no React render per frame. The tag
    // is a separate React root that renders a little later: until it shows the new
    // destination's icon, show none rather than the previous one.
    const tag = anchor.current;
    const travelling = m.moving && badge.current?.dataset.destination === destination;
    if (tag && tag.hasAttribute('data-travelling') !== travelling) tag.toggleAttribute('data-travelling', travelling);
    if (tag && tag.hasAttribute('data-asleep') !== asleep) tag.toggleAttribute('data-asleep', asleep);
    g.position.copy(pos);
    g.position.y = groundY(pos) - (doomed ? victimSink(doomed) : 0);
    // Pacing shifts the drawn figure sideways only, never `pos`: the walk and reroutes ignore it.
    const paceTarget = m.altar === 'pacing' ? paceOffset(clock.elapsedTime + paceStart).offset : 0;
    if (still) paceShift.current = 0;
    else if (!paceFrozen) paceShift.current = approach(paceShift.current, paceTarget, dt * PACE_EASE);
    if (paceShift.current !== 0) {
      const axis = paceAxis(spot.facing);
      g.position.x += axis.x * paceShift.current;
      g.position.z += axis.z * paceShift.current;
    }

    if (bubble.current) {
      bubble.current.rotation.y = t * 2;
      bubble.current.position.y = BUBBLE_Y + Math.sin(t * 4) * 0.08;
    }
    ring.current?.scale.setScalar(selected ? 1.25 + Math.sin(t * 5) * 0.08 : 1);
  });

  const scale = agent.kind === 'sub' ? 0.85 : 1;
  const waiting = agent.state === 'waiting';
  const urgent = statusKind(agent) === 'urgent';
  const capsule = (
    <mesh position={[0, 0.65, 0]} castShadow>
      <capsuleGeometry args={[0.32, 0.6, 4, 12]} />
      <meshLambertMaterial color={color} />
    </mesh>
  );

  return (
    <group
      ref={group}
      scale={scale}
      {...(onSelect && { userData: TARGET_USER_DATA })}
      onClick={
        onSelect &&
        ((e) => {
          e.stopPropagation();
          // Releasing after a camera drag selects nothing, as on a workstation.
          if (e.delta > CLICK_MAX_DRAG_PX) return;
          onSelect(agent.id);
        })
      }
      onPointerOver={
        onSelect &&
        ((e) => {
          // An agent in front of a workstation keeps it dark: the click would select the agent.
          e.stopPropagation();
          setPointerHover(cursorKey, true);
        })
      }
      onPointerOut={onSelect && (() => setPointerHover(cursorKey, false))}
      // Right click slaps (left click selects); a right drag pans the camera and slaps nothing.
      // Decided on the release: `contextmenu` fires on the press on macOS and Linux, so its
      // `delta` could not tell a click from a drag there.
      onPointerDown={
        onSelect &&
        ((e) => {
          if (e.button !== 2 || nearestTarget(e.intersections) !== group.current) return;
          rightDown.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
        })
      }
      onPointerUp={
        onSelect &&
        ((e) => {
          if (e.button !== 2) return;
          const down = rightDown.current;
          rightDown.current = null;
          // The nearest target only, as for the left click: never the agent behind a workstation.
          if (!down || nearestTarget(e.intersections) !== group.current) return;
          if (Math.hypot(e.nativeEvent.clientX - down.x, e.nativeEvent.clientY - down.y) > CLICK_MAX_DRAG_PX) return;
          e.stopPropagation();
          slapAgent(agent.id);
        })
      }
      onContextMenu={onSelect && ((e) => e.nativeEvent.preventDefault())}
    >
      <group ref={sway}>
        <CharacterBoundary fallback={capsule} onError={() => (motion.current.spawnLeft = 0)}>
          <Suspense fallback={null}>
            <Character
              look={look}
              state={agent.state}
              motion={motion}
              extra={bottleOn ? POTION_PROP : undefined}
              rod={fishes}
            />
          </Suspense>
        </CharacterBoundary>
      </group>
      {/* Session colour on the floor, inside the state ring: links the figure to its card.
          A doomed figure no longer belongs to a session: no disc, ring, gem nor tag. */}
      {!exit && (
        <>
          <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.42, 32]} />
            <meshBasicMaterial color={color} transparent opacity={0.85} />
          </mesh>
          <mesh ref={ring} position={[0, 0.06, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.5, 0.06, 8, 32]} />
            <meshBasicMaterial color={STATE_COLORS[agent.state]} />
          </mesh>
        </>
      )}
      {/* Left waiting at the altar for ten minutes: cobwebs grow over the sleeping agent. */}
      {!exit && altarStage === 'webbed' && (
        <group ref={webs} visible={false}>
          <AltarCobwebs />
        </group>
      )}
      {/* Waiting for a prompt: the small amber gem. At the altar, a speech bubble rides on the name tag. */}
      {waiting && !urgent && !exit && (
        <mesh ref={bubble} position={[0, BUBBLE_Y, 0]}>
          <octahedronGeometry args={[0.16]} />
          <meshBasicMaterial color={STATE_COLORS.waiting} />
        </mesh>
      )}
      {connected && !exit && (
        <Html
          ref={anchor}
          position={[0, TAG_Y, 0]}
          center
          className="agent-tag-anchor"
          style={{ '--session-color': color } as CSSProperties}
          zIndexRange={[10, 0]}
        >
          {/* While walking, the destination badge takes the request bubble's place (CSS). */}
          <DestinationBadge ref={badge} kind={destination} />
          {urgent && <RequestBubble reason={agent.waitReason} />}
          {isAsleep(altarStage) && <SnoreBubble />}
          {/* Same name as in the side list, which is the accessible one: not announced twice. */}
          <span className={`agent-tag${selected ? ' agent-tag--selected' : ''}`} aria-hidden="true">
            {name}
          </span>
        </Html>
      )}
      {/* One stable anchor; the effect inside remounts on each slap to restart its animations. */}
      {connected && onSelect && (
        <Html position={[0, SLAP_Y, 0]} center className="slap-anchor" zIndexRange={[30, 20]}>
          {slap !== null && <SlapEffect key={slap} dodged={dodged} />}
          {mishap?.bubble && <MishapEffect key={mishap.n} kind={mishap.kind} />}
        </Html>
      )}
      {!exit && <Soot root={group} mishap={mishap} />}
      {/* Mounted only while the potion acts; the effect remounts on each potion. */}
      {connected && potion !== null && !exit && (
        <Html position={[0, POTION_Y, 0]} center className="potion-anchor" zIndexRange={[30, 20]}>
          <PotionEffect key={potion} />
        </Html>
      )}
      {/* The 3D hand sweeps the other way on every other slap; none under reduced motion. */}
      {slap !== null && !reducedMotion() && <SlapHand key={slap} dir={slap % 2 === 0 ? 1 : -1} />}
    </group>
  );
}
