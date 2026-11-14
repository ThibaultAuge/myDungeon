import { Component, memo, Suspense, useEffect, useMemo, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import { Html, useAnimations } from '@react-three/drei';
import { LoopOnce, LoopRepeat, Vector3, type AnimationClip, type Group, type Mesh, type Object3D, type SkinnedMesh } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AgentState, AgentView } from '@agent-office/shared';
import { STATE_COLORS, statusKind } from '../format.ts';
import { reducedMotion } from '../motion.ts';
import { clipFor, CLIPS, gripFor, lookFor, SPAWN_TIME_SCALE, type ClipName, type Look, type PropRef } from './characters.ts';
import { CLICK_MAX_DRAG_PX, setPointerHover, TARGET_USER_DATA } from './cursor.ts';
import { DestinationBadge } from './DestinationIcon.tsx';
import { destinationOf } from './destinations.ts';
import { KIT_SCALE } from './dungeon.ts';
import { useKitGLTF } from './kit.ts';
import { reroute, routeBetween, SPAWN, type Point, type Spot } from './layout.ts';
import { RequestBubble } from './RequestBubble.tsx';
import { advance, approach, nextSpeed, remainingDistance, turnToward } from './walk.ts';

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

/** What the figure does this frame, written by the walk and read by the character. */
interface Motion {
  moving: boolean;
  speed: number;
  kneeling: boolean;
  /** Seconds of spawn clip left; -1 until the character has loaded and set it. */
  spawnLeft: number;
}

/** Share of the gap to close this frame for an exponential turn; all of it under reduced motion. */
function turnFraction(rate: number, dt: number, still: boolean): number {
  return still ? 1 : 1 - Math.exp(-rate * dt);
}

/** The animation clips shared by every character, loaded once. */
function useClips(): AnimationClip[] {
  const general = useKitGLTF('adventurers_anim', 'Rig_Medium_General');
  const movement = useKitGLTF('adventurers_anim', 'Rig_Medium_MovementBasic');
  return useMemo(() => {
    const wanted = new Set<string>(CLIPS);
    const clips = [...general.animations, ...movement.animations].filter((c) => wanted.has(c.name));
    if (import.meta.env.DEV) {
      const found = clips.map((c) => c.name);
      const missing = CLIPS.filter((n) => !found.includes(n));
      // A missing clip leaves a figure in its bind pose without any other sign.
      if (missing.length || found.length !== new Set(found).size) console.warn('KayKit clips missing or duplicated', { missing, found });
    }
    return clips;
  }, [general.animations, movement.animations]);
}

/** A model held in a hand: a plain clone (shared geometry and materials) inside the hand bone. */
function Held({ prop, bone }: { prop: PropRef; bone: Object3D }) {
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
    <group position={grip.position} rotation={grip.rotation} scale={grip.scale}>
      <primitive object={object} />
    </group>,
    bone,
  );
}

/**
 * The animated KayKit character. It suspends while its files load, so it sits in its own
 * Suspense and error boundary: the tag, ring and disc next to it never wait for it.
 */
function Character({ look, state, motion }: { look: Look; state: AgentState; motion: RefObject<Motion> }) {
  // One skinned clone per figure: the skeleton is its own, geometry and materials are shared.
  const { scene } = useKitGLTF('adventurers', look.body);
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
    });
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
      {look.right && hands.right && <Held prop={look.right} bone={hands.right} />}
      {look.left && hands.left && <Held prop={look.left} bone={hands.left} />}
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
  /** Absent for the resting figures, which cannot be selected. */
  onSelect?(id: string): void;
  /** Called once when a finished agent reaches its spot in the tavern. */
  onArrive?(id: string): void;
}

/**
 * Memoised: the scene re-renders every second for the clock, and a figure whose props did
 * not change (same agent object, spot and callbacks) has nothing to redraw.
 */
export const AgentFigure = memo(AgentFigureImpl);

function AgentFigureImpl({ agent, name, color, spot, start, selected, onSelect, onArrive }: Props) {
  const group = useRef<Group>(null);
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
  const path = useRef<Point[]>(start.id === spot.id ? [] : routeBetween(start, spot));
  const last = useRef<Spot>(spot);
  const arrived = useRef(false);
  // A figure coming out of the lockers rises from the ground before it walks; one coming
  // from a resting seat just walks, and one already finished does not rise.
  const motion = useRef<Motion>({
    moving: false,
    speed: 0,
    kneeling: false,
    spawnLeft: start.id === SPAWN.id && agent.state !== 'done' ? -1 : 0,
  });

  useEffect(() => {
    if (last.current.id === spot.id) return;
    // From where the agent is, not from where it was going: never through a wall.
    path.current = reroute(path.current, last.current, spot);
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

    m.moving = false;
    if (!spawning && path.current.length > 0) {
      // A reroute keeps the current speed: the agent changes course without stopping.
      // Accepted limit: if the new destination is within the braking distance, the speed
      // drops to the braking curve in one frame, and a route that doubles back turns at speed.
      m.speed = nextSpeed(m.speed, remainingDistance(pos, path.current), dt);
      const heading = advance(pos, path.current, m.speed * dt);
      if (heading !== null) g.rotation.y = turnToward(g.rotation.y, heading, turnFraction(WALK_TURN_RATE, dt, still));
      m.moving = path.current.length > 0;
    } else if (!spawning) {
      m.speed = 0;
      // `last` catches up with `spot` in an effect: until then the agent has not set off yet.
      if (onArrive && agent.state === 'done' && last.current.id === spot.id && !arrived.current) {
        arrived.current = true;
        onArrive(agent.id);
      }
      g.rotation.y = turnToward(g.rotation.y, spot.facing, turnFraction(REST_TURN_RATE, dt, still));
    }
    m.kneeling = path.current.length === 0 && !!spot.kneel;
    // Touch the DOM only when walking starts or stops: no React render per frame. The tag
    // is a separate React root that renders a little later: until it shows the new
    // destination's icon, show none rather than the previous one.
    const tag = anchor.current;
    const travelling = m.moving && badge.current?.dataset.destination === destination;
    if (tag && tag.hasAttribute('data-travelling') !== travelling) tag.toggleAttribute('data-travelling', travelling);
    g.position.copy(pos);

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
    >
      <CharacterBoundary fallback={capsule} onError={() => (motion.current.spawnLeft = 0)}>
        <Suspense fallback={null}>
          <Character look={lookFor(agent.kind, agent.agentType)} state={agent.state} motion={motion} />
        </Suspense>
      </CharacterBoundary>
      {/* Session colour on the floor, inside the state ring: links the figure to its card. */}
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.42, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} />
      </mesh>
      <mesh ref={ring} position={[0, 0.06, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.5, 0.06, 8, 32]} />
        <meshBasicMaterial color={STATE_COLORS[agent.state]} />
      </mesh>
      {/* Waiting for a prompt: the small amber gem. At the altar, a speech bubble rides on the name tag. */}
      {waiting && !urgent && (
        <mesh ref={bubble} position={[0, BUBBLE_Y, 0]}>
          <octahedronGeometry args={[0.16]} />
          <meshBasicMaterial color={STATE_COLORS.waiting} />
        </mesh>
      )}
      {connected && (
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
          {/* Same name as in the side list, which is the accessible one: not announced twice. */}
          <span className={`agent-tag${selected ? ' agent-tag--selected' : ''}`} aria-hidden="true">
            {name}
          </span>
        </Html>
      )}
    </group>
  );
}
