import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { Color, DoubleSide, LatheGeometry, MeshStandardMaterial, SphereGeometry, Vector2, type Group } from 'three';
import { reducedMotion } from '../motion.ts';
import { agentPositions } from './AgentFigure.tsx';
import type { Point } from './layout.ts';
import { GHOST_SPEED, evaporation, nearestOnCorridor, nextWander, seededRandom, wanderStart } from './ghost.ts';

// A sheet ghost built from simple shapes (no KayKit pack has one): a dome with a wavy skirt
// and two dark eyes. It floats along the corridors, through walls when it leaves the room
// where its body was, and fades upwards when its session leaves.

/** Height of the skirt's lowest point above the floor. */
const HOVER = 0.3;
/** Up-and-down float, in metres and radians per second. */
const BOB = 0.1;
const BOB_RATE = 1.8;
/** Height of the name tag, above the dome. */
const TAG_Y = 2.05;
/** Body opacity at rest: see-through, yet readable on the stone floor. */
const BODY_OPACITY = 0.72;
/** Turn rate towards the travel direction (per second, exponential). */
const TURN_RATE = 4;

/** Dome and straight sides, swept around Y: radius 0.42, 1.3 m tall. */
const BODY_GEO = (() => {
  const profile: Vector2[] = [];
  for (let i = 0; i <= 4; i++) profile.push(new Vector2(0.44 - i * 0.005, i * 0.17));
  for (let i = 1; i <= 10; i++) {
    const a = (i / 10) * (Math.PI / 2);
    profile.push(new Vector2(Math.max(0.0001, 0.42 * Math.cos(a)), 0.68 + 0.62 * Math.sin(a)));
  }
  const geo = new LatheGeometry(profile, 40);
  // A wavy hem: the bottom ring goes up and down six times around.
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0.01) continue;
    p.setY(i, 0.07 * Math.sin(6 * Math.atan2(p.getZ(i), p.getX(i))));
  }
  geo.computeVertexNormals();
  return geo;
})();
const EYE_GEO = new SphereGeometry(0.07, 12, 10);
/** Two flattened ovals on the front of the dome (stable arrays: no re-application per render). */
const EYES: readonly [number, number, number][] = [
  [-0.14, 1.02, 0.38],
  [0.14, 1.02, 0.38],
];
const EYE_SCALE: [number, number, number] = [1, 1.5, 0.6];

/** Ghost meshes are never pointer targets: a click goes through to what lies behind. */
const noRaycast = () => null;

const WHITE = new Color('#e8eeff');

function GhostFigureImpl({
  id,
  name,
  color,
  bodyId,
  leaving,
  onGone,
}: {
  id: string;
  name: string;
  color: string;
  /** Id of the main agent figure it replaces: its last position, if any, is where the ghost appears. */
  bodyId: string;
  leaving: boolean;
  onGone: (id: string) => void;
}) {
  const connected = useThree((s) => !!s.events.connected);
  const group = useRef<Group>(null);
  const body = useRef<Group>(null);
  const [random] = useState(() => seededRandom(id));
  // Mutable wander state, read and changed by useFrame only: never triggers a render.
  const wander = useRef<{ x: number; z: number; heading: number; path: Point[]; at: Point; t: number; still: boolean } | null>(null);
  if (!wander.current) {
    // Read on mount only, best effort: a seated agent that just became a ghost rises from its
    // body while that figure is still mounted in this render; otherwise a random corridor end.
    const corpse = agentPositions.get(bodyId);
    const from: Point = corpse ? { x: corpse.x, z: corpse.z } : wanderStart(random);
    // Straight to the nearest corridor (through any wall), then from corridor end to corridor end.
    const entry = nearestOnCorridor(from);
    wander.current = { x: from.x, z: from.z, heading: 0, path: [entry], at: entry, t: random() * 10, still: false };
  }
  const out = useRef({ elapsed: 0, gone: false });
  useEffect(() => {
    // A ghost that leaves then becomes a ghost again under the same key starts afresh.
    if (!leaving) out.current = { elapsed: 0, gone: false };
  }, [leaving]);

  const materials = useMemo(() => {
    const glow = new Color(color).lerp(WHITE, 0.55);
    return {
      body: new MeshStandardMaterial({
        color: WHITE,
        emissive: glow,
        emissiveIntensity: 0.45,
        roughness: 0.6,
        transparent: true,
        opacity: BODY_OPACITY,
        depthWrite: false,
        side: DoubleSide,
      }),
      eye: new MeshStandardMaterial({ color: '#1d1b26', roughness: 0.4, transparent: true, opacity: 1 }),
    };
  }, [color]);
  useEffect(
    () => () => {
      materials.body.dispose();
      materials.eye.dispose();
    },
    [materials],
  );

  useFrame((_, dt) => {
    const g = group.current;
    const b = body.current;
    if (!g || !b) return;
    const still = reducedMotion();
    let fade = 1;
    let rise = 0;
    if (leaving) {
      if (still) out.current.elapsed = Infinity;
      else out.current.elapsed += dt * 1000;
      const ev = evaporation(out.current.elapsed);
      fade = ev.opacity;
      rise = ev.rise;
      if (ev.done && !out.current.gone) {
        out.current.gone = true;
        onGone(id);
      }
    }
    const state = wander.current!;
    if (still && !state.still) {
      // No drift and no float: the ghost waits on the corridor nearest to where it is now.
      const p = nearestOnCorridor(state);
      state.x = p.x;
      state.z = p.z;
      state.at = p;
      state.path = [];
    }
    state.still = still;
    if (!still) {
      state.t += dt;
      let step = GHOST_SPEED * Math.min(dt, 0.1);
      while (step > 0) {
        if (state.path.length === 0) state.path = nextWander(random, state.at);
        const target = state.path[0];
        const dx = target.x - state.x;
        const dz = target.z - state.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 1e-4) state.heading = Math.atan2(dx, dz);
        if (dist <= step) {
          state.x = target.x;
          state.z = target.z;
          state.at = target;
          state.path.shift();
          step -= dist;
          // An empty leg (already there) must not spin forever within one frame.
          if (dist <= 1e-4 && state.path.length === 0) break;
        } else {
          state.x += (dx / dist) * step;
          state.z += (dz / dist) * step;
          step = 0;
        }
      }
    }
    g.position.set(state.x, 0, state.z);
    const turn = still ? 1 : 1 - Math.exp(-TURN_RATE * dt);
    const delta = Math.atan2(Math.sin(state.heading - b.rotation.y), Math.cos(state.heading - b.rotation.y));
    b.rotation.y += delta * turn;
    b.position.y = HOVER + rise + (still ? 0 : Math.sin(state.t * BOB_RATE) * BOB);
    // A slight sway of the sheet as it floats.
    b.rotation.z = still ? 0 : Math.sin(state.t * BOB_RATE * 0.7) * 0.06;
    materials.body.opacity = BODY_OPACITY * fade;
    materials.eye.opacity = fade;
  });

  return (
    <group ref={group}>
      <group ref={body}>
        <mesh geometry={BODY_GEO} material={materials.body} dispose={null} raycast={noRaycast} renderOrder={1} />
        {EYES.map((position) => (
          <mesh
            key={position[0]}
            geometry={EYE_GEO}
            material={materials.eye}
            dispose={null}
            raycast={noRaycast}
            position={position}
            scale={EYE_SCALE}
            renderOrder={2}
          />
        ))}
      </group>
      {connected && !leaving && (
        <Html
          position={[0, TAG_Y, 0]}
          center
          className="agent-tag-anchor"
          style={{ '--session-color': color } as CSSProperties}
          zIndexRange={[10, 0]}
        >
          {/* Not announced: a ghost is not a session one can open. */}
          <span className="agent-tag agent-tag--ghost" aria-hidden="true">
            {name}
          </span>
        </Html>
      )}
    </group>
  );
}

export const GhostFigure = memo(GhostFigureImpl);
