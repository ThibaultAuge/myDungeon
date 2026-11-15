import { BOUNDS, doorOf, GATE, inFootprint, ROOMS, type FloorKind, type RoomDef, type Side, type WallHang } from './layout.ts';

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

/**
 * Thickness of the outer walls of the castle. Their outer face is the edge of the map (the
 * stone base, the moat on the south side); their inner face stays about where a room wall is.
 */
export const PERIMETER_T = 0.6;
/** The line of BOUNDS on each side of the map: where the rooms on the edge end. */
export const BOUND_LINE: Record<Side, number> = { n: BOUNDS.z0, s: BOUNDS.z1, w: BOUNDS.x0, e: BOUNDS.x1 };
/**
 * Pillars as deep as an outer wall (gate jambs, slots between two rooms) overlap the wall ends:
 * they are this much deeper, inwards only, so their faces never fight with the wall's.
 */
export const PERIMETER_PILLAR_EXTRA = 0.06;
/** Middle line of the outer wall on each side of the map. */
export const PERIMETER_LINE: Record<Side, number> = {
  n: OUTER.z0 + PERIMETER_T / 2,
  s: OUTER.z1 - PERIMETER_T / 2,
  w: OUTER.x0 + PERIMETER_T / 2,
  e: OUTER.x1 - PERIMETER_T / 2,
};
/** Inner face of the outer wall on each side of the map. */
export const PERIMETER_INNER: Record<Side, number> = {
  n: OUTER.z0 + PERIMETER_T,
  s: OUTER.z1 - PERIMETER_T,
  w: OUTER.x0 + PERIMETER_T,
  e: OUTER.x1 - PERIMETER_T,
};

/** Sides of a room that lie on the edge of the map: they get the thick outer wall. */
export function perimeterSides(room: RoomDef): Set<Side> {
  const out = new Set<Side>();
  for (const side of ['n', 's', 'w', 'e'] as Side[]) if (Math.abs(edge(room, side).at - BOUND_LINE[side]) < 1e-6) out.add(side);
  return out;
}

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
  /** Wall thickness: PERIMETER_T on the outer walls, WALL_T inside. */
  thick?: number;
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
  const outer = perimeterSides(room);
  const ex = room.cx + room.w / 2;
  const ez = room.cz + room.d / 2;
  // The wall line of each side: the map edge's thick wall, a shared edge, or inside the room.
  const at: Record<Side, number> = {
    n: outer.has('n') ? PERIMETER_LINE.n : z0,
    s: outer.has('s') ? PERIMETER_LINE.s : shared.has('s') ? ez : z1,
    w: outer.has('w') ? PERIMETER_LINE.w : x0,
    e: outer.has('e') ? PERIMETER_LINE.e : shared.has('e') ? ex : x1,
  };
  // A wall stops at the inner face of an outer wall it meets.
  const ax0 = outer.has('w') ? PERIMETER_INNER.w : x0;
  const ax1 = outer.has('e') ? PERIMETER_INNER.e : x1;
  const az0 = outer.has('n') ? PERIMETER_INNER.n : z0;
  const az1 = outer.has('s') ? PERIMETER_INNER.s : z1;
  const lines: Record<Side, [[number, number], [number, number]]> = {
    n: [[ax0, at.n], [ax1, at.n]],
    s: [[ax0, at.s], [ax1, at.s]],
    w: [[at.w, az0], [at.w, az1]],
    e: [[at.e, az0], [at.e, az1]],
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
    runs.push(...cutDoors({ room, side, a, b, thick: outer.has(side) ? PERIMETER_T : WALL_T }, doors));
  }
  return runs;
}

/**
 * Walls closing the corridors where they reach the edge of the map, in line with the walls
 * of the rooms standing on that edge (which keep their own walls: nothing is doubled).
 */
export function edgeRuns(rooms: RoomDef[] = walledRooms()): WallRun[] {
  const runs: WallRun[] = [];
  for (const side of ['n', 's', 'w', 'e'] as Side[]) {
    // The thick outer wall, its outer face on the edge of the map.
    const at = PERIMETER_LINE[side];
    // It runs between the inner faces of the outer walls it meets; the map corners get a pillar.
    const [start, end] = side === 'n' || side === 's' ? [PERIMETER_INNER.w, PERIMETER_INNER.e] : [PERIMETER_INNER.n, PERIMETER_INNER.s];
    // Rooms on this edge draw their own stretch of the outer wall (same test as wallRuns).
    const covered = rooms
      .filter((r) => perimeterSides(r).has(side))
      .map((r) => edge(r, side))
      .map((e) => [e.lo + WALL_INSET, e.hi - WALL_INSET] as const)
      // The gate leaves the edge open from one room's wall line to the other's.
      .concat(side === GATE.side ? [[GATE.lo - WALL_INSET, GATE.hi + WALL_INSET] as const] : [])
      .sort((p, q) => p[0] - q[0]);
    let from = start;
    const point = (v: number): [number, number] => (side === 'n' || side === 's' ? [v, at] : [at, v]);
    for (const [lo, hi] of [...covered, [end, Infinity] as const]) {
      // The 0.3 m slot between two rooms standing side by side is closed by a pillar instead.
      if (lo - from > 0.5) runs.push({ side, a: point(from), b: point(Math.min(lo, end)), thick: PERIMETER_T });
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
  /** Ground footprint of every wall stretch and pillar: what the first-person view bumps into. */
  blockers: Box[];
}

/** An axis-aligned rectangle on the ground. */
export interface Box {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
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

/** How far in front of a wall's inner face nothing may stand for a torch or banner to hang there. */
const FREE_AHEAD = 0.6 - WALL_T / 2;

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
function wallIsFree(room: RoomDef, x: number, z: number, side: Side, thick = WALL_T): boolean {
  const [ix, iz] = INWARD[side];
  // Looked for in front of the wall's inner face, whatever its thickness.
  const ahead = thick / 2 + FREE_AHEAD;
  const rx = x + ix * ahead - room.cx;
  const rz = z + iz * ahead - room.cz;
  if (room.props.some((p) => inFootprint(p, rx, rz))) return false;
  // Not inside a zone drawn on the floor (the Scriptorium).
  return !ROOMS.some((zn) => zn.insideOf === room.id && Math.abs(x - zn.cx) < zn.w / 2 + 0.5 && Math.abs(z - zn.cz) < zn.d / 2 + 0.5);
}

const PILLAR_W = 0.3;

function pillar(layout: WallLayout, x: number, z: number, wx = PILLAR_W, wz = PILLAR_W, anchor: [number, number] = [x, z]): void {
  // A 1.5 m pillar thinned to 0.3 m, and a short column for the lowered state.
  addTall(layout, 'pillar', { x, y: 0, z, rotY: 0, scale: [wx / 1.5, KIT_SCALE, wz / 1.5], ax: anchor[0], az: anchor[1] });
  add(layout.low, 'column', { x, y: 0, z, rotY: 0, scale: [(wx / PILLAR_W) * 0.4, KIT_SCALE, (wz / PILLAR_W) * 0.4] });
  layout.blockers.push({ x0: x - wx / 2, x1: x + wx / 2, z0: z - wz / 2, z1: z + wz / 2 });
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
function hang(layout: WallLayout, h: WallHang, x: number, z: number, side: Side, thick: number): void {
  const [ix, iz] = INWARD[side];
  const s = (h.s ?? 1) * KIT_SCALE;
  const d = thick / 2 - (h.back ?? 0) * s;
  addTall(layout, tallKey(h.pack, h.name), { x: x + ix * d, y: h.y, z: z + iz * d, rotY: FACE_IN[side], scale: [s, s, s], ax: x, az: z });
}

/** Tall wall pieces, the low wall inside them, and torches, banners or hangs on plain stretches. */
function placeRun(layout: WallLayout, run: WallRun, rand: () => number): void {
  const { side, a, b, room } = run;
  const thick = run.thick ?? WALL_T;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.round(len / WALL_CHUNK));
  const chunk = len / n;
  // The whole run, as thick as its wall, from end to end.
  const horizontal = side === 'n' || side === 's';
  const [hx, hz] = horizontal ? [0, thick / 2] : [thick / 2, 0];
  layout.blockers.push({
    x0: Math.min(a[0], b[0]) - hx,
    x1: Math.max(a[0], b[0]) + hx,
    z0: Math.min(a[1], b[1]) - hz,
    z1: Math.max(a[1], b[1]) + hz,
  });
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = a[0] + (b[0] - a[0]) * t;
    const z = a[1] + (b[1] - a[1]) * t;
    const rotY = FACE_IN[side];
    const model = chunk < 1.5 ? 'wall' : pick(rand, room?.walls ?? WALL_VARIANTS);
    addTall(layout, model, { x, y: 0, z, rotY, scale: [chunk / 4, KIT_SCALE, thick], ax: x, az: z });
    // Slightly thinner than the tall wall, so that it hides inside it without flickering.
    add(layout.low, 'barrier', { x, y: 0, z, rotY, scale: [chunk / 4, KIT_SCALE, (thick - 0.03) / 0.5] });
    // Wall decor on plain stretches with nothing in front. A corridor end only gets a torch.
    if (model !== 'wall' || chunk < 2 || (room && !wallIsFree(room, x, z, side, thick))) continue;
    const [ix, iz] = INWARD[side];
    const roll = rand();
    if (roll < 0.45) {
      const d = thick / 2;
      addTall(layout, 'torch_mounted', { x: x + ix * d, y: 1.9, z: z + iz * d, rotY, ax: x, az: z });
    } else if (roll < 0.75 && room?.hangs?.length) {
      // The room's own wall pieces, in place of the banners.
      hang(layout, room.hangs[Math.floor(rand() * room.hangs.length)], x, z, side, thick);
    } else if (roll < 0.75 && room) {
      const style = BANNER_STYLES[Math.floor(rand() * BANNER_STYLES.length)];
      // The banner's back is 0.38 m in front of its origin in the pack.
      const d = thick / 2 - 0.38 * KIT_SCALE;
      addTall(layout, `banner_${style}${room.accent}`, { x: x + ix * d, y: 0, z: z + iz * d, rotY, ax: x, az: z });
    }
  }
}

/** Wide jambs of the castle gate. */
export const GATE_JAMB = 0.6;
/** Height of the gate opening, under the lintel. */
export const GATE_H = 2.2;

/**
 * The castle gate: two wide jambs on the room corners, a lintel over the opening and a torch
 * on each side facing the drawbridge. All of it goes down with the cutaway like a wall.
 */
function gate(layout: WallLayout): void {
  const z = PERIMETER_LINE.s;
  const lo = GATE.lo - WALL_INSET;
  const hi = GATE.hi + WALL_INSET;
  const mid = (lo + hi) / 2;
  // Every gate piece shares the anchor of the gate middle: the gate goes down as one piece.
  for (const x of [lo, hi]) pillar(layout, x, z + INWARD.s[1] * (PERIMETER_PILLAR_EXTRA / 2), GATE_JAMB, PERIMETER_T + PERIMETER_PILLAR_EXTRA, [mid, z]);
  // A wall model is 4 m high in the pack: squashed into a beam above the opening.
  const lintel = 4 * KIT_SCALE - GATE_H;
  addTall(layout, 'wall', { x: mid, y: GATE_H, z, rotY: FACE_IN.s, scale: [(hi - lo) / 4, lintel / 4, PERIMETER_T - 0.04], ax: mid, az: z });
  // Outside face: rotation 0 turns the torch towards +z, out of the castle.
  for (const x of [lo - 0.8, hi + 0.8]) {
    addTall(layout, 'torch_mounted', { x, y: 1.9, z: z + PERIMETER_T / 2, rotY: 0, ax: mid, az: z });
  }
}

let defaultLayout: WallLayout | undefined;

/**
 * The dungeon's walls, built once and shared, read-only: the rendered walls and the
 * first-person collisions must come from the same layout.
 */
export function dungeonWalls(): WallLayout {
  defaultLayout ??= wallLayout();
  return defaultLayout;
}

export function wallLayout(rooms: RoomDef[] = walledRooms()): WallLayout {
  const layout: WallLayout = { tall: new Map(), low: new Map(), blockers: [] };
  const edgeRand = seeded('walls:edge');
  for (const run of edgeRuns(rooms)) placeRun(layout, run, edgeRand);
  // A thick square pillar at each corner of the map, where two outer walls meet.
  for (const xs of ['w', 'e'] as Side[]) {
    for (const zs of ['n', 's'] as Side[]) pillar(layout, PERIMETER_LINE[xs], PERIMETER_LINE[zs], PERIMETER_T, PERIMETER_T);
  }
  gate(layout);
  for (const room of rooms) {
    const rand = seeded(`walls:${room.id}`);
    const shared = sharedSides(room, rooms);
    const outer = perimeterSides(room);
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
      // A corner on the map edge: the map corner pillar covers it when both sides are outer
      // walls; a slot between two rooms gets a pillar through the whole outer wall; otherwise
      // the pillar stands against the outer wall's inner face.
      const px = outer.has(xs);
      const pz = outer.has(zs);
      if (px && pz) continue;
      if (px) {
        if (shared.has(zs)) {
          x = PERIMETER_LINE[xs] + INWARD[xs][0] * (PERIMETER_PILLAR_EXTRA / 2);
          wx = PERIMETER_T + PERIMETER_PILLAR_EXTRA;
        } else x = PERIMETER_INNER[xs] + INWARD[xs][0] * (PILLAR_W / 2);
      }
      if (pz) {
        if (shared.has(xs)) {
          z = PERIMETER_LINE[zs] + INWARD[zs][1] * (PERIMETER_PILLAR_EXTRA / 2);
          wz = PERIMETER_T + PERIMETER_PILLAR_EXTRA;
        } else z = PERIMETER_INNER[zs] + INWARD[zs][1] * (PILLAR_W / 2);
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

/** How fast a tall piece goes down or up (per second, as a share of the remaining way). */
export const CUT_SPEED = 10;

/**
 * Next height of a piece lowered by the cutaway, from 0 (sunk) to 1 (standing): eases toward
 * `target`, snaps when close. NaN (first frame) jumps straight to the target, and so does
 * reduced motion.
 */
export function cutHeight(prev: number, target: number, dt: number, reduced: boolean): number {
  if (Number.isNaN(prev)) return target;
  const k = reduced ? 1 : Math.min(1, dt * CUT_SPEED);
  const h = prev + (target - prev) * k;
  return Math.abs(target - h) < 0.002 ? target : h;
}

/** Radius of a corner tower: small, a herald stands on it. */
export const TOWER_R = 0.8;
/** The tower centre sits this far outside the map corner, so its inner part stays inside the walls. */
export const TOWER_OFFSET = 0.2;
/** Height of the tower top (where the herald stands); the walls are 3 m high. */
export const TOWER_H = 3.8;
/** The shaft goes down below the ground, so a south tower rises out of the moat. */
export const TOWER_BASE = -1.2;

export interface Tower {
  x: number;
  z: number;
  /** Cutaway anchor: the map corner pillar's, so tower and pillar go down together. */
  ax: number;
  az: number;
  /** Heading (rotation around Y) of a figure on the tower looking into the castle courtyard. */
  facing: number;
}

/** The four little towers at the corners of the castle, where the herald sounds his trumpet. */
export const TOWERS: readonly Tower[] = (['n', 's'] as Side[]).flatMap((zs) =>
  (['w', 'e'] as Side[]).map((xs) => {
    const dx = xs === 'w' ? -1 : 1;
    const dz = zs === 'n' ? -1 : 1;
    return Object.freeze({
      x: (xs === 'w' ? OUTER.x0 : OUTER.x1) + dx * TOWER_OFFSET,
      z: (zs === 'n' ? OUTER.z0 : OUTER.z1) + dz * TOWER_OFFSET,
      ax: PERIMETER_LINE[xs],
      az: PERIMETER_LINE[zs],
      // KayKit characters face +Z at rotation 0. Facing inward, the north heralds face the default view.
      facing: Math.atan2(-dx, -dz),
    });
  }),
);
