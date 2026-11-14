import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { Vector3, type Group, type Mesh } from 'three';
import type { AgentView } from '@agent-office/shared';
import { STATE_COLORS } from '../format.ts';
import { reducedMotion } from '../motion.ts';
import { reroute, routeBetween, type Point, type Spot } from './layout.ts';
import { advance, nextSpeed, remainingDistance } from './walk.ts';

/** Live positions of the figures, read by the camera to follow the selected agent. */
export const agentPositions = new Map<string, Vector3>();

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

export function AgentFigure({ agent, name, color, spot, start, selected, onSelect, onArrive }: Props) {
  const group = useRef<Group>(null);
  const body = useRef<Mesh>(null);
  const ring = useRef<Mesh>(null);
  const bubble = useRef<Mesh>(null);
  const pos = useMemo(() => new Vector3(start.x, 0, start.z), []); // eslint-disable-line react-hooks/exhaustive-deps
  const path = useRef<Point[]>(start.id === spot.id ? [] : routeBetween(start, spot));
  const last = useRef<Spot>(spot);
  const speed = useRef(0);
  const arrived = useRef(false);

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
  const hovered = useRef(false);
  useEffect(
    () => () => {
      if (hovered.current) document.body.style.cursor = '';
    },
    [],
  );

  useFrame(({ clock }, delta) => {
    const g = group.current;
    if (!g) return;
    // Reduced motion: agents still move between rooms (that is information), the ambient loops stop.
    const t = reducedMotion() ? 0 : clock.elapsedTime;
    const dt = Math.min(delta, 0.05);
    let walking = false;
    if (path.current.length > 0) {
      // A reroute keeps the current speed: the agent changes course without stopping.
      // Accepted limit: if the new destination is within the braking distance, the speed
      // drops to the braking curve in one frame, and a route that doubles back turns at speed.
      speed.current = nextSpeed(speed.current, remainingDistance(pos, path.current), dt);
      const heading = advance(pos, path.current, speed.current * dt);
      if (heading !== null) g.rotation.y = heading;
      walking = path.current.length > 0;
    } else {
      speed.current = 0;
      // `last` catches up with `spot` in an effect: until then the agent has not set off yet.
      if (onArrive && agent.state === 'done' && last.current.id === spot.id && !arrived.current) {
        arrived.current = true;
        onArrive(agent.id);
      }
      // Shortest arc, so an agent never spins a full turn to face its desk.
      const diff = Math.atan2(Math.sin(spot.facing - g.rotation.y), Math.cos(spot.facing - g.rotation.y));
      g.rotation.y += diff * 0.1;
    }
    g.position.copy(pos);
    if (body.current) {
      const bob = walking ? Math.abs(Math.sin(t * 12)) * 0.08 : agent.state === 'working' ? Math.sin(t * 8) * 0.03 : 0;
      // The first of the altar queue kneels: the whole figure sinks a little.
      body.current.position.y = 0.65 + bob;
      g.position.y = path.current.length === 0 && spot.kneel ? -0.3 : 0;
      // The state ring stays on the floor.
      if (ring.current) ring.current.position.y = 0.04 - g.position.y / g.scale.y;
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
      onClick={
        onSelect &&
        ((e) => {
          e.stopPropagation();
          onSelect(agent.id);
        })
      }
      onPointerOver={
        onSelect &&
        (() => {
          hovered.current = true;
          document.body.style.cursor = 'pointer';
        })
      }
      onPointerOut={
        onSelect &&
        (() => {
          hovered.current = false;
          document.body.style.cursor = '';
        })
      }
    >
      <mesh ref={body} position={[0, 0.65, 0]} castShadow>
        <capsuleGeometry args={[0.32, 0.6, 4, 12]} />
        <meshLambertMaterial color={color} />
      </mesh>
      <mesh position={[0, 1.38, 0]} castShadow>
        <sphereGeometry args={[0.26, 16, 12]} />
        <meshLambertMaterial color="#F5C4B3" />
      </mesh>
      <mesh position={[0, 1.42, 0.22]}>
        <boxGeometry args={[0.28, 0.07, 0.08]} />
        <meshLambertMaterial color="#2C2C2A" />
      </mesh>
      <mesh ref={ring} position={[0, 0.06, 0]} rotation={[Math.PI / 2, 0, 0]}>
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
