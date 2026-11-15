import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { Matrix4, type BufferGeometry, type Material, type Mesh } from 'three';
import { ANIM_FILES_USED } from './characters.ts';
import manifest from './kit-manifest.json';

// KayKit models (CC0, Kay Lousberg), copied to public/kaykit by `npm run kaykit:import`.

export type Pack = keyof typeof manifest;

function kitUrl(pack: Pack, name: string): string {
  // Pack and model names come from static scene data, some typed as plain strings: only a
  // model the manifest lists can turn into a URL.
  const spec = Object.hasOwn(manifest, pack) ? manifest[pack] : undefined;
  if (!spec || !(spec.models as readonly string[]).includes(name)) throw new Error(`KayKit model not in the manifest: ${pack}/${name}`);
  const format = 'format' in spec ? spec.format : 'gltf';
  return `${import.meta.env.BASE_URL}kaykit/${pack}/${name}.${format}`;
}

/**
 * Loads a kit model. Draco stays off: KayKit files do not use it, and drei would otherwise
 * be ready to fetch its decoder from a third-party CDN if a file ever declared it.
 */
export function useKitGLTF(pack: Pack, name: string) {
  return useGLTF(kitUrl(pack, name), false);
}

/**
 * The animation files the figures play a clip from (ANIM_FILES_USED), as one list of URLs.
 * The load and the preload share this exact list: the loader caches an array under the whole
 * array, so a preload of the same files one by one would not serve the load.
 */
const ANIM_URLS: string[] = ANIM_FILES_USED.map((name) => kitUrl('animations', name));

/** Loads the used animation files (suspends while loading), in ANIM_FILES_USED order. */
export function useAnimFiles() {
  return useGLTF(ANIM_URLS, false);
}

/**
 * Every model of the manifest, for preloading, except the animation files: most hold no clip
 * the figures play (about 1 MB each), and the used ones are preloaded as one list.
 */
function allKitModels(): { pack: Pack; name: string }[] {
  return (Object.keys(manifest) as Pack[])
    .filter((pack) => pack !== 'animations')
    .flatMap((pack) => manifest[pack].models.map((name) => ({ pack, name })));
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
  const { scene } = useKitGLTF(pack, name);
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
  for (const { pack, name } of allKitModels()) useGLTF.preload(kitUrl(pack, name), false);
  useGLTF.preload(ANIM_URLS, false);
}
