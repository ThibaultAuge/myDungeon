import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Matrix4, Vector3, type InstancedMesh } from 'three';
import { reducedMotion } from '../motion.ts';
import { corridorFloor, foundation, inForeground, KIT_SCALE, OUTER, roomFloor, tallModel, wallLayout, type CutItem, type Placement } from './dungeon.ts';
import { useKitParts, type Pack } from './kit.ts';
import { itemMatrix, KitInstances } from './KitInstances.tsx';
import { ROOMS } from './layout.ts';

function Placed({ placement, shadow = true }: { placement: Placement; shadow?: boolean }) {
  return (
    <>
      {[...placement].map(([name, items]) => (
        <KitInstances key={name} pack="dungeon" name={name} items={items} shadow={shadow} />
      ))}
    </>
  );
}

/** Room tiles, corridor flagstones and the stone base around the dungeon. */
export function Floors() {
  const placement = useMemo(() => {
    const p: Placement = new Map();
    for (const r of ROOMS) if (!r.insideOf) roomFloor(r, p);
    corridorFloor(p);
    foundation(p);
    return p;
  }, []);
  const w = OUTER.x1 - OUTER.x0;
  const d = OUTER.z1 - OUTER.z0;
  return (
    <>
      {/* Mortar behind the tiles and the base: their bevelled edges never show the background. */}
      <mesh position={[(OUTER.x0 + OUTER.x1) / 2, -0.8, (OUTER.z0 + OUTER.z1) / 2]} receiveShadow>
        <boxGeometry args={[w - 0.1, 1.48, d - 0.1]} />
        <meshStandardMaterial color="#5E5A55" roughness={1} />
      </mesh>
      <Placed placement={placement} shadow={false} />
    </>
  );
}

/** How fast a wall goes down or up (per second, as a share of the remaining way). */
const WALL_SPEED = 10;

const anchor = new Vector3();
const m = new Matrix4();
const mp = new Matrix4();

/**
 * Copies of one tall model (a wall, a pillar, a torch) that each sink into the ground while
 * their anchor shows in front of the cutaway curve, and rise again behind it.
 */
function CutawayKit({ model, items }: { model: string; items: CutItem[] }) {
  const { pack, name } = tallModel(model);
  const parts = useKitParts(pack as Pack, name);
  const meshes = useRef<(InstancedMesh | null)[]>([]);
  const seen = useRef<InstancedMesh[]>([]);
  // Height of each copy, from 0 (sunk) to 1 (standing). NaN forces the first write.
  const height = useMemo(() => new Float32Array(items.length).fill(Number.NaN), [items]);

  useFrame(({ camera, pointer }, dt) => {
    const k = reducedMotion() ? 1 : Math.min(1, dt * WALL_SPEED);
    let changed = false;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      anchor.set(it.ax, 0, it.az).project(camera);
      const target = inForeground(pointer.x, pointer.y, anchor.x, anchor.y) ? 0 : 1;
      const prev = height[i];
      let h = Number.isNaN(prev) ? target : prev + (target - prev) * k;
      if (Math.abs(target - h) < 0.002) h = target;
      if (h === prev) continue;
      height[i] = h;
      changed = true;
      const [sx, sy, sz] = it.scale ?? [KIT_SCALE, KIT_SCALE, KIT_SCALE];
      // Decor sinks with its wall: its height above the ground shrinks too.
      itemMatrix({ ...it, y: it.y * h, scale: [sx, sy * Math.max(h, 1e-4), sz] }, m);
      parts.forEach((part, p) => meshes.current[p]?.setMatrixAt(i, mp.multiplyMatrices(m, part.matrix)));
    }
    if (!changed) return;
    for (const mesh of meshes.current) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  });

  return (
    <>
      {parts.map((part, p) => (
        <instancedMesh
          key={p}
          ref={(mesh) => {
            meshes.current[p] = mesh;
            // A new GPU mesh starts with identity matrices: write every copy again. React
            // detaches and re-attaches this inline ref on every render, so compare with the last
            // mesh seen, which the detach (null) does not clear.
            if (mesh && mesh !== seen.current[p]) {
              seen.current[p] = mesh;
              height.fill(Number.NaN);
            }
          }}
          args={[part.geometry, part.material, items.length]}
          castShadow
          receiveShadow
        />
      ))}
    </>
  );
}

/**
 * Walls of the dungeon. Moving the mouse uncovers the rooms: every tall piece shown in front
 * of a curve through the cursor sinks into the ground, leaving the low wall that always stands
 * inside it; the pieces behind the curve stand.
 */
export function Walls() {
  const layout = useMemo(() => wallLayout(), []);
  return (
    <group>
      <Placed placement={layout.low} />
      {[...layout.tall].map(([model, items]) => (
        <CutawayKit key={model} model={model} items={items} />
      ))}
    </group>
  );
}
