import { MeshStandardMaterial, type Material, type Mesh, type Object3D } from 'three';

// Hover glow of a workstation. Kit materials are shared by every model of a pack, so they are
// never changed in place: the hovered meshes get a brighter copy, then their own material back.

const GLOW_COLOR = '#ffd9a0';
const GLOW_INTENSITY = 0.35;

/** One glowing copy per source material, made on first hover. */
const glowing = new WeakMap<Material, Material>();

function glowOf(m: Material): Material {
  // Unlit materials (candle flames, blinking lights) already glow.
  if (!(m instanceof MeshStandardMaterial)) return m;
  let copy = glowing.get(m);
  if (!copy) {
    const c = m.clone();
    c.emissive.set(GLOW_COLOR);
    c.emissiveIntensity = GLOW_INTENSITY;
    copy = c;
    glowing.set(m, copy);
  }
  return copy;
}

interface Swap {
  original: Material | Material[];
  glow: Material | Material[];
}

const SWAP = 'glowSwap';

/** The mesh's own material, even while it holds a glowing copy. */
export function baseMaterial(mesh: Mesh): Material | Material[] {
  const swap = mesh.userData[SWAP] as Swap | undefined;
  return swap && mesh.material === swap.glow ? swap.original : mesh.material;
}

/** Lights or dims every mesh under `root`. Calling it twice with the same value changes nothing. */
export function setHighlight(root: Object3D, on: boolean): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const swap = mesh.userData[SWAP] as Swap | undefined;
    if (on && !swap) {
      const original = mesh.material;
      mesh.material = Array.isArray(original) ? original.map(glowOf) : glowOf(original);
      mesh.userData[SWAP] = { original, glow: mesh.material } satisfies Swap;
    } else if (!on && swap) {
      // Restore only our own swap: a material React set during the hover is newer than the stored one.
      if (mesh.material === swap.glow) mesh.material = swap.original;
      delete mesh.userData[SWAP];
    }
  });
}
