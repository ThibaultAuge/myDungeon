import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RoomId } from '@agent-office/shared';
import {
  CUT_CURVE,
  DOOR_W,
  GATE_H,
  GATE_JAMB,
  KIT_SCALE,
  LARGE_TILE,
  OUTER,
  PERIMETER_INNER,
  PERIMETER_LINE,
  PERIMETER_PILLAR_EXTRA,
  PERIMETER_T,
  SMALL_TILE,
  WALL_INSET,
  WALL_T,
  corridorFloor,
  edgeRuns,
  foundation,
  inForeground,
  perimeterSides,
  roomFloor,
  seeded,
  sharedSides,
  tallKey,
  tallModel,
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
  GATE,
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
  type WallHang,
} from '../src/scene/layout.ts';
import {
  CLIPS,
  DEATH_CLIP_TIME,
  SIT_CLIP,
  SIT_POSE_TIME,
  HIT_CLIP_TIME,
  LOOKS,
  MAIN_BODY,
  SKELETON_LOOKS,
  SPAWN_CLIP_TIME,
  SUB_BODIES,
  USE_ITEM_CLIP_TIME,
  type PropRef,
} from '../src/scene/characters.ts';

// kit.ts and the .tsx files need drei and import.meta.env: they are not imported here. The
// manifest is read as plain JSON and the geometry is tested through dungeon.ts directly.

const TOL = 1e-6;

interface PackSpec {
  source: string;
  license: string | null;
  format?: string;
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

const formatOf = (spec: PackSpec) => spec.format ?? 'gltf';

interface GlbJson {
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  buffers?: { uri?: string }[];
  images?: { uri?: string; bufferView?: number }[];
  animations?: { name?: string }[];
}

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

/**
 * Same rules as scripts/import-kaykit.mjs (checkGlb): a self-contained binary glTF 2 with a
 * consistent length; every chunk walked (the browser loader keeps the LAST JSON chunk, so a
 * clean first chunk must not hide a second one), each with a whole header, a length that is
 * a multiple of 4 and inside the file; exactly one JSON chunk first, optionally one BIN
 * chunk after it; a parsable JSON; no extension, no external buffer or image.
 * Returns the problem (null when safe) and the parsed JSON chunk when there is one.
 */
function readGlb(buf: Buffer): { problem: string | null; json?: GlbJson } {
  if (buf.length < 20 || buf.toString('latin1', 0, 4) !== 'glTF') return { problem: 'not a binary glTF' };
  if (buf.readUInt32LE(4) !== 2) return { problem: 'not version 2' };
  if (buf.readUInt32LE(8) !== buf.length) return { problem: 'inconsistent length' };
  const chunks: { type: number; start: number; length: number }[] = [];
  for (let offset = 12; offset < buf.length; ) {
    if (offset + 8 > buf.length) return { problem: 'truncated chunk' };
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    if (length % 4 !== 0 || offset + 8 + length > buf.length) return { problem: 'invalid chunk length' };
    chunks.push({ type, start: offset + 8, length });
    offset += 8 + length;
  }
  if (chunks[0]?.type !== JSON_CHUNK) return { problem: 'no JSON chunk first' };
  if (chunks.length > 2 || (chunks.length === 2 && chunks[1].type !== BIN_CHUNK)) return { problem: 'unexpected chunks' };
  let json: GlbJson;
  try {
    json = JSON.parse(buf.toString('utf8', chunks[0].start, chunks[0].start + chunks[0].length));
  } catch {
    return { problem: 'unparsable JSON' };
  }
  const ext = [...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])];
  if (ext.length) return { problem: `extensions: ${ext.join(', ')}`, json };
  if ((json.buffers ?? []).some((b) => b.uri !== undefined)) return { problem: 'external buffer', json };
  if ((json.images ?? []).some((i) => i.uri !== undefined || i.bufferView === undefined)) return { problem: 'external image', json };
  return { problem: null, json };
}

/** A JSON chunk body, space-padded to a multiple of 4 bytes as the GLB format requires. */
function jsonBody(json: unknown, raw?: string): Buffer {
  let text = raw ?? JSON.stringify(json);
  while (Buffer.byteLength(text) % 4) text += ' ';
  return Buffer.from(text, 'utf8');
}

/** One chunk: 8-byte header (declared length, type) then the data, as given. */
function chunk(type: number, data: Buffer, declaredLength = data.length): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32LE(declaredLength, 0);
  head.writeUInt32LE(type, 4);
  return Buffer.concat([head, data]);
}

interface GlbPatch {
  magic?: string;
  version?: number;
  /** Declared total length; defaults to the real one. */
  length?: number;
  /** Type of the first chunk; defaults to JSON. */
  chunkType?: number;
  /** Raw first-chunk text, for unparsable JSON. */
  rawJson?: string;
  /** Chunks appended after the first one (already built with `chunk`). */
  extra?: Buffer[];
  /** Raw bytes appended at the very end, outside any chunk. */
  trailing?: Buffer;
}

/** Builds a GLB (header + JSON chunk + optional extra chunks) for the checker's own tests. */
function makeGlb(json: unknown, patch: GlbPatch = {}): Buffer {
  const head = Buffer.alloc(12);
  const buf = Buffer.concat([
    head,
    chunk(patch.chunkType ?? JSON_CHUNK, jsonBody(json, patch.rawJson)),
    ...(patch.extra ?? []),
    patch.trailing ?? Buffer.alloc(0),
  ]);
  buf.write(patch.magic ?? 'glTF', 0, 'latin1');
  buf.writeUInt32LE(patch.version ?? 2, 4);
  buf.writeUInt32LE(patch.length ?? buf.length, 8);
  return buf;
}

const ACCENTS: Accent[] = ['red', 'blue', 'green', 'yellow', 'white', 'brown'];
const BANNER_STYLES = ['', 'patternA_', 'patternB_', 'patternC_', 'shield_', 'triple_'];
/** Decoration with a footprint (rugs, grass and cobwebs are walked through or overhead). */
const DECOR: PropKind[] = ['crates', 'barrels', 'chest', 'coins', 'candle', 'chartChest', 'sacks', 'bookPile', 'lumber', 'forge', 'fuel', 'treasury', 'gamerCorner', 'prison', 'beartrap', 'logs', 'pantry'];

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

/** The BOUNDS line of each side of the map. */
const BOUND_LINE: Record<Side, number> = { n: BOUNDS.z0, s: BOUNDS.z1, w: BOUNDS.x0, e: BOUNDS.x1 };

/** Sides of a room lying on the map edge, derived independently from BOUNDS. */
function onMapEdge(r: RoomDef): Set<Side> {
  const b = rect(r);
  const at: Record<Side, number> = { n: b.z0, s: b.z1, w: b.x0, e: b.x1 };
  return new Set((['n', 's', 'w', 'e'] as Side[]).filter((s) => Math.abs(at[s] - BOUND_LINE[s]) < TOL));
}

/**
 * Coordinate of the wall line of a side: the thick outer wall's middle line on a map-edge
 * side, else WALL_INSET inside the room edge, except for a shared 'e' or 's' side, whose
 * single wall stands on the common edge itself.
 */
function wallLine(r: RoomDef, side: Side, rooms: RoomDef[] = WALLED): number {
  if (onMapEdge(r).has(side)) return PERIMETER_LINE[side];
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

const horizontalSide = (s: Side) => s === 'n' || s === 's';

/**
 * Span of a room's run of a side along its own axis: from inset to inset, except that an
 * end meeting a map-edge side stops at that outer wall's inner face.
 */
function runSpan(r: RoomDef, side: Side): [number, number] {
  const b = rect(r);
  const edge = onMapEdge(r);
  if (horizontalSide(side)) {
    return [edge.has('w') ? PERIMETER_INNER.w : b.x0 + WALL_INSET, edge.has('e') ? PERIMETER_INNER.e : b.x1 - WALL_INSET];
  }
  return [edge.has('n') ? PERIMETER_INNER.n : b.z0 + WALL_INSET, edge.has('s') ? PERIMETER_INNER.s : b.z1 - WALL_INSET];
}

/** True when a wall piece (by its facing and centre) stands on a perimeter wall line. */
function onPerimeterLine(item: KitItem): boolean {
  const side = sideOfRotation(item.rotY);
  if (!side) return false;
  return horizontalSide(side)
    ? Math.abs(item.z - PERIMETER_LINE.n) < TOL || Math.abs(item.z - PERIMETER_LINE.s) < TOL
    : Math.abs(item.x - PERIMETER_LINE.w) < TOL || Math.abs(item.x - PERIMETER_LINE.e) < TOL;
}

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

// The castle gate in the south edge: its jambs stand on the outer wall's middle line, in
// line with the wall lines of the two rooms either side of the opening.
const GATE_LO = GATE.lo - WALL_INSET;
const GATE_HI = GATE.hi + WALL_INSET;
const GATE_MID = (GATE_LO + GATE_HI) / 2;
// Pillars as deep as the south outer wall (jambs, seam slots) reach a little further inwards:
// their middle line and depth, their outer face still on the map edge.
const DEEP_T = PERIMETER_T + PERIMETER_PILLAR_EXTRA;
const DEEP_Z = OUTER.z1 - DEEP_T / 2;
/** The lintel is a little thinner than the outer wall, so it never fights with the jambs. */
const LINTEL_T = PERIMETER_T - 0.04;

/** True for the gate's own decor: torches that sink with the lintel (anchored on its middle). */
function isGateDecor(t: { name: string; item: CutItem }): boolean {
  return t.name === 'torch_mounted' && Math.abs(t.item.ax - GATE_MID) < 1e-9 && Math.abs(t.item.az - PERIMETER_LINE.s) < 1e-9;
}

/** The four map corners, as (x side, z side) pairs. */
const MAP_CORNERS: [Side, Side][] = [
  ['w', 'n'],
  ['e', 'n'],
  ['w', 's'],
  ['e', 's'],
];

/** Corridor ends lying in the gate opening, on the south edge. */
function gateCorridorEnds(): Point[] {
  return CORRIDORS.flat().filter((p) => Math.abs(p.z - BOUNDS.z1) <= 1 && p.x > GATE.lo && p.x < GATE.hi);
}

// ---------------------------------------------------------------- manifest

describe('kit manifest', () => {
  /**
   * Verifies that the manifest declares every pack the scene loads from, forest included
   */
  it('declares the map, character and decoration packs with safe names', () => {
    expect(Object.keys(MANIFEST).sort()).toEqual([
      'adventurers',
      'adventurers_anim',
      'adventurers_props',
      'dungeon',
      'forest',
      'furniture',
      'halloween',
      'mixed1',
      'mixed2',
      'resources',
      'restaurant',
      'skeleton_props',
      'skeletons',
      'tools',
      'weapons',
    ]);
    for (const pack of Object.keys(MANIFEST)) expect(pack).toMatch(SAFE_NAME);
  });

  const packs = Object.entries(MANIFEST).map(([pack, spec]) => [pack, spec] as const);
  const gltfPacks = packs.filter(([, spec]) => formatOf(spec) === 'gltf');
  const glbPacks = packs.filter(([, spec]) => formatOf(spec) === 'glb');

  /**
   * Verifies that every pack has a known format, and the character packs are binary glTF
   */
  it('gives every pack the gltf (default) or glb format', () => {
    for (const [pack, spec] of packs) expect(['gltf', 'glb'], pack).toContain(formatOf(spec));
    expect(glbPacks.map(([p]) => p).sort()).toEqual(['adventurers', 'adventurers_anim', 'skeletons']);
    expect(gltfPacks.map(([p]) => p).sort()).toEqual([
      'adventurers_props',
      'dungeon',
      'forest',
      'furniture',
      'halloween',
      'mixed1',
      'mixed2',
      'resources',
      'restaurant',
      'skeleton_props',
      'tools',
      'weapons',
    ]);
  });

  /**
   * Verifies that the adventurers props pack is a .gltf pack with the character textures its props use
   */
  it('declares adventurers_props as a gltf pack sharing the character textures', () => {
    const spec = MANIFEST.adventurers_props;
    expect(spec).toBeDefined();
    expect(formatOf(spec)).toBe('gltf');
    expect([...spec.textures].sort()).toEqual(['barbarian_texture.png', 'knight_texture.png', 'mage_texture.png', 'rogue_texture.png']);
    expect(spec.license).toBeTruthy();
  });

  /**
   * Verifies that every model and texture name of a pack is safe and listed only once
   */
  it.each(packs)('%s lists only safe, unique model and texture names', (_pack, spec) => {
    expect(spec.models.length).toBeGreaterThan(0);
    // A .gltf pack shares external textures; a .glb pack embeds them and may list none.
    if (formatOf(spec) === 'gltf') expect(spec.textures.length).toBeGreaterThan(0);
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
  it.each(gltfPacks)('%s models exist in public/kaykit as .gltf and .bin', (pack, spec) => {
    const missing = spec.models.flatMap((name) =>
      [`${name}.gltf`, `${name}.bin`].filter((f) => !fs.existsSync(path.join(PUBLIC_KAYKIT, pack, f))),
    );
    expect(missing).toEqual([]);
  });

  /**
   * Verifies that a copied .gltf only points at its own buffer and at its pack's textures
   */
  it.each(gltfPacks)('%s .gltf files reference only their own .bin and listed textures', (pack, spec) => {
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
   * Verifies that every model of a glb pack is in public/kaykit/<pack>/ as <name>.glb
   */
  it.each(glbPacks)('%s models exist in public/kaykit as .glb', (pack, spec) => {
    const missing = spec.models.map((name) => `${name}.glb`).filter((f) => !fs.existsSync(path.join(PUBLIC_KAYKIT, pack, f)));
    expect(missing).toEqual([]);
  });

  /**
   * Verifies that a glb pack ships no separate .gltf or .bin next to its .glb files
   */
  it.each(glbPacks)('%s has no stray .gltf or .bin', (pack, spec) => {
    const stray = spec.models
      .flatMap((name) => [`${name}.gltf`, `${name}.bin`])
      .filter((f) => fs.existsSync(path.join(PUBLIC_KAYKIT, pack, f)));
    expect(stray).toEqual([]);
  });

  /**
   * Verifies that every copied .glb is self-contained: no extension, external buffer or image
   */
  it.each(glbPacks)('%s .glb files pass the import safety checks', (pack, spec) => {
    const bad: string[] = [];
    for (const name of spec.models) {
      const file = path.join(PUBLIC_KAYKIT, pack, `${name}.glb`);
      if (!fs.existsSync(file)) continue; // reported by the existence test
      const { problem } = readGlb(fs.readFileSync(file));
      if (problem) bad.push(`${name}: ${problem}`);
    }
    expect(bad).toEqual([]);
  });

  /**
   * Verifies that a pack with a license has its License.txt copied next to its models
   */
  it.each(packs.filter(([, spec]) => spec.license))('%s ships its License.txt', (pack) => {
    expect(fs.existsSync(path.join(PUBLIC_KAYKIT, pack, 'License.txt'))).toBe(true);
  });

  /**
   * Verifies that the main body, every sub body and every LOOKS body is an adventurers model
   */
  it('contains every character body used by the agents', () => {
    const models = new Set(MANIFEST.adventurers.models);
    const used = [MAIN_BODY, ...SUB_BODIES, ...Object.values(LOOKS).map((l) => l.body)];
    expect(used.length).toBeGreaterThan(1);
    expect(used.filter((n) => !models.has(n))).toEqual([]);
  });

  /**
   * Verifies that the adventurers pack ships no body that no agent can ever wear
   */
  it('ships only bodies the agents use', () => {
    const used = new Set<string>([MAIN_BODY, ...SUB_BODIES]);
    expect(MANIFEST.adventurers.models.filter((n) => !used.has(n))).toEqual([]);
  });

  /**
   * Verifies that every prop held in LOOKS is a model of the pack it names
   */
  it('contains every prop held by a subagent look, in the pack it names', () => {
    const held: { type: string; ref: PropRef }[] = Object.entries(LOOKS).flatMap(([type, l]) =>
      [l.right, l.left].filter((p): p is PropRef => !!p).map((ref) => ({ type, ref })),
    );
    expect(held.length).toBeGreaterThan(0);
    const missing = held
      .filter(({ ref }) => !MANIFEST[ref.pack]?.models.includes(ref.model))
      .map(({ type, ref }) => `${type}: ${ref.pack}/${ref.model}`);
    expect(missing).toEqual([]);
  });

  /**
   * Verifies that every adventurers_props model is held by some look (no unused import)
   */
  it('ships only adventurers props that a look holds', () => {
    const held = new Set(
      Object.values(LOOKS)
        .flatMap((l) => [l.right, l.left])
        .filter((p): p is PropRef => p?.pack === 'adventurers_props')
        .map((p) => p.model),
    );
    expect(MANIFEST.adventurers_props.models.filter((m) => !held.has(m))).toEqual([]);
  });

  /**
   * Verifies that every clip the figures play exists in one of the adventurers_anim files
   */
  it('contains every animation clip played by the figures', () => {
    const names = new Set<string>();
    for (const name of MANIFEST.adventurers_anim.models) {
      const file = path.join(PUBLIC_KAYKIT, 'adventurers_anim', `${name}.glb`);
      const { json } = readGlb(fs.readFileSync(file));
      for (const a of json?.animations ?? []) if (a.name) names.add(a.name);
    }
    expect(names.size).toBeGreaterThan(0);
    expect(CLIPS.filter((c) => !names.has(c))).toEqual([]);
  });

  // ---- skeletons and the scripted clips

  /** The parts of a glTF JSON chunk the rig and clip checks read. */
  interface RigJson {
    nodes?: { name?: string }[];
    skins?: { joints: number[] }[];
    accessors?: { max?: number[] }[];
    animations?: { name?: string; samplers: { input: number }[] }[];
  }

  const glbJson = (pack: string, name: string): RigJson =>
    readGlb(fs.readFileSync(path.join(PUBLIC_KAYKIT, pack, `${name}.glb`))).json as RigJson;
  /** Node names as GLTFLoader renames them (PropertyBinding.sanitizeNodeName): `handslot.r` → `handslotr`. */
  const sanitize = (n: string) => n.replace(/\s/g, '_').replace(/[[\]\.:\/]/g, '');
  const jointNames = (json: RigJson) => (json.skins?.[0]?.joints ?? []).map((i) => sanitize(json.nodes?.[i]?.name ?? ''));

  /**
   * Verifies that each one-shot clip constant matches the clip length in the animation file
   */
  it.each([
    ['Spawn_Ground', SPAWN_CLIP_TIME],
    ['Hit_A', HIT_CLIP_TIME],
    ['Death_A', DEATH_CLIP_TIME],
    ['Use_Item', USE_ITEM_CLIP_TIME],
  ])('times %s as long as the clip in Rig_Medium', (clip, time) => {
    let length: number | undefined;
    for (const file of MANIFEST.adventurers_anim.models) {
      const json = glbJson('adventurers_anim', file);
      const anim = json.animations?.find((a) => a.name === clip);
      if (!anim) continue;
      // A clip lasts until its last keyframe: the largest time of all its sampler inputs.
      length = Math.max(...anim.samplers.map((s) => json.accessors?.[s.input]?.max?.[0] ?? 0));
      break;
    }
    expect(length, `${clip} found`).toBeDefined();
    expect(length!).toBeCloseTo(time, 2);
  });

  /**
   * Verifies that the sitting pose of the endless wait at the altar lies inside its clip
   */
  it('holds the altar sitting pose inside its clip', () => {
    const json = glbJson('adventurers_anim', 'Rig_Medium_General');
    const anim = json.animations?.find((a) => a.name === SIT_CLIP);
    expect(anim, `${SIT_CLIP} found`).toBeDefined();
    const length = Math.max(...anim!.samplers.map((s) => json.accessors?.[s.input]?.max?.[0] ?? 0));
    expect(SIT_POSE_TIME).toBeGreaterThan(0);
    expect(SIT_POSE_TIME).toBeLessThan(length);
  });

  /**
   * Verifies that the skeleton bodies share the Knight's rig, so the Rig_Medium clips drive them
   */
  it.each(MANIFEST.skeletons.models)('rigs %s with the same joints as the Knight', (name) => {
    const knight = jointNames(glbJson('adventurers', 'Knight'));
    expect(knight).toHaveLength(23);
    const joints = jointNames(glbJson('skeletons', name));
    expect([...joints].sort()).toEqual([...knight].sort());
  });

  /**
   * Verifies that every skeleton body has both hand slots for its weapon
   */
  it.each(MANIFEST.skeletons.models)('gives %s both hand slots', (name) => {
    const nodes = new Set((glbJson('skeletons', name).nodes ?? []).map((n) => sanitize(n.name ?? '')));
    expect(nodes.has('handslotr')).toBe(true);
    expect(nodes.has('handslotl')).toBe(true);
  });

  /**
   * Verifies that every skeleton look uses a body and a weapon of the packs it names
   */
  it('contains every skeleton body and weapon, in the pack each look names', () => {
    const missing = SKELETON_LOOKS.flatMap((l) => {
      const out: string[] = [];
      if (!MANIFEST[l.pack ?? 'adventurers']?.models.includes(l.body)) out.push(`${l.pack}/${l.body}`);
      for (const ref of [l.right, l.left]) if (ref && !MANIFEST[ref.pack]?.models.includes(ref.model)) out.push(`${ref.pack}/${ref.model}`);
      return out;
    });
    expect(missing).toEqual([]);
  });

  /**
   * Verifies that the skeletons packs ship no body or weapon that no skeleton uses, besides
   * the room decor's shield (the packs are shared with the decor)
   */
  it('ships only skeleton bodies and weapons that a look or the decor uses', () => {
    const bodies = new Set<string>(SKELETON_LOOKS.map((l) => l.body));
    const weapons = new Set(SKELETON_LOOKS.flatMap((l) => [l.right, l.left]).filter((p): p is PropRef => !!p).map((p) => p.model));
    expect(MANIFEST.skeletons.models.filter((m) => !bodies.has(m))).toEqual([]);
    expect(MANIFEST.skeleton_props.models.filter((m) => !weapons.has(m))).toEqual(['Skeleton_Shield_Large_A']);
    for (const w of weapons) expect(MANIFEST.skeleton_props.models).toContain(w);
  });

  /**
   * Verifies that the skeleton weapons share the single skeleton texture
   */
  it('declares skeleton_props with the skeleton texture only', () => {
    expect(MANIFEST.skeleton_props.textures).toEqual(['skeleton_texture.png']);
    expect(MANIFEST.skeletons.textures).toEqual([]);
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
    const missing: string[] = [];
    for (const key of LAYOUT.tall.keys()) {
      const { pack, name } = tallModel(key);
      if (pack === 'dungeon') used.add(name);
      else if (!MANIFEST[pack as keyof typeof MANIFEST]?.models.includes(name)) missing.push(key);
    }

    const dungeon = new Set(MANIFEST.dungeon.models);
    expect([...[...used].filter((n) => !dungeon.has(n)), ...missing]).toEqual([]);
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

// ---------------------------------------------------------------- glb checker

// The manifest tests above rely on readGlb; these make sure it really rejects what the
// import script rejects, so a passing manifest test means something.
describe('readGlb (copy of checkGlb)', () => {
  const SAFE = { asset: { version: '2.0' }, buffers: [{ byteLength: 4 }], images: [{ bufferView: 0, mimeType: 'image/png' }] };

  /**
   * Verifies that a self-contained GLB is accepted and its JSON chunk returned
   */
  it('accepts an embedded-only GLB and returns its JSON', () => {
    const { problem, json } = readGlb(makeGlb({ ...SAFE, animations: [{ name: 'Idle_A' }] }));
    expect(problem).toBeNull();
    expect(json?.animations?.[0].name).toBe('Idle_A');
  });

  /**
   * Verifies that a GLB without buffers or images is accepted
   */
  it('accepts a GLB with no buffer and no image', () => {
    expect(readGlb(makeGlb({ asset: { version: '2.0' } })).problem).toBeNull();
  });

  /**
   * Verifies that files too short, with a wrong magic, version or length are rejected
   */
  it.each([
    ['shorter than a header', Buffer.from('glTF')],
    ['a wrong magic', makeGlb(SAFE, { magic: 'gltf' })],
    ['a text glTF', Buffer.from(JSON.stringify(SAFE).padEnd(40, ' '))],
    ['version 1', makeGlb(SAFE, { version: 1 })],
    ['a declared length too long', makeGlb(SAFE, { length: 9999 })],
    ['a declared length one byte short', (() => { const b = makeGlb(SAFE); b.writeUInt32LE(b.length - 1, 8); return b; })()],
    ['a first chunk that is not JSON', makeGlb(SAFE, { chunkType: 0x004e4942 })],
    ['a JSON chunk longer than the file', (() => { const b = makeGlb(SAFE); b.writeUInt32LE(b.length, 12); return b; })()],
    ['unparsable JSON', makeGlb(null, { rawJson: '{"asset": ' })],
  ])('rejects %s', (_label, buf) => {
    expect(readGlb(buf).problem).not.toBeNull();
  });

  // ---- chunk walk (hardened checkGlb: every chunk is checked, not only the first)

  const bin = (bytes = 8) => chunk(BIN_CHUNK, Buffer.alloc(bytes));
  const EVIL = { ...SAFE, buffers: [{ byteLength: 4, uri: 'https://example.invalid/evil.bin' }] };

  /**
   * Verifies that a file with only the JSON chunk is accepted
   */
  it('accepts a JSON-only file', () => {
    const buf = makeGlb(SAFE);
    expect(buf.length % 4).toBe(0);
    expect(readGlb(buf).problem).toBeNull();
  });

  /**
   * Verifies that a JSON chunk followed by one BIN chunk is accepted, JSON read from the first
   */
  it('accepts a JSON + BIN file and reads the JSON chunk', () => {
    const { problem, json } = readGlb(makeGlb({ ...SAFE, animations: [{ name: 'Walking_A' }] }, { extra: [bin(16)] }));
    expect(problem).toBeNull();
    expect(json?.animations?.[0].name).toBe('Walking_A');
  });

  /**
   * Verifies that an empty BIN chunk (length 0, a multiple of 4) is accepted
   */
  it('accepts an empty BIN chunk', () => {
    expect(readGlb(makeGlb(SAFE, { extra: [bin(0)] })).problem).toBeNull();
  });

  /**
   * Verifies that a malformed or extra chunk is rejected with the matching problem
   */
  it.each([
    // The bypass: a clean first JSON, then a BIN, then an evil JSON the browser would keep.
    ['an evil JSON chunk after the BIN chunk', makeGlb(SAFE, { extra: [bin(), chunk(JSON_CHUNK, jsonBody(EVIL))] }), 'unexpected chunks'],
    ['a second JSON chunk right after the first', makeGlb(SAFE, { extra: [chunk(JSON_CHUNK, jsonBody(EVIL))] }), 'unexpected chunks'],
    ['a second chunk of unknown type', makeGlb(SAFE, { extra: [chunk(0x12345678, Buffer.alloc(4))] }), 'unexpected chunks'],
    ['three chunks (JSON, BIN, BIN)', makeGlb(SAFE, { extra: [bin(), bin()] }), 'unexpected chunks'],
    ['a chunk length that is not a multiple of 4', makeGlb(SAFE, { extra: [chunk(BIN_CHUNK, Buffer.alloc(6))] }), 'invalid chunk length'],
    ['a chunk declaring more bytes than the file has', makeGlb(SAFE, { extra: [chunk(BIN_CHUNK, Buffer.alloc(8), 16)] }), 'invalid chunk length'],
    ['4 trailing bytes, too short for a chunk header', makeGlb(SAFE, { trailing: Buffer.alloc(4) }), 'truncated chunk'],
    ['7 trailing bytes after a BIN chunk', makeGlb(SAFE, { extra: [bin()], trailing: Buffer.alloc(7) }), 'truncated chunk'],
  ])('rejects %s', (_label, buf, problem) => {
    expect(readGlb(buf).problem).toBe(problem);
  });

  /**
   * Verifies that any used or required extension is rejected (decoders load from a CDN)
   */
  it.each([
    ['extensionsUsed', { ...SAFE, extensionsUsed: ['KHR_draco_mesh_compression'] }],
    ['extensionsRequired', { ...SAFE, extensionsRequired: ['EXT_meshopt_compression'] }],
  ])('rejects a GLB with %s', (_label, json) => {
    expect(readGlb(makeGlb(json)).problem).toMatch(/extensions/);
  });

  /**
   * Verifies that empty extension lists are not a problem
   */
  it('accepts empty extension lists', () => {
    expect(readGlb(makeGlb({ ...SAFE, extensionsUsed: [], extensionsRequired: [] })).problem).toBeNull();
  });

  /**
   * Verifies that a buffer with any uri, even a data URI or empty string, is rejected
   */
  it.each(['model.bin', 'data:application/octet-stream;base64,AAAA', '', 'https://example.invalid/x.bin'])(
    'rejects a buffer with uri %j',
    (uri) => {
      expect(readGlb(makeGlb({ ...SAFE, buffers: [{ byteLength: 4 }, { byteLength: 4, uri }] })).problem).toBe('external buffer');
    },
  );

  /**
   * Verifies that an image with a uri, or without a bufferView, is rejected
   */
  it.each([
    ['a uri', { uri: 'texture.png' }],
    ['a uri and a bufferView', { uri: 'texture.png', bufferView: 0 }],
    ['no bufferView', { mimeType: 'image/png' }],
  ])('rejects an image with %s', (_label, image) => {
    expect(readGlb(makeGlb({ ...SAFE, images: [image] })).problem).toBe('external image');
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
    for (const [name] of tiles) expect(name).toBe('floor_tile_large');
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
    // From inset to inset, or to the inner face of an outer wall the run meets.
    const [lo, hi] = runSpan(r, side);
    const full = hi - lo;
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
      const [lo, hi] = runSpan(r, side);
      expect(runRange(mine[0])[0], `${side} start`).toBeCloseTo(lo, 6);
      expect(runRange(mine[0])[1], `${side} end`).toBeCloseTo(hi, 6);
    }
  });

  /**
   * Verifies that runs lie on their wall line (outer, inset or shared), within the run span
   */
  it.each(WALLED_CASES)('%s runs lie on their wall line, within the room span', (_id, r) => {
    for (const run of wallRuns(r)) {
      expect(run.room).toBe(r);
      const line = wallLine(r, run.side);
      const [lo, hi] = runSpan(r, run.side);
      const k = horizontalSide(run.side) ? 0 : 1;
      for (const p of [run.a, run.b]) {
        expect(p[1 - k], `${run.side} line`).toBeCloseTo(line, 9);
        expect(p[k]).toBeGreaterThanOrEqual(lo - TOL);
        expect(p[k]).toBeLessThanOrEqual(hi + TOL);
      }
    }
  });

  /**
   * Verifies that map-edge runs are PERIMETER_T thick and every other run WALL_T thick
   */
  it.each(WALLED_CASES)('%s runs are PERIMETER_T thick on the map edge, WALL_T elsewhere', (_id, r) => {
    const edge = onMapEdge(r);
    for (const run of wallRuns(r)) {
      expect(run.thick, `${run.side}`).toBe(edge.has(run.side) ? PERIMETER_T : WALL_T);
    }
  });

  /**
   * Verifies that a room on the west edge alone gets the user-specified run geometry
   */
  it('lays the west wall of a west-edge room on the outer line, n and s from its inner face', () => {
    // On the west edge only: n and s are plain sides, so the w run spans the z insets.
    const r = makeRoom('west-edge', BOUNDS.x0 + 2, 0, 4, 4, { door: { side: 'e', at: 0 } });
    expect([...perimeterSides(r)]).toEqual(['w']);
    const runs = wallRuns(r, [r]);
    const west = runs.filter((x) => x.side === 'w');
    expect(west).toHaveLength(1);
    expect(west[0].a[0]).toBeCloseTo(PERIMETER_LINE.w, 9);
    expect(west[0].thick).toBe(PERIMETER_T);
    expect(runRange(west[0])[0]).toBeCloseTo(-2 + WALL_INSET, 9);
    expect(runRange(west[0])[1]).toBeCloseTo(2 - WALL_INSET, 9);
    for (const side of ['n', 's'] as Side[]) {
      const [run] = runs.filter((x) => x.side === side);
      expect(run.thick).toBe(WALL_T);
      expect(runRange(run)[0], side).toBeCloseTo(PERIMETER_INNER.w, 9);
      expect(runRange(run)[1], side).toBeCloseTo(BOUNDS.x0 + 4 - WALL_INSET, 9);
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
   * Verifies that the map gets 4 north, 1 south, 2 west, no east ends (x=5 is the gate)
   */
  it('closes 7 corridor ends: 4 on n, 1 on s, 2 on w', () => {
    const count = (s: Side) => EDGE_RUNS.filter((r) => r.side === s).length;
    expect(EDGE_RUNS).toHaveLength(7);
    expect([count('n'), count('s'), count('w'), count('e')]).toEqual([4, 1, 2, 0]);
    // Only the x = 15 corridor end is closed on the south edge; x = 5 opens on the gate.
    const south = EDGE_RUNS.filter((r) => r.side === 's').map(runRange);
    expect(south[0][0]).toBeCloseTo(13.85, 9);
    expect(south[0][1]).toBeCloseTo(16.15, 9);
  });

  /**
   * Verifies that edge runs belong to no room, lie on PERIMETER_LINE and are PERIMETER_T thick
   */
  it('lies on the outer wall line, PERIMETER_T thick, without a room', () => {
    for (const run of EDGE_RUNS) {
      expect(run.room).toBeUndefined();
      expect(run.thick).toBe(PERIMETER_T);
      const k = horizontalSide(run.side) ? 1 : 0;
      expect(run.a[k]).toBeCloseTo(PERIMETER_LINE[run.side], 9);
      expect(run.b[k]).toBeCloseTo(PERIMETER_LINE[run.side], 9);
      const [lo, hi] = runRange(run);
      expect(hi - lo).toBeGreaterThan(0.5);
    }
  });

  /**
   * Verifies that the outer middle line and inner face sit T/2 and T inside the OUTER edge
   */
  it('puts PERIMETER_LINE T/2 and PERIMETER_INNER T inside the OUTER edge', () => {
    expect(OUTER).toEqual({ x0: BOUNDS.x0 - 0.5, x1: BOUNDS.x1 + 0.5, z0: BOUNDS.z0 - 0.5, z1: BOUNDS.z1 + 0.5 });
    const outer: Record<Side, number> = { n: OUTER.z0, s: OUTER.z1, w: OUTER.x0, e: OUTER.x1 };
    for (const side of ['n', 's', 'w', 'e'] as Side[]) {
      const [ix, iz] = INWARD[side];
      const inward = ix + iz;
      expect(PERIMETER_LINE[side], side).toBeCloseTo(outer[side] + inward * (PERIMETER_T / 2), 9);
      expect(PERIMETER_INNER[side], side).toBeCloseTo(outer[side] + inward * PERIMETER_T, 9);
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
   * Verifies that every corridor end at the map edge is closed, except the gate's end
   */
  it('closes every corridor end at the map edge but the gate', () => {
    const open: string[] = [];
    const gateEnds = gateCorridorEnds();
    for (const p of CORRIDORS.flat()) {
      // The castle gate is deliberately open: checked in the castle gate tests below.
      if (gateEnds.includes(p)) continue;
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
   * Verifies that without rooms each side is one corner-to-corner wall, south split by the gate
   */
  it('closes each whole side of the map when there is no room, the gate left open', () => {
    const runs = edgeRuns([]);
    expect(runs.map((r) => r.side).sort()).toEqual(['e', 'n', 's', 's', 'w']);
    // Each side runs between the inner faces of the two outer walls it meets.
    for (const run of runs) expect(run.thick).toBe(PERIMETER_T);
    for (const run of runs.filter((r) => r.side !== GATE.side)) {
      const [lo, hi] = runRange(run);
      const [l0, l1] = horizontalSide(run.side) ? [PERIMETER_INNER.w, PERIMETER_INNER.e] : [PERIMETER_INNER.n, PERIMETER_INNER.s];
      expect(lo).toBeCloseTo(l0, 9);
      expect(hi).toBeCloseTo(l1, 9);
    }
    const south = runs.filter((r) => r.side === GATE.side).map(runRange).sort((p, q) => p[0] - q[0]);
    expect(south[0][0]).toBeCloseTo(PERIMETER_INNER.w, 9);
    expect(south[0][1]).toBeCloseTo(GATE_LO, 9);
    expect(south[1][0]).toBeCloseTo(GATE_HI, 9);
    expect(south[1][1]).toBeCloseTo(PERIMETER_INNER.e, 9);
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
   * Verifies that outer wall pieces are PERIMETER_T thick and inner ones WALL_T, any length
   */
  it('keeps every tall wall piece PERIMETER_T thick on the map edge, WALL_T inside', () => {
    const walls = TALL.filter((t) => t.name.startsWith('wall'));
    const outer = walls.filter((t) => onPerimeterLine(t.item));
    const inner = walls.filter((t) => !onPerimeterLine(t.item));
    expect(outer.length).toBeGreaterThan(0);
    expect(inner.length).toBeGreaterThan(0);
    for (const { name, item } of outer) {
      expect(item.scale![2], `${name} (${item.x}, ${item.z})`).toBeCloseTo(item.y > TOL ? LINTEL_T : PERIMETER_T, 9);
    }
    for (const { name, item } of inner) expect(item.scale?.[2], `${name} (${item.x}, ${item.z})`).toBe(WALL_T);
  });

  /**
   * Verifies that each low barrier is thinner than the tall wall it hides in
   */
  it('makes every low barrier thinner than its own tall wall', () => {
    const walls = TALL.filter((t) => t.name.startsWith('wall') && t.item.y < TOL).map((t) => t.item);
    const barriers = LOW.filter(([n]) => n === 'barrier').map(([, b]) => b);
    expect(barriers.length).toBeGreaterThan(0);
    for (const b of barriers) {
      const wall = walls.find((w) => Math.abs(w.x - b.x) < TOL && Math.abs(w.z - b.z) < TOL && Math.abs(w.rotY - b.rotY) < TOL);
      expect(wall, `barrier (${b.x}, ${b.z})`).toBeDefined();
      // A barrier is 0.5 m thick in the pack; the tall wall's z scale is its thickness.
      expect(b.scale![2] * 0.5).toBeLessThan(wall!.scale![2]);
      // Inside the castle, still thinner than an ordinary wall.
      if (!onPerimeterLine(b)) expect(b.scale![2] * 0.5).toBeLessThan(WALL_T);
    }
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
  it('anchors walls and pillars on their own centre, the gate jambs aside', () => {
    const onGate = (it: CutItem) => Math.abs(it.ax - GATE_MID) < 1e-9 && Math.abs(it.az - PERIMETER_LINE.s) < 1e-9;
    const pieces = TALL.filter(
      (t) => (t.name.startsWith('wall') || t.name === 'pillar') && !(t.name === 'pillar' && onGate(t.item)),
    );
    expect(pieces.length).toBeGreaterThan(0);
    for (const { name, item } of pieces) {
      expect(Math.abs(item.ax - item.x), name).toBeLessThan(1e-9);
      expect(Math.abs(item.az - item.z), name).toBeLessThan(1e-9);
    }
  });

  /**
   * Verifies that every gate piece (jambs, lintel, torches) shares the gate middle anchor, so the gate sinks as one piece
   */
  it('anchors every gate piece on the gate middle', () => {
    const near = (it: CutItem) => Math.abs(it.z - PERIMETER_LINE.s) < 0.5 && it.x > GATE_LO - 1.5 && it.x < GATE_HI + 1.5;
    const jambs = TALL.filter((t) => t.name === 'pillar' && near(t.item) && Math.abs(t.item.scale![0] * 1.5 - GATE_JAMB) < 1e-9);
    const lintel = TALL.filter((t) => t.name.startsWith('wall') && t.item.y > 0 && near(t.item));
    const torches = TALL.filter(isGateDecor);
    expect([jambs.length, lintel.length, torches.length]).toEqual([2, 1, 2]);
    for (const { name, item } of [...jambs, ...lintel, ...torches]) {
      expect(item.ax, name).toBeCloseTo(GATE_MID, 9);
      expect(item.az, name).toBeCloseTo(PERIMETER_LINE.s, 9);
    }
  });

  /**
   * Verifies that every torch or banner shares the anchor of a wall piece, so it sinks with it
   */
  it('anchors wall decor on the wall chunk it hangs on', () => {
    const walls = TALL.filter((t) => t.name.startsWith('wall')).map((t) => t.item);
    // The gate torches face outwards, unlike the lintel they sink with: see the gate tests.
    const decor = TALL.filter((t) => (t.name === 'torch_mounted' || t.name.startsWith('banner_')) && !isGateDecor(t));
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
    // North end on the rooms' inset wall line; south end, on the map edge, through the whole
    // outer wall: on its middle line, PERIMETER_T deep.
    const ends: [number, number][] = [
      [garde.cz - garde.d / 2 + WALL_INSET, 0.3],
      [DEEP_Z, DEEP_T],
    ];
    for (const [z, depth] of ends) {
      const here = pillarsAt(seam, z);
      expect(here, `z ${z}`).toHaveLength(1);
      // A 1.5 m pillar: its x and z scales times 1.5 are its width and depth.
      expect(here[0].scale![0] * 1.5).toBeCloseTo(0.6, 9);
      expect(here[0].scale![2] * 1.5).toBeCloseTo(depth, 9);
      // The room to the east leaves the corner to its west neighbour: no pillar of its own.
      expect(pillarsAt(seam + WALL_INSET, z)).toEqual([]);
    }
    // No leftover pillar at the old inset south corner of the seam.
    expect(pillarsAt(seam, garde.cz + garde.d / 2 - WALL_INSET)).toEqual([]);
  });

  /**
   * Verifies that each map corner holds one PERIMETER_T square pillar on the outer wall lines
   */
  it.each([
    ['the real rooms', LAYOUT],
    ['no room', wallLayout([])],
  ])('puts a PERIMETER_T square pillar at each map corner with %s', (_label, layout) => {
    const pillars = layout.tall.get('pillar')!;
    for (const [xs, zs] of MAP_CORNERS) {
      const x = PERIMETER_LINE[xs];
      const z = PERIMETER_LINE[zs];
      const here = pillars.filter((p) => Math.abs(p.x - x) < TOL && Math.abs(p.z - z) < TOL);
      expect(here, `${zs}${xs}`).toHaveLength(1);
      const [p] = here;
      expect(p.scale![0] * 1.5).toBeCloseTo(PERIMETER_T, 9);
      expect(p.scale![2] * 1.5).toBeCloseTo(PERIMETER_T, 9);
      // It stands on its own centre and fills the map corner exactly.
      expect(p.ax).toBeCloseTo(x, 9);
      expect(p.az).toBeCloseTo(z, 9);
      const outerX = xs === 'w' ? OUTER.x0 : OUTER.x1;
      const outerZ = zs === 'n' ? OUTER.z0 : OUTER.z1;
      expect(Math.abs(p.x - outerX)).toBeCloseTo(PERIMETER_T / 2, 9);
      expect(Math.abs(p.z - outerZ)).toBeCloseTo(PERIMETER_T / 2, 9);
    }
  });

  /**
   * Verifies that no outer wall run, edge or room, intrudes on a map corner pillar
   */
  it('keeps every perimeter run clear of the map corner pillars', () => {
    const runs = [...EDGE_RUNS, ...WALLED.flatMap((r) => wallRuns(r))].filter((r) => r.thick === PERIMETER_T);
    expect(runs.length).toBeGreaterThan(0);
    const clashes: string[] = [];
    for (const run of runs) {
      const [lo, hi] = runRange(run);
      const line = horizontalSide(run.side) ? run.a[1] : run.a[0];
      const h = run.thick! / 2;
      const box = horizontalSide(run.side)
        ? { x0: lo, x1: hi, z0: line - h, z1: line + h }
        : { x0: line - h, x1: line + h, z0: lo, z1: hi };
      for (const [xs, zs] of MAP_CORNERS) {
        const px = PERIMETER_LINE[xs];
        const pz = PERIMETER_LINE[zs];
        const ox = Math.min(box.x1, px + PERIMETER_T / 2) - Math.max(box.x0, px - PERIMETER_T / 2);
        const oz = Math.min(box.z1, pz + PERIMETER_T / 2) - Math.max(box.z0, pz - PERIMETER_T / 2);
        if (ox > TOL && oz > TOL) clashes.push(`${run.room?.id ?? 'edge'} ${run.side} ${lo}..${hi} over ${zs}${xs} corner`);
      }
    }
    expect(clashes).toEqual([]);
  });

  /**
   * Verifies that every outer wall piece has its outer face exactly on the OUTER edge
   */
  it('puts the outer face of every perimeter wall piece on the OUTER edge', () => {
    const outer = TALL.filter((t) => t.name.startsWith('wall') && t.item.scale![2] === PERIMETER_T);
    expect(outer.length).toBeGreaterThan(0);
    // Every map edge gets some outer wall.
    const sides = new Set(outer.map((t) => sideOfRotation(t.item.rotY)));
    expect([...sides].sort()).toEqual(['e', 'n', 's', 'w']);
    const off: string[] = [];
    for (const { name, item } of outer) {
      const side = sideOfRotation(item.rotY)!;
      const t = item.scale![2];
      const face = { n: item.z - t / 2, s: item.z + t / 2, w: item.x - t / 2, e: item.x + t / 2 }[side];
      const edge = { n: OUTER.z0, s: OUTER.z1, w: OUTER.x0, e: OUTER.x1 }[side];
      if (Math.abs(face - edge) > 1e-9) off.push(`${name} ${side} (${item.x}, ${item.z}) face ${face} vs ${edge}`);
    }
    expect(off).toEqual([]);
  });

  /**
   * Verifies that a plain corner beside an outer wall puts its 0.3 m pillar against the inner face
   */
  it.each([
    ['n', PERIMETER_INNER.n + 0.15],
    ['s', PERIMETER_INNER.s - 0.15],
  ] as [Side, number][])('stands the taverne %s-w corner pillar against the outer inner face', (_zs, z) => {
    const taverne = room('taverne');
    const x = taverne.cx - taverne.w / 2 + WALL_INSET;
    const here = TALL.filter((t) => t.name === 'pillar' && Math.abs(t.item.x - x) < TOL && Math.abs(t.item.z - z) < TOL);
    expect(here).toHaveLength(1);
    expect(here[0].item.scale![0] * 1.5).toBeCloseTo(0.3, 9);
    expect(here[0].item.scale![2] * 1.5).toBeCloseTo(0.3, 9);
  });

  /**
   * Verifies that no torch or banner hangs where a prop stands in front of the wall
   */
  it('never hangs wall decor in front of furniture or over a nested zone', () => {
    // The gate torches hang outside the castle, facing the forest: see the gate tests.
    const decor = TALL.filter((t) => (t.name === 'torch_mounted' || t.name.startsWith('banner_')) && !isGateDecor(t));
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
      // end the outer wall's middle line. On a shared wall, the line is the common edge itself.
      const line = r ? wallLine(r, side) : PERIMETER_LINE[side];
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
   * Verifies that without rooms only the edge walls and the gate remain, with no banner
   */
  it('keeps only the edge walls and the gate for no rooms', () => {
    const empty = wallLayout([]);
    const names = [...empty.tall.keys()];
    expect(names.some((n) => n.startsWith('wall'))).toBe(true);
    for (const n of names) expect(n === 'torch_mounted' || n === 'pillar' || n.startsWith('wall'), n).toBe(true);
    expect([...empty.low.keys()].sort()).toEqual(['barrier', 'column']);
    // The only pillars are the two gate jambs and the four map corners, each with its column.
    const pillars = empty.tall.get('pillar')!;
    expect(pillars).toHaveLength(6);
    const corners = pillars.filter((p) =>
      MAP_CORNERS.some(([xs, zs]) => Math.abs(p.x - PERIMETER_LINE[xs]) < TOL && Math.abs(p.z - PERIMETER_LINE[zs]) < TOL),
    );
    expect(corners).toHaveLength(4);
    const jambs = pillars
      .filter((p) => !corners.includes(p))
      .map((p) => [p.x, p.z])
      .sort((p, q) => p[0] - q[0]);
    expect(jambs).toHaveLength(2);
    expect(jambs[0][0]).toBeCloseTo(GATE_LO, 9);
    expect(jambs[1][0]).toBeCloseTo(GATE_HI, 9);
    for (const [, z] of jambs) expect(z).toBeCloseTo(DEEP_Z, 9);
    expect(empty.low.get('column')).toHaveLength(6);
    // Every wall chunk lies on one of the four outer wall lines.
    for (const [n, items] of empty.tall) {
      if (!n.startsWith('wall')) continue;
      for (const w of items) {
        expect(onPerimeterLine(w), `${n} (${w.x}, ${w.z})`).toBe(true);
        expect(w.scale![2], `${n} (${w.x}, ${w.z})`).toBeCloseTo(w.y > TOL ? LINTEL_T : PERIMETER_T, 9);
      }
    }
  });
});

// ---------------------------------------------------------------- castle gate

describe('castle gate', () => {
  /** Span along x of a horizontal wall or barrier piece (a wall model is 4 pack units wide). */
  const spanX = (item: KitItem): [number, number] => [item.x - 2 * item.scale![0], item.x + 2 * item.scale![0]];
  const overlapsOpening = ([lo, hi]: [number, number]) => Math.min(hi, GATE.hi) - Math.max(lo, GATE.lo) > TOL;
  const lintels = () => TALL.filter((t) => t.name.startsWith('wall') && t.item.y > TOL);

  /**
   * Verifies that the gate opens in the south edge from the Héraut's east edge to the Concierge's west
   */
  it('lies on the south edge between the Héraut and the Conciergerie', () => {
    const heraut = room('heraut');
    const concierge = room('concierge');
    expect(GATE.side).toBe('s');
    expect(GATE.lo).toBeLessThan(GATE.hi);
    expect(heraut.cx + heraut.w / 2).toBeCloseTo(GATE.lo, 9);
    expect(concierge.cx - concierge.w / 2).toBeCloseTo(GATE.hi, 9);
    // Both rooms stand on the south edge of the map.
    expect(heraut.cz + heraut.d / 2).toBeCloseTo(BOUNDS.z1, 9);
    expect(concierge.cz + concierge.d / 2).toBeCloseTo(BOUNDS.z1, 9);
  });

  /**
   * Verifies that no room, nested or not, covers the corridor strip leading to the gate
   */
  it('has no room overlapping the opening', () => {
    const blocking = ROOMS.filter((r) => {
      const b = rect(r);
      const ox = Math.min(b.x1, GATE.hi) - Math.max(b.x0, GATE.lo);
      const oz = Math.min(b.z1, BOUNDS.z1) - Math.max(b.z0, BOUNDS.z1 - 2);
      return ox > TOL && oz > TOL;
    });
    expect(blocking.map((r) => r.id)).toEqual([]);
  });

  /**
   * Verifies that the x = 5 corridor is the one corridor ending inside the gate opening
   */
  it('receives the end of the x = 5 corridor', () => {
    const ends = gateCorridorEnds();
    expect(ends).toHaveLength(1);
    expect(ends[0].x).toBeCloseTo(5, 9);
    const corridor = CORRIDORS.find(([a, b]) => a === ends[0] || b === ends[0])!;
    // A north-south corridor, running into the gate.
    expect(corridor[0].x).toBeCloseTo(corridor[1].x, 9);
  });

  /**
   * Verifies that no edge wall closes the gate, with or without rooms on the map
   */
  it.each([
    ['the real rooms', EDGE_RUNS],
    ['no room', edgeRuns([])],
  ])('leaves the opening free of edge walls with %s', (_label, runs) => {
    const closing = runs.filter((r) => r.side === GATE.side).map(runRange).filter(overlapsOpening);
    expect(closing).toEqual([]);
  });

  /**
   * Verifies that the corridor end at the gate is not closed by any edge or room wall run
   */
  it('leaves the corridor end at the gate open', () => {
    const [end] = gateCorridorEnds();
    const southRuns = [...EDGE_RUNS, ...WALLED.flatMap((r) => wallRuns(r))].filter(
      (run) => run.side === 's' && Math.abs(run.a[1] - PERIMETER_LINE.s) < 0.6,
    );
    const closing = southRuns.filter((run) => {
      const [lo, hi] = runRange(run);
      return end.x >= lo - TOL && end.x <= hi + TOL;
    });
    expect(closing).toEqual([]);
  });

  /**
   * Verifies that no wall piece or low barrier at floor level stands across the opening
   */
  it('keeps the opening clear of floor-level walls and barriers', () => {
    // Anything across the south strip, from the outer wall back to the rooms' inset line.
    const onSouthLine = (item: KitItem) =>
      item.z > BOUNDS.z1 - 1 && item.z < OUTER.z1 + TOL && horizontalSide(sideOfRotation(item.rotY) ?? 'w');
    const walls = TALL.filter((t) => t.name.startsWith('wall') && t.item.y < TOL && onSouthLine(t.item)).map((t) => t.item);
    const barriers = LOW.filter(([n, b]) => n === 'barrier' && onSouthLine(b)).map(([, b]) => b);
    expect(walls.filter((w) => overlapsOpening(spanX(w))).map((w) => `wall (${w.x}, ${w.z})`)).toEqual([]);
    expect(barriers.filter((b) => overlapsOpening(spanX(b))).map((b) => `barrier (${b.x}, ${b.z})`)).toEqual([]);
  });

  /**
   * Verifies that a GATE_JAMB-wide pillar, with its low column, stands on each side of the gate
   */
  it.each([
    ['west', GATE_LO],
    ['east', GATE_HI],
  ])('puts a %s jamb GATE_JAMB wide, PERIMETER_T deep, on the outer wall line', (_side, x) => {
    const at = (item: KitItem) => Math.abs(item.x - x) < TOL && Math.abs(item.z - DEEP_Z) < TOL;
    // A 1.5 m pillar: its x and z scales times 1.5 are its width and depth.
    const jambs = TALL.filter(
      (t) =>
        t.name === 'pillar' &&
        at(t.item) &&
        Math.abs(t.item.scale![0] * 1.5 - GATE_JAMB) < TOL &&
        Math.abs(t.item.scale![2] * 1.5 - DEEP_T) < TOL,
    );
    expect(jambs).toHaveLength(1);
    // Deeper than the wall inwards only: the outer face stays on the map edge.
    expect(jambs[0].item.z + (jambs[0].item.scale![2] * 1.5) / 2).toBeCloseTo(OUTER.z1, 9);
    expect(jambs[0].item.y).toBe(0);
    expect(LOW.some(([n, c]) => n === 'column' && at(c))).toBe(true);
  });

  /**
   * Verifies that one lintel spans the whole opening at GATE_H and tops out at wall height
   */
  it('lays one lintel over the opening, from GATE_H up to the top of the walls', () => {
    const found = lintels();
    expect(found).toHaveLength(1);
    const { item } = found[0];
    expect(item.y).toBeCloseTo(GATE_H, 9);
    expect(item.x).toBeCloseTo(GATE_MID, 9);
    expect(item.z).toBeCloseTo(PERIMETER_LINE.s, 9);
    expect(sideOfRotation(item.rotY)).toBe('s');
    // It reaches from jamb to jamb, over the whole opening.
    const [lo, hi] = spanX(item);
    expect(lo).toBeCloseTo(GATE_LO, 9);
    expect(hi).toBeCloseTo(GATE_HI, 9);
    expect(lo).toBeLessThanOrEqual(GATE.lo);
    expect(hi).toBeGreaterThanOrEqual(GATE.hi);
    // A wall is 4 pack units high, drawn at KIT_SCALE: the lintel's top meets the walls' top.
    expect(GATE_H + 4 * item.scale![1]).toBeCloseTo(4 * KIT_SCALE, 9);
    expect(item.scale![2]).toBeCloseTo(LINTEL_T, 9);
    expect(item.scale![2]).toBeLessThan(DEEP_T);
    expect(GATE_H).toBeGreaterThan(0);
    expect(GATE_H).toBeLessThan(4 * KIT_SCALE);
  });

  /**
   * Verifies that two torches hang on the gate's outside face, one beyond each jamb
   */
  it('hangs two outward-facing torches beside the gate, sinking with the lintel', () => {
    const torches = TALL.filter(isGateDecor).map((t) => t.item).sort((p, q) => p.x - q.x);
    expect(torches).toHaveLength(2);
    for (const t of torches) {
      // Rotation 0 turns the decorated face towards +z: out of the castle, to the forest.
      expect(Math.cos(t.rotY)).toBeCloseTo(1, 9);
      // On the outer face of the outer wall, which is the map edge itself.
      expect(t.z).toBeCloseTo(PERIMETER_LINE.s + PERIMETER_T / 2, 9);
      expect(t.z).toBeCloseTo(OUTER.z1, 9);
      expect(t.y).toBeGreaterThan(0);
      expect(t.y).toBeLessThan(4 * KIT_SCALE);
    }
    expect(torches[0].x).toBeLessThan(GATE_LO - GATE_JAMB / 2);
    expect(torches[1].x).toBeGreaterThan(GATE_HI + GATE_JAMB / 2);
    // Their anchor is the lintel's, so the whole gate goes down as one piece.
    const lintel = lintels()[0].item;
    for (const t of torches) {
      expect(t.ax).toBeCloseTo(lintel.ax, 9);
      expect(t.az).toBeCloseTo(lintel.az, 9);
    }
  });

  /**
   * Verifies that the narrowed Conciergerie opens north onto the z = 5.5 corridor
   */
  it('opens the Conciergerie door north onto the z = 5.5 corridor', () => {
    const concierge = room('concierge');
    expect(concierge.door.side).toBe('n');
    const { outside } = doorOf(concierge);
    expect(outside.z).toBeCloseTo(5.5, 9);
    expect(outside.x).toBeGreaterThanOrEqual(5);
    expect(outside.x).toBeLessThanOrEqual(15);
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

// ---------------------------------------------------------------- perimeter sides

describe('perimeterSides', () => {
  /**
   * Verifies that no room door opens in an outer wall: door pillars stand on the inset line, which suits inner walls only
   */
  it('puts no room door on a map-edge side', () => {
    for (const r of ROOMS.filter((x) => !x.insideOf)) {
      expect(perimeterSides(r).has(r.door.side), r.id).toBe(false);
    }
  });

  /**
   * Verifies that the sides lying on the BOUNDS lines are reported for sample rooms
   */
  it.each([
    ['observatoire', ['n', 'w']],
    ['taverne', ['e', 'n', 's']],
    ['atelier', ['n']],
    ['autel', []],
    ['garde', ['s', 'w']],
    ['heraut', ['s']],
    ['concierge', ['s']],
  ] as [RoomId, Side[]][])('%s lies on the map edge on sides %j', (id, sides) => {
    expect([...perimeterSides(room(id))].sort()).toEqual([...sides].sort());
  });

  /**
   * Verifies that perimeterSides agrees with the BOUNDS edges for every walled room
   */
  it.each(WALLED_CASES)('%s matches its edges on BOUNDS', (_id, r) => {
    expect([...perimeterSides(r)].sort()).toEqual([...onMapEdge(r)].sort());
  });

  /**
   * Verifies that a room covering the whole map has all four sides on the perimeter
   */
  it('reports all four sides for a room covering BOUNDS', () => {
    const r = makeRoom('all', (BOUNDS.x0 + BOUNDS.x1) / 2, (BOUNDS.z0 + BOUNDS.z1) / 2, BOUNDS.x1 - BOUNDS.x0, BOUNDS.z1 - BOUNDS.z0);
    expect([...perimeterSides(r)].sort()).toEqual(['e', 'n', 's', 'w']);
  });

  /**
   * Verifies that a room set back 0.3 m from the edge is not on the perimeter
   */
  it('reports nothing for a room just short of the map edge', () => {
    const r = makeRoom('near', BOUNDS.x0 + 2.3, BOUNDS.z0 + 2.3, 4, 4);
    expect(perimeterSides(r).size).toBe(0);
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

// ---------------------------------------------------------------- room identity

/** Tall keys of a room's hangs. */
const hangKeys = (r: RoomDef) => new Set((r.hangs ?? []).map((h) => tallKey(h.pack, h.name)));

/** "x,z" of an anchor, rounded so that equal anchors compare equal. */
const anchorKey = (i: CutItem) => `${i.ax.toFixed(6)},${i.az.toFixed(6)}`;

describe('tallKey / tallModel', () => {
  /**
   * Verifies that a dungeon-pack model is keyed by its bare name, any other pack as pack:name
   */
  it('keys dungeon models by bare name and other packs as pack:name', () => {
    expect(tallKey('dungeon', 'wall')).toBe('wall');
    expect(tallKey('furniture', 'pictureframe_medium')).toBe('furniture:pictureframe_medium');
  });

  /**
   * Verifies that a bare key resolves to the dungeon pack and a prefixed key to its pack
   */
  it('resolves a bare key to the dungeon pack and splits pack:name at the first colon', () => {
    expect(tallModel('torch_mounted')).toEqual({ pack: 'dungeon', name: 'torch_mounted' });
    expect(tallModel('mixed1:chain_hanging_A')).toEqual({ pack: 'mixed1', name: 'chain_hanging_A' });
    expect(tallModel('a:b:c')).toEqual({ pack: 'a', name: 'b:c' });
  });

  /**
   * Verifies that tallModel undoes tallKey for every hang of the map and every manifest model
   */
  it('round-trips every hang and every manifest model', () => {
    const pairs = [
      ...ROOMS.flatMap((r) => r.hangs ?? []).map((h) => ({ pack: h.pack, name: h.name })),
      ...Object.entries(MANIFEST).flatMap(([pack, spec]) => spec.models.map((name) => ({ pack, name }))),
    ];
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) expect(tallModel(tallKey(p.pack, p.name))).toEqual(p);
  });
});

describe('room identity data', () => {
  const withWalls = ROOMS.filter((r) => r.walls).map((r) => [r.id, r] as const);
  const withHangs = ROOMS.filter((r) => r.hangs).map((r) => [r.id, r] as const);

  /**
   * Verifies that several rooms have their own wall mix and their own hangs
   */
  it('gives several rooms their own walls and hangs', () => {
    expect(withWalls.length).toBeGreaterThanOrEqual(3);
    expect(withHangs.length).toBeGreaterThanOrEqual(3);
  });

  /**
   * Verifies that a room's wall models are dungeon-pack models with positive finite weights
   */
  it.each(withWalls)('%s wall variants are dungeon models with positive weights', (_id, r) => {
    const dungeon = new Set(MANIFEST.dungeon.models);
    expect(r.walls!.length).toBeGreaterThan(0);
    for (const [name, weight] of r.walls!) {
      expect(dungeon.has(name), name).toBe(true);
      expect(name.startsWith('wall'), name).toBe(true);
      expect(Number.isFinite(weight) && weight > 0, `${name} weight ${weight}`).toBe(true);
    }
  });

  /**
   * Verifies that a room's hangs are manifest models with a sane height, back and scale
   */
  it.each(withHangs)('%s hangs are manifest models with a sane height, back and scale', (_id, r) => {
    expect(r.hangs!.length).toBeGreaterThan(0);
    for (const h of r.hangs!) {
      expect(MANIFEST[h.pack]?.models.includes(h.name), `${h.pack}/${h.name}`).toBe(true);
      expect(h.y).toBeGreaterThanOrEqual(0);
      expect(h.y).toBeLessThan(3);
      expect(Number.isFinite(h.back ?? 0)).toBe(true);
      expect(h.s ?? 1).toBeGreaterThan(0);
    }
  });

  /**
   * Verifies that every walled room has a #RRGGBB mood light with a positive intensity
   */
  it.each(WALLED_CASES)('%s has a #RRGGBB light with a positive intensity', (_id, r) => {
    expect(r.light).toBeDefined();
    expect(r.light!.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(Number.isFinite(r.light!.intensity)).toBe(true);
    expect(r.light!.intensity).toBeGreaterThan(0);
  });

  /**
   * Verifies that a zone inside another room has no light of its own
   */
  it('gives no light to a zone inside another room', () => {
    const zones = ROOMS.filter((r) => r.insideOf);
    expect(zones.length).toBeGreaterThan(0);
    for (const z of zones) expect(z.light, z.id).toBeUndefined();
  });
});

describe('wallLayout: room walls and hangs', () => {
  const HANGS: WallHang[] = [
    { pack: 'furniture', name: 'pictureframe_medium', y: 1.6, back: 0, s: 1 },
    { pack: 'mixed1', name: 'chain_hanging_A', y: 2.6, back: 0.15, s: 0.8 },
  ];
  const HANG_KEYS = new Set(HANGS.map((h) => tallKey(h.pack, h.name)));
  // A large room of plain walls: every chunk is 'wall' and over 2 m, so each one rolls for
  // decor. About thirty rolls: the seeded dice are certain to land on hangs a few times.
  const big = (extra: Partial<RoomDef>) => makeRoom('hang-test', 0, -2, 30, 16, { walls: [['wall', 1]], ...extra });
  const hung = big({ hangs: HANGS });
  const WITH = wallLayout([hung]);
  const WITHOUT = wallLayout([big({})]);
  const hangItems = [...WITH.tall].filter(([k]) => HANG_KEYS.has(k)).flatMap(([k, items]) => items.map((item) => ({ k, item })));

  /**
   * Verifies that a room with hangs gets its hang models and no banner at all
   */
  it('hangs the room models in place of banners', () => {
    expect(hangItems.length).toBeGreaterThan(0);
    expect([...WITH.tall.keys()].filter((k) => k.startsWith('banner_'))).toEqual([]);
    expect([...WITHOUT.tall.keys()].some((k) => k.startsWith('banner_'))).toBe(true);
  });

  /**
   * Verifies that hangs take exactly the wall spots banners take, torches unchanged
   */
  it('puts hangs on the same spots as the banners they replace, torches unchanged', () => {
    const banners = [...WITHOUT.tall].filter(([k]) => k.startsWith('banner_')).flatMap(([, items]) => items);
    expect(hangItems.map(({ item }) => anchorKey(item)).sort()).toEqual(banners.map(anchorKey).sort());
    expect(WITH.tall.get('torch_mounted')).toEqual(WITHOUT.tall.get('torch_mounted'));
  });

  /**
   * Verifies that an empty hangs list falls back to the banners
   */
  it('falls back to banners for an empty hangs list', () => {
    expect(wallLayout([big({ hangs: [] })])).toEqual(WITHOUT);
  });

  /**
   * Verifies that each hang is anchored on its wall chunk and faces into the room like a banner
   */
  it('anchors every hang on its wall chunk, facing into the room', () => {
    const walls = [...WITH.tall].filter(([k]) => k.startsWith('wall')).flatMap(([, items]) => items);
    for (const { k, item } of hangItems) {
      const side = sideOfRotation(item.rotY);
      expect(side, `${k} rotY ${item.rotY}`).toBeDefined();
      const chunk = walls.find((w) => Math.abs(w.ax - item.ax) < 1e-9 && Math.abs(w.az - item.az) < 1e-9);
      expect(chunk, `${k} at (${item.x}, ${item.z})`).toBeDefined();
      expect(item.rotY).toBeCloseTo(chunk!.rotY, 12);
      // Its inward direction points to the room centre.
      const [ix, iz] = INWARD[side!];
      expect((hung.cx - item.ax) * ix + (hung.cz - item.az) * iz).toBeGreaterThan(0);
    }
  });

  /**
   * Verifies that a hang stands at its height, scale s × KIT_SCALE, its back on the wall face
   */
  it('places each hang at its height and scale, its back against the wall face', () => {
    for (const { k, item } of hangItems) {
      const h = HANGS.find((x) => tallKey(x.pack, x.name) === k)!;
      const s = (h.s ?? 1) * KIT_SCALE;
      expect(item.y).toBe(h.y);
      expect(item.scale).toEqual([s, s, s]);
      const [ix, iz] = INWARD[sideOfRotation(item.rotY)!];
      const d = WALL_T / 2 - (h.back ?? 0) * s;
      expect(item.x - item.ax).toBeCloseTo(ix * d, 9);
      expect(item.z - item.az).toBeCloseTo(iz * d, 9);
    }
  });

  /**
   * Verifies that a room with its own walls uses only those models on chunks of 1.5 m or more
   */
  it("uses only the room's wall models, plain 'wall' on chunks shorter than 1.5 m", () => {
    // 4 × 6 m, door north: the two north stretches are 0.95 m, the others 2.85 m and 3.7 m.
    const r = makeRoom('variant-test', 0, -2, 4, 6, { walls: [['wall_scaffold', 1]] });
    const inRoom = (i: CutItem) => Math.abs(i.ax - r.cx) < r.w / 2 && Math.abs(i.az - r.cz) < r.d / 2;
    const walls = [...wallLayout([r]).tall]
      .filter(([k]) => k.startsWith('wall'))
      .flatMap(([k, items]) => items.filter(inRoom).map((item) => ({ k, item })));
    expect(walls).toHaveLength(7);
    for (const { k, item } of walls) {
      const chunk = item.scale![0] * 4;
      expect(k, `chunk ${chunk.toFixed(2)} m`).toBe(chunk < 1.5 ? 'wall' : 'wall_scaffold');
    }
    expect(walls.filter(({ k }) => k === 'wall')).toHaveLength(2);
  });

  /**
   * Verifies that in the real map, a room with its own walls only draws those on long chunks
   */
  it('keeps every map room with walls to its own wall models', () => {
    const problems: string[] = [];
    let checked = 0;
    for (const { name, item } of TALL.filter((t) => t.name.startsWith('wall'))) {
      const r = roomFacedBy(item);
      if (!r?.walls) continue;
      const chunk = item.scale![0] * 4;
      const allowed = chunk < 1.5 ? ['wall'] : r.walls.map(([n]) => n);
      checked++;
      if (!allowed.includes(name)) problems.push(`${r.id}: ${name} on a ${chunk.toFixed(2)} m chunk`);
    }
    expect(checked).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  /**
   * Verifies that in the real map, every hang faces a room that lists it, on its wall chunk
   */
  it('hangs every map hang in a room that lists it, anchored on a wall chunk', () => {
    const all = new Set(ROOMS.flatMap((r) => [...hangKeys(r)]));
    const walls = TALL.filter((t) => t.name.startsWith('wall')).map((t) => t.item);
    const items = TALL.filter((t) => all.has(t.name));
    expect(items.length).toBeGreaterThan(0);
    const problems: string[] = [];
    for (const { name, item } of items) {
      const r = roomFacedBy(item);
      if (!r || !hangKeys(r).has(name)) problems.push(`${name} at (${item.x}, ${item.z}) faces ${r?.id ?? 'no room'}`);
      const onChunk = walls.some((w) => anchorKey(w) === anchorKey(item) && Math.abs(w.rotY - item.rotY) < TOL);
      if (!onChunk) problems.push(`${name} at (${item.x}, ${item.z}) is on no wall chunk`);
    }
    expect(problems).toEqual([]);
  });

  /**
   * Verifies that in the real map, a room with hangs gets no random banner
   */
  it('hangs no random banner in a map room that has hangs', () => {
    const stray = TALL.filter((t) => t.name.startsWith('banner_'))
      .map(({ name, item }) => ({ name, item, r: roomFacedBy(item) }))
      .filter(({ name, r }) => r?.hangs?.length && !hangKeys(r).has(name))
      .map(({ name, r }) => `${r!.id}: ${name}`);
    expect(stray).toEqual([]);
  });
});
