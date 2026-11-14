import { BOUNDS, doorOf, inFootprint, ROOMS, type FloorKind, type RoomDef, type Side, type WallHang } from './layout.ts';

// Where the KayKit floor tiles, walls and wall decor go. Pure geometry, no three.js scene:
// testable in node. Every list is grouped by model name, ready for <KitInstances>.

/**
 * The KayKit packs are drawn about 1.33 times bigger than our scene (a KayKit table is 1 m
 * high, ours 0.75 m): every model is scaled by this factor.
 */
export const KIT_SCALE = 0.75;

/** One copy of a model: position, Y rotation, and a per-axis scale (KIT_SCALE when omitted). */
export interface KitItem {
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale?: [number, number, number];
}

export type Placement = Map<string, KitItem[]>;

function add(p: Placement, name: string, item: KitItem): void {
  const list = p.get(name);
  if (list) list.push(item);
  else p.set(name, [item]);
}

/** Small deterministic generator: the same room always gets the same tiles and walls. */
export function seeded(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, weighted: [T, number][]): T {
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of weighted) {
    r -= w;
    if (r < 0) return v;
  }
  return weighted[weighted.length - 1][0];
}

// ---------------------------------------------------------------- floors

/** A small tile is 2 m in the pack, 1.5 m here; a large one 3 m. */
export const SMALL_TILE = 2 * KIT_SCALE;
export const LARGE_TILE = 4 * KIT_SCALE;
/** Room tiles sit a little above the corridor tiles, which they overlap at the edges. */
const ROOM_FLOOR_Y = -0.02;
const CORRIDOR_FLOOR_Y = -0.035;

const FLOOR_TILES: Record<FloorKind, [string, number][]> = {
  stone: [
    ['floor_tile_small', 10],
    ['floor_tile_small_broken_A', 1],
    ['floor_tile_small_broken_B', 1],
    ['floor_tile_small_weeds_A', 1],
    ['floor_tile_small_weeds_B', 1],
  ],
  stoneFancy: [
    ['floor_tile_small', 8],
    ['floor_tile_small_decorated', 1],
    ['floor_tile_grate', 1],
  ],
  grate: [
    ['floor_tile_small', 6],
    ['floor_tile_grate', 2],
    ['floor_tile_small_broken_A', 1],
  ],
  wood: [['floor_wood_small', 1]],
  woodDark: [['floor_wood_small_dark', 1]],
  dirt: [
    ['floor_dirt_small_A', 3],
    ['floor_dirt_small_B', 3],
    ['floor_dirt_small_C', 3],
    ['floor_dirt_small_D', 3],
    ['floor_dirt_small_weeds', 2],
  ],
};

/** Covers a room exactly with small tiles, stretched a little so that a whole number fits. */
export function roomFloor(room: RoomDef, out: Placement = new Map()): Placement {
  const nx = Math.max(1, Math.round(room.w / SMALL_TILE));
  const nz = Math.max(1, Math.round(room.d / SMALL_TILE));
  const tw = room.w / nx;
  const td = room.d / nz;
  const rand = seeded(`floor:${room.id}`);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      // Stone and dirt tiles turn at random so their pattern does not repeat; wooden planks
      // keep one direction. The scale applies before the turn: a quarter turn swaps the axes.
      const turns = room.floorKind.startsWith('wood') ? 0 : Math.floor(rand() * 4);
      const quarter = turns % 2 === 1;
      add(out, pick(rand, FLOOR_TILES[room.floorKind]), {
        x: room.cx - room.w / 2 + tw * (i + 0.5),
        y: ROOM_FLOOR_Y,
        z: room.cz - room.d / 2 + td * (j + 0.5),
        rotY: turns * (Math.PI / 2),
        scale: quarter ? [td / 2, KIT_SCALE, tw / 2] : [tw / 2, KIT_SCALE, td / 2],
      });
    }
  }
  return out;
}

/** The outer rectangle of the dungeon, corridors included. */
export const OUTER = { x0: BOUNDS.x0 - 0.5, x1: BOUNDS.x1 + 0.5, z0: BOUNDS.z0 - 0.5, z1: BOUNDS.z1 + 0.5 };

function walledRooms(): RoomDef[] {
  return ROOMS.filter((r) => !r.insideOf);
}

/** Large stone tiles over the whole dungeon, except where a room covers a tile entirely. */
export function corridorFloor(out: Placement = new Map()): Placement {
  const rand = seeded('corridors');
  const rooms = walledRooms();
  for (let x = OUTER.x0; x < OUTER.x1 - 1e-6; x += LARGE_TILE) {
    for (let z = OUTER.z0; z < OUTER.z1 - 1e-6; z += LARGE_TILE) {
      const covered = rooms.some(
        (r) =>
          x >= r.cx - r.w / 2 - 1e-6 &&
          x + LARGE_TILE <= r.cx + r.w / 2 + 1e-6 &&
          z >= r.cz - r.d / 2 - 1e-6 &&
          z + LARGE_TILE <= r.cz + r.d / 2 + 1e-6,
      );
      if (covered) continue;
      // Plain flagstones only: the rocky variant looked like a boulder lying in the corridor.
      add(out, 'floor_tile_large', {
        x: x + LARGE_TILE / 2,
        y: CORRIDOR_FLOOR_Y,
        z: z + LARGE_TILE / 2,
        rotY: Math.floor(rand() * 4) * (Math.PI / 2),
      });
    }
  }
  return out;
}

/** Stone foundation blocks around the edge: the dungeon looks like a model on its base. */
export function foundation(out: Placement = new Map()): Placement {
  const step = SMALL_TILE;
  // The blocks are 2 m high in the pack: their top meets the corridor floor.
  const y = -2 * KIT_SCALE - 0.01;
  const nx = Math.round((OUTER.x1 - OUTER.x0) / step);
  const nz = Math.round((OUTER.z1 - OUTER.z0) / step);
  const h = step / 2;
  for (let i = 1; i < nx - 1; i++) {
    const x = OUTER.x0 + step * (i + 0.5);
    add(out, 'floor_foundation_front', { x, y, z: OUTER.z1 - h, rotY: 0 });
    add(out, 'floor_foundation_front', { x, y, z: OUTER.z0 + h, rotY: Math.PI });
  }
  for (let j = 1; j < nz - 1; j++) {
    const z = OUTER.z0 + step * (j + 0.5);
    add(out, 'floor_foundation_front', { x: OUTER.x1 - h, y, z, rotY: Math.PI / 2 });
    add(out, 'floor_foundation_front', { x: OUTER.x0 + h, y, z, rotY: -Math.PI / 2 });
  }
  add(out, 'floor_foundation_corner', { x: OUTER.x0 + h, y, z: OUTER.z1 - h, rotY: 0 });
  add(out, 'floor_foundation_corner', { x: OUTER.x1 - h, y, z: OUTER.z1 - h, rotY: Math.PI / 2 });
  add(out, 'floor_foundation_corner', { x: OUTER.x1 - h, y, z: OUTER.z0 + h, rotY: Math.PI });
  add(out, 'floor_foundation_corner', { x: OUTER.x0 + h, y, z: OUTER.z0 + h, rotY: -Math.PI / 2 });
  return out;
}

// ---------------------------------------------------------------- walls

export const WALL_T = 0.25;
/** Walls sit inside the floor so that two neighbouring rooms never draw on the same spot. */
export const WALL_INSET = 0.15;
export const DOOR_W = 1.8;
const WALL_CHUNK = 3;

/** Y rotation that turns the decorated face of a wall model (+z) towards the room. */
const FACE_IN: Record<Side, number> = { n: 0, s: Math.PI, w: Math.PI / 2, e: -Math.PI / 2 };
/** Unit vector from the wall towards the inside of its room. */
const INWARD: Record<Side, [number, number]> = { n: [0, 1], s: [0, -1], w: [1, 0], e: [-1, 0] };

/** A straight stretch of wall between a corner and a corner or the door. */
export interface WallRun {
  /** The room the wall belongs to; none for the walls closing the corridors at the map edge. */
  room?: RoomDef;
  side: Side;
  /** Ends of the run, in world coordinates. */
  a: [number, number];
  b: [number, number];
}

/** Cuts the door openings (centres along the run) out of the run from a to b. */
function cutDoors(run: WallRun, doors: number[]): WallRun[] {
  const { a, b } = run;
  const k = run.side === 'n' || run.side === 's' ? 0 : 1;
  const at = (v: number): [number, number] => (k === 0 ? [v, a[1]] : [a[0], v]);
  const out: WallRun[] = [];
  let from = a[k];
  for (const d of [...doors].sort((p, q) => p - q)) {
    const lo = d - DOOR_W / 2;
    const hi = d + DOOR_W / 2;
    if (hi < from || lo > b[k]) continue;
    if (lo - from > 0.05) out.push({ ...run, a: at(from), b: at(lo) });
    from = Math.max(from, hi);
  }
  if (b[k] - from > 0.05) out.push({ ...run, a: at(from), b });
  return out;
}

/**
 * Walls of a room, the door left open. A wall shared with a neighbouring room is a single
 * wall on the common edge, drawn by the room to its west or north (its 'e' or 's' side).
 */
export function wallRuns(room: RoomDef, rooms: RoomDef[] = walledRooms()): WallRun[] {
  const x0 = room.cx - room.w / 2 + WALL_INSET;
  const x1 = room.cx + room.w / 2 - WALL_INSET;
  const z0 = room.cz - room.d / 2 + WALL_INSET;
  const z1 = room.cz + room.d / 2 - WALL_INSET;
  const shared = sharedSides(room, rooms);
  const ex = room.cx + room.w / 2;
  const ez = room.cz + room.d / 2;
  const lines: Record<Side, [[number, number], [number, number]]> = {
    n: [[x0, z0], [x1, z0]],
    s: [[x0, shared.has('s') ? ez : z1], [x1, shared.has('s') ? ez : z1]],
    w: [[x0, z0], [x0, z1]],
    e: [[shared.has('e') ? ex : x1, z0], [shared.has('e') ? ex : x1, z1]],
  };
  const runs: WallRun[] = [];
  for (const side of ['n', 's', 'w', 'e'] as Side[]) {
    if (shared.has(side) && (side === 'n' || side === 'w')) continue;
    const horizontal = side === 'n' || side === 's';
    // Doors on this edge: the room's own, and on a shared wall the neighbour's too.
    const doors: number[] = [];
    for (const r of shared.has(side) ? rooms : [room]) {
      const s = r === room ? side : OPPOSITE[side];
      if (r.door.side !== s) continue;
      if (r !== room && Math.abs(edge(r, s).at - edge(room, side).at) > 0.6) continue;
      const w = doorOf(r).wall;
      doors.push(horizontal ? w.x : w.z);
    }
    const [a, b] = lines[side];
    runs.push(...cutDoors({ room, side, a, b }, doors));
  }
  return runs;
}

/**
 * Walls closing the corridors where they reach the edge of the map, in line with the walls
 * of the rooms standing on that edge (which keep their own walls: nothing is doubled).
 */
export function edgeRuns(rooms: RoomDef[] = walledRooms()): WallRun[] {
  const runs: WallRun[] = [];
  const lines: Record<Side, { at: number; lo: number; hi: number }> = {
    n: { at: BOUNDS.z0, lo: BOUNDS.x0, hi: BOUNDS.x1 },
    s: { at: BOUNDS.z1, lo: BOUNDS.x0, hi: BOUNDS.x1 },
    w: { at: BOUNDS.x0, lo: BOUNDS.z0, hi: BOUNDS.z1 },
    e: { at: BOUNDS.x1, lo: BOUNDS.z0, hi: BOUNDS.z1 },
  };
  for (const side of ['n', 's', 'w', 'e'] as Side[]) {
    const line = lines[side];
    const [ix, iz] = INWARD[side];
    // The wall line of the rooms on this edge.
    const at = line.at + (ix + iz) * WALL_INSET;
    const covered = rooms
      .map((r) => edge(r, side))
      .filter((e) => Math.abs(e.at - line.at) < 0.6)
      .map((e) => [e.lo + WALL_INSET, e.hi - WALL_INSET] as const)
      .sort((p, q) => p[0] - q[0]);
    let from = line.lo + WALL_INSET;
    const point = (v: number): [number, number] => (side === 'n' || side === 's' ? [v, at] : [at, v]);
    for (const [lo, hi] of [...covered, [line.hi - WALL_INSET, Infinity] as const]) {
      // The 0.3 m slot between two rooms standing side by side is closed by a pillar instead.
      if (lo - from > 0.5) runs.push({ side, a: point(from), b: point(Math.min(lo, line.hi - WALL_INSET)) });
      from = Math.max(from, hi);
    }
  }
  return runs;
}

/** A tall wall piece: it goes down when its anchor (its stretch of wall) is in the foreground. */
export interface CutItem extends KitItem {
  /** Point of the wall that decides whether the piece stands: shared by a wall and its decor. */
  ax: number;
  az: number;
}

/** Wall pieces and wall decor. */
export interface WallLayout {
  /** Tall walls, pillars and wall decor, lowered by the cutaway. */
  tall: Map<string, CutItem[]>;
  /** Low walls and posts, always shown; hidden inside the tall walls while those stand. */
  low: Placement;
}

function addTall(layout: WallLayout, name: string, item: CutItem): void {
  const list = layout.tall.get(name);
  if (list) list.push(item);
  else layout.tall.set(name, [item]);
}

const WALL_VARIANTS: [string, number][] = [
  ['wall', 10],
  ['wall_window_open', 2],
  ['wall_arched', 2],
  ['wall_shelves', 2],
  ['wall_cracked', 2],
];

const BANNER_STYLES = ['', 'patternA_', 'patternB_', 'patternC_', 'shield_'];

/**
 * Key of a tall piece in WallLayout.tall: the bare model name for the dungeon pack, else
 * `pack:name` (a frame, a shield, a chain hung by a room).
 */
export function tallKey(pack: string, name: string): string {
  return pack === 'dungeon' ? name : `${pack}:${name}`;
}

/** Pack and model of a WallLayout.tall key. */
export function tallModel(key: string): { pack: string; name: string } {
  const i = key.indexOf(':');
  return i < 0 ? { pack: 'dungeon', name: key } : { pack: key.slice(0, i), name: key.slice(i + 1) };
}

/** True when nothing stands against the wall at (x, z), so a torch or a banner can hang there. */
function wallIsFree(room: RoomDef, x: number, z: number, side: Side): boolean {
  const [ix, iz] = INWARD[side];
  const rx = x + ix * 0.6 - room.cx;
  const rz = z + iz * 0.6 - room.cz;
  if (room.props.some((p) => inFootprint(p, rx, rz))) return false;
  // Not inside a zone drawn on the floor (the Scriptorium).
  return !ROOMS.some((zn) => zn.insideOf === room.id && Math.abs(x - zn.cx) < zn.w / 2 + 0.5 && Math.abs(z - zn.cz) < zn.d / 2 + 0.5);
}

const PILLAR_W = 0.3;

function pillar(layout: WallLayout, x: number, z: number, wx = PILLAR_W, wz = PILLAR_W): void {
  // A 1.5 m pillar thinned to 0.3 m, and a short column for the lowered state.
  addTall(layout, 'pillar', { x, y: 0, z, rotY: 0, scale: [wx / 1.5, KIT_SCALE, wz / 1.5], ax: x, az: z });
  add(layout.low, 'column', { x, y: 0, z, rotY: 0, scale: [(wx / PILLAR_W) * 0.4, KIT_SCALE, (wz / PILLAR_W) * 0.4] });
}

const OPPOSITE: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };

/** Edge of a room on one side: the line it lies on and the range it covers along that line. */
function edge(room: RoomDef, side: Side): { at: number; lo: number; hi: number } {
  const hw = room.w / 2;
  const hd = room.d / 2;
  switch (side) {
    case 'n':
      return { at: room.cz - hd, lo: room.cx - hw, hi: room.cx + hw };
    case 's':
      return { at: room.cz + hd, lo: room.cx - hw, hi: room.cx + hw };
    case 'w':
      return { at: room.cx - hw, lo: room.cz - hd, hi: room.cz + hd };
    case 'e':
      return { at: room.cx + hw, lo: room.cz - hd, hi: room.cz + hd };
  }
}

/**
 * Sides of a room backed by another room (the Poste de garde, the Salle des épreuves and the
 * Héraut stand side by side). Such a side gets a single wall on the common edge.
 */
export function sharedSides(room: RoomDef, rooms: RoomDef[] = walledRooms()): Set<Side> {
  const out = new Set<Side>();
  for (const side of ['n', 's', 'e', 'w'] as Side[]) {
    const mine = edge(room, side);
    for (const other of rooms) {
      if (other.id === room.id) continue;
      const theirs = edge(other, OPPOSITE[side]);
      const overlap = Math.min(mine.hi, theirs.hi) - Math.max(mine.lo, theirs.lo);
      if (Math.abs(mine.at - theirs.at) < 0.6 && overlap > 0.5) out.add(side);
    }
  }
  return out;
}

/** Hangs a room's wall piece on the wall at (x, z), its back against the wall face. */
function hang(layout: WallLayout, h: WallHang, x: number, z: number, side: Side): void {
  const [ix, iz] = INWARD[side];
  const s = (h.s ?? 1) * KIT_SCALE;
  const d = WALL_T / 2 - (h.back ?? 0) * s;
  addTall(layout, tallKey(h.pack, h.name), { x: x + ix * d, y: h.y, z: z + iz * d, rotY: FACE_IN[side], scale: [s, s, s], ax: x, az: z });
}

/** Tall wall pieces, the low wall inside them, and torches, banners or hangs on plain stretches. */
function placeRun(layout: WallLayout, run: WallRun, rand: () => number): void {
  const { side, a, b, room } = run;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.round(len / WALL_CHUNK));
  const chunk = len / n;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = a[0] + (b[0] - a[0]) * t;
    const z = a[1] + (b[1] - a[1]) * t;
    const rotY = FACE_IN[side];
    const model = chunk < 1.5 ? 'wall' : pick(rand, room?.walls ?? WALL_VARIANTS);
    addTall(layout, model, { x, y: 0, z, rotY, scale: [chunk / 4, KIT_SCALE, WALL_T], ax: x, az: z });
    // Slightly thinner than the tall wall, so that it hides inside it without flickering.
    add(layout.low, 'barrier', { x, y: 0, z, rotY, scale: [chunk / 4, KIT_SCALE, (WALL_T - 0.03) / 0.5] });
    // Wall decor on plain stretches with nothing in front. A corridor end only gets a torch.
    if (model !== 'wall' || chunk < 2 || (room && !wallIsFree(room, x, z, side))) continue;
    const [ix, iz] = INWARD[side];
    const roll = rand();
    if (roll < 0.45) {
      const d = WALL_T / 2;
      addTall(layout, 'torch_mounted', { x: x + ix * d, y: 1.9, z: z + iz * d, rotY, ax: x, az: z });
    } else if (roll < 0.75 && room?.hangs?.length) {
      // The room's own wall pieces, in place of the banners.
      hang(layout, room.hangs[Math.floor(rand() * room.hangs.length)], x, z, side);
    } else if (roll < 0.75 && room) {
      const style = BANNER_STYLES[Math.floor(rand() * BANNER_STYLES.length)];
      // The banner's back is 0.38 m in front of its origin in the pack.
      const d = WALL_T / 2 - 0.38 * KIT_SCALE;
      addTall(layout, `banner_${style}${room.accent}`, { x: x + ix * d, y: 0, z: z + iz * d, rotY, ax: x, az: z });
    }
  }
}

export function wallLayout(rooms: RoomDef[] = walledRooms()): WallLayout {
  const layout: WallLayout = { tall: new Map(), low: new Map() };
  const edgeRand = seeded('walls:edge');
  for (const run of edgeRuns(rooms)) placeRun(layout, run, edgeRand);
  for (const room of rooms) {
    const rand = seeded(`walls:${room.id}`);
    const shared = sharedSides(room, rooms);
    for (const run of wallRuns(room, rooms)) placeRun(layout, run, rand);
    // Corner pillars hide the joins; door pillars frame the opening.
    const x0 = room.cx - room.w / 2 + WALL_INSET;
    const x1 = room.cx + room.w / 2 - WALL_INSET;
    const z0 = room.cz - room.d / 2 + WALL_INSET;
    const z1 = room.cz + room.d / 2 - WALL_INSET;
    // On a shared side, one wide pillar straddles the two rooms where their walls meet the
    // shared wall; the room to the east or south leaves it to its neighbour.
    const corners: [Side, Side][] = [
      ['n', 'w'],
      ['n', 'e'],
      ['s', 'w'],
      ['s', 'e'],
    ];
    for (const [zs, xs] of corners) {
      let x = xs === 'w' ? x0 : x1;
      let z = zs === 'n' ? z0 : z1;
      let wx = PILLAR_W;
      let wz = PILLAR_W;
      if (shared.has(xs)) {
        if (xs === 'w') continue;
        x = room.cx + room.w / 2;
        wx = 2 * (WALL_INSET + PILLAR_W / 2);
      }
      if (shared.has(zs)) {
        if (zs === 'n') continue;
        z = room.cz + room.d / 2;
        wz = 2 * (WALL_INSET + PILLAR_W / 2);
      }
      pillar(layout, x, z, wx, wz);
    }
    const door = doorOf(room).wall;
    const along: [number, number] = room.door.side === 'n' || room.door.side === 's' ? [1, 0] : [0, 1];
    for (const sgn of [-1, 1]) {
      const px = door.x + along[0] * sgn * (DOOR_W / 2);
      const pz = door.z + along[1] * sgn * (DOOR_W / 2);
      // Same inset as the wall line the door sits on.
      const [ix, iz] = INWARD[room.door.side];
      pillar(layout, px + ix * WALL_INSET, pz + iz * WALL_INSET);
    }
  }
  return layout;
}

// ---------------------------------------------------------------- cutaway

/**
 * How far the cutaway curve drops away from the cursor. Normalised device coordinates span 2
 * in each direction: 0.3 drops the curve by 15 % of the screen height half a screen away.
 */
export const CUT_CURVE = 0.3;

/**
 * Cutaway: an upside-down parabola through the cursor splits the screen. A wall piece whose
 * anchor shows below it is in the foreground and goes down; above it, the piece stands.
 * All coordinates are normalised device coordinates (x right, y up, -1 to 1).
 */
export function inForeground(cursorX: number, cursorY: number, x: number, y: number): boolean {
  return y < cursorY - CUT_CURVE * (x - cursorX) ** 2;
}
