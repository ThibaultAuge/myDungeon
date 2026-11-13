import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { Mesh, MeshLambertMaterial } from 'three';
import { ROOM_NAMES } from '../format.ts';
import { reducedMotion } from '../motion.ts';
import { ROOMS } from './layout.ts';

function Box({ size, pos, color }: { size: [number, number, number]; pos: [number, number, number]; color: string }) {
  return (
    <mesh position={pos}>
      <boxGeometry args={size} />
      <meshLambertMaterial color={color} />
    </mesh>
  );
}

function Desk({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <Box size={[1.8, 0.08, 1]} pos={[0, 0.75, 0]} color="#C8B89A" />
      {[-0.8, 0.8].flatMap((dx) =>
        [-0.4, 0.4].map((dz) => <Box key={`${dx}${dz}`} size={[0.08, 0.75, 0.08]} pos={[dx, 0.37, dz]} color="#5F5E5A" />),
      )}
      <Box size={[0.7, 0.45, 0.05]} pos={[0, 1.05, -0.3]} color="#2C2C2A" />
    </group>
  );
}

function ServerLed({ x, phase }: { x: number; phase: number }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const mat = ref.current?.material as MeshLambertMaterial | undefined;
    const on = reducedMotion() || Math.sin(clock.elapsedTime * 3 + phase) > 0;
    mat?.color.set(on ? '#5DCAA5' : '#085041');
  });
  return (
    <mesh ref={ref} position={[x, 1.7, 8.04]}>
      <boxGeometry args={[0.6, 0.06, 0.02]} />
      <meshLambertMaterial color="#5DCAA5" />
    </mesh>
  );
}

const WALL = '#B4B2A9';
const WALL_H = 1.1;
const BOOK_COLORS = ['#534AB7', '#1D9E75', '#D85A30', '#378ADD'];

/** Static office: floors, walls, furniture and room signs. */
export function OfficeRooms() {
  return (
    <group>
      {ROOMS.map((r) => (
        <group key={r.id}>
          <Box size={[8.6, 0.2, 8.6]} pos={[r.center[0], -0.1, r.center[1]]} color={r.floor} />
          <Html position={[r.center[0], 2.2, r.center[1] + (r.center[1] < 0 ? -3.6 : 3.6)]} center className="room-sign" zIndexRange={[5, 0]}>
            {ROOM_NAMES[r.id]}
          </Html>
        </group>
      ))}
      <Box size={[2.6, 0.2, 2.6]} pos={[0, -0.1, 0]} color="#D3D1C7" />

      <Box size={[18.8, WALL_H, 0.25]} pos={[0, WALL_H / 2, -9.3]} color={WALL} />
      <Box size={[18.8, WALL_H, 0.25]} pos={[0, WALL_H / 2, 9.3]} color={WALL} />
      <Box size={[0.25, WALL_H, 18.8]} pos={[-9.3, WALL_H / 2, 0]} color={WALL} />
      <Box size={[0.25, WALL_H, 18.8]} pos={[9.3, WALL_H / 2, 0]} color={WALL} />
      {[-5.3, 5.3].map((p) => (
        <group key={p}>
          <Box size={[7.8, WALL_H, 0.2]} pos={[p, WALL_H / 2, 0]} color={WALL} />
          <Box size={[0.2, WALL_H, 7.8]} pos={[0, WALL_H / 2, p]} color={WALL} />
        </group>
      ))}

      {/* Accueil: two desks, a coffee machine and a sofa */}
      <Desk x={-6.6} z={-6.8} />
      <Desk x={-3.2} z={-6.8} />
      <Box size={[0.7, 1.2, 0.6]} pos={[-2.2, 0.6, -1.6]} color="#993C1D" />
      <Box size={[2.6, 0.45, 0.8]} pos={[-5.8, 0.22, -1.4]} color="#7F77DD" />

      {/* Atelier code: four desks */}
      {[
        [2.6, -6.6],
        [6.6, -6.6],
        [2.6, -3],
        [6.6, -3],
      ].map(([x, z]) => (
        <Desk key={`${x}${z}`} x={x} z={z} />
      ))}

      {/* Bibliothèque: three shelves and a reading table */}
      {[0, 1, 2].map((i) => (
        <group key={i}>
          <Box size={[2.4, 2.2, 0.5]} pos={[-7.2 + i * 2.6, 1.1, 8.6]} color="#8B6A4A" />
          {[0, 1, 2, 3].map((j) => (
            <Box key={j} size={[2.2, 0.35, 0.35]} pos={[-7.2 + i * 2.6, 0.35 + j * 0.52, 8.45]} color={BOOK_COLORS[(i + j) % 4]} />
          ))}
        </group>
      ))}
      <Box size={[1.6, 0.08, 1.6]} pos={[-4.6, 0.75, 3.1]} color="#C8B89A" />
      <Box size={[0.15, 0.75, 0.15]} pos={[-4.6, 0.37, 3.1]} color="#5F5E5A" />

      {/* Salle serveur: four racks with blinking lights */}
      {[0, 1, 2, 3].map((i) => (
        <group key={i}>
          <Box size={[1, 2.2, 0.9]} pos={[3 + i * 1.6, 1.1, 8.5]} color="#2C2C2A" />
          <ServerLed x={3 + i * 1.6} phase={i} />
        </group>
      ))}
    </group>
  );
}
