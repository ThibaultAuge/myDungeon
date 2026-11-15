import { useEffect, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, type Material, type MeshStandardMaterial, type Object3D, type SkinnedMesh } from 'three';
import { reducedMotion } from '../motion.ts';
import { SOOT_COLORS, sootAmount, type MishapKind } from './mishap.ts';

interface Swapped {
  mesh: SkinnedMesh;
  original: Material | Material[];
  clone: Material | Material[];
  tints: { material: MeshStandardMaterial; base: Color }[];
}

/** Marks this module's copies, so a copy is never taken for an original. */
const SOOT_CLONE = 'sootClone';

function hasColor(m: Material): m is MeshStandardMaterial {
  return (m as MeshStandardMaterial).color instanceof Color;
}

/**
 * Soot on a figure: its character's materials are swapped for tinted copies that wash off
 * over time (`sootAmount`). The KayKit materials are shared by every figure, so the copies
 * belong to this figure only. Mounted once per figure and re-armed by a new `mishap.n`:
 * swap and restore both happen in the frame loop, so a second mishap during the soot
 * reuses the copies (only the colour and the clock start over) and the originals are
 * captured exactly once. The originals come back, and the copies are freed, when the soot
 * is gone or the figure unmounts.
 */
export function Soot({ root, mishap }: { root: RefObject<Object3D | null>; mishap: { n: number; kind: MishapKind } | null }) {
  const swapped = useRef<Swapped[] | null>(null);
  const armed = useRef(0);
  const started = useRef<number | null>(null);
  const soot = useRef(new Color());

  const restore = () => {
    for (const s of swapped.current ?? []) {
      // Only our own copy: anything else attached since then is left alone.
      if (s.mesh.material === s.clone) s.mesh.material = s.original;
      for (const t of s.tints) t.material.dispose();
    }
    swapped.current = null;
  };
  useEffect(() => restore, []);

  const swap = (): Swapped[] => {
    const list: Swapped[] = [];
    // The character's skinned body only: not the floor disc, the ring nor a held prop.
    root.current?.traverse((o) => {
      const mesh = o as SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      const originals = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (originals.some((m) => m.userData[SOOT_CLONE])) return;
      const tints = originals.map((m) => {
        const material = m.clone() as MeshStandardMaterial;
        material.userData[SOOT_CLONE] = true;
        return { material, base: hasColor(m) ? m.color.clone() : new Color(1, 1, 1) };
      });
      const clone = Array.isArray(mesh.material) ? tints.map((t) => t.material) : tints[0].material;
      list.push({ mesh, original: mesh.material, clone, tints });
      mesh.material = clone;
    });
    return list;
  };

  useFrame(({ clock }) => {
    if (mishap && mishap.n !== armed.current) {
      armed.current = mishap.n;
      started.current = clock.elapsedTime;
      soot.current.set(SOOT_COLORS[mishap.kind]);
    }
    if (started.current === null) return;
    const amount = sootAmount((clock.elapsedTime - started.current) * 1000, reducedMotion());
    if (amount <= 0) {
      restore();
      started.current = null;
      return;
    }
    // The model may still be loading: try again on later frames until it is there.
    if (!swapped.current?.length) swapped.current = swap();
    for (const s of swapped.current) {
      for (const t of s.tints) t.material.color.copy(t.base).lerp(soot.current, amount);
    }
  });
  return null;
}
