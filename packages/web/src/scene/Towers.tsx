import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, CylinderGeometry, MeshStandardMaterial, Vector3, type Group } from 'three';
import { reducedMotion } from '../motion.ts';
import { cutHeight, inForeground, TOWER_BASE, TOWER_H, TOWER_R, TOWERS, type Tower } from './dungeon.ts';

// Shared by the four towers, never disposed (module scope, like the kit).
const SHAFT_H = TOWER_H - TOWER_BASE;
const shaft = new CylinderGeometry(TOWER_R, TOWER_R * 1.06, SHAFT_H, 20);
shaft.translate(0, TOWER_BASE + SHAFT_H / 2, 0);
const RIM_H = 0.12;
const rim = new CylinderGeometry(TOWER_R * 1.08, TOWER_R * 1.08, RIM_H, 20);
rim.translate(0, TOWER_H - RIM_H / 2, 0);
const MERLON = 0.28;
const merlon = new BoxGeometry(0.3, MERLON, 0.2);
const stone = new MeshStandardMaterial({ color: '#8f8a83', roughness: 0.95 });
const MERLONS = 8;

const anchor = new Vector3();

/** Height (0 sunk, 1 standing) of each tower, shared with the heralds standing on them. */
export const towerHeights = new Float32Array(TOWERS.length).fill(1);

function TowerMesh({ tower, index }: { tower: Tower; index: number }) {
  const group = useRef<Group>(null);
  const prev = useRef(Number.NaN);
  const merlons = useMemo(
    () =>
      Array.from({ length: MERLONS }, (_, i) => {
        const a = (i / MERLONS) * Math.PI * 2;
        const r = TOWER_R * 0.98;
        return { pos: [Math.cos(a) * r, TOWER_H + MERLON / 2, Math.sin(a) * r] as const, rot: -a - Math.PI / 2 };
      }),
    [],
  );
  useFrame(({ camera, pointer }, dt) => {
    const g = group.current;
    if (!g) return;
    anchor.set(tower.ax, 0, tower.az).project(camera);
    const target = inForeground(pointer.x, pointer.y, anchor.x, anchor.y) ? 0 : 1;
    const h = cutHeight(prev.current, target, dt, reducedMotion());
    if (h === prev.current) return;
    prev.current = h;
    towerHeights[index] = h;
    g.scale.y = Math.max(h, 1e-4);
  });
  return (
    <group ref={group} position={[tower.x, 0, tower.z]}>
      <mesh geometry={shaft} material={stone} castShadow receiveShadow />
      <mesh geometry={rim} material={stone} castShadow receiveShadow />
      {merlons.map((m, i) => (
        <mesh key={i} geometry={merlon} material={stone} position={m.pos} rotation={[0, m.rot, 0]} castShadow />
      ))}
    </group>
  );
}

/**
 * The four little towers at the castle corners. Like the tall walls they sink into the ground
 * while their corner shows in front of the cutaway curve.
 */
export function Towers() {
  return (
    <>
      {TOWERS.map((tower, i) => (
        <TowerMesh key={i} tower={tower} index={i} />
      ))}
    </>
  );
}
