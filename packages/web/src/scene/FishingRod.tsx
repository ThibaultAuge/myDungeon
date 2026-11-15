import { createPortal, useFrame } from '@react-three/fiber';
import { useRef, type RefObject } from 'react';
import { CylinderGeometry, Matrix4, MeshLambertMaterial, Quaternion, SphereGeometry, Vector3, type Group, type Mesh, type Object3D } from 'three';
import { MOAT, WATER_Y } from './forest.ts';

// The fishing rod of a main agent fishing in the moat (fishing.ts). No KayKit pack has one, so
// it is made of three.js primitives. Geometries and materials are shared at module scope.

/** Length of the rod, in the hand slot's units (the character's own, before KIT_SCALE). */
const ROD_LENGTH = 2.4;
const ROD = new CylinderGeometry(0.015, 0.04, ROD_LENGTH, 6).translate(0, ROD_LENGTH / 2, 0);
/** A unit cylinder standing on its base, stretched from the water up to the rod tip. */
const LINE = new CylinderGeometry(0.006, 0.006, 1, 4).translate(0, 0.5, 0);
const FLOAT = new SphereGeometry(0.06, 8, 6);
const WOOD = new MeshLambertMaterial({ color: '#7a5230' });
const THREAD = new MeshLambertMaterial({ color: '#e8e2d0' });
const CORK = new MeshLambertMaterial({ color: '#d8352a' });

/**
 * Modelled along +Y. During the fishing clips the hand slot's +X points forward (towards the
 * water) and its +Y up: an eighth of a turn back on Z points the rod forward and up, between
 * the two (measured on the scene).
 */
const GRIP_ROTATION: [number, number, number] = [0, 0, -Math.PI / 4];

const tip = new Vector3();
const world = new Matrix4();
const local = new Matrix4();
const unit = new Quaternion();
const at = new Vector3();
const size = new Vector3();

/** Places `mesh` (a child of `parent`) at a world position and scale, whatever the parent's turn. */
function placeInWorld(mesh: Object3D, parent: Object3D, position: Vector3, scale: Vector3): void {
  world.compose(position, unit, scale);
  local.copy(parent.matrixWorld).invert().multiply(world);
  mesh.matrix.copy(local);
}

/**
 * The rod in the hand slot `bone`, with its line hanging straight down from the tip to the
 * water and a float on it. The line shows only while the tip is over the water.
 */
export function FishingRod({ bone, holder }: { bone: Object3D; holder: RefObject<Group | null> }) {
  const tipRef = useRef<Object3D>(null);
  const line = useRef<Mesh>(null);
  const float = useRef<Mesh>(null);

  useFrame(() => {
    const g = holder.current;
    const l = line.current;
    const f = float.current;
    if (!g || !tipRef.current || !l || !f) return;
    tipRef.current.getWorldPosition(tip);
    const overWater = g.visible && tip.z < MOAT.z1 && tip.y > WATER_Y;
    l.visible = f.visible = overWater;
    if (!overWater) return;
    at.set(tip.x, WATER_Y, tip.z);
    placeInWorld(l, g, at, size.set(1, tip.y - WATER_Y, 1));
    placeInWorld(f, g, at, size.set(1, 1, 1));
  });

  return createPortal(
    <group ref={holder} rotation={GRIP_ROTATION} visible={false}>
      <mesh geometry={ROD} material={WOOD} castShadow />
      <object3D ref={tipRef} position={[0, ROD_LENGTH, 0]} />
      <mesh ref={line} geometry={LINE} material={THREAD} matrixAutoUpdate={false} visible={false} />
      <mesh ref={float} geometry={FLOAT} material={CORK} matrixAutoUpdate={false} visible={false} />
    </group>,
    bone,
  );
}
