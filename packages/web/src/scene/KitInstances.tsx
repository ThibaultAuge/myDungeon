import { useLayoutEffect, useRef } from 'react';
import { Euler, Matrix4, Quaternion, Vector3, type InstancedMesh, type Material } from 'three';
import { KIT_SCALE, type KitItem } from './dungeon.ts';
import { useKitParts, type KitPart, type Pack } from './kit.ts';

type V3 = [number, number, number];

const tmp = {
  m: new Matrix4(),
  q: new Quaternion(),
  e: new Euler(),
  p: new Vector3(),
  s: new Vector3(),
};

export function itemMatrix(item: KitItem, out: Matrix4): Matrix4 {
  const [sx, sy, sz] = item.scale ?? [KIT_SCALE, KIT_SCALE, KIT_SCALE];
  tmp.q.setFromEuler(tmp.e.set(0, item.rotY, 0));
  return out.compose(tmp.p.set(item.x, item.y, item.z), tmp.q, tmp.s.set(sx, sy, sz));
}

function InstancedPart({
  part,
  items,
  shadow,
  receive,
  material,
}: {
  part: KitPart;
  items: KitItem[];
  shadow: boolean;
  receive: boolean;
  material?: Material;
}) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    items.forEach((item, i) => mesh.setMatrixAt(i, itemMatrix(item, m).multiply(part.matrix)));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items, part]);
  return (
    <instancedMesh
      // A new count needs a new instanced mesh.
      key={items.length}
      ref={ref}
      args={[part.geometry, material ?? part.material, items.length]}
      castShadow={shadow}
      receiveShadow={receive}
    />
  );
}

/** Many copies of one model in one draw call per mesh: floor tiles, walls, pillars. */
export function KitInstances({
  pack,
  name,
  items,
  shadow = true,
  receiveShadow = true,
  material,
}: {
  pack: Pack;
  name: string;
  items: KitItem[];
  /** Flat or tiny pieces (floor tiles, books) cast no shadow: one draw call less each. */
  shadow?: boolean;
  /** Takes the shadows of other objects (off for the night forest, dimmed to a third anyway). */
  receiveShadow?: boolean;
  /** Replaces the pack's shared material (the night-shaded forest). */
  material?: Material;
}) {
  const parts = useKitParts(pack, name);
  if (items.length === 0) return null;
  return (
    <>
      {parts.map((part, i) => (
        <InstancedPart key={i} part={part} items={items} shadow={shadow} receive={receiveShadow} material={material} />
      ))}
    </>
  );
}

/** A single model: a piece of furniture or an object on a table. */
export function Kit({
  pack = 'dungeon',
  name,
  pos = [0, 0, 0],
  rot = [0, 0, 0],
  scale = 1,
  shadow,
}: {
  pack?: Pack;
  name: string;
  pos?: V3;
  rot?: V3;
  /** Multiplies KIT_SCALE; a triple scales each axis. */
  scale?: number | V3;
  /** Casts a shadow; by default only objects big enough for it to show. */
  shadow?: boolean;
}) {
  const parts = useKitParts(pack, name);
  const s: V3 = typeof scale === 'number' ? [scale, scale, scale] : scale;
  const casts = shadow ?? Math.min(s[0], s[1], s[2]) >= 0.6;
  return (
    <group position={pos} rotation={rot} scale={[s[0] * KIT_SCALE, s[1] * KIT_SCALE, s[2] * KIT_SCALE]}>
      {parts.map((p, i) => (
        <mesh
          key={i}
          geometry={p.geometry}
          material={p.material}
          matrix={p.matrix}
          matrixAutoUpdate={false}
          castShadow={casts}
          receiveShadow
        />
      ))}
    </group>
  );
}
