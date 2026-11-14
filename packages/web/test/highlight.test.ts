import { describe, expect, it } from 'vitest';
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Material,
} from 'three';
import { setHighlight } from '../src/scene/highlight.ts';

const BLACK = 0x000000;

/** A fresh workstation: a lit (standard) mesh and an unlit (basic) one under a group. */
function station() {
  const standard = new MeshStandardMaterial({ color: 0x884422 });
  const basic = new MeshBasicMaterial({ color: 0xffaa00 });
  const lit = new Mesh(new BoxGeometry(), standard);
  const unlit = new Mesh(new BoxGeometry(), basic);
  const root = new Group();
  root.add(lit, unlit);
  return { root, lit, unlit, standard, basic };
}

/** Emissive state of a standard material, as plain numbers. */
function glowState(m: Material) {
  const s = m as MeshStandardMaterial;
  return { emissive: s.emissive.getHex(), intensity: s.emissiveIntensity };
}

describe('setHighlight: on', () => {
  /**
   * Verifies that a standard mesh gets a distinct glowing material when highlighted
   */
  it('gives a standard mesh a different, emissive material', () => {
    const { root, lit, standard } = station();
    setHighlight(root, true);
    expect(lit.material).not.toBe(standard);
    expect(lit.material).toBeInstanceOf(MeshStandardMaterial);
    const { emissive, intensity } = glowState(lit.material as Material);
    expect(emissive).not.toBe(BLACK);
    expect(intensity).toBeGreaterThan(0);
  });

  /**
   * Verifies that the shared source material is never mutated by the highlight
   */
  it('leaves the source material unchanged', () => {
    const { root, standard } = station();
    const before = { emissive: standard.emissive.getHex(), intensity: standard.emissiveIntensity, color: standard.color.getHex() };
    setHighlight(root, true);
    expect(standard.emissive.getHex()).toBe(BLACK);
    expect({ emissive: standard.emissive.getHex(), intensity: standard.emissiveIntensity, color: standard.color.getHex() }).toEqual(before);
  });

  /**
   * Verifies that the glowing copy keeps the base colour of its source material
   */
  it('keeps the base colour in the glowing copy', () => {
    const { root, lit, standard } = station();
    setHighlight(root, true);
    expect((lit.material as MeshStandardMaterial).color.getHex()).toBe(standard.color.getHex());
  });

  /**
   * Verifies that an unlit (basic) mesh keeps its exact material when highlighted
   */
  it('leaves a basic-material mesh untouched', () => {
    const { root, unlit, basic } = station();
    const color = basic.color.getHex();
    setHighlight(root, true);
    expect(unlit.material).toBe(basic);
    expect(basic.color.getHex()).toBe(color);
  });

  /**
   * Verifies that highlighting twice keeps the same glowing material (idempotent)
   */
  it('is idempotent when called on twice', () => {
    const { root, lit } = station();
    setHighlight(root, true);
    const glow = lit.material;
    setHighlight(root, true);
    expect(lit.material).toBe(glow);
  });

  /**
   * Verifies that two meshes sharing one source material share one glowing copy
   */
  it('gives meshes sharing a source material the same glow clone', () => {
    const shared = new MeshStandardMaterial();
    const a = new Mesh(new BoxGeometry(), shared);
    const b = new Mesh(new BoxGeometry(), shared);
    const root = new Group();
    root.add(a, b);
    setHighlight(root, true);
    expect(a.material).not.toBe(shared);
    expect(a.material).toBe(b.material);
  });

  /**
   * Verifies that the glow copy is reused across separate hovers of different roots
   */
  it('reuses the glow copy of a source material across hovers', () => {
    const shared = new MeshStandardMaterial();
    const first = new Mesh(new BoxGeometry(), shared);
    const second = new Mesh(new BoxGeometry(), shared);
    setHighlight(first, true);
    const glow = first.material;
    setHighlight(first, false);
    setHighlight(second, true);
    expect(second.material).toBe(glow);
    setHighlight(first, true);
    expect(first.material).toBe(glow);
  });

  /**
   * Verifies that meshes nested deep in the hierarchy and the root mesh itself glow
   */
  it('reaches nested meshes and a mesh root', () => {
    const deepMat = new MeshStandardMaterial();
    const rootMat = new MeshStandardMaterial();
    const deep = new Mesh(new BoxGeometry(), deepMat);
    const inner = new Group();
    inner.add(deep);
    const root = new Mesh(new BoxGeometry(), rootMat);
    root.add(inner);
    setHighlight(root, true);
    expect(deep.material).not.toBe(deepMat);
    expect(root.material).not.toBe(rootMat);
    expect(glowState(deep.material as Material).intensity).toBeGreaterThan(0);
  });

  /**
   * Verifies that a physical material (a standard subclass) also gets a glowing copy
   */
  it('glows a MeshPhysicalMaterial mesh too', () => {
    const physical = new MeshPhysicalMaterial();
    const mesh = new Mesh(new BoxGeometry(), physical);
    setHighlight(mesh, true);
    expect(mesh.material).not.toBe(physical);
    expect(mesh.material).toBeInstanceOf(MeshPhysicalMaterial);
    expect(physical.emissive.getHex()).toBe(BLACK);
  });

  /**
   * Verifies that non-mesh objects with a material (lines) are left alone
   */
  it('ignores non-mesh objects such as lines', () => {
    const lineMat = new LineBasicMaterial();
    const line = new Line(new BufferGeometry(), lineMat);
    const root = new Group();
    root.add(line);
    setHighlight(root, true);
    expect(line.material).toBe(lineMat);
  });

  /**
   * Verifies that an empty group can be highlighted without error
   */
  it('accepts an empty group', () => {
    expect(() => setHighlight(new Group(), true)).not.toThrow();
    expect(() => setHighlight(new Group(), false)).not.toThrow();
  });
});

describe('setHighlight: off', () => {
  /**
   * Verifies that turning the highlight off restores the exact original material
   */
  it('restores the original material instance', () => {
    const { root, lit, unlit, standard, basic } = station();
    setHighlight(root, true);
    setHighlight(root, false);
    expect(lit.material).toBe(standard);
    expect(unlit.material).toBe(basic);
    expect(standard.emissive.getHex()).toBe(BLACK);
  });

  /**
   * Verifies that turning off twice, or without a prior on, changes nothing
   */
  it('is a no-op when nothing is highlighted', () => {
    const { root, lit, standard } = station();
    setHighlight(root, false);
    expect(lit.material).toBe(standard);
    setHighlight(root, true);
    setHighlight(root, false);
    setHighlight(root, false);
    expect(lit.material).toBe(standard);
  });

  /**
   * Verifies that a double on followed by a single off still restores the original
   */
  it('restores the original after on, on, off', () => {
    const { root, lit, standard } = station();
    setHighlight(root, true);
    setHighlight(root, true);
    setHighlight(root, false);
    expect(lit.material).toBe(standard);
  });

  /**
   * Verifies that repeated hover cycles keep restoring the original material
   */
  it('survives several on/off cycles', () => {
    const { root, lit, standard } = station();
    for (let i = 0; i < 3; i++) {
      setHighlight(root, true);
      expect(lit.material).not.toBe(standard);
      setHighlight(root, false);
      expect(lit.material).toBe(standard);
    }
  });

  /**
   * Verifies that a mesh's own userData is not left with highlight leftovers after off
   */
  it('keeps unrelated userData intact across a cycle', () => {
    const { root, lit } = station();
    lit.userData.custom = 42;
    setHighlight(root, true);
    setHighlight(root, false);
    expect(lit.userData).toEqual({ custom: 42 });
  });
});

describe('setHighlight: array materials', () => {
  /**
   * Verifies that each standard entry of a material array glows and basic entries stay
   */
  it('maps each entry of a material array', () => {
    const standard = new MeshStandardMaterial();
    const basic = new MeshBasicMaterial();
    const original = [standard, basic];
    const mesh = new Mesh(new BoxGeometry(), original);
    setHighlight(mesh, true);
    expect(Array.isArray(mesh.material)).toBe(true);
    const glow = mesh.material as Material[];
    expect(glow).toHaveLength(2);
    expect(glow[0]).not.toBe(standard);
    expect(glowState(glow[0]).emissive).not.toBe(BLACK);
    expect(glowState(glow[0]).intensity).toBeGreaterThan(0);
    expect(glow[1]).toBe(basic);
    expect(standard.emissive.getHex()).toBe(BLACK);
  });

  /**
   * Verifies that turning off restores the very same material array
   */
  it('restores the original array instance', () => {
    const original = [new MeshStandardMaterial(), new MeshBasicMaterial()];
    const mesh = new Mesh(new BoxGeometry(), original);
    setHighlight(mesh, true);
    expect(mesh.material).not.toBe(original);
    setHighlight(mesh, false);
    expect(mesh.material).toBe(original);
    expect(original).toHaveLength(2);
  });

  /**
   * Verifies that an array entry and a single-material mesh with one source share a glow
   */
  it('shares the glow clone between array and single-material meshes', () => {
    const shared = new MeshStandardMaterial();
    const single = new Mesh(new BoxGeometry(), shared);
    const multi = new Mesh(new BoxGeometry(), [shared, new MeshBasicMaterial()]);
    const root = new Group();
    root.add(single, multi);
    setHighlight(root, true);
    expect((multi.material as Material[])[0]).toBe(single.material);
  });

  /**
   * Verifies that highlighting an array mesh twice keeps the same glowing array
   */
  it('is idempotent for material arrays', () => {
    const mesh = new Mesh(new BoxGeometry(), [new MeshStandardMaterial()]);
    setHighlight(mesh, true);
    const glow = mesh.material;
    setHighlight(mesh, true);
    expect(mesh.material).toBe(glow);
  });
});

describe('setHighlight: glow colour', () => {
  /**
   * Verifies that the glow clone of a black-emissive source has a warm, non-black emissive
   */
  it('uses a warm emissive tint', () => {
    const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    setHighlight(mesh, true);
    const c = new Color((mesh.material as MeshStandardMaterial).emissive.getHex());
    // Warm: red is at least as strong as blue.
    expect(c.r).toBeGreaterThanOrEqual(c.b);
    expect(c.r + c.g + c.b).toBeGreaterThan(0);
  });
});

describe('setHighlight: material replaced during the hover', () => {
  /**
   * Verifies that off keeps a material assigned by someone else while the mesh glowed,
   * instead of putting back the stale original
   */
  it('does not overwrite a newer material on off', () => {
    const { root, lit } = station();
    setHighlight(root, true);
    const newer = new MeshStandardMaterial({ color: 0x00ff00 });
    lit.material = newer;
    setHighlight(root, false);
    expect(lit.material).toBe(newer);
    expect(lit.userData).toEqual({});
  });
});
