import { Matrix4, Mesh, MeshStandardMaterial, type BufferGeometry, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { baseMaterial } from './highlight.ts';

// Draw-call saver for workstations. A post is made of many small static meshes (shapes and
// KayKit parts); those sharing a look are merged into one mesh per look. The originals are
// hidden, not removed, so React keeps owning them; the hover glow swaps the merged meshes'
// materials like any other mesh. Three.js only, no drei: testable in node.
//
// Post children must be static: no `visible` or material prop that changes after mount. A
// mesh that must stay on its own (an animated light, a moving part) sets userData.noMerge.

/** Standard-material settings left out of the key: a material that changes one is never merged with another. */
const DEFAULTS = new MeshStandardMaterial();

/** True when every setting that is not in the shape key is at its default. */
function plain(m: MeshStandardMaterial): boolean {
  return (
    m.type === 'MeshStandardMaterial' &&
    !m.map &&
    !m.vertexColors &&
    !m.normalMap &&
    !m.emissiveMap &&
    !m.roughnessMap &&
    !m.metalnessMap &&
    !m.aoMap &&
    !m.alphaMap &&
    !m.envMap &&
    m.flatShading === DEFAULTS.flatShading &&
    m.wireframe === DEFAULTS.wireframe &&
    m.toneMapped === DEFAULTS.toneMapped &&
    m.fog === DEFAULTS.fog &&
    m.alphaTest === DEFAULTS.alphaTest &&
    m.depthWrite === DEFAULTS.depthWrite &&
    m.depthTest === DEFAULTS.depthTest &&
    m.polygonOffset === DEFAULTS.polygonOffset &&
    m.opacity === DEFAULTS.opacity
  );
}

/**
 * Key under which two materials draw the same: untextured standard materials with the same
 * colour and finish (the shapes, which each own a material), or else the very same material
 * (KayKit parts share one per pack). Null for anything that must not merge: unlit or
 * animated materials, and see-through ones, which three.js sorts per object.
 */
export function lookKey(m: Material): string | null {
  if (!(m instanceof MeshStandardMaterial) || m.transparent) return null;
  if (!plain(m)) return `mat:${m.uuid}`;
  const e = m.emissive.getHex();
  return `std:${m.color.getHex()}:${m.roughness}:${m.metalness}:${e}:${m.emissiveIntensity}:${m.side}`;
}

/** Attribute layout: mergeGeometries refuses geometries that differ in any of these. */
function geometryKey(g: BufferGeometry): string {
  const attrs = Object.keys(g.attributes)
    .sort()
    .map((k) => {
      const a = g.attributes[k] as { itemSize: number; normalized: boolean; array: ArrayLike<number>; isInterleavedBufferAttribute?: boolean };
      return `${k}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}:${!!a.isInterleavedBufferAttribute}`;
    });
  return `${attrs.join(',')}|${g.index ? 'i' : 'n'}`;
}

/**
 * True for a mesh that can join a merge: plain, static, shown under `root`, with one
 * mergeable material and a geometry the bake handles. `toRoot` is the inverse of the root's
 * world matrix.
 */
function mergeable(o: Object3D, root: Object3D, toRoot: Matrix4): o is Mesh {
  const mesh = o as Mesh;
  if (!mesh.isMesh || (mesh as { isInstancedMesh?: boolean }).isInstancedMesh) return false;
  if ((mesh as { isSkinnedMesh?: boolean }).isSkinnedMesh || mesh.userData.noMerge) return false;
  const material = baseMaterial(mesh);
  if (Array.isArray(material) || !lookKey(material)) return false;
  // Morph targets are not moved by the bake, and influences would be lost.
  if (Object.keys(mesh.geometry.morphAttributes).length) return false;
  // Quantized positions would be clamped by the bake: float positions only.
  const position = mesh.geometry.getAttribute('position');
  if (!position || position.normalized || !(position.array instanceof Float32Array)) return false;
  // A copy mirrored relative to the root would be baked inside out: three.js only flips the
  // winding per object.
  if (rel.multiplyMatrices(toRoot, mesh.matrixWorld).determinant() < 0) return false;
  for (let p: Object3D | null = mesh; p && p !== root; p = p.parent) if (!p.visible) return false;
  return true;
}

const rel = new Matrix4();

export interface Merged {
  /** The merged meshes, positioned in the root's local space. */
  meshes: Mesh[];
  /** The meshes they replace, now hidden. */
  hidden: Mesh[];
}

/**
 * Merges the static meshes under `root` that share a look, a shadow role and a geometry
 * layout. The merged meshes are returned (not added); their sources are hidden. A look used
 * by a single mesh is left as it is. A source that glows (hover) counts with its own
 * material, so the merged mesh never inherits the glow.
 */
export function mergeStatic(root: Object3D): Merged {
  root.updateWorldMatrix(true, true);
  const toRoot = root.matrixWorld.clone().invert();
  const groups = new Map<string, Mesh[]>();
  root.traverse((o) => {
    if (!mergeable(o, root, toRoot)) return;
    const key = `${lookKey(baseMaterial(o) as Material)}|${o.castShadow}|${o.receiveShadow}|${geometryKey(o.geometry)}`;
    const list = groups.get(key);
    if (list) list.push(o);
    else groups.set(key, [o]);
  });
  const meshes: Mesh[] = [];
  const hidden: Mesh[] = [];
  const m = new Matrix4();
  for (const sources of groups.values()) {
    if (sources.length < 2) continue;
    const parts = sources.map((s) => s.geometry.clone().applyMatrix4(m.multiplyMatrices(toRoot, s.matrixWorld)));
    const geometry = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    if (!geometry) continue;
    const first = sources[0];
    const merged = new Mesh(geometry, baseMaterial(first));
    merged.castShadow = first.castShadow;
    merged.receiveShadow = first.receiveShadow;
    merged.userData.noMerge = true;
    meshes.push(merged);
    for (const s of sources) {
      s.visible = false;
      hidden.push(s);
    }
  }
  return { meshes, hidden };
}

/** Undoes mergeStatic: shows the sources again and frees the merged geometries. */
export function unmerge({ meshes, hidden }: Merged): void {
  for (const s of hidden) s.visible = true;
  for (const mesh of meshes) {
    mesh.removeFromParent();
    mesh.geometry.dispose();
  }
}
