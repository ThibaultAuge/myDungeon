import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { Vector3, type Group, type Mesh } from 'three';
import type { AgentView } from '@agent-office/shared';
import { STATE_COLORS } from '../format.ts';
import { reducedMotion } from '../motion.ts';
import { routeBetween, type Seat } from './layout.ts';

/** Live positions of the figures, read by the camera to follow the selected agent. */
export const agentPositions = new Map<string, Vector3>();

const SPEED = 4.5;

interface Props {
  agent: AgentView;
  name: string;
  color: string;
  seat: Seat;
  selected: boolean;
  onSelect(id: string): void;
}

export function AgentFigure({ agent, name, color, seat, selected, onSelect }: Props) {
  const group = useRef<Group>(null);
  const body = useRef<Mesh>(null);
  const ring = useRef<Mesh>(null);
  const bubble = useRef<Mesh>(null);
  // Subagents appear at the hub and walk to their first seat; main agents start seated.
  const pos = useMemo(() => (agent.kind === 'sub' ? new Vector3(0, 0, 0) : new Vector3(seat.x, 0, seat.z)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const path = useRef<{ x: number; z: number }[]>(agent.kind === 'sub' ? [{ x: seat.x, z: seat.z }] : []);
  const room = useRef(agent.room);

  useEffect(() => {
    path.current = routeBetween(pos, seat, room.current === agent.room);
    room.current = agent.room;
  }, [seat.x, seat.z, agent.room]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    agentPositions.set(agent.id, pos);
    return () => {
      agentPositions.delete(agent.id);
    };
  }, [agent.id, pos]);

  useFrame(({ clock }, delta) => {
    const g = group.current;
    if (!g) return;
    // Reduced motion: agents still move between rooms (that is information), the ambient loops stop.
    const t = reducedMotion() ? 0 : clock.elapsedTime;
    const dt = Math.min(delta, 0.05);
    const next = path.current[0];
    let walking = false;
    if (next) {
      const dx = next.x - pos.x;
      const dz = next.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.06) {
        path.current.shift();
      } else {
        const step = Math.min(dist, SPEED * dt);
        pos.x += (dx / dist) * step;
        pos.z += (dz / dist) * step;
        g.rotation.y = Math.atan2(dx, dz);
        walking = true;
      }
    } else {
      // Shortest arc, so an agent never spins a full turn to face its desk.
      const diff = Math.atan2(Math.sin(seat.facing - g.rotation.y), Math.cos(seat.facing - g.rotation.y));
      g.rotation.y += diff * 0.1;
    }
    g.position.copy(pos);
    if (body.current) {
      const bob = walking ? Math.abs(Math.sin(t * 12)) * 0.08 : agent.state === 'working' ? Math.sin(t * 8) * 0.03 : 0;
      body.current.position.y = 0.65 + bob;
    }
    if (bubble.current) {
      bubble.current.rotation.y = t * 2;
      bubble.current.position.y = 2.05 + Math.sin(t * 4) * 0.08;
    }
    ring.current?.scale.setScalar(selected ? 1.25 + Math.sin(t * 5) * 0.08 : 1);
  });

  const scale = agent.kind === 'sub' ? 0.85 : 1;
  const waiting = agent.state === 'waiting';
  const urgent = waiting && agent.waitReason !== 'prompt';

  return (
    <group
      ref={group}
      scale={scale}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(agent.id);
      }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = '')}
    >
      <mesh ref={body} position={[0, 0.65, 0]}>
        <capsuleGeometry args={[0.32, 0.6, 4, 12]} />
        <meshLambertMaterial color={color} transparent={agent.state === 'done'} opacity={agent.state === 'done' ? 0.55 : 1} />
      </mesh>
      <mesh position={[0, 1.38, 0]}>
        <sphereGeometry args={[0.26, 16, 12]} />
        <meshLambertMaterial color="#F5C4B3" />
      </mesh>
      <mesh position={[0, 1.42, 0.22]}>
        <boxGeometry args={[0.28, 0.07, 0.08]} />
        <meshLambertMaterial color="#2C2C2A" />
      </mesh>
      <mesh ref={ring} position={[0, 0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.5, 0.06, 8, 32]} />
        <meshBasicMaterial color={STATE_COLORS[agent.state]} />
      </mesh>
      {waiting && (
        <mesh ref={bubble} position={[0, 2.05, 0]}>
          <octahedronGeometry args={[urgent ? 0.24 : 0.16]} />
          <meshBasicMaterial color={urgent ? '#E24B4A' : STATE_COLORS.waiting} />
        </mesh>
      )}
      <Html position={[0, 2.55, 0]} center className={`agent-tag${selected ? ' agent-tag--selected' : ''}`} zIndexRange={[10, 0]}>
        {name}
      </Html>
    </group>
  );
}
