import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RoomId } from '@agent-office/shared';
import {
  CUT_CURVE,
  DOOR_W,
  LARGE_TILE,
  OUTER,
  SMALL_TILE,
  WALL_INSET,
  WALL_T,
  corridorFloor,
  edgeRuns,
  foundation,
  inForeground,
  roomFloor,
  seeded,
  sharedSides,
  wallLayout,
  wallRuns,
  type CutItem,
  type KitItem,
  type Placement,
  type WallRun,
} from '../src/scene/dungeon.ts';
import {
  BOUNDS,
  CORRIDORS,
  ROOMS,
  ROOM_BY_ID,
  doorOf,
  inFootprint,
  wallSeats,
  type Accent,
  type FloorKind,
  type Point,
  type Prop,
  type PropKind,
  type RoomDef,
  type Side,
} from '../src/scene/layout.ts';

// kit.ts and the .tsx files need drei and import.meta.env: they are not imported here. The
// manifest is read as plain JSON and the geometry is tested through dungeon.ts directly.

const TOL = 1e-6;

interface PackSpec {
  source: string;
  license: string | null;
  textures: string[];
  models: string[];
}

const MANIFEST: Record<string, PackSpec> = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL('../src/scene/kit-manifest.json', import.meta.url)), 'utf8'),
);
const PUBLIC_KAYKIT = fileURLToPath(new URL('../public/kaykit/', import.meta.url));

/** Same rules as scripts/import-kaykit.mjs. */
const SAFE_NAME = /^[A-Za-z0-9_]+$/;
const SAFE_FILE = /^[A-Za-z0-9_]+\.(png|bin)$/;

const ACCENTS: Accent[] = ['red', 'blue', 'green', 'yellow', 'white', 'brown'];
const BANNER_STYLES = ['', 'patternA_', 'patternB_', 'patternC_', 'shield_', 'triple_'];
const DECOR: PropKind[] = ['crates', 'barrels', 'chest', 'coins', 'candle'];

const WALLED = ROOMS.filter((r) => !r.insideOf);
const WALLED_CASES = WALLED.map((r) => [r.id, r] as const);

function room(id: RoomId): RoomDef {
  const r = ROOM_BY_ID.get(id);
  if (!r) throw new Error(`missing room ${id}`);
  return r;
}

function rect(r: RoomDef) {
  return { x0: r.cx - r.w / 2, x1: r.cx + r.w / 2, z0: r.cz - r.d / 2, z1: r.cz + r.d / 2 };
}

/** Every (model, item) pair of a placement. */
function entries(p: Placement): [string, KitItem][] {
  return [...p].flatMap(([name, items]) => items.map((item) => [name, item] as [string, KitItem]));
}

/** A synthetic walled room, for the edge cases the real floor plan does not have. */
function makeRoom(id: string, cx: number, cz: number, w: number, d: number, extra: Partial<RoomDef> = {}): RoomDef {
  return {
    id: id as RoomId,
    cx,
    cz,
    w,
    d,
    floorKind: 'stone',
    accent: 'red',
    door: { side: 'n', at: 0 },
    props: [],
    seats: [],
    ...extra,
  };
}

/** Y rotation that turns a wall model's decorated face towards the room, per side (the public convention). */
const FACE_IN: [Side, number][] = [
  ['n', 0],
  ['s', Math.PI],
  ['w', Math.PI / 2],
  ['e', -Math.PI / 2],
];
const INWARD: Record<Side, [number, number]> = { n: [0, 1], s: [0, -1], w: [1, 0], e: [-1, 0] };

function sideOfRotation(rotY: number): Side | undefined {
  return FACE_IN.find(([, r]) => Math.abs(Math.atan2(Math.sin(rotY - r), Math.cos(rotY - r))) < TOL)?.[0];
}

/**
 * Coordinate of the wall line of a side: WALL_INSET inside the room edge, except for a
 * shared 'e' or 's' side, whose single wall stands on the common edge itself.
 */
function wallLine(r: RoomDef, side: Side, rooms: RoomDef[] = WALLED): number {
  const b = rect(r);
  const shared = sharedSides(r, rooms).has(side);
  switch (side) {
    case 'n':
      return b.z0 + WALL_INSET;
    case 's':
      return shared ? b.z1 : b.z1 - WALL_INSET;
    case 'w':
      return b.x0 + WALL_INSET;
    case 'e':
      return shared ? b.x1 : b.x1 - WALL_INSET;
  }
}

/** Coordinate of the edge-of-map wall line of a side: BOUNDS moved WALL_INSET inwards. */
const EDGE_LINE: Record<Side, number> = {
  n: BOUNDS.z0 + WALL_INSET,
  s: BOUNDS.z1 - WALL_INSET,
  w: BOUNDS.x0 + WALL_INSET,
  e: BOUNDS.x1 - WALL_INSET,
};

const horizontalSide = (s: Side) => s === 'n' || s === 's';

/** Range covered by a run along its own axis. */
function runRange(run: WallRun): [number, number] {
  const k = horizontalSide(run.side) ? 0 : 1;
  return [Math.min(run.a[k], run.b[k]), Math.max(run.a[k], run.b[k])];
}

/** Size of a floor tile along the world x and z axes, its Y rotation applied. */
function worldSize(t: KitItem): [number, number] {
  // KitInstances applies the scale before the rotation: a quarter turn swaps the axes.
  const quarter = Math.abs(Math.sin(t.rotY)) > 0.5;
  const [sx, , sz] = t.scale!;
  return quarter ? [2 * sz, 2 * sx] : [2 * sx, 2 * sz];
}

/** The walled room a wall decor item faces into, if any (none for a corridor end). */
function roomFacedBy(item: KitItem): RoomDef | undefined {
  const side = sideOfRotation(item.rotY);
  if (!side) return undefined;
  const [ix, iz] = INWARD[side];
  const probe = { x: item.x + ix * 0.6, z: item.z + iz * 0.6 };
  return WALLED.find((w) => {
    const b = rect(w);
    return probe.x > b.x0 && probe.x < b.x1 && probe.z > b.z0 && probe.z < b.z1;
  });
}

// The whole wall layout is pure and deterministic: computed once for every test below.
const LAYOUT = wallLayout();
const TALL: { name: string; item: CutItem }[] = [...LAYOUT.tall].flatMap(([name, items]) => items.map((item) => ({ name, item })));
const EDGE_RUNS = edgeRuns();
const LOW = entries(LAYOUT.low);

// ---------------------------------------------------------------- manifest

describe('kit manifest', () => {
  /**
   * Verifies that the manifest declares the three packs the scene loads from
   */
  it('declares the dungeon, tools and weapons packs with safe names', () => {
    expect(Object.keys(MANIFEST).sort()).toEqual(['dungeon', 'tools', 'weapons']);
    for (const pack of Object.keys(MANIFEST)) expect(pack).toMatch(SAFE_NAME);
  });

  const packs = Object.entries(MANIFEST).map(([pack, spec]) => [pack, spec] as const);

  /**
   * Verifies that every model and texture name of a pack is safe and listed only once
   */
  it.each(packs)('%s lists only safe, unique model and texture names', (_pack, spec) => {
    expect(spec.models.length).toBeGreaterThan(0);
    expect(spec.textures.length).toBeGreaterThan(0);
    for (const name of spec.models) expect(name).toMatch(SAFE_NAME);
    for (const tex of spec.textures) expect(tex).toMatch(SAFE_FILE);
    expect(new Set(spec.models).size).toBe(spec.models.length);
    expect(new Set(spec.textures).size).toBe(spec.textures.length);
  });

  /**
   * Verifies that every texture of a pack has been copied to public/kaykit/<pack>/
   */
  it.each(packs)('%s textures exist in public/kaykit', (pack, spec) => {
    const missing = spec.textures.filter((tex) => !fs.existsSync(path.join(PUBLIC_KAYKIT, pack, tex)));
    expect(missing).toEqual([]);
  });

  /**
   * Verifies that every model of a pack has its .gltf and .bin in public/kaykit/<pack>/
   */
  it.each(packs)('%s models exist in public/kaykit as .gltf and .bin', (pack, spec) => {
    const missing = spec.models.flatMap((name) =>
      [`${name}.gltf`, `${name}.bin`].filter((f) => !fs.existsSync(path.join(PUBLIC_KAYKIT, pack, f))),
    );
    expect(missing).toEqual([]);
  });

  /**
   * Verifies that a copied .gltf only points at its own buffer and at its pack's textures
   */
  it.each(packs)('%s .gltf files reference only their own .bin and listed textures', (pack, spec) => {
    const bad: string[] = [];
    for (const name of spec.models) {
      const file = path.join(PUBLIC_KAYKIT, pack, `${name}.gltf`);
      if (!fs.existsSync(file)) continue; // reported by the existence test
      const gltf = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        buffers?: { uri?: string }[];
        images?: { uri?: string }[];
      };
      for (const b of gltf.buffers ?? []) if (b.uri !== `${name}.bin`) bad.push(`${name}: buffer ${b.uri}`);
      for (const i of gltf.images ?? []) if (!i.uri || !spec.textures.includes(i.uri)) bad.push(`${name}: image ${i.uri}`);
    }
    expect(bad).toEqual([]);
  });

  /**
   * Verifies that every model placed by the dungeon geometry is in the dungeon pack
   */
  it('contains every model used by floors, foundation and walls', () => {
    const used = new Set<string>();
    const floors: Placement = new Map();
    for (const r of WALLED) roomFloor(r, floors);
    corridorFloor(floors);
    foundation(floors);
    for (const name of floors.keys()) used.add(name);
    for (const name of LAYOUT.low.keys()) used.add(name);
    for (const name of LAYOUT.tall.keys()) used.add(name);

    const dungeon = new Set(MANIFEST.dungeon.models);
    expect([...used].filter((n) => !dungeon.has(n))).toEqual([]);
  });

  /**
   * Verifies that every banner style exists in every accent colour, whatever the dice pick
   */
  it('contains a banner for every style and accent', () => {
    const dungeon = new Set(MANIFEST.dungeon.models);
    const missing = BANNER_STYLES.flatMap((style) => ACCENTS.map((a) => `banner_${style}${a}`)).filter((n) => !dungeon.has(n));
    expect(missing).toEqual([]);
  });

  /**
   * Verifies that every room accent is one of the six banner colours
   */
  it('gives every room an accent that has banners', () => {
    for (const r of ROOMS) expect(ACCENTS).toContain(r.accent);
  });
});

// ---------------------------------------------------------------- seeded

describe('seeded', () => {
  /**
   * Verifies that the same key always yields the same sequence of numbers
   */
  it('is deterministic for a given key', () => {
    const a = seeded('floor:atelier');
    const b = seeded('floor:atelier');
    const sa = Array.from({ length: 20 }, () => a());
    const sb = Array.from({ length: 20 }, () => b());
    expect(sa).toEqual(sb);
  });

  /**
   * Verifies that two different keys yield different sequences
   */
  it('differs between keys', () => {
    const a = seeded('walls:garde');
    const b = seeded('walls:heraut');
    expect(Array.from({ length: 5 }, () => a())).not.toEqual(Array.from({ length: 5 }, () => b()));
  });

  /**
   * Verifies that generated values lie in [0, 1), including for an empty key
   */
  it.each(['', 'x', 'corridors', 'a very long key with spaces and accents éà'])('stays in [0, 1) for key %j', (key) => {
    const rand = seeded(key);
    for (let i = 0; i < 1000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// ---------------------------------------------------------------- room floors

/** The whole tile count closest to SMALL_TILE for a length. */
function bestCount(len: number): number {
  const err = (n: number) => Math.abs(len / n / SMALL_TILE - 1);
  let best = 1;
  for (let n = 2; n <= Math.ceil(len / SMALL_TILE) + 1; n++) if (err(n) < err(best)) best = n;
  return best;
}

/** True when a model name belongs to the tile family of a floor kind. */
const FAMILY: Record<FloorKind, (name: string) => boolean> = {
  wood: (n) => n === 'floor_wood_small',
  woodDark: (n) => n === 'floor_wood_small_dark',
  dirt: (n) => n.startsWith('floor_dirt_'),
  stone: (n) => n.startsWith('floor_tile_small') || n === 'floor_tile_grate',
  stoneFancy: (n) => n.startsWith('floor_tile_small') || n === 'floor_tile_grate',
  grate: (n) => n.startsWith('floor_tile_small') || n === 'floor_tile_grate',
};

describe('roomFloor', () => {
  /**
   * Verifies that the tiles' areas add up to the room area and their centres lie inside it
   */
  it.each(WALLED_CASES)('%s tiles add up to the room area, centred inside it', (_id, r) => {
    const tiles = entries(roomFloor(r));
    expect(tiles.length).toBeGreaterThan(0);
    // A small tile is 2 pack units wide: its size is twice its x and z scale.
    const area = tiles.reduce((s, [, t]) => s + 2 * t.scale![0] * 2 * t.scale![2], 0);
    expect(Math.abs(area - r.w * r.d)).toBeLessThan(TOL);
    const b = rect(r);
    for (const [, t] of tiles) {
      expect(t.x).toBeGreaterThan(b.x0);
      expect(t.x).toBeLessThan(b.x1);
      expect(t.z).toBeGreaterThan(b.z0);
      expect(t.z).toBeLessThan(b.z1);
    }
  });

  /**
   * Verifies that tiles are stretched by at most 15%, or by the least possible amount
   */
  it.each(WALLED_CASES)('%s tiles stay close to the small tile size', (_id, r) => {
    // SPEC CONFLICT: the brief asks for ±15% on every tile, but the concierge is 3.5 m deep:
    // 2 tiles of 1.75 m (+16.7%) or 3 of 1.17 m (-22%), no whole count reaches ±15%. The
    // test accepts ±15%, or else the whole count closest to SMALL_TILE.
    const ok = (size: number, len: number) =>
      Math.abs(size / SMALL_TILE - 1) <= 0.15 + TOL || Math.abs(size - len / bestCount(len)) < TOL;
    for (const [, t] of entries(roomFloor(r))) {
      const [sx, sz] = worldSize(t);
      expect(ok(sx, r.w), `x size ${sx}`).toBe(true);
      expect(ok(sz, r.d), `z size ${sz}`).toBe(true);
    }
  });

  /**
   * Verifies that, once their Y rotation is applied, tiles stay in the room and never overlap
   */
  it.each(WALLED_CASES)('%s tiles, as rendered (rotation applied), tile the room without overlap', (_id, r) => {
    // KitInstances composes position, rotation and scale (scale first, in the model's own
    // axes). A quarter-turned tile with different x and z scales therefore swaps its width
    // and depth in the world. Together with the area test above, "inside the room and no
    // overlap" means the room is covered with no gap.
    const b = rect(r);
    const boxes = entries(roomFloor(r)).map(([, t]) => {
      const [hx, hz] = worldSize(t).map((v) => v / 2);
      return { x0: t.x - hx, x1: t.x + hx, z0: t.z - hz, z1: t.z + hz };
    });
    const problems: string[] = [];
    for (const t of boxes) {
      if (t.x0 < b.x0 - TOL || t.x1 > b.x1 + TOL || t.z0 < b.z0 - TOL || t.z1 > b.z1 + TOL) {
        problems.push(`outside: ${JSON.stringify(t)}`);
      }
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const ox = Math.min(boxes[i].x1, boxes[j].x1) - Math.max(boxes[i].x0, boxes[j].x0);
        const oz = Math.min(boxes[i].z1, boxes[j].z1) - Math.max(boxes[i].z0, boxes[j].z0);
        if (ox > TOL && oz > TOL) problems.push(`overlap: ${JSON.stringify(boxes[i])} / ${JSON.stringify(boxes[j])}`);
      }
    }
    expect(problems.slice(0, 3)).toEqual([]);
  });

  /**
   * Verifies that a room only uses the tile models of its floor kind
   */
  it.each(WALLED_CASES)('%s uses only tiles of its floor kind', (_id, r) => {
    const names = [...roomFloor(r).keys()];
    expect(names.filter((n) => !FAMILY[r.floorKind](n))).toEqual([]);
  });

  /**
   * Verifies that wood rooms use plain planks, dark wood rooms dark planks, dirt rooms dirt
   */
  it('maps wood, dark wood and dirt rooms to their dedicated tiles', () => {
    expect([...roomFloor(room('taverne')).keys()]).toEqual(['floor_wood_small']);
    expect([...roomFloor(room('biblio')).keys()]).toEqual(['floor_wood_small_dark']);
    const dirt = [...roomFloor(room('concierge')).keys()];
    expect(dirt.length).toBeGreaterThan(0);
    for (const n of dirt) expect(n).toMatch(/^floor_dirt_/);
  });

  /**
   * Verifies that two calls for the same room give exactly the same tiles
   */
  it.each(WALLED_CASES)('%s floor is deterministic', (_id, r) => {
    expect(roomFloor(r)).toEqual(roomFloor(r));
  });

  /**
   * Verifies that tiles are appended to a given placement, keeping its existing entries
   */
  it('appends to the placement it is given', () => {
    const p: Placement = new Map([['marker', [{ x: 1, y: 2, z: 3, rotY: 0 }]]]);
    const out = roomFloor(room('taverne'), p);
    expect(out).toBe(p);
    expect(p.get('marker')).toEqual([{ x: 1, y: 2, z: 3, rotY: 0 }]);
    expect(p.get('floor_wood_small')!.length).toBe(entries(roomFloor(room('taverne'))).length);
  });

  /**
   * Verifies that a room smaller than one tile still gets one tile covering it
   */
  it('covers a room smaller than a tile with a single tile', () => {
    const tiles = entries(roomFloor(makeRoom('tiny', 0, 0, 0.5, 0.4, { floorKind: 'wood' })));
    expect(tiles).toHaveLength(1);
    const [, t] = tiles[0];
    expect(2 * t.scale![0]).toBeCloseTo(0.5);
    expect(2 * t.scale![2]).toBeCloseTo(0.4);
    expect(t.x).toBeCloseTo(0);
    expect(t.z).toBeCloseTo(0);
  });
});

// ---------------------------------------------------------------- corridors and foundation

describe('corridorFloor', () => {
  const tiles = entries(corridorFloor());
  const H = LARGE_TILE / 2;

  /**
   * Verifies that corridor tiles only use the large stone tile models
   */
  it('uses large stone tiles only', () => {
    expect(tiles.length).toBeGreaterThan(0);
    for (const [name] of tiles) expect(['floor_tile_large', 'floor_tile_large_rocks']).toContain(name);
  });

  /**
   * Verifies that no corridor tile is hidden entirely under a walled room
   */
  it('skips tiles lying entirely inside a walled room', () => {
    const hidden = tiles.filter(([, t]) =>
      WALLED.some((r) => {
        const b = rect(r);
        return t.x - H >= b.x0 - TOL && t.x + H <= b.x1 + TOL && t.z - H >= b.z0 - TOL && t.z + H <= b.z1 + TOL;
      }),
    );
    expect(hidden).toEqual([]);
  });

  /**
   * Verifies that corridor tiles stay within the outer rectangle of the dungeon
   */
  it('stays within OUTER', () => {
    for (const [, t] of tiles) {
      expect(t.x - H).toBeGreaterThanOrEqual(OUTER.x0 - TOL);
      expect(t.x + H).toBeLessThanOrEqual(OUTER.x1 + TOL);
      expect(t.z - H).toBeGreaterThanOrEqual(OUTER.z0 - TOL);
      expect(t.z + H).toBeLessThanOrEqual(OUTER.z1 + TOL);
    }
  });

  /**
   * Verifies that corridor tiles and rooms together leave no hole in the dungeon floor
   */
  it('leaves no hole: every point of OUTER is on a corridor tile or in a walled room', () => {
    const step = 0.5;
    const nx = Math.round((OUTER.x1 - OUTER.x0) / step);
    const nz = Math.round((OUTER.z1 - OUTER.z0) / step);
    const holes: Point[] = [];
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= nz; j++) {
        const p = { x: OUTER.x0 + i * step, z: OUTER.z0 + j * step };
        const onTile = tiles.some(([, t]) => Math.abs(p.x - t.x) <= H + TOL && Math.abs(p.z - t.z) <= H + TOL);
        const inRoom = WALLED.some((r) => {
          const b = rect(r);
          return p.x >= b.x0 - TOL && p.x <= b.x1 + TOL && p.z >= b.z0 - TOL && p.z <= b.z1 + TOL;
        });
        if (!onTile && !inRoom) holes.push(p);
      }
    }
    expect(holes.slice(0, 5)).toEqual([]);
  });

  /**
   * Verifies that two calls give the same corridor tiles
   */
  it('is deterministic', () => {
    expect(corridorFloor()).toEqual(corridorFloor());
  });
});

describe('foundation', () => {
  /**
   * Verifies that the foundation has one corner block at each corner of OUTER
   */
  it('puts one corner block at each corner of the dungeon', () => {
    const corners = foundation().get('floor_foundation_corner')!;
    expect(corners).toHaveLength(4);
    const h = SMALL_TILE / 2;
    const expected = [
      [OUTER.x0 + h, OUTER.z1 - h],
      [OUTER.x1 - h, OUTER.z1 - h],
      [OUTER.x1 - h, OUTER.z0 + h],
      [OUTER.x0 + h, OUTER.z0 + h],
    ];
    for (const [x, z] of expected) {
      expect(corners.some((c) => Math.abs(c.x - x) < TOL && Math.abs(c.z - z) < TOL)).toBe(true);
    }
  });

  /**
   * Verifies that every foundation block sits along the outer edge, below the floor
   */
  it('only places blocks along the outer edge, below floor level', () => {
    const blocks = entries(foundation());
    expect(blocks.length).toBeGreaterThan(4);
    const h = SMALL_TILE / 2;
    for (const [, b] of blocks) {
      const onEdge =
        Math.abs(b.x - (OUTER.x0 + h)) < TOL ||
        Math.abs(b.x - (OUTER.x1 - h)) < TOL ||
        Math.abs(b.z - (OUTER.z0 + h)) < TOL ||
        Math.abs(b.z - (OUTER.z1 - h)) < TOL;
      expect(onEdge, JSON.stringify(b)).toBe(true);
      expect(b.y).toBeLessThan(0);
    }
  });
});

// ---------------------------------------------------------------- wall runs

describe('wallRuns', () => {
  /**
   * Verifies that no wall run covers the door gap of the room
   */
  it.each(WALLED_CASES)('%s leaves the DOOR_W gap at the door free', (_id, r) => {
    const door = doorOf(r).wall;
    const side = r.door.side;
    const horizontal = side === 'n' || side === 's';
    const centre = horizontal ? door.x : door.z;
    const lo = centre - DOOR_W / 2;
    const hi = centre + DOOR_W / 2;
    for (const run of wallRuns(r).filter((x) => x.side === side)) {
      const k = horizontal ? 0 : 1;
      const r0 = Math.min(run.a[k], run.b[k]);
      const r1 = Math.max(run.a[k], run.b[k]);
      const overlap = Math.min(r1, hi) - Math.max(r0, lo);
      expect(overlap, `${side} run ${r0}..${r1} vs door ${lo}..${hi}`).toBeLessThanOrEqual(TOL);
    }
  });

  /**
   * Verifies that the door wall still has walls on both sides of a centred door
   */
  it.each(WALLED_CASES)('%s door wall is the side length minus the door gap', (_id, r) => {
    const side = r.door.side;
    const horizontal = side === 'n' || side === 's';
    const full = (horizontal ? r.w : r.d) - 2 * WALL_INSET;
    const len = wallRuns(r)
      .filter((x) => x.side === side)
      .reduce((s, x) => s + Math.hypot(x.b[0] - x.a[0], x.b[1] - x.a[1]), 0);
    expect(len).toBeCloseTo(full - DOOR_W, 6);
  });

  /**
   * Verifies that a side without a door is one full run, or none when its neighbour owns it
   */
  it.each(WALLED_CASES)('%s sides without a door are a single full run unless owned by a neighbour', (_id, r) => {
    const runs = wallRuns(r);
    const shared = sharedSides(r);
    for (const side of (['n', 's', 'e', 'w'] as Side[]).filter((s) => s !== r.door.side)) {
      const mine = runs.filter((x) => x.side === side);
      if (shared.has(side) && (side === 'n' || side === 'w')) {
        expect(mine, `${side} belongs to the neighbour`).toHaveLength(0);
        continue;
      }
      expect(mine).toHaveLength(1);
      const full = (horizontalSide(side) ? r.w : r.d) - 2 * WALL_INSET;
      expect(Math.hypot(mine[0].b[0] - mine[0].a[0], mine[0].b[1] - mine[0].a[1])).toBeCloseTo(full, 6);
    }
  });

  /**
   * Verifies that runs lie WALL_INSET inside the room, or on the edge for an owned shared side
   */
  it.each(WALLED_CASES)('%s runs lie on their wall line, within the room span', (_id, r) => {
    const b = rect(r);
    for (const run of wallRuns(r)) {
      expect(run.room).toBe(r);
      const line = wallLine(r, run.side);
      for (const [x, z] of [run.a, run.b]) {
        if (horizontalSide(run.side)) {
          expect(z).toBeCloseTo(line, 9);
          expect(x).toBeGreaterThanOrEqual(b.x0 + WALL_INSET - TOL);
          expect(x).toBeLessThanOrEqual(b.x1 - WALL_INSET + TOL);
        } else {
          expect(x).toBeCloseTo(line, 9);
          expect(z).toBeGreaterThanOrEqual(b.z0 + WALL_INSET - TOL);
          expect(z).toBeLessThanOrEqual(b.z1 - WALL_INSET + TOL);
        }
      }
    }
  });

  /**
   * Verifies that back-to-back rooms get one wall on their common edge, drawn by the west room
   */
  it('draws a single wall on each common edge of the bottom rooms', () => {
    const garde = room('garde');
    const epreuves = room('epreuves');
    const heraut = room('heraut');
    const xs = (r: RoomDef, side: Side) => wallRuns(r).filter((x) => x.side === side).map((x) => x.a[0]);
    expect(xs(garde, 'e')).toEqual([garde.cx + garde.w / 2]);
    expect(xs(epreuves, 'w')).toEqual([]);
    expect(xs(epreuves, 'e')).toEqual([epreuves.cx + epreuves.w / 2]);
    expect(xs(heraut, 'w')).toEqual([]);
    expect(garde.cx + garde.w / 2).toBeCloseTo(-15, 9);
    expect(epreuves.cx + epreuves.w / 2).toBeCloseTo(-4, 9);
  });

  /**
   * Verifies that the shared wall leaves the neighbour's door open on the common edge
   */
  it("cuts the neighbour's door out of the shared wall", () => {
    const west = makeRoom('west', 0, 0, 4, 4);
    const east = makeRoom('east', 4, 0, 4, 4, { door: { side: 'w', at: 0 } });
    const rooms = [west, east];
    expect(wallRuns(east, rooms).filter((x) => x.side === 'w')).toEqual([]);
    const shared = wallRuns(west, rooms).filter((x) => x.side === 'e');
    expect(shared).toHaveLength(2);
    for (const run of shared) {
      expect(run.a[0]).toBeCloseTo(2, 9);
      const [lo, hi] = runRange(run);
      expect(Math.min(hi, DOOR_W / 2) - Math.max(lo, -DOOR_W / 2)).toBeLessThanOrEqual(TOL);
    }
  });

  /**
   * Verifies that a north-south pair gets one wall on the south side of the north room
   */
  it('lets the north room own a shared north-south wall', () => {
    const north = makeRoom('north', 0, 0, 4, 4, { door: { side: 'w', at: 0 } });
    const south = makeRoom('south', 0, 4, 4, 4, { door: { side: 'e', at: 0 } });
    const rooms = [north, south];
    expect(wallRuns(south, rooms).filter((x) => x.side === 'n')).toEqual([]);
    const shared = wallRuns(north, rooms).filter((x) => x.side === 's');
    expect(shared).toHaveLength(1);
    expect(shared[0].a[1]).toBeCloseTo(2, 9);
  });

  /**
   * Verifies that a door nearly touching a corner leaves no sliver of wall beside it
   */
  it('drops the sliver of wall between a door and a close corner', () => {
    // Inner wall spans -1.85..1.85; a door at -0.93 opens on -1.83..-0.03: 2 cm from the corner.
    const r = makeRoom('corner-door', 0, 0, 4, 4, { door: { side: 'n', at: -0.93 } });
    const north = wallRuns(r, [r]).filter((x) => x.side === 'n');
    expect(north).toHaveLength(1);
    expect(Math.min(north[0].a[0], north[0].b[0])).toBeCloseTo(-0.93 + DOOR_W / 2, 9);
  });

  /**
   * Verifies that a door on the west side splits the west wall, the others staying whole
   */
  it('splits only the door side for a west door', () => {
    const r = makeRoom('west-door', 0, 0, 6, 6, { door: { side: 'w', at: 0 } });
    const runs = wallRuns(r, [r]);
    expect(runs.filter((x) => x.side === 'w')).toHaveLength(2);
    for (const s of ['n', 's', 'e'] as Side[]) expect(runs.filter((x) => x.side === s)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- edge runs

describe('edgeRuns', () => {
  /**
   * Verifies that the current map gets 4 north, 2 south, 2 west and no east corridor ends
   */
  it('closes 8 corridor ends: 4 on n, 2 on s, 2 on w', () => {
    const count = (s: Side) => EDGE_RUNS.filter((r) => r.side === s).length;
    expect(EDGE_RUNS).toHaveLength(8);
    expect([count('n'), count('s'), count('w'), count('e')]).toEqual([4, 2, 2, 0]);
    const south = EDGE_RUNS.filter((r) => r.side === 's').map(runRange).sort((p, q) => p[0] - q[0]);
    expect(south[0][0]).toBeCloseTo(3.85, 9);
    expect(south[0][1]).toBeCloseTo(6.15, 9);
    expect(south[1][0]).toBeCloseTo(13.85, 9);
    expect(south[1][1]).toBeCloseTo(16.15, 9);
  });

  /**
   * Verifies that edge runs belong to no room and lie on the edge rooms' wall line
   */
  it('lies on BOUNDS moved WALL_INSET inwards, without a room', () => {
    for (const run of EDGE_RUNS) {
      expect(run.room).toBeUndefined();
      const k = horizontalSide(run.side) ? 1 : 0;
      expect(run.a[k]).toBeCloseTo(EDGE_LINE[run.side], 9);
      expect(run.b[k]).toBeCloseTo(EDGE_LINE[run.side], 9);
      const [lo, hi] = runRange(run);
      expect(hi - lo).toBeGreaterThan(0.5);
    }
  });

  /**
   * Verifies that no edge run doubles the wall of a room standing on that edge
   */
  it('never overlaps the wall of a room on the same edge', () => {
    const edgeOf: Record<Side, (r: RoomDef) => { at: number; lo: number; hi: number }> = {
      n: (r) => ({ at: r.cz - r.d / 2, lo: r.cx - r.w / 2, hi: r.cx + r.w / 2 }),
      s: (r) => ({ at: r.cz + r.d / 2, lo: r.cx - r.w / 2, hi: r.cx + r.w / 2 }),
      w: (r) => ({ at: r.cx - r.w / 2, lo: r.cz - r.d / 2, hi: r.cz + r.d / 2 }),
      e: (r) => ({ at: r.cx + r.w / 2, lo: r.cz - r.d / 2, hi: r.cz + r.d / 2 }),
    };
    const bound: Record<Side, number> = { n: BOUNDS.z0, s: BOUNDS.z1, w: BOUNDS.x0, e: BOUNDS.x1 };
    const doubled: string[] = [];
    for (const run of EDGE_RUNS) {
      const [lo, hi] = runRange(run);
      for (const r of WALLED) {
        const e = edgeOf[run.side](r);
        if (Math.abs(e.at - bound[run.side]) > TOL) continue;
        const overlap = Math.min(hi, e.hi - WALL_INSET) - Math.max(lo, e.lo + WALL_INSET);
        if (overlap > TOL) doubled.push(`${run.side} ${lo}..${hi} over ${r.id}`);
      }
    }
    expect(doubled).toEqual([]);
  });

  /**
   * Verifies that every corridor reaching the map edge is closed by an edge run
   */
  it('closes every corridor end at the map edge', () => {
    const open: string[] = [];
    for (const p of CORRIDORS.flat()) {
      const near: [Side, number, number][] = [
        ['n', Math.abs(p.z - BOUNDS.z0), p.x],
        ['s', Math.abs(p.z - BOUNDS.z1), p.x],
        ['w', Math.abs(p.x - BOUNDS.x0), p.z],
        ['e', Math.abs(p.x - BOUNDS.x1), p.z],
      ];
      for (const [side, dist, along] of near) {
        if (dist > 1) continue;
        const closed = EDGE_RUNS.some((run) => {
          const [lo, hi] = runRange(run);
          return run.side === side && along >= lo - TOL && along <= hi + TOL;
        });
        if (!closed) open.push(`${side} at (${p.x}, ${p.z})`);
      }
    }
    expect(open).toEqual([]);
  });

  /**
   * Verifies that without rooms each map side is one wall from corner to corner
   */
  it('closes each whole side of the map when there is no room', () => {
    const runs = edgeRuns([]);
    expect(runs.map((r) => r.side).sort()).toEqual(['e', 'n', 's', 'w']);
    for (const run of runs) {
      const [lo, hi] = runRange(run);
      const [l0, l1] = horizontalSide(run.side) ? [BOUNDS.x0, BOUNDS.x1] : [BOUNDS.z0, BOUNDS.z1];
      expect(lo).toBeCloseTo(l0 + WALL_INSET, 9);
      expect(hi).toBeCloseTo(l1 - WALL_INSET, 9);
    }
  });

  /**
   * Verifies that the slot under 0.5 m between two rooms side by side gets no edge wall
   */
  it('skips the narrow slot between two rooms on the edge', () => {
    // garde and epreuves meet at x = -15 on the south edge: their wall lines leave a 0.3 m slot.
    for (const run of EDGE_RUNS.filter((r) => r.side === 's')) {
      const [lo, hi] = runRange(run);
      expect(lo > -15 || hi < -15).toBe(true);
      expect(lo > -4 || hi < -4).toBe(true);
    }
  });
});

// ---------------------------------------------------------------- wall layout

describe('wallLayout', () => {
  /**
   * Verifies that tall wall pieces keep the WALL_T thickness, whatever their length
   */
  it('keeps every tall wall piece WALL_T thick', () => {
    const walls = TALL.filter((t) => t.name.startsWith('wall'));
    expect(walls.length).toBeGreaterThan(0);
    for (const { name, item } of walls) expect(item.scale?.[2], name).toBe(WALL_T);
  });

  /**
   * Verifies that low barriers are thinner than the tall walls they hide in
   */
  it('makes every low barrier thinner than WALL_T', () => {
    const barriers = LOW.filter(([n]) => n === 'barrier');
    expect(barriers.length).toBeGreaterThan(0);
    // A barrier is 0.5 m thick in the pack.
    for (const [, b] of barriers) expect(b.scale![2] * 0.5).toBeLessThan(WALL_T);
  });

  /**
   * Verifies that every low barrier stands where a tall wall stands, facing the same way
   */
  it('puts every low barrier inside a tall wall piece', () => {
    const walls = TALL.filter((t) => t.name.startsWith('wall')).map((t) => t.item);
    const orphans = LOW.filter(([n]) => n === 'barrier').filter(
      ([, b]) => !walls.some((w) => Math.abs(w.x - b.x) < TOL && Math.abs(w.z - b.z) < TOL && Math.abs(w.rotY - b.rotY) < TOL),
    );
    expect(orphans).toEqual([]);
  });

  /**
   * Verifies that every tall pillar has a short column at its foot for the lowered state
   */
  it('pairs every tall pillar with a low column', () => {
    const columns = LOW.filter(([n]) => n === 'column').map(([, c]) => c);
    const pillars = TALL.filter((t) => t.name === 'pillar');
    expect(pillars.length).toBeGreaterThan(0);
    for (const { item } of pillars) {
      expect(columns.some((c) => Math.abs(c.x - item.x) < TOL && Math.abs(c.z - item.z) < TOL)).toBe(true);
    }
  });

  /**
   * Verifies that every wall piece and every pillar sinks or stands on its own position
   */
  it('anchors walls and pillars on their own centre', () => {
    const pieces = TALL.filter((t) => t.name.startsWith('wall') || t.name === 'pillar');
    expect(pieces.length).toBeGreaterThan(0);
    for (const { name, item } of pieces) {
      expect(Math.abs(item.ax - item.x), name).toBeLessThan(1e-9);
      expect(Math.abs(item.az - item.z), name).toBeLessThan(1e-9);
    }
  });

  /**
   * Verifies that every torch or banner shares the anchor of a wall piece, so it sinks with it
   */
  it('anchors wall decor on the wall chunk it hangs on', () => {
    const walls = TALL.filter((t) => t.name.startsWith('wall')).map((t) => t.item);
    const decor = TALL.filter((t) => t.name === 'torch_mounted' || t.name.startsWith('banner_'));
    expect(decor.length).toBeGreaterThan(0);
    const orphans = decor.filter(
      ({ item }) =>
        !walls.some((w) => Math.abs(w.ax - item.ax) < 1e-9 && Math.abs(w.az - item.az) < 1e-9 && Math.abs(w.rotY - item.rotY) < TOL),
    );
    expect(orphans.map((o) => `${o.name} (${o.item.x}, ${o.item.z})`)).toEqual([]);
  });

  /**
   * Verifies that each shared corner gets one wide pillar straddling the common edge
   */
  it.each([
    ['garde | epreuves', -15],
    ['epreuves | heraut', -4],
  ])('puts one 0.6 m pillar on each end of the %s wall', (_name, seam) => {
    const garde = room('garde');
    const pillarsAt = (x: number, z: number) =>
      TALL.filter((t) => t.name === 'pillar' && Math.abs(t.item.x - x) < TOL && Math.abs(t.item.z - z) < TOL).map((t) => t.item);
    for (const z of [garde.cz - garde.d / 2 + WALL_INSET, garde.cz + garde.d / 2 - WALL_INSET]) {
      const here = pillarsAt(seam, z);
      expect(here).toHaveLength(1);
      // A 1.5 m pillar: its x scale times 1.5 is its width.
      expect(here[0].scale![0] * 1.5).toBeCloseTo(0.6, 9);
      // The room to the east leaves the corner to its west neighbour: no pillar of its own.
      expect(pillarsAt(seam + WALL_INSET, z)).toEqual([]);
    }
  });

  /**
   * Verifies that no torch or banner hangs where a prop stands in front of the wall
   */
  it('never hangs wall decor in front of furniture or over a nested zone', () => {
    const decor = TALL.filter((t) => t.name === 'torch_mounted' || t.name.startsWith('banner_'));
    expect(decor.length).toBeGreaterThan(0);
    const problems: string[] = [];
    for (const { name, item } of decor) {
      const side = sideOfRotation(item.rotY);
      if (!side) {
        problems.push(`${name} faces no wall side (rotY ${item.rotY})`);
        continue;
      }
      const [ix, iz] = INWARD[side];
      const r = roomFacedBy(item);
      // The decor point projected onto its wall line: the room's own line, or for a corridor
      // end the edge-of-map line. On a shared wall, the line is the common edge itself.
      const line = r ? wallLine(r, side) : EDGE_LINE[side];
      const wall = horizontalSide(side) ? { x: item.x, z: line } : { x: line, z: item.z };
      const front = { x: wall.x + ix * 0.6, z: wall.z + iz * 0.6 };
      if (!r) {
        // A corridor end: torches only, on an edge run, and clear of every room's furniture.
        if (name !== 'torch_mounted') problems.push(`${name} on a corridor end at (${item.x}, ${item.z})`);
        const onEdge = EDGE_RUNS.some((run) => {
          const [lo, hi] = runRange(run);
          const along = horizontalSide(side) ? wall.x : wall.z;
          return run.side === side && along >= lo - TOL && along <= hi + TOL;
        });
        if (!onEdge) problems.push(`${name} at (${item.x}, ${item.z}) faces no room and no edge run`);
        for (const other of WALLED) {
          const blocking = other.props.filter((p) => inFootprint(p, front.x - other.cx, front.z - other.cz));
          if (blocking.length) problems.push(`edge ${name} in front of ${other.id} ${blocking.map((p) => p.kind).join(', ')}`);
        }
        continue;
      }
      const blocking = r.props.filter((p) => inFootprint(p, front.x - r.cx, front.z - r.cz));
      if (blocking.length) problems.push(`${r.id}: ${name} in front of ${blocking.map((p) => p.kind).join(', ')}`);
      for (const zn of ROOMS.filter((z) => z.insideOf === r.id)) {
        if (Math.abs(wall.x - zn.cx) < zn.w / 2 + 0.5 && Math.abs(wall.z - zn.cz) < zn.d / 2 + 0.5) {
          problems.push(`${r.id}: ${name} over the ${zn.id} zone`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  /**
   * Verifies that wall banners hang in a room and use the colour of its accent
   */
  it("uses the room's accent colour for its banners", () => {
    for (const { name, item } of TALL.filter((t) => t.name.startsWith('banner_'))) {
      const r = roomFacedBy(item);
      expect(r, `${name} at (${item.x}, ${item.z})`).toBeDefined();
      expect(name.endsWith(`_${r!.accent}`), `${name} in ${r!.id}`).toBe(true);
    }
  });

  /**
   * Verifies that two calls give the same walls and wall decor
   */
  it('is deterministic', () => {
    expect(wallLayout()).toEqual(LAYOUT);
  });

  /**
   * Verifies that without rooms only the map-edge walls remain, with no pillar or banner
   */
  it('keeps only the edge walls for no rooms', () => {
    const empty = wallLayout([]);
    const names = [...empty.tall.keys()];
    expect(names.some((n) => n.startsWith('wall'))).toBe(true);
    for (const n of names) expect(n === 'torch_mounted' || n.startsWith('wall'), n).toBe(true);
    expect([...empty.low.keys()]).toEqual(['barrier']);
    // Every wall chunk lies on one of the four edge lines.
    for (const [n, items] of empty.tall) {
      if (!n.startsWith('wall')) continue;
      for (const w of items) {
        const onLine =
          Math.abs(w.z - EDGE_LINE.n) < TOL ||
          Math.abs(w.z - EDGE_LINE.s) < TOL ||
          Math.abs(w.x - EDGE_LINE.w) < TOL ||
          Math.abs(w.x - EDGE_LINE.e) < TOL;
        expect(onLine, `${n} (${w.x}, ${w.z})`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------- shared sides

describe('sharedSides', () => {
  const EXPECTED: Partial<Record<RoomId, Side[]>> = { garde: ['e'], epreuves: ['e', 'w'], heraut: ['w'] };

  /**
   * Verifies that only the three back-to-back bottom rooms have shared sides
   */
  it.each(WALLED_CASES)('%s has the expected shared sides', (id, r) => {
    expect([...sharedSides(r)].sort()).toEqual([...(EXPECTED[id] ?? [])].sort());
  });

  /**
   * Verifies that a room alone in the list shares no side
   */
  it('finds nothing for a room alone', () => {
    const r = room('epreuves');
    expect(sharedSides(r, [r]).size).toBe(0);
  });

  /**
   * Verifies that two rooms touching along a full edge share that edge
   */
  it('detects two rooms touching east-west', () => {
    const a = makeRoom('a', 0, 0, 4, 4);
    const b = makeRoom('b', 4, 0, 4, 4);
    expect([...sharedSides(a, [a, b])]).toEqual(['e']);
    expect([...sharedSides(b, [a, b])]).toEqual(['w']);
  });

  /**
   * Verifies that two rooms touching north-south share that edge
   */
  it('detects two rooms touching north-south', () => {
    const a = makeRoom('a', 0, 0, 4, 4);
    const b = makeRoom('b', 0, 4, 4, 4);
    expect([...sharedSides(a, [a, b])]).toEqual(['s']);
    expect([...sharedSides(b, [a, b])]).toEqual(['n']);
  });

  /**
   * Verifies that rooms separated by a corridor do not share a side
   */
  it('ignores rooms separated by a corridor', () => {
    const a = makeRoom('a', 0, 0, 4, 4);
    const b = makeRoom('b', 6, 0, 4, 4);
    expect(sharedSides(a, [a, b]).size).toBe(0);
  });

  /**
   * Verifies that rooms meeting only at a corner do not share a side
   */
  it('ignores rooms that only touch at a corner or barely overlap', () => {
    const a = makeRoom('a', 0, 0, 4, 4);
    const corner = makeRoom('b', 4, 4, 4, 4);
    const sliver = makeRoom('c', 4, 3.6, 4, 4); // edges overlap 0.4 m only
    expect(sharedSides(a, [a, corner]).size).toBe(0);
    expect(sharedSides(a, [a, sliver]).size).toBe(0);
  });
});

// ---------------------------------------------------------------- cutaway

describe('inForeground', () => {
  /**
   * Verifies that a point directly below the cursor is in the foreground
   */
  it.each([
    [0, 0],
    [0.5, -0.3],
    [-0.9, 0.9],
  ])('sinks a point just below a cursor at (%d, %d)', (cx, cy) => {
    expect(inForeground(cx, cy, cx, cy - 0.01)).toBe(true);
    expect(inForeground(cx, cy, cx, -1)).toBe(true);
  });

  /**
   * Verifies that a point directly above the cursor stands
   */
  it('keeps a point directly above the cursor', () => {
    expect(inForeground(0, 0, 0, 0.01)).toBe(false);
    expect(inForeground(0.2, -0.5, 0.2, 1)).toBe(false);
  });

  /**
   * Verifies that a point exactly on the cursor stands (the curve is a strict bound)
   */
  it('keeps the point under the cursor itself', () => {
    expect(inForeground(0.3, 0.4, 0.3, 0.4)).toBe(false);
  });

  /**
   * Verifies that at the cursor's height but off to the side, a point stands
   */
  it.each([0.1, 0.5, 1, 2])('keeps a point level with the cursor, %d to either side', (dx) => {
    expect(inForeground(0, 0, dx, 0)).toBe(false);
    expect(inForeground(0, 0, -dx, 0)).toBe(false);
  });

  /**
   * Verifies that the curve is symmetric left and right of the cursor
   */
  it('is symmetric about the cursor', () => {
    for (const dx of [0.05, 0.3, 0.7, 1.4]) {
      for (const y of [-1, -0.5, -0.2, -0.05, 0, 0.3]) {
        expect(inForeground(0.2, 0.1, 0.2 + dx, y)).toBe(inForeground(0.2, 0.1, 0.2 - dx, y));
      }
    }
  });

  /**
   * Verifies that one NDC unit away from the cursor the curve has dropped by CUT_CURVE (0.3)
   */
  it('drops by CUT_CURVE one unit away from the cursor', () => {
    expect(CUT_CURVE).toBe(0.3);
    const cy = 0.5;
    const curve = cy - CUT_CURVE;
    expect(inForeground(0, cy, 1, curve - 0.001)).toBe(true);
    expect(inForeground(0, cy, 1, curve + 0.001)).toBe(false);
    expect(inForeground(0, cy, -1, curve - 0.001)).toBe(true);
    expect(inForeground(0, cy, -1, curve + 0.001)).toBe(false);
  });

  /**
   * Verifies that the curve drops faster further away (quadratic: 4 × CUT_CURVE at 2 units)
   */
  it('drops quadratically with the distance from the cursor', () => {
    expect(inForeground(0, 0, 2, -4 * CUT_CURVE + 0.001)).toBe(false);
    expect(inForeground(0, 0, 2, -4 * CUT_CURVE - 0.001)).toBe(true);
  });
});

// ---------------------------------------------------------------- decor props

/**
 * True when (x, z) lies on the prop's footprint widened by `margin` (0 = the bare box).
 *
 * inFootprint widens every box by a body's half width (0.35 m). The bare box is not
 * exported, but on an axis-aligned box a point is within `margin` of it exactly when the
 * four points shifted by ±(0.35 − margin) on both axes all fall in the widened box.
 */
function onProp(prop: Prop, x: number, z: number, margin: number): boolean {
  const s = 0.35 - margin;
  return [
    [s, s],
    [s, -s],
    [-s, s],
    [-s, -s],
  ].every(([dx, dz]) => inFootprint(prop, x + dx, z + dz));
}

describe('decor props', () => {
  const withDecor = ROOMS.filter((r) => r.props.some((p) => DECOR.includes(p.kind))).map((r) => [r.id, r] as const);

  /**
   * Verifies that the decoration is spread over several rooms
   */
  it('decorates several rooms', () => {
    expect(withDecor.length).toBeGreaterThanOrEqual(5);
  });

  /**
   * Verifies that every decor kind has a footprint agents walk around
   */
  it.each(DECOR)('%s has a footprint that blocks its centre but not 2 m away', (kind) => {
    const p: Prop = { kind, x: 0, z: 0 };
    expect(inFootprint(p, 0, 0)).toBe(true);
    expect(inFootprint(p, 2, 0)).toBe(false);
    expect(inFootprint(p, 0, 2)).toBe(false);
  });

  /**
   * Verifies that decor props stand inside their room
   */
  it.each(withDecor)('%s decor props lie inside the room', (_id, r) => {
    for (const p of r.props.filter((x) => DECOR.includes(x.kind))) {
      expect(Math.abs(p.x)).toBeLessThan(r.w / 2);
      expect(Math.abs(p.z)).toBeLessThan(r.d / 2);
    }
  });

  /**
   * Verifies that no seat, station, wall seat or door entry point stands on a decor prop
   */
  it.each(withDecor)('%s keeps seats and the door entry clear of decor', (_id, r) => {
    const decor = r.props.filter((p) => DECOR.includes(p.kind));
    const places: [string, Point][] = [
      ...r.seats.map((s, i) => [`seat ${i}`, s] as [string, Point]),
      ...Object.entries(r.stations ?? {}).flatMap(([name, seats]) => seats.map((s, i) => [`${name} ${i}`, s] as [string, Point])),
      ...wallSeats(r).map((s, i) => [`wall ${i}`, s] as [string, Point]),
    ];
    if (!r.insideOf) {
      const inside = doorOf(r).inside;
      places.push(['door', { x: inside.x - r.cx, z: inside.z - r.cz }]);
    }
    const clashes = places.flatMap(([label, p]) =>
      decor.filter((d) => inFootprint(d, p.x, p.z)).map((d) => `${label} (${p.x}, ${p.z}) on ${d.kind} (${d.x}, ${d.z})`),
    );
    expect(clashes).toEqual([]);
  });

  /**
   * Verifies that the straight walk from the door to every seat never crosses a decor prop
   */
  it.each(withDecor.filter(([, r]) => !r.insideOf))('%s walks from the door to each seat miss the decor', (_id, r) => {
    // Reduced check: the agent's centre line must miss the bare box (margin 0), not the
    // box widened by 0.35 m. With the full margin, a walk that brushes past the corner of a
    // crate on the way to a wall seat would count as a collision, and that seat is already
    // held to the full margin by the test above.
    const decor = r.props.filter((p) => DECOR.includes(p.kind));
    const inside = doorOf(r).inside;
    const from = { x: inside.x - r.cx, z: inside.z - r.cz };
    const seats: Point[] = [...r.seats, ...Object.values(r.stations ?? {}).flat(), ...wallSeats(r)];
    const clashes: string[] = [];
    for (const to of seats) {
      const steps = Math.max(2, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.05));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = from.x + (to.x - from.x) * t;
        const z = from.z + (to.z - from.z) * t;
        const hit = decor.find((d) => onProp(d, x, z, 0));
        if (hit) {
          clashes.push(`to (${to.x}, ${to.z}) crosses ${hit.kind} at (${x.toFixed(2)}, ${z.toFixed(2)})`);
          break;
        }
      }
    }
    expect(clashes).toEqual([]);
  });
});
