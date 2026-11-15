import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Object3D, Vector3 } from 'three';
import type { RoomId } from '@agent-office/shared';
import { DECOR_RECIPES, decorPlacement, type DecorBatch, type DecorPiece } from '../src/scene/decor.ts';
import { KIT_SCALE } from '../src/scene/dungeon.ts';
import { DECOR_KINDS, ROOMS, type Prop, type PropKind, type RoomDef } from '../src/scene/layout.ts';

// decor.ts is pure data and geometry: tested in node without drei. The manifest is read as
// plain JSON, as in dungeon.test.ts.

const TOL = 1e-9;

const MANIFEST: Record<string, { models: string[] }> = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL('../src/scene/kit-manifest.json', import.meta.url)), 'utf8'),
);

const RECIPES = Object.entries(DECOR_RECIPES) as [PropKind, readonly DecorPiece[]][];

/** A synthetic room holding the given props, for decorPlacement's own cases. */
function makeRoom(props: Prop[], cx = 10, cz = -4, id = 'decor-test'): RoomDef {
  return {
    id: id as RoomId,
    cx,
    cz,
    w: 8,
    d: 8,
    floorKind: 'stone',
    accent: 'red',
    door: { side: 'n', at: 0 },
    props,
    seats: [],
  };
}

/** The batch of a model and shadow choice, or undefined. */
function batchOf(batches: DecorBatch[], pack: string, name: string, shadow?: boolean): DecorBatch | undefined {
  return batches.find((b) => b.pack === pack && b.name === name && (shadow === undefined || b.shadow === shadow));
}

function totalItems(batches: DecorBatch[]): number {
  return batches.reduce((s, b) => s + b.items.length, 0);
}

// ---------------------------------------------------------------- recipes

describe('DECOR_RECIPES', () => {
  /**
   * Verifies that every recipe piece names a pack and a model listed in kit-manifest.json
   */
  it('references only packs and models of the manifest', () => {
    const missing = RECIPES.flatMap(([kind, pieces]) =>
      pieces.filter((p) => !MANIFEST[p.pack]?.models.includes(p.name)).map((p) => `${kind}: ${p.pack}/${p.name}`),
    );
    expect(RECIPES.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  /**
   * Verifies that every recipe has at least one piece with finite offsets and a positive scale
   */
  it.each(RECIPES)('%s has pieces with finite offsets and a positive scale', (_kind, pieces) => {
    expect(pieces.length).toBeGreaterThan(0);
    for (const p of pieces) {
      for (const v of [p.x, p.z, p.y ?? 0, p.rot ?? 0]) expect(Number.isFinite(v)).toBe(true);
      expect(p.s ?? 1).toBeGreaterThan(0);
    }
  });

  /**
   * Verifies that every recipe key is a decoration kind, never a workstation kind
   */
  it('only has recipes for decoration kinds', () => {
    expect(RECIPES.map(([k]) => k).filter((k) => !DECOR_KINDS.includes(k))).toEqual([]);
  });

  /**
   * Verifies that every decor kind placed in ROOMS is drawn by a recipe
   */
  it('covers every decoration kind used in the rooms', () => {
    const undrawn = ROOMS.flatMap((r) =>
      r.props
        .filter((p) => DECOR_KINDS.includes(p.kind) && !DECOR_RECIPES[p.kind])
        .map((p) => `${r.id}:${p.kind}`),
    );
    expect(undrawn).toEqual([]);
  });

  /**
   * Verifies that no recipe kind is used in ROOMS as part of a workstation (with a post)
   */
  it('is never used by a prop that belongs to a post', () => {
    const tagged = ROOMS.flatMap((r) => r.props.filter((p) => p.post && DECOR_RECIPES[p.kind]).map((p) => `${r.id}:${p.kind}:${p.post}`));
    expect(tagged).toEqual([]);
  });
});

// ---------------------------------------------------------------- placement

describe('decorPlacement', () => {
  /**
   * Verifies that no room, or rooms without decor, give no batch at all
   */
  it('returns no batch for no rooms or rooms without recipe props', () => {
    expect(decorPlacement([])).toEqual([]);
    expect(decorPlacement([makeRoom([])])).toEqual([]);
    expect(decorPlacement([makeRoom([{ kind: 'bench', x: 0, z: 0 }])])).toEqual([]);
  });

  /**
   * Verifies that a decor kind tagged with a post is skipped (the post draws it)
   */
  it('ignores props that belong to a post', () => {
    const r = makeRoom([
      { kind: 'barrels', x: 0, z: 0, post: 'taverne' },
      { kind: 'crates', x: 1, z: 1, post: 'atelier' },
    ]);
    expect(decorPlacement([r])).toEqual([]);
  });

  /**
   * Verifies that an unrotated prop places its pieces at room centre + prop + piece offset
   */
  it('adds the room centre and the prop position to each piece offset', () => {
    const batches = decorPlacement([makeRoom([{ kind: 'barrels', x: 1, z: 2 }], 10, -4)]);
    const barrels = batchOf(batches, 'dungeon', 'barrel_small')!;
    expect(barrels.items).toHaveLength(2);
    const pts = barrels.items.map((i) => [i.x, i.z]).sort((a, b) => a[0] - b[0]);
    expect(pts[0][0]).toBeCloseTo(10 + 1 - 0.4, 9);
    expect(pts[0][1]).toBeCloseTo(-4 + 2 + 0, 9);
    expect(pts[1][0]).toBeCloseTo(10 + 1 + 0.4, 9);
    expect(pts[1][1]).toBeCloseTo(-4 + 2 + 0.05, 9);
    for (const i of barrels.items) expect(i.rotY).toBeCloseTo(0, 12);
  });

  /**
   * Verifies that a quarter turn moves a piece at +x to -z (three.js Y-rotation convention)
   */
  it('turns piece offsets like a three.js Y rotation: x = 0.4 goes to z = -0.4 at π/2', () => {
    const batches = decorPlacement([makeRoom([{ kind: 'barrels', x: 0, z: 0, rot: Math.PI / 2 }], 0, 0)]);
    const items = batchOf(batches, 'dungeon', 'barrel_small')!.items;
    // Pieces (-0.4, 0) and (0.4, 0.05): a quarter turn maps (x, z) to (z, -x).
    const sorted = [...items].sort((a, b) => a.z - b.z);
    expect(sorted[0].x).toBeCloseTo(0.05, 9);
    expect(sorted[0].z).toBeCloseTo(-0.4, 9);
    expect(sorted[1].x).toBeCloseTo(0, 9);
    expect(sorted[1].z).toBeCloseTo(0.4, 9);
    for (const i of items) expect(i.rotY).toBeCloseTo(Math.PI / 2, 12);
  });

  /**
   * Verifies that every recipe, at several turns, lands where a three.js group would put it
   */
  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7, -2.3])('matches a three.js group turned by %d', (turn) => {
    const cx = 3;
    const cz = -7;
    const prop = { x: 1.2, z: -0.6 };
    const problems: string[] = [];
    for (const [kind, pieces] of RECIPES) {
      const batches = decorPlacement([makeRoom([{ kind, ...prop, rot: turn }], cx, cz)]);
      expect(totalItems(batches)).toBe(pieces.length);
      const group = new Object3D();
      group.position.set(cx + prop.x, 0, cz + prop.z);
      group.rotation.y = turn;
      group.updateMatrixWorld(true);
      for (const p of pieces) {
        const want = group.localToWorld(new Vector3(p.x, p.y ?? 0, p.z));
        const found = batches
          .filter((b) => b.pack === p.pack && b.name === p.name)
          .flatMap((b) => b.items)
          .some(
            (i) =>
              Math.abs(i.x - want.x) < 1e-6 &&
              Math.abs(i.y - want.y) < 1e-6 &&
              Math.abs(i.z - want.z) < 1e-6 &&
              Math.abs(i.rotY - (turn + (p.rot ?? 0))) < 1e-9,
          );
        if (!found) problems.push(`${kind}: ${p.pack}/${p.name} expected at (${want.x}, ${want.y}, ${want.z})`);
      }
    }
    expect(problems).toEqual([]);
  });

  /**
   * Verifies that a piece's own turn adds to the prop's turn, and its height is kept
   */
  it("adds the piece's turn to the prop's turn and keeps the piece height", () => {
    const turn = 0.5;
    const batches = decorPlacement([makeRoom([{ kind: 'chartChest', x: 0, z: 0, rot: turn }])]);
    const maps = batchOf(batches, 'tools', 'map_rolled')!.items;
    const recipe = DECOR_RECIPES.chartChest!.filter((p) => p.name === 'map_rolled');
    expect(maps).toHaveLength(recipe.length);
    expect(maps.map((i) => i.rotY).sort()).toEqual(recipe.map((p) => turn + p.rot!).sort());
    for (const i of maps) expect(i.y).toBeCloseTo(recipe[0].y!, 12);
    // A piece without y rests on the floor.
    expect(batchOf(batches, 'dungeon', 'trunk_medium_A')!.items[0].y).toBe(0);
  });

  /**
   * Verifies that each item is scaled uniformly by the piece scale times KIT_SCALE
   */
  it('scales every item by s × KIT_SCALE on all three axes (KIT_SCALE alone without s)', () => {
    const batches = decorPlacement([makeRoom([{ kind: 'crates', x: 0, z: 0 }, { kind: 'barrels', x: 2, z: 2 }])]);
    const s = 0.7 * KIT_SCALE;
    expect(batchOf(batches, 'dungeon', 'crates_stacked')!.items[0].scale).toEqual([s, s, s]);
    for (const i of batchOf(batches, 'dungeon', 'barrel_small')!.items) {
      expect(i.scale).toEqual([KIT_SCALE, KIT_SCALE, KIT_SCALE]);
    }
  });

  /**
   * Verifies that the same model from several props and rooms shares one batch
   */
  it('groups the same model of every prop and room into one batch', () => {
    const a = makeRoom([{ kind: 'barrels', x: 0, z: 0 }, { kind: 'barrels', x: 2, z: 0 }], 0, 0, 'a');
    const b = makeRoom([{ kind: 'barrels', x: 0, z: 0 }], 20, 0, 'b');
    const batches = decorPlacement([a, b]);
    expect(batches.filter((x) => x.name === 'barrel_small')).toHaveLength(1);
    expect(batchOf(batches, 'dungeon', 'barrel_small')!.items).toHaveLength(6);
  });

  /**
   * Verifies that batches are keyed by pack, model and shadow: no two batches share all three
   */
  it('keeps one batch per pack, model and shadow choice', () => {
    const batches = decorPlacement(ROOMS);
    const keys = batches.map((b) => `${b.pack}/${b.name}/${b.shadow}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const b of batches) expect(b.items.length).toBeGreaterThan(0);
  });

  /**
   * Verifies that one model used big and small is split into a shadow and a no-shadow batch
   */
  it('splits a model into two batches when its pieces differ in shadow', () => {
    // Wood_Log_Stack: s 0.45 in lumber (no shadow), s 0.75 in logs (shadow).
    const batches = decorPlacement([makeRoom([{ kind: 'lumber', x: -2, z: 0 }, { kind: 'logs', x: 2, z: 0 }])]);
    const logs = batches.filter((b) => b.pack === 'resources' && b.name === 'Wood_Log_Stack');
    expect(logs.map((b) => b.shadow).sort()).toEqual([false, true]);
    for (const b of logs) expect(b.items).toHaveLength(1);
  });

  /**
   * Verifies the shadow default: only pieces scaled 0.6 or more cast one, unless set explicitly
   */
  it.each([
    ['barrels', 'dungeon', 'barrel_small', true, 'no s (1)'],
    ['crates', 'dungeon', 'crates_stacked', true, 's 0.7'],
    ['fuel', 'resources', 'Parts_Pile_Small', true, 's 0.6, the boundary'],
    ['weeds', 'forest', 'Rock_1_A_Color1', false, 's 0.5'],
    ['coins', 'dungeon', 'coin_stack_large', false, 's 0.45'],
    ['rug', 'furniture', 'rug_rectangle_stripes_A', false, 's 1.25 but shadow: false'],
  ] as [PropKind, string, string, boolean, string][])('%s %s/%s casts a shadow: %s (%s)', (kind, pack, name, shadow) => {
    const batches = decorPlacement([makeRoom([{ kind, x: 0, z: 0 }])]);
    const b = batchOf(batches, pack, name);
    expect(b).toBeDefined();
    expect(b!.shadow).toBe(shadow);
  });

  /**
   * Verifies that a prop without rot is placed unturned
   */
  it('treats a missing rot as no turn', () => {
    const plain = decorPlacement([makeRoom([{ kind: 'forge', x: 0.5, z: 0.5 }])]);
    const zero = decorPlacement([makeRoom([{ kind: 'forge', x: 0.5, z: 0.5, rot: 0 }])]);
    expect(plain).toEqual(zero);
  });

  /**
   * Verifies that the real map yields one item per recipe piece of every unposted decor prop
   */
  it('places every piece of every decor prop of the map', () => {
    const expected = ROOMS.flatMap((r) => r.props)
      .filter((p) => !p.post)
      .reduce((s, p) => s + (DECOR_RECIPES[p.kind]?.length ?? 0), 0);
    expect(expected).toBeGreaterThan(0);
    expect(totalItems(decorPlacement(ROOMS))).toBe(expected);
  });

  /**
   * Verifies that every decor piece of the map lands on its room's floor
   */
  it.each(ROOMS.filter((r) => r.props.some((p) => !p.post && DECOR_RECIPES[p.kind])).map((r) => [r.id, r] as const))(
    '%s decor pieces lie inside the room',
    (_id, r) => {
      const outside = decorPlacement([r])
        .flatMap((b) => b.items.map((i) => ({ name: b.name, i })))
        .filter(({ i }) => Math.abs(i.x - r.cx) >= r.w / 2 - TOL || Math.abs(i.z - r.cz) >= r.d / 2 - TOL)
        .map(({ name, i }) => `${name} (${i.x.toFixed(2)}, ${i.z.toFixed(2)})`);
      expect(outside).toEqual([]);
    },
  );

  /**
   * Verifies that two calls on the same rooms give the same batches
   */
  it('is deterministic', () => {
    expect(decorPlacement(ROOMS)).toEqual(decorPlacement(ROOMS));
  });
});
