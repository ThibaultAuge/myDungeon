import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { Mesh, MeshLambertMaterial } from 'three';
import { reducedMotion } from '../motion.ts';
import { useT } from '../i18n/useT.ts';
import { BOUNDS, doorOf, ROOMS, type Prop, type PropKind, type RoomDef } from './layout.ts';

// The static dungeon: corridor flagstones, room floors, low walls with a door gap, and
// furniture made of simple shapes in a bright "toy" palette.

type V3 = [number, number, number];

function Box({ size, pos, color, rot }: { size: V3; pos: V3; color: string; rot?: V3 }) {
  return (
    <mesh position={pos} rotation={rot}>
      <boxGeometry args={size} />
      <meshLambertMaterial color={color} />
    </mesh>
  );
}

function Cyl({ r, h, pos, color, rTop, rot }: { r: number; h: number; pos: V3; color: string; rTop?: number; rot?: V3 }) {
  return (
    <mesh position={pos} rotation={rot}>
      <cylinderGeometry args={[rTop ?? r, r, h, 16]} />
      <meshLambertMaterial color={color} />
    </mesh>
  );
}

function Ball({ r, pos, color, emissive }: { r: number; pos: V3; color: string; emissive?: boolean }) {
  return (
    <mesh position={pos}>
      <sphereGeometry args={[r, 16, 12]} />
      {emissive ? <meshBasicMaterial color={color} /> : <meshLambertMaterial color={color} />}
    </mesh>
  );
}

const WOOD = '#A0703F';
const WOOD_LIGHT = '#C99A62';
const DARK = '#3E3A36';
const IRON = '#6B7280';
const BRASS = '#D9A93A';
const BOOKS = ['#5B4BD6', '#1FA67A', '#E0613A', '#2F8FE0', '#D94C8A', '#E8B730'];

function Table({ w, d, h = 0.78, color = WOOD_LIGHT }: { w: number; d: number; h?: number; color?: string }) {
  return (
    <group>
      <Box size={[w, 0.1, d]} pos={[0, h, 0]} color={color} />
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => <Box key={`${sx}${sz}`} size={[0.1, h, 0.1]} pos={[sx * (w / 2 - 0.12), h / 2, sz * (d / 2 - 0.12)]} color={WOOD} />),
      )}
    </group>
  );
}

/** Blinking light: steam valves, candles, the crystal of the telescope. */
function Blink({ pos, on, off, phase = 0, r = 0.08 }: { pos: V3; on: string; off: string; phase?: number; r?: number }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const mat = ref.current?.material as MeshLambertMaterial | undefined;
    const lit = reducedMotion() || Math.sin(clock.elapsedTime * 3 + phase) > -0.3;
    mat?.color.set(lit ? on : off);
  });
  return (
    <mesh ref={ref} position={pos}>
      <sphereGeometry args={[r, 10, 8]} />
      <meshBasicMaterial color={on} />
    </mesh>
  );
}

const PROPS: Record<PropKind, () => ReactNode> = {
  altar: () => (
    <group>
      <Box size={[1.8, 0.9, 0.7]} pos={[0, 0.45, 0]} color="#F4F1EA" />
      <Box size={[1.9, 0.08, 0.8]} pos={[0, 0.94, 0]} color={BRASS} />
      <Box size={[0.8, 0.5, 0.05]} pos={[0, 0.95, 0.38]} color="#B83A4B" />
    </group>
  ),
  pew: () => (
    <group>
      <Box size={[2.2, 0.12, 0.45]} pos={[0, 0.42, 0]} color={WOOD} />
      <Box size={[2.2, 0.5, 0.08]} pos={[0, 0.7, 0.22]} color={WOOD} />
      <Box size={[0.08, 0.42, 0.4]} pos={[-1, 0.21, 0]} color={WOOD} />
      <Box size={[0.08, 0.42, 0.4]} pos={[1, 0.21, 0]} color={WOOD} />
    </group>
  ),
  candles: () => (
    <group>
      <Cyl r={0.18} h={1} pos={[0, 0.5, 0]} color={BRASS} rTop={0.05} />
      <Cyl r={0.05} h={0.25} pos={[0, 1.12, 0]} color="#FFF8E1" />
      <Blink pos={[0, 1.32, 0]} on="#FFC845" off="#F59E0B" r={0.06} />
    </group>
  ),
  mapTable: () => (
    <group>
      <Table w={4} d={2.2} />
      <Box size={[3.4, 0.02, 1.7]} pos={[0, 0.84, 0]} color="#F3E6C4" />
      <Box size={[0.9, 0.025, 0.7]} pos={[-0.8, 0.86, 0.2]} color="#7CC08A" />
      <Box size={[0.7, 0.025, 0.5]} pos={[0.9, 0.86, -0.3]} color="#6BA6E0" />
    </group>
  ),
  globe: () => (
    <group>
      <Cyl r={0.3} h={0.9} pos={[0, 0.45, 0]} color={WOOD} rTop={0.08} />
      <Ball r={0.45} pos={[0, 1.3, 0]} color="#4F9BE8" />
      <Ball r={0.2} pos={[0.25, 1.45, 0.25]} color="#5CC27A" />
    </group>
  ),
  bench: () => (
    <group>
      <Table w={2} d={1} h={0.85} color={WOOD} />
      <Box size={[0.3, 0.25, 0.2]} pos={[-0.5, 1, 0]} color={IRON} />
      <Box size={[0.5, 0.06, 0.15]} pos={[0.4, 0.93, 0.1]} color="#C0392B" />
    </group>
  ),
  toolRack: () => (
    <group>
      <Box size={[3.4, 1.6, 0.15]} pos={[0, 0.8, 0]} color={WOOD} />
      {[-1.2, -0.4, 0.4, 1.2].map((x, i) => (
        <Box key={x} size={[0.12, 0.8, 0.1]} pos={[x, 1, 0.12]} color={[IRON, '#C0392B', IRON, BRASS][i]} />
      ))}
    </group>
  ),
  easel: () => (
    <group>
      <Box size={[0.08, 1.8, 0.08]} pos={[-0.35, 0.9, 0]} color={WOOD} rot={[0, 0, 0.12]} />
      <Box size={[0.08, 1.8, 0.08]} pos={[0.35, 0.9, 0]} color={WOOD} rot={[0, 0, -0.12]} />
      <Box size={[1, 0.8, 0.05]} pos={[0, 1.3, 0.06]} color="#FFFDF5" />
      <Box size={[0.3, 0.25, 0.06]} pos={[-0.2, 1.4, 0.08]} color="#E85D9A" />
      <Box size={[0.3, 0.2, 0.06]} pos={[0.2, 1.2, 0.08]} color="#3BB3E0" />
    </group>
  ),
  bookcase: () => (
    <group>
      <Box size={[2.2, 2.2, 0.5]} pos={[0, 1.1, 0]} color={WOOD} />
      {[0, 1, 2, 3].map((j) => (
        <Box key={j} size={[2, 0.36, 0.32]} pos={[0, 0.35 + j * 0.5, 0.12]} color={BOOKS[j % BOOKS.length]} />
      ))}
    </group>
  ),
  readingTable: () => (
    <group>
      <Table w={1.8} d={1} />
      <Box size={[0.4, 0.08, 0.3]} pos={[-0.3, 0.87, 0]} color={BOOKS[0]} />
      <Box size={[0.4, 0.12, 0.3]} pos={[0.4, 0.89, 0.1]} color={BOOKS[2]} />
    </group>
  ),
  lectern: () => (
    <group>
      <Cyl r={0.08} h={0.9} pos={[0, 0.45, 0]} color={WOOD} />
      <Box size={[0.7, 0.06, 0.5]} pos={[0, 1, 0]} color={WOOD_LIGHT} rot={[0.35, 0, 0]} />
      <Box size={[0.5, 0.02, 0.35]} pos={[0, 1.05, 0]} color="#FFF6DD" rot={[0.35, 0, 0]} />
    </group>
  ),
  telescope: () => (
    <group>
      <Cyl r={0.35} h={0.6} pos={[0, 0.3, 0]} color={WOOD} rTop={0.15} />
      <Cyl r={0.18} h={2} pos={[0, 1.3, -0.2]} color={BRASS} rTop={0.12} rot={[-0.7, 0, 0]} />
      <Blink pos={[0, 2.1, -0.85]} on="#BFE4FF" off="#7FB6E8" r={0.13} />
    </group>
  ),
  starTable: () => (
    <group>
      <Table w={2.2} d={1} />
      <Box size={[2, 0.02, 0.8]} pos={[0, 0.84, 0]} color="#1E2A5A" />
      {[-0.6, 0, 0.5].map((x) => (
        <Ball key={x} r={0.04} pos={[x, 0.86, x * 0.3]} color="#FFE680" emissive />
      ))}
    </group>
  ),
  aviary: () => (
    <group>
      <Box size={[2.6, 0.1, 1.2]} pos={[0, 0.05, 0]} color={WOOD} />
      <Box size={[2.6, 0.1, 1.2]} pos={[0, 1.7, 0]} color={WOOD} />
      {[-1.2, -0.6, 0, 0.6, 1.2].map((x) => (
        <Box key={x} size={[0.04, 1.6, 0.04]} pos={[x, 0.88, 0.58]} color={BRASS} />
      ))}
      {[-0.7, 0.1, 0.8].map((x, i) => (
        <Ball key={x} r={0.16} pos={[x, 0.35 + (i % 2) * 0.6, 0]} color={i === 1 ? '#F4F4F4' : '#9AA5B1'} />
      ))}
    </group>
  ),
  boiler: () => (
    <group>
      <Cyl r={0.8} h={1.8} pos={[0, 0.9, 0]} color="#B4532A" />
      <Cyl r={0.15} h={0.9} pos={[0.3, 2.2, 0]} color={DARK} />
      <Blink pos={[0, 0.6, 0.8]} on="#FF7A1A" off="#B83A1A" r={0.14} />
    </group>
  ),
  engine: () => (
    <group>
      <Box size={[1.6, 1.3, 1]} pos={[0, 0.65, 0]} color={IRON} />
      <Cyl r={0.45} h={0.15} pos={[0, 1.1, 0.55]} color={BRASS} rot={[Math.PI / 2, 0, 0]} />
      <Cyl r={0.25} h={0.15} pos={[0.55, 0.6, 0.55]} color={BRASS} rot={[Math.PI / 2, 0, 0]} />
      <Blink pos={[-0.55, 0.5, 0.52]} on="#5DE0A5" off="#1D6B4F" phase={1.3} />
    </group>
  ),
  abacus: () => (
    <group>
      <Box size={[0.1, 1.8, 0.3]} pos={[-1.2, 0.9, 0]} color={WOOD} />
      <Box size={[0.1, 1.8, 0.3]} pos={[1.2, 0.9, 0]} color={WOOD} />
      {[0.5, 0.9, 1.3, 1.7].map((y, j) => (
        <group key={y}>
          <Box size={[2.4, 0.03, 0.03]} pos={[0, y, 0]} color={DARK} />
          {[0, 1, 2, 3].map((k) => (
            <Ball key={k} r={0.09} pos={[-0.9 + k * 0.22 + (j % 2) * 0.8, y, 0]} color={BOOKS[(j + k) % BOOKS.length]} />
          ))}
        </group>
      ))}
    </group>
  ),
  slate: () => (
    <group>
      <Box size={[2.6, 1.4, 0.1]} pos={[0, 1.3, 0]} color="#2E3B36" />
      <Box size={[2.8, 0.1, 0.15]} pos={[0, 0.58, 0]} color={WOOD} />
      <Box size={[1.2, 0.04, 0.02]} pos={[-0.4, 1.5, 0.06]} color="#F2F2F2" />
      <Box size={[0.8, 0.04, 0.02]} pos={[0.3, 1.2, 0.06]} color="#F2F2F2" />
    </group>
  ),
  portcullis: () => (
    <group>
      {[-1.2, -0.6, 0, 0.6, 1.2].map((x) => (
        <Box key={x} size={[0.1, 2.2, 0.1]} pos={[x, 1.1, 0]} color={IRON} />
      ))}
      {[0.6, 1.4, 2.1].map((y) => (
        <Box key={y} size={[2.6, 0.1, 0.1]} pos={[0, y, 0]} color={IRON} />
      ))}
    </group>
  ),
  weaponRack: () => (
    <group>
      <Box size={[2, 0.12, 0.3]} pos={[0, 1.2, 0]} color={WOOD} />
      {[-0.7, -0.2, 0.3, 0.8].map((x) => (
        <Box key={x} size={[0.06, 2, 0.06]} pos={[x, 1, 0.05]} color={x > 0 ? IRON : WOOD} />
      ))}
    </group>
  ),
  lantern: () => (
    <group>
      <Cyl r={0.06} h={1.8} pos={[0, 0.9, 0]} color={DARK} />
      <Box size={[0.3, 0.35, 0.3]} pos={[0, 1.9, 0]} color={DARK} />
      <Blink pos={[0, 1.9, 0]} on="#FFD25A" off="#E8A92A" r={0.12} />
    </group>
  ),
  guardTable: () => (
    <group>
      <Table w={1.2} d={1.2} />
      <Box size={[0.3, 0.05, 0.2]} pos={[0.2, 0.86, 0]} color={BRASS} />
    </group>
  ),
  alchemyBench: () => (
    <group>
      <Table w={3.4} d={0.9} h={0.9} color={WOOD} />
      {[-1.2, -0.6, 0, 0.6, 1.2].map((x, i) => (
        <group key={x}>
          <Cyl r={0.1} h={0.3} pos={[x, 1.1, 0]} color="#DDEEF5" />
          <Blink pos={[x, 1.3, 0]} on={i % 2 ? '#3FD07A' : '#E54B4B'} off="#8FA3AD" phase={i} r={0.07} />
        </group>
      ))}
    </group>
  ),
  stage: () => (
    <group>
      <Cyl r={1.3} h={0.3} pos={[0, 0.15, 0]} color="#C0392B" />
      <Box size={[0.06, 2.6, 0.06]} pos={[0, 1.3, -1.1]} color={WOOD} />
      <Box size={[0.9, 1.1, 0.03]} pos={[0.45, 2, -1.1]} color="#2F6FE0" />
      <Ball r={0.12} pos={[0.85, 2.3, -1.06]} color={BRASS} />
    </group>
  ),
  inspectionDesk: () => (
    <group>
      <Table w={1.4} d={0.8} />
      <Cyl r={0.14} h={0.03} pos={[0.2, 0.86, 0]} color="#CDEBFF" rot={[0, 0, 0]} />
      <Box size={[0.03, 0.25, 0.03]} pos={[0.2, 0.75, 0]} color={BRASS} />
    </group>
  ),
  couch: () => (
    <group>
      <Box size={[2.8, 0.45, 0.9]} pos={[0, 0.25, 0]} color="#E85D9A" />
      <Box size={[2.8, 0.6, 0.25]} pos={[0, 0.7, -0.35]} color="#D94C8A" />
      <Box size={[0.25, 0.4, 0.9]} pos={[-1.3, 0.6, 0]} color="#D94C8A" />
      <Box size={[0.25, 0.4, 0.9]} pos={[1.3, 0.6, 0]} color="#D94C8A" />
    </group>
  ),
  diceTable: () => (
    <group>
      <Cyl r={0.6} h={0.08} pos={[0, 0.7, 0]} color={WOOD_LIGHT} />
      <Cyl r={0.12} h={0.7} pos={[0, 0.35, 0]} color={WOOD} />
      <Box size={[0.14, 0.14, 0.14]} pos={[0.15, 0.81, 0.1]} color="#FFFFFF" rot={[0, 0.5, 0]} />
      <Box size={[0.14, 0.14, 0.14]} pos={[-0.15, 0.81, -0.05]} color="#E54B4B" rot={[0, 1.1, 0]} />
    </group>
  ),
  posters: () => (
    <group>
      <Box size={[0.8, 1, 0.03]} pos={[-0.6, 1.5, 0]} color="#FFC845" />
      <Box size={[0.8, 1, 0.03]} pos={[0.4, 1.6, 0]} color="#3BB3E0" />
      <Box size={[0.5, 0.6, 0.03]} pos={[1.2, 1.3, 0]} color="#7CC08A" />
    </group>
  ),
  brooms: () => (
    <group>
      {[-0.3, 0, 0.3].map((x, i) => (
        <group key={x}>
          <Box size={[0.05, 1.6, 0.05]} pos={[x, 1, 0]} color={WOOD_LIGHT} rot={[0, 0, (i - 1) * 0.08]} />
          <Box size={[0.25, 0.3, 0.12]} pos={[x, 0.2, 0]} color="#E8C25A" />
        </group>
      ))}
    </group>
  ),
  cart: () => (
    <group>
      <Box size={[1, 0.5, 0.6]} pos={[0, 0.5, 0]} color="#2F8FE0" />
      {[-0.4, 0.4].map((x) => (
        <Cyl key={x} r={0.12} h={0.08} pos={[x, 0.12, 0.32]} color={DARK} rot={[Math.PI / 2, 0, 0]} />
      ))}
      <Cyl r={0.2} h={0.35} pos={[0.2, 0.92, 0]} color={IRON} />
    </group>
  ),
  longTable: () => (
    <group>
      <Table w={1.2} d={4} />
      {[-1.2, 0, 1.2].map((z) => (
        <Cyl key={z} r={0.08} h={0.18} pos={[0, 0.92, z]} color={BRASS} />
      ))}
    </group>
  ),
  fireplace: () => (
    <group>
      <Box size={[3, 2.2, 0.8]} pos={[0, 1.1, 0]} color="#8C7B6B" />
      <Box size={[1.6, 1, 0.3]} pos={[0, 0.5, 0.3]} color={DARK} />
      <Blink pos={[0, 0.4, 0.4]} on="#FF8A1A" off="#FFC845" r={0.3} />
    </group>
  ),
  barrel: () => <Cyl r={0.4} h={0.9} pos={[0, 0.45, 0]} color={WOOD} rTop={0.35} />,
  lockers: () => (
    <group>
      {[-1.2, -0.4, 0.4, 1.2].map((z) => (
        <group key={z}>
          <Box size={[0.5, 2, 0.75]} pos={[0, 1, z]} color="#5B6B8C" />
          <Box size={[0.03, 0.1, 0.1]} pos={[-0.26, 1, z + 0.2]} color={BRASS} />
        </group>
      ))}
    </group>
  ),
  rug: () => <Box size={[2.8, 0.02, 1.8]} pos={[0, 0.015, 0]} color="#C0392B" />,
};

function PropMesh({ room, prop }: { room: RoomDef; prop: Prop }) {
  return (
    <group position={[room.cx + prop.x, 0, room.cz + prop.z]} rotation={[0, prop.rot ?? 0, 0]}>
      {PROPS[prop.kind]()}
    </group>
  );
}

const WALL = '#E5D3B3';
const WALL_CAP = '#C9B28C';
const WALL_H = 1.1;
const WALL_T = 0.25;
const DOOR_W = 1.8;
/** Walls sit inside the floor so that two neighbouring rooms never draw on the same spot. */
const WALL_INSET = 0.15;

/** One wall, split around the door when the door is on it. */
function WallRun({ a, b, door }: { a: [number, number]; b: [number, number]; door?: [number, number] }) {
  const horizontal = a[1] === b[1];
  const segs: [number, number][] = [];
  const lo = horizontal ? Math.min(a[0], b[0]) : Math.min(a[1], b[1]);
  const hi = horizontal ? Math.max(a[0], b[0]) : Math.max(a[1], b[1]);
  const d = door ? (horizontal ? door[0] : door[1]) : undefined;
  if (d === undefined) segs.push([lo, hi]);
  else {
    segs.push([lo, d - DOOR_W / 2], [d + DOOR_W / 2, hi]);
  }
  return (
    <>
      {segs
        .filter(([s, e]) => e - s > 0.05)
        .map(([s, e]) => {
          const len = e - s;
          const mid = (s + e) / 2;
          const pos: V3 = horizontal ? [mid, WALL_H / 2, a[1]] : [a[0], WALL_H / 2, mid];
          const size: V3 = horizontal ? [len, WALL_H, WALL_T] : [WALL_T, WALL_H, len];
          const cap: V3 = horizontal ? [len, 0.08, WALL_T + 0.08] : [WALL_T + 0.08, 0.08, len];
          return (
            <group key={s}>
              <Box size={size} pos={pos} color={WALL} />
              <Box size={cap} pos={[pos[0], WALL_H + 0.04, pos[2]]} color={WALL_CAP} />
            </group>
          );
        })}
    </>
  );
}

function RoomWalls({ room }: { room: RoomDef }) {
  const x0 = room.cx - room.w / 2 + WALL_INSET;
  const x1 = room.cx + room.w / 2 - WALL_INSET;
  const z0 = room.cz - room.d / 2 + WALL_INSET;
  const z1 = room.cz + room.d / 2 - WALL_INSET;
  const { wall } = doorOf(room);
  const at: [number, number] = [wall.x, wall.z];
  const side = room.door.side;
  return (
    <group>
      <WallRun a={[x0, z0]} b={[x1, z0]} door={side === 'n' ? at : undefined} />
      <WallRun a={[x0, z1]} b={[x1, z1]} door={side === 's' ? at : undefined} />
      <WallRun a={[x0, z0]} b={[x0, z1]} door={side === 'w' ? at : undefined} />
      <WallRun a={[x1, z0]} b={[x1, z1]} door={side === 'e' ? at : undefined} />
    </group>
  );
}

/** Static dungeon: floors, walls, furniture and room signs. */
export function OfficeRooms() {
  const { t } = useT();
  // drei's Html loses the content of a label mounted before the canvas is connected to its
  // events (its target changes and the new root is never rendered): mount the signs a tick later.
  const [signs, setSigns] = useState(false);
  useEffect(() => setSigns(true), []);
  const w = BOUNDS.x1 - BOUNDS.x0 + 1;
  const d = BOUNDS.z1 - BOUNDS.z0 + 1;
  return (
    <group>
      {/* Corridor flagstones under everything */}
      <Box size={[w, 0.2, d]} pos={[(BOUNDS.x0 + BOUNDS.x1) / 2, -0.12, (BOUNDS.z0 + BOUNDS.z1) / 2]} color="#B9B2A6" />
      {ROOMS.map((r) => (
        <group key={r.id}>
          {r.insideOf ? (
            <Box size={[r.w, 0.01, r.d]} pos={[r.cx, 0.005, r.cz]} color={r.floor} />
          ) : (
            <>
              <Box size={[r.w, 0.2, r.d]} pos={[r.cx, -0.1, r.cz]} color={r.floor} />
              <RoomWalls room={r} />
            </>
          )}
          {r.props.map((p, i) => (
            <PropMesh key={i} room={r} prop={p} />
          ))}
          {signs && (
            <Html position={[r.cx, 2.4, r.cz - r.d / 2 + (r.insideOf ? 0.4 : 0.2)]} center className="room-sign" zIndexRange={[5, 0]}>
              {t.rooms[r.id]}
            </Html>
          )}
        </group>
      ))}
    </group>
  );
}
