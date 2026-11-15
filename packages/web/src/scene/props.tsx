import { useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh, MeshBasicMaterial } from 'three';
import { reducedMotion } from '../motion.ts';
import { DECOR_RECIPES } from './decor.ts';
import { KIT_SCALE, type KitItem } from './dungeon.ts';
import type { Pack } from './kit.ts';
import { Kit, KitInstances } from './KitInstances.tsx';
import type { Accent, PropKind, RoomDef } from './layout.ts';

// Furniture of the dungeon. KayKit models where the packs have one; otherwise simple shapes
// in colours taken from the KayKit palette, so both kinds sit together.

type V3 = [number, number, number];

const PALETTE = {
  wood: '#9A5A3C',
  woodLight: '#C27F4E',
  woodDark: '#6E3F2C',
  stone: '#8F949E',
  stoneLight: '#BFC3CA',
  iron: '#5E6470',
  dark: '#3B3742',
  brass: '#E3A53B',
};

const ACCENT_HEX: Record<Accent, string> = {
  red: '#C8433B',
  blue: '#3F72C8',
  green: '#4E9E4A',
  yellow: '#E6B53A',
  white: '#E9E4DA',
  brown: '#8A5A3A',
};

const BOOKS = ['#5B4BD6', '#1FA67A', '#E0613A', '#2F8FE0', '#D94C8A', '#E8B730'];

/** Only shapes big enough for their shadow to show cast one: each caster costs a draw call. */
const SHADOW_MIN = 0.3;
/** Stools of a tavern long table, relative to the table: one under each seat of layout.ts, a little behind it. */
const STOOL_BACK = 1.25;
const TABLE_STOOLS: readonly [number, number][] = [-1.2, 0, 1.2].flatMap((z) => [
  [-STOOL_BACK, z],
  [STOOL_BACK, z],
]);
const STOOL_SCALE = 0.7;
/** Stools of the relaxation corner's dice table, west, east and north of it (seats at 1 m, hips 0.25 m further). */
const DICE_STOOLS: readonly [number, number][] = [
  [-STOOL_BACK, 0],
  [STOOL_BACK, 0],
  [0, -STOOL_BACK],
];

function Box({ size, pos, color, rot }: { size: V3; pos: V3; color: string; rot?: V3 }) {
  return (
    <mesh position={pos} rotation={rot} castShadow={Math.max(...size) >= SHADOW_MIN} receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={1} />
    </mesh>
  );
}

function Cyl({ r, h, pos, color, rTop, rot }: { r: number; h: number; pos: V3; color: string; rTop?: number; rot?: V3 }) {
  return (
    <mesh position={pos} rotation={rot} castShadow={Math.max(2 * r, h) >= SHADOW_MIN} receiveShadow>
      <cylinderGeometry args={[rTop ?? r, r, h, 16]} />
      <meshStandardMaterial color={color} roughness={1} />
    </mesh>
  );
}

function Ball({ r, pos, color }: { r: number; pos: V3; color: string }) {
  return (
    <mesh position={pos} castShadow={2 * r >= SHADOW_MIN} receiveShadow>
      <sphereGeometry args={[r, 16, 12]} />
      <meshStandardMaterial color={color} roughness={0.8} />
    </mesh>
  );
}

/** Blinking light: steam valves, candles, the crystal of the telescope. Unlit, so it glows. */
function Blink({ pos, on, off, phase = 0, r = 0.08 }: { pos: V3; on: string; off: string; phase?: number; r?: number }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const mat = ref.current?.material as MeshBasicMaterial | undefined;
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

/** Height to give an object whose lowest point is at minY (pack units) to rest on y. */
function on(y: number, minY: number, s: number): number {
  return y - minY * KIT_SCALE * s;
}

/** A tool or a book lying flat on a surface at height y. */
function Lying({ name, pack = 'tools', x, z, y, s, turn = 0 }: { name: string; pack?: 'tools' | 'weapons'; x: number; z: number; y: number; s: number; turn?: number }) {
  return <Kit pack={pack} name={name} pos={[x, y + 0.04, z]} rot={[-Math.PI / 2, 0, turn]} scale={s} />;
}

/** A row of KayKit books on a shelf: one draw call for the whole row. */
function BookRow({ y, z, width, seed }: { y: number; z: number; width: number; seed: number }) {
  const items = useMemo(() => {
    const out: KitItem[] = [];
    const s = 0.5 * KIT_SCALE;
    const step = 0.16;
    for (let x = -width / 2 + step / 2, i = 0; x < width / 2 - step / 2; x += step, i++) {
      // Some books lean a little, as on a real shelf.
      const lean = ((i * 7 + seed) % 5 === 0 ? 0.25 : 0) * ((i + seed) % 2 ? 1 : -1);
      out.push({ x, y: on(y, -0.44, 0.5), z, rotY: Math.PI / 2 + lean, scale: [s, s * (0.85 + ((i * 13 + seed) % 4) * 0.06), s] });
    }
    return out;
  }, [y, z, width, seed]);
  return <KitInstances pack="tools" name="journal_closed" items={items} shadow={false} />;
}

function Pew() {
  const w = PALETTE.wood;
  return (
    <group>
      <Box size={[2.2, 0.1, 0.45]} pos={[0, 0.42, 0]} color={PALETTE.woodLight} />
      <Box size={[2.2, 0.5, 0.08]} pos={[0, 0.72, 0.2]} color={w} />
      <Box size={[0.1, 0.9, 0.45]} pos={[-1.05, 0.45, 0]} color={w} />
      <Box size={[0.1, 0.9, 0.45]} pos={[1.05, 0.45, 0]} color={w} />
    </group>
  );
}

type PropRenderer = (room: RoomDef) => ReactNode;

/**
 * A decor kind drawn one model at a time from its recipe. The map draws decoration with
 * instances (DecorInstances); this is for a recipe drawn anywhere else.
 */
function Recipe({ kind }: { kind: PropKind }) {
  return (
    <group>
      {(DECOR_RECIPES[kind] ?? []).map((p, i) => (
        <Kit
          key={i}
          pack={p.pack as Pack}
          name={p.name}
          pos={[p.x, p.y ?? 0, p.z]}
          rot={[0, p.rot ?? 0, 0]}
          scale={p.s ?? 1}
          shadow={p.shadow}
        />
      ))}
    </group>
  );
}

const recipe =
  (kind: PropKind): PropRenderer =>
  () => <Recipe kind={kind} />;

export const PROPS: Record<PropKind, PropRenderer> = {
  altar: (room) => (
    <group>
      <Box size={[1.7, 0.85, 0.6]} pos={[0, 0.425, 0]} color={PALETTE.stoneLight} />
      <Box size={[1.8, 0.08, 0.7]} pos={[0, 0.89, 0]} color={PALETTE.stone} />
      <Box size={[0.7, 0.75, 0.04]} pos={[0, 0.5, 0.32]} color={ACCENT_HEX[room.accent]} />
      <Kit name="candle_triple" pos={[-0.6, 0.93, 0]} scale={0.6} />
      <Kit name="candle_triple" pos={[0.6, 0.93, 0]} scale={0.6} rot={[0, Math.PI, 0]} />
      <Kit pack="tools" name="journal_open" pos={[0, on(0.93, -0.42, 0.45), 0]} rot={[-0.5, 0, 0]} scale={0.45} />
    </group>
  ),
  pew: () => <Pew />,
  // A small stone shrine covered in candles.
  candles: () => <Kit pack="halloween" name="shrine_candles" scale={0.8} />,
  mapTable: () => (
    <group>
      <Kit name="table_long" rot={[0, Math.PI / 2, 0]} scale={[1.4, 1, 1.3]} />
      <Kit pack="tools" name="map" pos={[-0.3, 0.75, 0.1]} scale={1.3} />
      <Kit pack="tools" name="compass_base" pos={[1.2, on(0.75, -0.14, 0.6), -0.4]} scale={0.6} />
      <Lying name="drafting_compass" x={1.4} z={0.3} y={0.75} s={0.6} turn={0.6} />
      <Kit name="candle_lit" pos={[-1.6, 0.75, -0.6]} scale={0.5} />
      <Kit pack="tools" name="blueprint_stacked" pos={[1.3, 0.75, -1.15]} rot={[0, 0.3, 0]} scale={0.45} />
      <Kit pack="tools" name="map_rolled" pos={[-1.2, on(0.75, -0.12, 0.7), 0.7]} rot={[0, 1.3, 0]} scale={0.7} />
    </group>
  ),
  globe: () => (
    <group>
      <Cyl r={0.3} h={0.12} pos={[0, 0.06, 0]} color={PALETTE.woodDark} />
      <Cyl r={0.07} h={0.75} pos={[0, 0.48, 0]} color={PALETTE.wood} />
      <mesh position={[0, 1.3, 0]} rotation={[0, 0, 0.4]} castShadow>
        <torusGeometry args={[0.5, 0.03, 8, 32]} />
        <meshStandardMaterial color={PALETTE.brass} roughness={0.6} metalness={0.3} />
      </mesh>
      <Ball r={0.45} pos={[0, 1.3, 0]} color="#4F9BE8" />
      <Ball r={0.2} pos={[0.24, 1.45, 0.22]} color="#5CC27A" />
      <Ball r={0.16} pos={[-0.28, 1.18, 0.2]} color="#5CC27A" />
    </group>
  ),
  bench: () => (
    <group>
      <Kit name="table_medium" scale={[1.33, 1.13, 0.66]} />
      <Lying name="hammer" x={-0.6} z={0.1} y={0.85} s={0.5} turn={0.4} />
      <Lying name="saw" x={0.5} z={-0.1} y={0.85} s={0.5} turn={-0.2} />
      <Lying name="wrench_A" x={-0.1} z={-0.2} y={0.85} s={0.5} turn={1.2} />
      <Kit pack="tools" name="handplane" pos={[0.1, 0.86, 0.25]} rot={[0, Math.PI / 2, 0]} scale={0.5} />
      <Kit pack="tools" name="mallet" pos={[-0.85, on(0.85, -0.22, 0.5), -0.25]} scale={0.5} />
    </group>
  ),
  toolRack: () => (
    <group>
      <Box size={[3.4, 1.7, 0.12]} pos={[0, 0.95, -0.02]} color={PALETTE.wood} />
      <Box size={[3.4, 0.1, 0.18]} pos={[0, 1.8, 0]} color={PALETTE.woodDark} />
      {(
        [
          ['pickaxe', -1.25, 0.6],
          ['shovel', -0.55, 0.6],
          ['axe', 0.1, 0.6],
          ['saw', 0.75, 0.6],
          ['tongs', 1.35, 0.6],
        ] as const
      ).map(([name, x, s]) => (
        <Kit key={name} pack="tools" name={name} pos={[x, 1.05, 0.1]} scale={s} />
      ))}
    </group>
  ),
  easel: () => (
    <group>
      <Box size={[0.08, 1.8, 0.08]} pos={[-0.35, 0.9, 0]} color={PALETTE.wood} rot={[0, 0, 0.12]} />
      <Box size={[0.08, 1.8, 0.08]} pos={[0.35, 0.9, 0]} color={PALETTE.wood} rot={[0, 0, -0.12]} />
      <Box size={[0.08, 1.7, 0.08]} pos={[0, 0.85, -0.3]} color={PALETTE.wood} rot={[-0.2, 0, 0]} />
      <Box size={[1, 0.8, 0.05]} pos={[0, 1.3, 0.06]} color="#FFFDF5" />
      <Box size={[0.3, 0.25, 0.06]} pos={[-0.2, 1.4, 0.08]} color="#E85D9A" />
      <Box size={[0.3, 0.2, 0.06]} pos={[0.2, 1.2, 0.08]} color="#3BB3E0" />
      <Box size={[0.9, 0.05, 0.12]} pos={[0, 0.88, 0.08]} color={PALETTE.woodLight} />
    </group>
  ),
  bookcase: (room) => {
    const seed = room.id.length + Math.round(room.cx);
    return (
      <group>
        <Box size={[2.2, 2.2, 0.08]} pos={[0, 1.1, -0.21]} color={PALETTE.woodDark} />
        <Box size={[0.1, 2.2, 0.5]} pos={[-1.05, 1.1, 0]} color={PALETTE.wood} />
        <Box size={[0.1, 2.2, 0.5]} pos={[1.05, 1.1, 0]} color={PALETTE.wood} />
        {[0.06, 0.6, 1.14, 1.68, 2.18].map((y) => (
          <Box key={y} size={[2.1, 0.07, 0.48]} pos={[0, y, 0]} color={PALETTE.wood} />
        ))}
        {[0.1, 0.64, 1.18, 1.72].map((y, j) => (
          <BookRow key={y} y={y} z={0} width={1.9} seed={seed + j} />
        ))}
      </group>
    );
  },
  readingTable: () => (
    <group>
      <Kit name="table_medium" scale={[1.2, 1, 0.66]} />
      <Kit pack="tools" name="journal_open" pos={[-0.3, on(0.75, -0.42, 0.45), 0]} rot={[-1.2, 0, 0]} scale={0.45} />
      <Lying name="journal_closed" x={0.35} z={0.1} y={0.75} s={0.5} turn={0.3} />
      <Kit name="candle_lit" pos={[0.6, 0.75, -0.25]} scale={0.45} />
      <Kit pack="furniture" name="book_set" pos={[-0.75, on(0.75, -0.25, 0.4), -0.15]} rot={[0, 0.2, 0]} scale={0.4} />
    </group>
  ),
  lectern: () => (
    <group>
      <Cyl r={0.2} h={0.08} pos={[0, 0.04, 0]} color={PALETTE.woodDark} />
      <Cyl r={0.07} h={0.9} pos={[0, 0.5, 0]} color={PALETTE.wood} />
      <Box size={[0.7, 0.06, 0.5]} pos={[0, 1, 0]} color={PALETTE.woodLight} rot={[0.35, 0, 0]} />
      <Kit pack="tools" name="journal_open" pos={[0, 1.1, 0]} rot={[0.35 - 1.2, 0, 0]} scale={0.4} />
    </group>
  ),
  telescope: () => (
    <group>
      {[0, (2 * Math.PI) / 3, (4 * Math.PI) / 3].map((a) => (
        <Box key={a} size={[0.07, 1.1, 0.07]} pos={[Math.sin(a) * 0.25, 0.5, Math.cos(a) * 0.25]} rot={[Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3]} color={PALETTE.wood} />
      ))}
      <Cyl r={0.18} h={2} pos={[0, 1.3, -0.2]} color={PALETTE.brass} rTop={0.12} rot={[-0.7, 0, 0]} />
      <Cyl r={0.21} h={0.12} pos={[0, 1.95, -0.75]} color={PALETTE.dark} rot={[-0.7, 0, 0]} />
      <Blink pos={[0, 2.1, -0.85]} on="#BFE4FF" off="#7FB6E8" r={0.13} />
    </group>
  ),
  starTable: () => (
    <group>
      <Kit name="table_medium_tablecloth" scale={[1.45, 1, 0.66]} />
      <Kit pack="tools" name="map_empty" pos={[-0.3, 0.76, 0]} scale={0.8} />
      <Kit pack="tools" name="compass_base" pos={[0.75, on(0.76, -0.14, 0.6), 0]} scale={0.6} />
      <Kit pack="tools" name="map_rolled" pos={[-1, on(0.76, -0.12, 0.6), -0.15]} rot={[0, 1.4, 0]} scale={0.6} />
      <Kit name="candle_melted" pos={[1.25, 0.76, -0.2]} scale={0.5} />
    </group>
  ),
  aviary: () => (
    <group>
      <Box size={[2.6, 0.12, 1.2]} pos={[0, 0.06, 0]} color={PALETTE.wood} />
      <Box size={[2.6, 0.12, 1.2]} pos={[0, 1.7, 0]} color={PALETTE.wood} />
      {[-1.2, -0.6, 0, 0.6, 1.2].map((x) => (
        <Box key={x} size={[0.04, 1.6, 0.04]} pos={[x, 0.88, 0.58]} color={PALETTE.brass} />
      ))}
      <Box size={[2.4, 0.06, 0.06]} pos={[0, 0.6, 0]} color={PALETTE.woodLight} />
      <Box size={[2.4, 0.06, 0.06]} pos={[0, 1.2, 0]} color={PALETTE.woodLight} />
      {/* Plump birds on the perches: Mixed Bag plushies, a wink. */}
      {[-0.7, 0.1, 0.8].map((x, i) => (
        <Kit
          key={x}
          pack="mixed1"
          name={i === 1 ? 'chicken_plushie_B' : 'chicken_plushie_A'}
          pos={[x, 0.63 + (i % 2) * 0.6, 0]}
          rot={[0, 0.4 - i * 0.4, 0]}
          scale={0.5}
        />
      ))}
    </group>
  ),
  boiler: () => (
    <group>
      <Kit pack="mixed1" name="woodstove" scale={1.15} />
      <Blink pos={[0, 0.75, 0.5]} on="#FF7A1A" off="#B83A1A" r={0.14} />
    </group>
  ),
  engine: () => (
    <group>
      <Box size={[1.6, 1.3, 1]} pos={[0, 0.65, 0]} color={PALETTE.iron} />
      <Box size={[1.7, 0.1, 1.1]} pos={[0, 1.32, 0]} color={PALETTE.dark} />
      <Cyl r={0.45} h={0.15} pos={[0, 1.1, 0.55]} color={PALETTE.brass} rot={[Math.PI / 2, 0, 0]} />
      <Cyl r={0.25} h={0.15} pos={[0.55, 0.6, 0.55]} color={PALETTE.brass} rot={[Math.PI / 2, 0, 0]} />
      <Blink pos={[-0.55, 0.5, 0.52]} on="#5DE0A5" off="#1D6B4F" phase={1.3} />
    </group>
  ),
  abacus: () => (
    <group>
      <Box size={[0.12, 1.8, 0.3]} pos={[-1.2, 0.9, 0]} color={PALETTE.wood} />
      <Box size={[0.12, 1.8, 0.3]} pos={[1.2, 0.9, 0]} color={PALETTE.wood} />
      <Box size={[2.5, 0.1, 0.3]} pos={[0, 1.85, 0]} color={PALETTE.woodDark} />
      {[0.5, 0.9, 1.3, 1.7].map((y, j) => (
        <group key={y}>
          <Box size={[2.4, 0.03, 0.03]} pos={[0, y, 0]} color={PALETTE.dark} />
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
      <Box size={[2.7, 0.08, 0.14]} pos={[0, 2.03, 0]} color={PALETTE.wood} />
      <Box size={[2.8, 0.1, 0.18]} pos={[0, 0.58, 0]} color={PALETTE.wood} />
      <Box size={[1.2, 0.04, 0.02]} pos={[-0.4, 1.5, 0.06]} color="#F2F2F2" />
      <Box size={[0.8, 0.04, 0.02]} pos={[0.3, 1.2, 0.06]} color="#F2F2F2" />
    </group>
  ),
  portcullis: () => <Kit name="wall_gated" scale={[0.87, 0.75, 0.25]} />,
  weaponRack: () => (
    <group>
      <Box size={[2, 0.1, 0.25]} pos={[0, 0.25, 0]} color={PALETTE.woodDark} />
      <Box size={[2, 0.1, 0.12]} pos={[0, 1.3, -0.05]} color={PALETTE.wood} />
      <Box size={[0.1, 1.4, 0.12]} pos={[-0.95, 0.7, -0.05]} color={PALETTE.wood} />
      <Box size={[0.1, 1.4, 0.12]} pos={[0.95, 0.7, -0.05]} color={PALETTE.wood} />
      <Kit pack="weapons" name="sword_A" pos={[-0.65, on(0.3, -0.36, 0.8), 0.05]} scale={0.8} />
      <Kit pack="weapons" name="axe_A" pos={[-0.25, on(0.3, -0.37, 0.8), 0.05]} scale={0.8} />
      <Kit pack="weapons" name="spear_A" pos={[0.15, on(0.3, -1.03, 0.6), 0.05]} scale={0.6} />
      <Kit pack="weapons" name="halberd" pos={[0.6, on(0.3, -0.93, 0.6), 0.05]} scale={0.6} />
      <Kit pack="weapons" name="shield_A" pos={[0, 1.3, 0.1]} scale={0.6} />
    </group>
  ),
  lantern: () => (
    <group>
      <Kit name="column" scale={[0.4, 1, 0.4]} />
      <Kit pack="tools" name="lantern" pos={[0, 1.05, 0]} scale={0.55} />
      <Blink pos={[0, 1.27, 0]} on="#FFD25A" off="#E8A92A" r={0.07} />
    </group>
  ),
  guardTable: () => (
    <group>
      <Kit name="table_small" scale={[1.6, 1, 1.6]} />
      <Kit name="keyring" pos={[-0.2, 0.76, 0.1]} scale={0.45} />
      <Kit name="coin_stack_small" pos={[0.3, 0.75, -0.2]} scale={0.45} />
      <Kit name="candle_lit" pos={[0.35, 0.75, 0.3]} scale={0.4} />
    </group>
  ),
  alchemyBench: () => (
    <group>
      <Kit name="table_long" rot={[0, Math.PI / 2, 0]} scale={[0.6, 1.2, 1.13]} />
      {[-1.2, -0.6, 0, 0.6, 1.2].map((x, i) => (
        <group key={x}>
          <Kit name={['bottle_A_green', 'bottle_B_brown', 'bottle_C_green', 'bottle_A_labeled_brown', 'bottle_A_green'][i]} pos={[x, 0.9, 0]} scale={0.55} />
          <Blink pos={[x, 1.32, 0]} on={i % 2 ? '#3FD07A' : '#E54B4B'} off="#8FA3AD" phase={i} r={0.06} />
        </group>
      ))}
      <Kit pack="restaurant" name="jar_C_large" pos={[0.3, 0.9, -0.25]} scale={0.5} />
      <Kit pack="restaurant" name="jar_A_medium" pos={[-0.9, 0.9, -0.25]} scale={0.5} />
      <Kit pack="restaurant" name="jar_B_small" pos={[0.9, 0.9, -0.25]} scale={0.45} />
    </group>
  ),
  stage: (room) => (
    <group>
      <Kit name="floor_wood_small" pos={[0, 0.15, 0]} scale={[1.73, 2, 1.73]} />
      <Box size={[0.08, 2.6, 0.08]} pos={[-0.9, 1.3, -1.15]} color={PALETTE.woodDark} />
      <Box size={[0.08, 2.6, 0.08]} pos={[0.9, 1.3, -1.15]} color={PALETTE.woodDark} />
      <Box size={[1.9, 0.08, 0.08]} pos={[0, 2.6, -1.15]} color={PALETTE.woodDark} />
      <Kit name={`banner_patternB_${room.accent}`} pos={[0, -0.15, -1.45]} scale={0.7} />
    </group>
  ),
  inspectionDesk: () => (
    <group>
      <Kit name="table_small" scale={[1.4, 1, 0.8]} />
      <Kit pack="tools" name="magnifying_glass" pos={[0.25, 0.79, 0]} rot={[-Math.PI / 2, 0, 0.5]} scale={0.5} />
      <Lying name="journal_open" x={-0.2} z={0} y={0.75} s={0.4} />
    </group>
  ),
  couch: () => (
    <group>
      <Kit pack="furniture" name="couch_pillows" pos={[0, 0, -0.1]} scale={0.95} />
      <Kit pack="furniture" name="rug_oval_A" pos={[0, 0.01, 1.1]} scale={0.6} shadow={false} />
    </group>
  ),
  diceTable: () => (
    <group>
      <Kit name="table_small" scale={[1.2, 0.95, 1.2]} />
      <Box size={[0.14, 0.14, 0.14]} pos={[0.15, 0.78, 0.1]} color="#FFFFFF" rot={[0, 0.5, 0]} />
      <Box size={[0.14, 0.14, 0.14]} pos={[-0.15, 0.78, -0.05]} color="#E54B4B" rot={[0, 1.1, 0]} />
      <Kit name="coin_stack_small" pos={[-0.25, 0.71, 0.25]} scale={0.4} />
      <Kit pack="mixed1" name="puzzlecube_complete" pos={[0.3, on(0.71, -0.21, 0.35), -0.3]} rot={[0, 0.6, 0]} scale={0.35} />
      {/* Stools under the three dice players (layout.ts seats west, east and north of the table). */}
      {DICE_STOOLS.map(([x, z]) => (
        <Kit key={`${x}:${z}`} name="stool" pos={[x, 0, z]} scale={STOOL_SCALE} />
      ))}
    </group>
  ),
  posters: (room) => (
    <group>
      <Kit name={`banner_patternA_${room.accent}`} pos={[-0.55, 0, -0.2]} scale={0.7} />
      <Kit name={`banner_patternC_${room.accent}`} pos={[0.55, 0, -0.2]} scale={0.7} />
    </group>
  ),
  brooms: () => (
    <group>
      {[-0.3, 0, 0.3].map((x, i) => (
        <group key={x}>
          <Box size={[0.05, 1.6, 0.05]} pos={[x, 1, 0]} color={PALETTE.woodLight} rot={[0, 0, (i - 1) * 0.08]} />
          <Box size={[0.25, 0.3, 0.12]} pos={[x, 0.2, 0]} color="#E8C25A" />
        </group>
      ))}
    </group>
  ),
  cart: () => (
    <group>
      <Box size={[1, 0.45, 0.6]} pos={[0, 0.5, 0]} color={PALETTE.wood} />
      <Box size={[1.02, 0.06, 0.62]} pos={[0, 0.74, 0]} color={PALETTE.woodDark} />
      {[-0.4, 0.4].map((x) => (
        <Cyl key={x} r={0.16} h={0.08} pos={[x, 0.16, 0.32]} color={PALETTE.dark} rot={[Math.PI / 2, 0, 0]} />
      ))}
      <Kit pack="tools" name="bucket_metal" pos={[0.2, 0.77, 0]} scale={0.4} />
      <Kit name="box_small" pos={[-0.25, 0.77, 0]} scale={0.4} />
    </group>
  ),
  longTable: () => (
    <group>
      <Kit name="table_long" scale={[0.8, 1, 1.33]} />
      <Kit pack="restaurant" name="food_stew" pos={[0, 0.75, -1.3]} scale={0.4} />
      <Kit name="plate_food_B" pos={[0, 0.75, -0.4]} scale={0.4} />
      <Kit name="plate_stack" pos={[0.1, 0.75, 0.5]} scale={0.4} />
      <Kit pack="restaurant" name="food_dinner" pos={[0, 0.75, 1.4]} scale={0.35} />
      <Kit name="candle_lit" pos={[-0.1, 0.75, 0.95]} scale={0.45} />
      {/* Stools under the six tavern seats around the table (layout.ts), where the
          Sit_Chair_Idle pose lands its hips (workGestures.ts). */}
      {TABLE_STOOLS.map(([x, z]) => (
        <Kit key={`${x}:${z}`} name="stool" pos={[x, 0, z]} scale={STOOL_SCALE} />
      ))}
    </group>
  ),
  fireplace: () => (
    <group>
      <Box size={[3, 2.2, 0.8]} pos={[0, 1.1, 0]} color={PALETTE.stone} />
      <Box size={[3.2, 0.2, 0.95]} pos={[0, 2.25, 0]} color={PALETTE.stoneLight} />
      <Box size={[1.6, 1, 0.3]} pos={[0, 0.5, 0.3]} color={PALETTE.dark} />
      <Box size={[0.9, 0.12, 0.12]} pos={[0, 0.12, 0.35]} color={PALETTE.woodDark} rot={[0, 0.3, 0]} />
      <Blink pos={[0, 0.4, 0.4]} on="#FF8A1A" off="#FFC845" r={0.3} />
    </group>
  ),
  barrel: () => <Kit name="barrel_small" scale={[1.05, 1.05, 1.05]} />,
  lockers: () => (
    <group>
      {[-1.2, -0.4, 0.4, 1.2].map((z) => (
        <group key={z}>
          <Box size={[0.5, 2, 0.75]} pos={[0, 1, z]} color={PALETTE.wood} />
          <Box size={[0.04, 1.8, 0.62]} pos={[-0.26, 1, z]} color={PALETTE.woodLight} />
          <Box size={[0.04, 0.12, 0.1]} pos={[-0.29, 1, z + 0.2]} color={PALETTE.brass} />
        </group>
      ))}
    </group>
  ),
  keg: () => <Kit name="keg" scale={0.45} />,
  rug: recipe('rug'),
  crates: recipe('crates'),
  barrels: recipe('barrels'),
  chest: recipe('chest'),
  coins: recipe('coins'),
  candle: recipe('candle'),
  chartChest: recipe('chartChest'),
  sacks: recipe('sacks'),
  weeds: recipe('weeds'),
  bookPile: recipe('bookPile'),
  lumber: recipe('lumber'),
  forge: recipe('forge'),
  fuel: recipe('fuel'),
  treasury: recipe('treasury'),
  gamerCorner: recipe('gamerCorner'),
  cobwebs: recipe('cobwebs'),
  prison: recipe('prison'),
  beartrap: recipe('beartrap'),
  logs: recipe('logs'),
  pantry: recipe('pantry'),
};
