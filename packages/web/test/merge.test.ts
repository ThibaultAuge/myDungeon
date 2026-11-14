import { describe, expect, it } from 'vitest';
import {
  Box3,
  BoxGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SkinnedMesh,
  Texture,
  type BufferGeometry,
  type Material,
  type MeshStandardMaterialParameters,
} from 'three';
import { setHighlight } from '../src/scene/highlight.ts';
import { lookKey, mergeStatic, unmerge } from '../src/scene/merge.ts';

// merge.ts only uses three (no drei): tested in node on hand-built scenes.

/** A unit box (24 vertices) with its own red standard material, at (x, y, z). */
function box(x = 0, y = 0, z = 0, material: Material = red()): Mesh {
  const m = new Mesh(new BoxGeometry(1, 1, 1), material);
  m.position.set(x, y, z);
  return m;
}

function red(): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: 0xff0000, roughness: 0.8, metalness: 0 });
}

function rootWith(...children: Mesh[]): Group {
  const g = new Group();
  for (const c of children) g.add(c);
  return g;
}

function vertexCount(g: BufferGeometry): number {
  return g.getAttribute('position').count;
}

function bounds(g: BufferGeometry): Box3 {
  g.computeBoundingBox();
  return g.boundingBox!;
}

// ---------------------------------------------------------------- lookKey

describe('lookKey', () => {
  /**
   * Verifies that two distinct untextured materials of the same colour and finish share a key
   */
  it('gives the same key to equal-looking distinct standard materials', () => {
    const a = red();
    const b = red();
    expect(a.uuid).not.toBe(b.uuid);
    expect(lookKey(a)).not.toBeNull();
    expect(lookKey(a)).toBe(lookKey(b));
  });

  /**
   * Verifies that a different colour, roughness, metalness, emissive or side changes the key
   */
  it.each([
    ['colour', { color: 0x00ff00 }],
    ['roughness', { roughness: 0.3 }],
    ['metalness', { metalness: 0.5 }],
    ['emissive', { emissive: 0x111111 }],
    ['emissive intensity', { emissiveIntensity: 2 }],
    ['side', { side: DoubleSide }],
  ] as [string, MeshStandardMaterialParameters][])('changes the key when the %s differs', (_label, params) => {
    const other = new MeshStandardMaterial({ color: 0xff0000, roughness: 0.8, metalness: 0, ...params });
    expect(lookKey(other)).not.toBe(lookKey(red()));
  });

  /**
   * Verifies that a material with any setting outside the shape key is keyed by identity only
   */
  it.each([
    ['textured', () => new MeshStandardMaterial({ map: new Texture() })],
    ['vertex-coloured', () => new MeshStandardMaterial({ vertexColors: true })],
    ['flat-shaded', () => new MeshStandardMaterial({ flatShading: true })],
    ['normal-mapped', () => new MeshStandardMaterial({ normalMap: new Texture() })],
    ['physical', () => new MeshPhysicalMaterial({ clearcoat: 1 })],
  ])('keys a %s material by its own identity', (_label, make) => {
    const a = make();
    const b = make();
    expect(lookKey(a)).toBe(lookKey(a));
    expect(lookKey(a)).not.toBe(lookKey(b));
  });

  /**
   * Verifies that a non-standard (unlit) material cannot be merged
   */
  it('returns null for a MeshBasicMaterial', () => {
    expect(lookKey(new MeshBasicMaterial({ color: 0xff0000 }))).toBeNull();
  });
});

// ---------------------------------------------------------------- mergeStatic

describe('mergeStatic', () => {
  /**
   * Verifies that two boxes with equal-looking materials become one mesh, sources hidden
   */
  it('merges two equal-looking boxes into one mesh and hides both sources', () => {
    const a = box(-1);
    const b = box(1);
    const root = rootWith(a, b);
    const { meshes, hidden } = mergeStatic(root);
    expect(meshes).toHaveLength(1);
    expect(vertexCount(meshes[0].geometry)).toBe(48);
    expect(hidden).toHaveLength(2);
    expect(hidden).toContain(a);
    expect(hidden).toContain(b);
    expect(a.visible).toBe(false);
    expect(b.visible).toBe(false);
  });

  /**
   * Verifies that the merged mesh is returned unattached, with its source's look and shadows
   */
  it("returns the merged mesh unattached, with the first source's material and shadow flags", () => {
    const mat = red();
    const a = box(-1, 0, 0, mat);
    const b = box(1);
    for (const m of [a, b]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    const { meshes } = mergeStatic(rootWith(a, b));
    expect(meshes[0].parent).toBeNull();
    expect(meshes[0].material).toBe(mat);
    expect(meshes[0].castShadow).toBe(true);
    expect(meshes[0].receiveShadow).toBe(true);
    expect(meshes[0].userData.noMerge).toBe(true);
  });

  /**
   * Verifies that merged vertices are in the root's local space, not in world space
   */
  it("puts the merged vertices in the root's local space, parents' transforms applied", () => {
    const a = box(-1);
    const nested = new Group();
    nested.position.set(0, 2, 0);
    const b = box(1);
    nested.add(b);
    const root = new Group();
    root.add(a, nested);
    // The root moves and turns in the world: none of that may reach the merged geometry.
    root.position.set(5, 0, -3);
    root.rotation.y = 0.8;
    const world = new Group();
    world.position.set(100, 50, 100);
    world.add(root);

    const { meshes } = mergeStatic(root);
    expect(meshes).toHaveLength(1);
    const bb = bounds(meshes[0].geometry);
    expect(bb.min.x).toBeCloseTo(-1.5, 9);
    expect(bb.max.x).toBeCloseTo(1.5, 9);
    expect(bb.min.y).toBeCloseTo(-0.5, 9);
    expect(bb.max.y).toBeCloseTo(2.5, 9);
    expect(bb.min.z).toBeCloseTo(-0.5, 9);
    expect(bb.max.z).toBeCloseTo(0.5, 9);
  });

  /**
   * Verifies that the source geometries are left as they were (the merge works on copies)
   */
  it('leaves the source geometries untouched', () => {
    const a = box(-3);
    const b = box(3);
    mergeStatic(rootWith(a, b));
    for (const m of [a, b]) {
      const bb = bounds(m.geometry);
      expect(bb.min.x).toBeCloseTo(-0.5, 9);
      expect(bb.max.x).toBeCloseTo(0.5, 9);
    }
  });

  /**
   * Verifies that boxes of different colours are not merged and stay visible
   */
  it('keeps meshes of different colours apart', () => {
    const a = box(-1, 0, 0, new MeshStandardMaterial({ color: 0xff0000 }));
    const b = box(1, 0, 0, new MeshStandardMaterial({ color: 0x0000ff }));
    const { meshes, hidden } = mergeStatic(rootWith(a, b));
    expect(meshes).toEqual([]);
    expect(hidden).toEqual([]);
    expect(a.visible).toBe(true);
    expect(b.visible).toBe(true);
  });

  /**
   * Verifies that a look used by a single mesh is left as it is
   */
  it('leaves a single mesh untouched', () => {
    const a = box();
    const { meshes, hidden } = mergeStatic(rootWith(a));
    expect(meshes).toEqual([]);
    expect(hidden).toEqual([]);
    expect(a.visible).toBe(true);
  });

  /**
   * Verifies that an empty root gives nothing to merge
   */
  it('returns nothing for an empty root', () => {
    expect(mergeStatic(new Group())).toEqual({ meshes: [], hidden: [] });
  });

  /**
   * Verifies that only the equal-looking meshes merge in a mixed group
   */
  it('merges each look separately in a mixed group', () => {
    const r1 = box(0);
    const r2 = box(2);
    const r3 = box(4);
    const blue = (x: number) => box(x, 0, 0, new MeshStandardMaterial({ color: 0x0000ff }));
    const b1 = blue(0);
    const b2 = blue(2);
    const lone = box(9, 0, 0, new MeshStandardMaterial({ color: 0x00ff00 }));
    const { meshes, hidden } = mergeStatic(rootWith(r1, r2, r3, b1, b2, lone));
    expect(meshes.map((m) => vertexCount(m.geometry)).sort((p, q) => p - q)).toEqual([48, 72]);
    expect(hidden).toHaveLength(5);
    expect(lone.visible).toBe(true);
  });

  /**
   * Verifies that a different castShadow or receiveShadow keeps meshes apart
   */
  it.each(['castShadow', 'receiveShadow'] as const)('does not merge meshes whose %s differs', (flag) => {
    const a = box(-1);
    const b = box(1);
    a[flag] = true;
    b[flag] = false;
    const { meshes } = mergeStatic(rootWith(a, b));
    expect(meshes).toEqual([]);
    expect(a.visible && b.visible).toBe(true);
  });

  /**
   * Verifies that geometries with different attribute layouts are not merged together
   */
  it('does not merge geometries with different attributes', () => {
    const a = box(-1);
    const b = box(1);
    b.geometry.deleteAttribute('uv');
    const { meshes } = mergeStatic(rootWith(a, b));
    expect(meshes).toEqual([]);
    expect(b.visible).toBe(true);
  });

  /**
   * Verifies that unlit materials, instanced, skinned, opted-out and multi-material meshes are skipped
   */
  it.each([
    ['a MeshBasicMaterial', () => box(5, 0, 0, new MeshBasicMaterial({ color: 0xff0000 }))],
    ['an InstancedMesh', () => new InstancedMesh(new BoxGeometry(1, 1, 1), red(), 2)],
    ['a SkinnedMesh', () => new SkinnedMesh(new BoxGeometry(1, 1, 1), red())],
    [
      'a userData.noMerge mesh',
      () => {
        const m = box(5);
        m.userData.noMerge = true;
        return m;
      },
    ],
    ['an array-material mesh', () => new Mesh(new BoxGeometry(1, 1, 1), [red(), red()])],
  ] as [string, () => Mesh][])('skips %s', (_label, make) => {
    const pair = make();
    const twin = make();
    // Two plain red boxes still merge around the skipped ones.
    const a = box(-1);
    const b = box(1);
    const { meshes, hidden } = mergeStatic(rootWith(pair, twin, a, b));
    expect(meshes).toHaveLength(1);
    expect(vertexCount(meshes[0].geometry)).toBe(48);
    expect(hidden).not.toContain(pair);
    expect(hidden).not.toContain(twin);
    expect(pair.visible).toBe(true);
    expect(twin.visible).toBe(true);
  });

  /**
   * Verifies that invisible meshes, or meshes under an invisible parent, are skipped
   */
  it('skips meshes that are hidden or under a hidden parent', () => {
    const shown1 = box(-1);
    const shown2 = box(1);
    const off = box(3);
    off.visible = false;
    const hiddenGroup = new Group();
    hiddenGroup.visible = false;
    const underHidden = box(5);
    hiddenGroup.add(underHidden);
    const root = rootWith(shown1, shown2, off);
    root.add(hiddenGroup);
    const { meshes, hidden } = mergeStatic(root);
    expect(meshes).toHaveLength(1);
    expect(vertexCount(meshes[0].geometry)).toBe(48);
    expect(hidden.sort((p, q) => p.id - q.id)).toEqual([shown1, shown2].sort((p, q) => p.id - q.id));
    expect(underHidden.visible).toBe(true);
  });

  /**
   * Verifies that hidden-only groups (all candidates invisible) give no merge
   */
  it('merges nothing when every candidate is already invisible', () => {
    const a = box(-1);
    const b = box(1);
    a.visible = false;
    b.visible = false;
    expect(mergeStatic(rootWith(a, b))).toEqual({ meshes: [], hidden: [] });
  });

  /**
   * Verifies that merging again once the merged mesh is in the tree changes nothing
   */
  it('is a no-op the second time, merged mesh added to the root', () => {
    const root = rootWith(box(-1), box(1));
    const first = mergeStatic(root);
    root.add(...first.meshes);
    expect(mergeStatic(root)).toEqual({ meshes: [], hidden: [] });
    expect(first.meshes[0].visible).toBe(true);
  });

  /**
   * Verifies that textured meshes merge only when they share the very same material
   */
  it('merges textured meshes sharing one material, not textured twins', () => {
    const tex = new Texture();
    const shared = new MeshStandardMaterial({ map: tex });
    const s1 = box(0, 0, 0, shared);
    const s2 = box(2, 0, 0, shared);
    const t1 = box(4, 0, 0, new MeshStandardMaterial({ map: tex }));
    const t2 = box(6, 0, 0, new MeshStandardMaterial({ map: tex }));
    const { meshes, hidden } = mergeStatic(rootWith(s1, s2, t1, t2));
    expect(meshes).toHaveLength(1);
    expect(meshes[0].material).toBe(shared);
    expect(hidden).toHaveLength(2);
    expect(t1.visible && t2.visible).toBe(true);
  });
});

// ---------------------------------------------------------------- unmerge

describe('unmerge', () => {
  /**
   * Verifies that unmerge shows the sources again, detaches and disposes the merged meshes
   */
  it('restores the sources and detaches and disposes the merged meshes', () => {
    const a = box(-1);
    const b = box(1);
    const root = rootWith(a, b);
    const merged = mergeStatic(root);
    root.add(...merged.meshes);
    let disposed = 0;
    for (const m of merged.meshes) m.geometry.addEventListener('dispose', () => disposed++);

    unmerge(merged);

    expect(a.visible).toBe(true);
    expect(b.visible).toBe(true);
    for (const m of merged.meshes) expect(m.parent).toBeNull();
    expect(root.children).toEqual([a, b]);
    expect(disposed).toBe(merged.meshes.length);
  });

  /**
   * Verifies that unmerge works for merged meshes that were never attached
   */
  it('accepts merged meshes that were never added to the scene', () => {
    const a = box(-1);
    const b = box(1);
    const merged = mergeStatic(rootWith(a, b));
    expect(() => unmerge(merged)).not.toThrow();
    expect(a.visible && b.visible).toBe(true);
  });

  /**
   * Verifies that unmerging an empty result is harmless
   */
  it('does nothing for an empty merge', () => {
    expect(() => unmerge({ meshes: [], hidden: [] })).not.toThrow();
  });

  /**
   * Verifies that a merge after an unmerge gives the same merge again
   */
  it('lets the same tree be merged again after an unmerge', () => {
    const root = rootWith(box(-1), box(1));
    const first = mergeStatic(root);
    root.add(...first.meshes);
    unmerge(first);
    const second = mergeStatic(root);
    expect(second.meshes).toHaveLength(1);
    expect(second.hidden).toHaveLength(2);
  });
});

describe('merge safety', () => {
  /**
   * Verifies that a see-through material never merges: three.js sorts transparent meshes per object
   */
  it('leaves transparent meshes alone', () => {
    expect(lookKey(new MeshStandardMaterial({ transparent: true }))).toBeNull();
    const glass = () => new MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    const root = rootWith(box(0, 0, 0, glass()), box(2, 0, 0, glass()));
    expect(mergeStatic(root).meshes).toHaveLength(0);
  });

  /**
   * Verifies that a mirrored mesh is not baked into a merge, where it would turn inside out
   */
  it('skips meshes with a mirroring scale', () => {
    const mirrored = box(4, 0, 0);
    mirrored.scale.set(-1, 1, 1);
    const root = rootWith(box(0, 0, 0), box(2, 0, 0), mirrored);
    const merged = mergeStatic(root);
    expect(merged.meshes).toHaveLength(1);
    expect(vertexCount(merged.meshes[0].geometry)).toBe(48);
    expect(mirrored.visible).toBe(true);
  });

  /**
   * Verifies that merging a glowing post builds the merged mesh with the base material, so the glow goes away
   */
  it('merges a glowing post with its own materials', () => {
    const a = box(0, 0, 0);
    const b = box(2, 0, 0);
    const base = a.material as Material;
    const root = rootWith(a, b);
    setHighlight(root, true);
    const merged = mergeStatic(root);
    expect(merged.meshes).toHaveLength(1);
    expect(merged.meshes[0].material).toBe(base);
    root.add(...merged.meshes);
    setHighlight(root, false);
    expect(merged.meshes[0].material).toBe(base);
    expect(a.material).toBe(base);
  });

  /**
   * Verifies that only ancestors up to the merge root decide visibility
   */
  it('merges under a root whose own parent is hidden', () => {
    const outer = new Group();
    outer.visible = false;
    const root = rootWith(box(0, 0, 0), box(2, 0, 0));
    outer.add(root);
    expect(mergeStatic(root).meshes).toHaveLength(1);
  });
});

describe('merge bake limits', () => {
  /**
   * Verifies that geometries with morph targets never merge
   */
  it('skips meshes with morph targets', () => {
    const morphed = () => {
      const m = box();
      m.geometry.morphAttributes.position = [m.geometry.getAttribute('position').clone()];
      return m;
    };
    expect(mergeStatic(rootWith(morphed(), morphed())).meshes).toHaveLength(0);
  });

  /**
   * Verifies that mirroring is judged relative to the merge root: plain children of a mirrored root still merge
   */
  it('merges plain children of a mirrored root, and skips a child mirrored inside it', () => {
    const flipped = box(4, 0, 0);
    flipped.scale.set(-1, 1, 1);
    const root = rootWith(box(0, 0, 0), box(2, 0, 0), flipped);
    root.scale.set(-1, 1, 1);
    const merged = mergeStatic(root);
    expect(merged.meshes).toHaveLength(1);
    expect(flipped.visible).toBe(true);
  });
});
