import { useEffect, useRef, useState, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { MeshBasicMaterial, SphereGeometry, type Mesh, type PointLight } from 'three';
import type { RoomId } from '@agent-office/shared';
import { reducedMotion } from '../motion.ts';
import { ROOM_BY_ID, type PropKind } from './layout.ts';
import { onRoomMishap, PUFF_COLORS, PUFF_COUNT, PUFF_GAP_MS, PUFF_MS, puffParticles, type MishapKind } from './mishap.ts';

// Shared by every puff: one sphere, one material per kind (a kind never has two puffs at once).
const BALL = new SphereGeometry(1, 12, 8);
const MATERIALS: Record<MishapKind, MeshBasicMaterial> = {
  boiler: new MeshBasicMaterial({ color: PUFF_COLORS.boiler, transparent: true, depthWrite: false }),
  flask: new MeshBasicMaterial({ color: PUFF_COLORS.flask, transparent: true, depthWrite: false }),
};
/** Peak intensity of the flash. */
const FLASH = 25;

/** Where each mishap goes off: the boiler of the engine room, the alchemy bench of the trial room. */
const SOURCES: Record<MishapKind, { room: RoomId; prop: PropKind; y: number }> = {
  boiler: { room: 'machines', prop: 'boiler', y: 1.3 },
  flask: { room: 'epreuves', prop: 'alchemyBench', y: 1.2 },
};

/** World position of a mishap's source, from the room definitions (null if the prop moved away). */
function sourcePosition(kind: MishapKind): [number, number, number] | null {
  const { room: roomId, prop: kindOfProp, y } = SOURCES[kind];
  const room = ROOM_BY_ID.get(roomId);
  const prop = room?.props.find((p) => p.kind === kindOfProp);
  return room && prop ? [room.cx + prop.x, y, room.cz + prop.z] : null;
}
const POSITIONS: Record<MishapKind, [number, number, number] | null> = {
  boiler: sourcePosition('boiler'),
  flask: sourcePosition('flask'),
};

/** One puff: smoke balls bursting out and a short flash, then nothing. Remounted for every mishap. */
function Puff({ kind, light }: { kind: MishapKind; light: RefObject<PointLight | null> }) {
  const balls = useRef<(Mesh | null)[]>([]);
  const started = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (light.current) light.current.intensity = 0;
    },
    [light],
  );
  useFrame(({ clock }) => {
    started.current ??= clock.elapsedTime;
    const progress = ((clock.elapsedTime - started.current) * 1000) / PUFF_MS;
    const parts = puffParticles(progress);
    parts.forEach((p, i) => {
      const ball = balls.current[i];
      if (!ball) return;
      ball.position.set(p.x, p.y, p.z);
      ball.scale.setScalar(p.scale);
    });
    // All balls fade together: one shared material per kind.
    MATERIALS[kind].opacity = 0.85 * (parts[0]?.opacity ?? 0);
    // A quick rise then a decay, not a jump from dark to full.
    if (light.current) light.current.intensity = FLASH * Math.max(0, Math.min(progress * 12, 1 - progress * 3));
  });
  return (
    <>
      {Array.from({ length: PUFF_COUNT }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            balls.current[i] = m;
          }}
          geometry={BALL}
          material={MATERIALS[kind]}
          dispose={null}
          scale={0}
          raycast={() => null}
        />
      ))}
    </>
  );
}

function Source({ kind }: { kind: MishapKind }) {
  const [puff, setPuff] = useState<number | null>(null);
  // Always mounted, dark between puffs: a light that came and went would change the scene's
  // light count and make three.js recompile every lit material.
  const light = useRef<PointLight>(null);
  useEffect(() => {
    let count = 0;
    let last = -Infinity;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onRoomMishap((k) => {
      // Reduced motion: no burst nor flash; the bubble and the soot on the agent still say it.
      if (k !== kind || reducedMotion()) return;
      // At most a few flashes per second, even when failures come in bursts (WCAG 2.3.1).
      const now = performance.now();
      if (now - last < PUFF_GAP_MS) return;
      last = now;
      setPuff(++count);
      clearTimeout(timer);
      timer = setTimeout(() => setPuff(null), PUFF_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
      setPuff(null);
    };
  }, [kind]);
  const at = POSITIONS[kind];
  if (!at) return null;
  return (
    <group position={at}>
      <pointLight ref={light} color={PUFF_COLORS[kind]} intensity={0} distance={5} />
      {puff !== null && <Puff key={puff} kind={kind} light={light} />}
    </group>
  );
}

/** The room side of the mishaps: the boiler's puff of smoke and the flask's green blast. */
export function MishapProps() {
  return (
    <>
      <Source kind="boiler" />
      <Source kind="flask" />
    </>
  );
}
