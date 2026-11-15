import { memo, Suspense, useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  MeshStandardMaterial,
  SphereGeometry,
  TubeGeometry,
  Vector3,
  type Group,
} from 'three';
import { reducedMotion } from '../motion.ts';
import { KIT_SCALE } from './dungeon.ts';
import { useKitParts } from './kit.ts';
import {
  CHEESE_SPOT,
  MOUTH_AHEAD,
  cheeseScale,
  emergeScale,
  installRatCommand,
  nextPassDelay,
  pickPass,
  planRun,
  sampleRun,
  type RatPass,
  type RatRun,
} from './rat.ts';
import { turnToward } from './walk.ts';

// A rat built from simple shapes (no free KayKit pack has one), and the tavern cheese it
// sometimes steals. Logic and timings: rat.ts. Neither is a pointer target nor has any text.

/** The rat is drawn much larger than life (about 0.6 m without the tail), or it would vanish at the usual zoom. */
const RAT_SCALE = 1.9;
/** The cheese model (KayKit Restaurant) at this size is about 0.36 m wide: readable at the usual zoom. */
const CHEESE_SCALE = 0.5 * KIT_SCALE;
/** Height of the cheese held in the mouth, above the rat's feet (the distance ahead is `MOUTH_AHEAD`). */
const MOUTH_UP = 0.06 * RAT_SCALE;
/** Centre of the cheese model along x, in model units: its origin is at its bottom, off-centre in x. */
const CHEESE_CENTRE_X = 0.1535;
/** The cheese's turn on the table, kept in the mouth (relative to the rat, which lands facing +z). */
const CHEESE_TURN = 0.5;
/** Turn rate towards the travel direction (per second, exponential). */
const TURN_RATE = 18;
/** Trot: steps per second, bob height. */
const STEP_RATE = 14;
const BOB = 0.012;

const FUR = new MeshStandardMaterial({ color: '#6e6159', roughness: 0.9 });
const PINK = new MeshStandardMaterial({ color: '#d9969a', roughness: 0.7 });
const EYE = new MeshStandardMaterial({ color: '#141014', roughness: 0.3 });

const BALL = new SphereGeometry(1, 14, 10);
const SNOUT = new ConeGeometry(0.055, 0.13, 12).rotateX(Math.PI / 2);
const EAR = new CylinderGeometry(0.035, 0.035, 0.008, 12).rotateX(Math.PI / 2);
/** A curled tail trailing behind, built along +z then turned backwards. */
const TAIL = new TubeGeometry(
  new CatmullRomCurve3([
    new Vector3(0, 0, 0),
    new Vector3(0.03, 0.02, -0.1),
    new Vector3(-0.04, 0.03, -0.2),
    new Vector3(0.02, 0.02, -0.3),
    new Vector3(0.07, 0.04, -0.36),
  ]),
  16,
  0.012,
  6,
);

/** Rat and cheese meshes are never pointer targets: a click goes through to what lies behind. */
const noRaycast = () => null;

/** The procedural rat, facing +z, feet at y = 0. `tail` and `feet` are animated by the parent. */
function RatBody({ tail, feet }: { tail: RefObject<Group | null>; feet: RefObject<(Group | null)[]> }) {
  return (
    <group scale={RAT_SCALE}>
      <mesh raycast={noRaycast} geometry={BALL} material={FUR} position={[0, 0.075, 0]} scale={[0.07, 0.06, 0.13]} />
      <mesh raycast={noRaycast} geometry={BALL} material={FUR} position={[0, 0.09, 0.12]} scale={[0.055, 0.05, 0.06]} />
      <mesh raycast={noRaycast} geometry={SNOUT} material={FUR} position={[0, 0.085, 0.2]} />
      <mesh raycast={noRaycast} geometry={BALL} material={PINK} position={[0, 0.083, 0.265]} scale={0.012} />
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh raycast={noRaycast} geometry={EAR} material={PINK} position={[side * 0.04, 0.14, 0.11]} rotation={[0, side * 0.4, 0]} />
          <mesh raycast={noRaycast} geometry={BALL} material={EYE} position={[side * 0.03, 0.105, 0.17]} scale={0.011} />
        </group>
      ))}
      <group ref={tail} position={[0, 0.06, -0.12]}>
        <mesh raycast={noRaycast} geometry={TAIL} material={PINK} />
      </group>
      {[
        [-0.045, 0.07],
        [0.045, 0.07],
        [-0.045, -0.07],
        [0.045, -0.07],
      ].map(([x, z], i) => (
        <group
          key={i}
          ref={(g) => {
            feet.current[i] = g;
          }}
          position={[x, 0.012, z]}
        >
          <mesh raycast={noRaycast} geometry={BALL} material={PINK} scale={[0.016, 0.012, 0.022]} />
        </group>
      ))}
    </group>
  );
}

/** The cheese model, centred on its origin in x and z, its bottom at y = 0. */
function CheeseModel() {
  const parts = useKitParts('restaurant', 'food_ingredient_cheese');
  return (
    <group scale={CHEESE_SCALE} position={[-CHEESE_CENTRE_X * CHEESE_SCALE, 0, 0]}>
      {parts.map((p, i) => (
        <mesh
          key={i}
          raycast={noRaycast}
          geometry={p.geometry}
          material={p.material}
          matrix={p.matrix}
          matrixAutoUpdate={false}
          receiveShadow
        />
      ))}
    </group>
  );
}

interface Live {
  run: RatRun;
  /** Milliseconds since the run started (frame time, so a hidden tab pauses it). */
  elapsed: number;
  heading: number;
}

/**
 * Plays the rat passes: a natural one every 3 to 6 minutes, or one asked for through the
 * console command `agentOffice.rat(pass?)`.
 */
export const RatScene = memo(function RatScene() {
  const [run, setRun] = useState<{ key: number; run: RatRun } | null>(null);
  const live = useRef<Live | null>(null);
  /** Frame-clock time (ms) when a rat that stole the cheese left; null when the cheese is home. */
  const cheeseGoneAt = useRef<number | null>(null);
  const clockMs = useRef(0);
  const counter = useRef(0);
  const rat = useRef<Group>(null);
  const tail = useRef<Group>(null);
  const feet = useRef<(Group | null)[]>([]);
  const cheese = useRef<Group>(null);

  const start = useCallback((kind: RatPass) => {
    const next = planRun(kind, Math.random);
    live.current = { run: next, elapsed: 0, heading: sampleRun(next, 0).heading };
    // A replaced theft gives its cheese back at once.
    cheeseGoneAt.current = null;
    setRun({ key: ++counter.current, run: next });
  }, []);

  // Test command, for the console.
  useEffect(
    () => installRatCommand(window, { start, reducedMotion, log: (message) => console.info(message) }),
    [start],
  );

  // Natural passes. A hidden tab, reduced motion or a rat already out skips that turn.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        if (!document.hidden && !reducedMotion() && !live.current) start(pickPass(Math.random));
        schedule();
      }, nextPassDelay(Math.random));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [start]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    clockMs.current += dt * 1000;
    const now = clockMs.current;
    const current = live.current;
    let carried = false;
    const still = reducedMotion();
    // Under reduced motion the cheese is always home, without growing back.
    if (still) cheeseGoneAt.current = null;
    if (current) {
      if (still) {
        // No running rat under reduced motion: it vanishes.
        live.current = null;
        setRun(null);
      } else {
        current.elapsed += dt * 1000;
        const pose = sampleRun(current.run, current.elapsed);
        if (pose.done) {
          live.current = null;
          if (current.run.kind === 'cheese') cheeseGoneAt.current = now;
          setRun(null);
        } else {
          carried = pose.carrying;
          current.heading = turnToward(current.heading, pose.heading, 1 - Math.exp(-TURN_RATE * dt));
          const g = rat.current;
          if (g) {
            const phase = (current.elapsed / 1000) * STEP_RATE;
            const trot = pose.moving && pose.y === 0 ? 1 : 0;
            g.position.set(pose.x, pose.y + trot * BOB * Math.abs(Math.sin(phase)), pose.z);
            g.rotation.set(0, current.heading, trot * 0.06 * Math.sin(phase));
            g.scale.setScalar(emergeScale(current.run, current.elapsed));
            if (tail.current) tail.current.rotation.y = 0.35 * Math.sin(phase * (pose.moving ? 0.5 : 0.15));
            feet.current.forEach((f, i) => {
              if (f) f.position.z = (i < 2 ? 0.07 : -0.07) + trot * 0.025 * Math.sin(phase + (i % 3 === 0 ? 0 : Math.PI));
            });
          }
          const c = cheese.current;
          if (c && carried) {
            const size = emergeScale(current.run, current.elapsed);
            c.position.set(
              pose.x + Math.sin(current.heading) * MOUTH_AHEAD * size,
              pose.y + MOUTH_UP * size,
              pose.z + Math.cos(current.heading) * MOUTH_AHEAD * size,
            );
            c.rotation.set(0, current.heading + CHEESE_TURN, 0);
            c.scale.setScalar(size);
          }
        }
      }
    }
    const c = cheese.current;
    if (c && !carried) {
      const since = cheeseGoneAt.current === null ? null : now - cheeseGoneAt.current;
      const scale = cheeseScale(since);
      if (scale >= 1) cheeseGoneAt.current = null;
      c.position.set(CHEESE_SPOT.x, CHEESE_SPOT.y, CHEESE_SPOT.z);
      c.rotation.set(0, CHEESE_TURN, 0);
      c.scale.setScalar(scale);
      c.visible = scale > 0;
    } else if (c) {
      c.visible = true;
    }
  });

  return (
    <>
      <group ref={cheese} position={[CHEESE_SPOT.x, CHEESE_SPOT.y, CHEESE_SPOT.z]}>
        <Suspense fallback={null}>
          <CheeseModel />
        </Suspense>
      </group>
      {run && (
        <group key={run.key} ref={rat} position={[0, -10, 0]}>
          <RatBody tail={tail} feet={feet} />
        </group>
      )}
    </>
  );
});
