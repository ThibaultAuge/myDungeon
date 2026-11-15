import { Suspense, useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, BufferAttribute, CylinderGeometry, Vector3, type BufferGeometry, type Group, type Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { reducedMotion } from '../motion.ts';
import { cutHeight, inForeground, TOWER_BASE, TOWER_H, TOWER_R, TOWERS, type Tower } from './dungeon.ts';
import { isFps } from './fps.ts';
import { useKitParts } from './kit.ts';

const SHAFT_H = TOWER_H - TOWER_BASE;
const RIM_H = 0.12;
const MERLON = 0.28;
const MERLONS = 8;

/**
 * The towers wear the KayKit dungeon material (a palette texture: flat colour bands, the bricks
 * of the walls are modelled). Every vertex samples the stone band the wall faces use, with the
 * same light-at-the-top gradient, so towers and walls show the same grey under the same light.
 */
const STONE_U = 0.115;
const STONE_V_TOP = 0.04;
const STONE_V_GROUND = 0.2;

function stoneUv(geometry: BufferGeometry): BufferGeometry {
  const pos = geometry.attributes.position;
  const uv = new BufferAttribute(new Float32Array(pos.count * 2), 2);
  const top = TOWER_H + MERLON;
  for (let i = 0; i < pos.count; i++) {
    const k = Math.min(1, Math.max(0, pos.getY(i) / top));
    uv.setXY(i, STONE_U, STONE_V_GROUND + (STONE_V_TOP - STONE_V_GROUND) * k);
  }
  geometry.setAttribute('uv', uv);
  return geometry;
}

/** One merged geometry for a whole tower (shaft, rim, merlons): one draw call per tower. Module scope, never disposed. */
const towerGeometry = (() => {
  const parts: BufferGeometry[] = [];
  parts.push(new CylinderGeometry(TOWER_R, TOWER_R * 1.06, SHAFT_H, 20).translate(0, TOWER_BASE + SHAFT_H / 2, 0));
  parts.push(new CylinderGeometry(TOWER_R * 1.08, TOWER_R * 1.08, RIM_H, 20).translate(0, TOWER_H - RIM_H / 2, 0));
  for (let i = 0; i < MERLONS; i++) {
    const a = (i / MERLONS) * Math.PI * 2;
    const r = TOWER_R * 0.98;
    // The merlon's long side follows the rim.
    parts.push(
      new BoxGeometry(0.3, MERLON, 0.2)
        .rotateY(-a - Math.PI / 2)
        .translate(Math.cos(a) * r, TOWER_H + MERLON / 2, Math.sin(a) * r),
    );
  }
  const merged = mergeGeometries(parts.map((p) => stoneUv(p.toNonIndexed())), false);
  for (const p of parts) p.dispose();
  return merged!;
})();

const anchor = new Vector3();

/**
 * Height (0 sunk, 1 standing) of each tower, written by `Towers` every frame and read by the
 * heralds standing on them (Herald.tsx). Stays at 1 while `Towers` is not mounted.
 */
export const towerHeights = new Float32Array(TOWERS.length).fill(1);

function TowerMesh({ tower, index, material }: { tower: Tower; index: number; material: Material }) {
  const group = useRef<Group>(null);
  const prev = useRef(Number.NaN);
  useFrame(({ camera, pointer }, dt) => {
    const g = group.current;
    if (!g) return;
    anchor.set(tower.ax, 0, tower.az).project(camera);
    // Every tower stands in the first-person view.
    const target = !isFps() && inForeground(pointer.x, pointer.y, anchor.x, anchor.y) ? 0 : 1;
    const h = cutHeight(prev.current, target, dt, reducedMotion());
    if (h === prev.current) return;
    prev.current = h;
    towerHeights[index] = h;
    g.scale.y = Math.max(h, 1e-4);
  });
  return (
    <group ref={group} position={[tower.x, 0, tower.z]}>
      <mesh geometry={towerGeometry} material={material} castShadow receiveShadow />
    </group>
  );
}

function TowerSet() {
  // The wall's own (shared, never modified) kit material: same texture and shading as the walls.
  const kit = useKitParts('dungeon', 'wall')[0].material;
  // The merged geometry has no groups: it needs one material, never an array.
  const material = Array.isArray(kit) ? kit[0] : kit;
  // Unmounted (or not loaded yet), the towers stand for the heralds: never a stale lowered height.
  useEffect(() => () => void towerHeights.fill(1), []);
  return (
    <>
      {TOWERS.map((tower, i) => (
        <TowerMesh key={i} tower={tower} index={i} material={material} />
      ))}
    </>
  );
}

/**
 * The four little towers at the castle corners. Like the tall walls they sink into the ground
 * while their corner shows in front of the cutaway curve.
 */
export function Towers() {
  return (
    <Suspense fallback={null}>
      <TowerSet />
    </Suspense>
  );
}
