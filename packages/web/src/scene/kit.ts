import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { Matrix4, type BufferGeometry, type Material, type Mesh } from 'three';
import manifest from './kit-manifest.json';

// KayKit models (CC0, Kay Lousberg), copied to public/kaykit by `npm run kaykit:import`.

export type Pack = keyof typeof manifest;

function kitUrl(pack: Pack, name: string): string {
  return `${import.meta.env.BASE_URL}kaykit/${pack}/${name}.gltf`;
}

/** Every model of the manifest, for preloading. */
function allKitModels(): { pack: Pack; name: string }[] {
  return (Object.keys(manifest) as Pack[]).flatMap((pack) => manifest[pack].models.map((name) => ({ pack, name })));
}

/** One mesh of a model: its geometry, the pack's shared material, and its place in the model. */
export interface KitPart {
  geometry: BufferGeometry;
  material: Material | Material[];
  matrix: Matrix4;
}

// Each glTF file loads its own copy of the pack texture and material. One material per pack
// and material name is enough: it keeps the GPU state small and the colours identical.
const sharedMaterials = new Map<string, Material>();

function shareMaterial(pack: Pack, m: Material): Material {
  const key = `${pack}/${m.name}`;
  const known = sharedMaterials.get(key);
  if (known) return known;
  sharedMaterials.set(key, m);
  return m;
}

/** Loads a model (suspends while loading) and flattens it into parts. */
export function useKitParts(pack: Pack, name: string): KitPart[] {
  const { scene } = useGLTF(kitUrl(pack, name));
  return useMemo(() => {
    scene.updateMatrixWorld(true);
    const parts: KitPart[] = [];
    scene.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => shareMaterial(pack, m))
        : shareMaterial(pack, mesh.material);
      parts.push({ geometry: mesh.geometry, material, matrix: mesh.matrixWorld.clone() });
    });
    return parts;
  }, [scene, pack]);
}

export function preloadKit(): void {
  for (const { pack, name } of allKitModels()) useGLTF.preload(kitUrl(pack, name));
}
