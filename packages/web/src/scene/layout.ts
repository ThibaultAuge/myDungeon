import type { RoomId } from '@agent-office/shared';

// Dungeon floor plan, following the reference drawing in docs/lieux-et-personnages.md.
// Pure data and geometry, no three.js: the seat and route logic is testable in node.
//
// Five columns of rooms separated by 2 m corridors. x grows to the east, z to the south
// (the drawing's top is north, -z). Every room has one door opening onto a corridor; an
// agent going from one room to another walks out of its door, along the corridors and in
// through the other door, never through a wall.

export interface Point {
  x: number;
  z: number;
}

export interface Seat extends Point {
  /** Y rotation so the agent faces its bench, shelf or machine. */
  facing: number;
  /** First in the altar queue: kneels before the altar. */
  kneel?: boolean;
}

/** A seat placed in the dungeon, with the way to reach it from the corridors. */
export interface Spot extends Seat {
  /** Unique id: an agent keeps walking only when its spot changes. */
  id: string;
  /** Two spots in the same space are joined by a straight line. */
  space: string;
  /** Point on a corridor where the way in starts. */
  anchor: Point;
  /** Waypoints from the anchor to the seat, the seat excluded. */
  entry: Point[];
}

export type Side = 'n' | 's' | 'e' | 'w';

export type FloorKind = 'stone' | 'stoneFancy' | 'grate' | 'wood' | 'woodDark' | 'dirt';

/** The six colours of the KayKit banners. */
export type Accent = 'red' | 'blue' | 'green' | 'yellow' | 'white' | 'brown';

export type PropKind =
  | 'altar'
  | 'pew'
  | 'candles'
  | 'mapTable'
  | 'globe'
  | 'bench'
  | 'toolRack'
  | 'easel'
  | 'bookcase'
  | 'readingTable'
  | 'lectern'
  | 'telescope'
  | 'starTable'
  | 'aviary'
  | 'boiler'
  | 'engine'
  | 'abacus'
  | 'slate'
  | 'portcullis'
  | 'weaponRack'
  | 'lantern'
  | 'guardTable'
  | 'alchemyBench'
  | 'stage'
  | 'inspectionDesk'
  | 'couch'
  | 'diceTable'
  | 'posters'
  | 'brooms'
  | 'cart'
  | 'longTable'
  | 'fireplace'
  | 'barrel'
  | 'lockers'
  | 'rug'
  // Decoration: no seat of its own, but agents walk around it.
  | 'crates'
  | 'barrels'
  | 'chest'
  | 'coins'
  | 'candle';

export interface Prop {
  kind: PropKind;
  /** Position relative to the room centre. */
  x: number;
  z: number;
  /** Y rotation. */
  rot?: number;
}

export interface RoomDef {
  id: RoomId;
  /** Centre and size of the floor. */
  cx: number;
  cz: number;
  w: number;
  d: number;
  /** Material of the floor tiles. */
  floorKind: FloorKind;
  /** Colour of the room banners and rug. */
  accent: Accent;
  /** Wall holding the door, and the door's offset along that wall from its middle. */
  door: { side: Side; at: number };
  /** A zone inside another room (the Scriptorium): no walls, same door, same space. */
  insideOf?: RoomId;
  props: Prop[];
  /** Seats open to any agent, in order of preference. Relative to the room centre. */
  seats: Seat[];
  /** Seats of a dedicated post (the easel, the telescope…), keyed by station name. */
  stations?: Record<string, Seat[]>;
}

export const NORTH = Math.PI; // faces -z

/** Y rotation of an agent standing at (x, z) and looking at (tx, tz). Same convention as walking. */
export function faceTo(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}

/** Seats around a prop at (px, pz), at distance r, one per angle (0 = south of the prop). */
function around(px: number, pz: number, r: number, angles: number[]): Seat[] {
  return angles.map((a) => {
    const x = px + Math.sin(a) * r;
    const z = pz + Math.cos(a) * r;
    return { x, z, facing: faceTo(x, z, px, pz) };
  });
}

/** Seats in a row along x at depth z, all facing the same way. */
function row(z: number, xs: number[], facing: number): Seat[] {
  return xs.map((x) => ({ x, z, facing }));
}

const S = 0;
const W = -Math.PI / 2;
const E = Math.PI / 2;
const N = Math.PI;

export const ROOMS: RoomDef[] = [
  {
    id: 'observatoire',
    cx: -20,
    cz: -11,
    w: 8,
    d: 4,
    floorKind: 'woodDark',
    accent: 'blue',
    door: { side: 's', at: 0 },
    props: [
      { kind: 'candle', x: 3.4, z: 1.4 },
      { kind: 'telescope', x: 2.4, z: -0.7 },
      { kind: 'starTable', x: -2, z: -0.9 },
    ],
    stations: { lunette: around(2.4, -0.7, 1.1, [S, W + 0.4, E - 0.4]) },
    seats: [...row(0.1, [-2.8, -2, -1.2], N), ...around(2.4, -0.7, 1.1, [W - 0.2])],
  },
  {
    id: 'pigeonnier',
    cx: -10,
    cz: -11,
    w: 8,
    d: 4,
    floorKind: 'dirt',
    accent: 'white',
    door: { side: 's', at: 0 },
    props: [
      { kind: 'barrels', x: -2.8, z: 1.3 },
      { kind: 'aviary', x: -2.4, z: -1.1 },
      { kind: 'lectern', x: 2.2, z: -0.7, rot: 0 },
    ],
    seats: [...row(-0.1, [-3, -1.8], N), ...around(2.2, -0.7, 0.9, [S, W])],
  },
  {
    id: 'cartes',
    cx: -20,
    cz: -2.5,
    w: 8,
    d: 9,
    floorKind: 'wood',
    accent: 'yellow',
    door: { side: 'e', at: 0 },
    props: [
      { kind: 'chest', x: -3.1, z: -3.8 },
      { kind: 'mapTable', x: -0.6, z: -0.6 },
      { kind: 'globe', x: 2.6, z: -3.3 },
      { kind: 'rug', x: -0.6, z: -0.6 },
    ],
    seats: [
      ...row(-2, [-1.9, -0.6, 0.7], S),
      ...row(0.8, [-1.9, -0.6, 0.7], N),
      { x: -3.1, z: -0.6, facing: E },
      { x: 1.9, z: -0.6, facing: W },
      ...around(2.6, -3.3, 1, [S]),
      ...row(3.2, [-2.4, 1.2], N),
    ],
  },
  {
    id: 'biblio',
    cx: -10,
    cz: -2.5,
    w: 8,
    d: 9,
    floorKind: 'woodDark',
    accent: 'green',
    door: { side: 'e', at: 0 },
    props: [
      { kind: 'bookcase', x: -2.6, z: -4.1 },
      { kind: 'bookcase', x: 0, z: -4.1 },
      { kind: 'bookcase', x: 2.6, z: -4.1 },
      { kind: 'bookcase', x: -3.7, z: -1.6, rot: E },
      { kind: 'readingTable', x: 1.4, z: -0.9 },
      { kind: 'readingTable', x: 1.4, z: 2.6 },
    ],
    seats: [
      ...row(-3.2, [-2.6, 0, 2.6], N),
      ...row(-0.1, [0.9, 1.9], N),
      ...row(-1.7, [0.9, 1.9], S),
      ...row(1.8, [0.9, 1.9], S),
      ...row(3.4, [0.9, 1.9], N),
      { x: -2.9, z: -1.6, facing: W },
    ],
  },
  {
    // The copyists' corner, in the south-west of the library.
    id: 'scriptorium',
    cx: -12,
    cz: 0.25,
    w: 4,
    d: 3.5,
    floorKind: 'wood',
    accent: 'red',
    door: { side: 'e', at: 0 },
    insideOf: 'biblio',
    props: [
      { kind: 'rug', x: 0, z: 0 },
      { kind: 'lectern', x: -0.9, z: 0, rot: N },
      { kind: 'lectern', x: 0.9, z: 0, rot: N },
    ],
    stations: {
      ia: [{ x: -0.9, z: 0.8, facing: N }, { x: -0.9, z: -0.8, facing: S }],
      humains: [{ x: 0.9, z: 0.8, facing: N }, { x: 0.9, z: -0.8, facing: S }],
    },
    seats: [{ x: -1.6, z: 1.3, facing: N }, { x: 1.6, z: 1.3, facing: N }],
  },
  {
    id: 'atelier',
    cx: 0,
    cz: -8.75,
    w: 8,
    d: 8.5,
    floorKind: 'stoneFancy',
    accent: 'brown',
    door: { side: 's', at: 0 },
    props: [
      { kind: 'crates', x: 3.2, z: 3.4 },
      { kind: 'bench', x: -2, z: -2.4 },
      { kind: 'bench', x: 2, z: -2.4 },
      { kind: 'bench', x: -2, z: 0.6 },
      { kind: 'bench', x: 2, z: 0.6 },
      { kind: 'toolRack', x: 0, z: -4 },
      { kind: 'easel', x: -3.1, z: 3.3, rot: N },
    ],
    stations: { chevalet: [{ x: -3.1, z: 2.4, facing: S }, { x: -2.2, z: 2.6, facing: faceTo(-2.2, 2.6, -3.1, 3.3) }] },
    seats: [
      ...row(-1.6, [-2.5, -1.5, 1.5, 2.5], N),
      ...row(1.4, [-2.5, -1.5, 1.5, 2.5], N),
      ...row(-3.2, [-2.5, -1.5, 1.5, 2.5], S),
      ...row(-0.2, [-2.5, -1.5, 1.5, 2.5], S),
    ],
  },
  {
    id: 'autel',
    cx: 0,
    cz: -0.25,
    w: 8,
    d: 4.5,
    floorKind: 'stone',
    accent: 'red',
    door: { side: 's', at: 0 },
    props: [
      { kind: 'altar', x: 0, z: -1.65 },
      { kind: 'candles', x: -1.1, z: -1.8 },
      { kind: 'candles', x: 1.1, z: -1.8 },
      { kind: 'pew', x: -2.5, z: -0.1 },
      { kind: 'pew', x: 2.5, z: -0.1 },
      { kind: 'pew', x: -2.5, z: 1.2 },
      { kind: 'pew', x: 2.5, z: 1.2 },
    ],
    stations: { sacristain: [{ x: 1.9, z: -1.4, facing: faceTo(1.9, -1.4, 0, -1.65) }] },
    seats: [
      { x: -1.9, z: -1.4, facing: faceTo(-1.9, -1.4, 0, -1.65) },
      { x: 3.1, z: -1.4, facing: W },
      { x: -3.1, z: -1.4, facing: E },
    ],
  },
  {
    id: 'machines',
    cx: 10,
    cz: -10.75,
    w: 8,
    d: 4.5,
    floorKind: 'grate',
    accent: 'brown',
    door: { side: 's', at: 0 },
    props: [
      { kind: 'crates', x: 3.2, z: 1.4 },
      { kind: 'boiler', x: -2.7, z: -1 },
      { kind: 'engine', x: 0.2, z: -1.3 },
      { kind: 'engine', x: 2.7, z: -1.3 },
    ],
    seats: row(0.2, [-2.7, -1.8, 0.2, 1.1, 2.7, 3.4], N),
  },
  {
    id: 'arithmetique',
    cx: 10,
    cz: -4.25,
    w: 8,
    d: 4.5,
    floorKind: 'stone',
    accent: 'yellow',
    door: { side: 's', at: 0 },
    props: [
      { kind: 'coins', x: 3.3, z: 1.6 },
      { kind: 'abacus', x: -1.8, z: -1.4 },
      { kind: 'slate', x: 1.9, z: -2 },
    ],
    stations: { boulier: row(-0.4, [-1.8, -0.8], N) },
    seats: [...row(-0.9, [1.4, 2.6], N), ...row(-0.4, [-2.8], N)],
  },
  {
    id: 'detente',
    cx: 10,
    cz: 2.25,
    w: 8,
    d: 4.5,
    floorKind: 'wood',
    accent: 'red',
    door: { side: 's', at: 0 },
    props: [
      { kind: 'couch', x: -2.3, z: -1.5 },
      { kind: 'diceTable', x: 1.6, z: -0.2 },
      { kind: 'posters', x: 1.6, z: -2.15 },
    ],
    seats: [...row(-0.9, [-3, -1.6], S), ...around(1.6, -0.2, 1, [W, E, N])],
  },
  {
    id: 'concierge',
    cx: 10,
    cz: 8.25,
    w: 8,
    d: 3.5,
    floorKind: 'dirt',
    accent: 'brown',
    door: { side: 'w', at: 0 },
    props: [
      { kind: 'brooms', x: 2.8, z: -1.3 },
      { kind: 'cart', x: 0.8, z: 0.6 },
      { kind: 'barrel', x: 3.2, z: 1 },
    ],
    seats: [
      { x: 2, z: -0.7, facing: faceTo(2, -0.7, 2.8, -1.3) },
      { x: 0.8, z: -0.4, facing: S },
      { x: -1, z: 0.6, facing: E },
    ],
  },
  {
    id: 'garde',
    cx: -19.5,
    cz: 7,
    w: 9,
    d: 6,
    floorKind: 'stone',
    accent: 'blue',
    door: { side: 'n', at: 0 },
    props: [
      { kind: 'crates', x: -3.5, z: 2.2 },
      { kind: 'portcullis', x: -4.4, z: 0.4, rot: E },
      { kind: 'weaponRack', x: 1.8, z: 2.7 },
      { kind: 'lantern', x: -3.4, z: -2.2 },
      { kind: 'lantern', x: 3.4, z: -2.2 },
      { kind: 'guardTable', x: 0, z: 0.4 },
    ],
    seats: [
      ...around(0, 0.4, 1.1, [N, S, W, E]),
      { x: -3.4, z: 0.4, facing: W },
      ...row(1.9, [1.8], S),
    ],
  },
  {
    id: 'epreuves',
    cx: -9.5,
    cz: 7,
    w: 11,
    d: 6,
    floorKind: 'stone',
    accent: 'green',
    door: { side: 'n', at: 0 },
    props: [
      { kind: 'barrels', x: -4.6, z: -2.2 },
      { kind: 'readingTable', x: -2.6, z: 0.6 },
      { kind: 'alchemyBench', x: 2.8, z: 2.4 },
    ],
    stations: {
      relecture: [...row(-0.2, [-3.1, -2.1], S), ...row(1.4, [-3.1, -2.1], N)],
      labo: row(1.5, [2, 3, 4], S),
    },
    seats: [...row(-1.6, [-1, 1, 3.4], S), ...row(1.5, [0.6], E)],
  },
  {
    id: 'heraut',
    cx: 0,
    cz: 7,
    w: 8,
    d: 6,
    floorKind: 'wood',
    accent: 'yellow',
    door: { side: 'n', at: -2.4 },
    props: [
      { kind: 'chest', x: 3.3, z: 2.35 },
      { kind: 'stage', x: -1.6, z: 1.6 },
      { kind: 'inspectionDesk', x: 2.2, z: 0.6 },
    ],
    stations: {
      estrade: [{ x: -1.6, z: 1.6, facing: N }, { x: -2.6, z: 1.6, facing: N }, { x: -0.6, z: 1.6, facing: N }],
      inspection: [{ x: 2.2, z: -0.3, facing: S }, { x: 1.4, z: 1.5, facing: N }, { x: 3, z: 1.5, facing: N }],
    },
    seats: row(-1.8, [0.6, 2.2, 3.2], S),
  },
  {
    id: 'taverne',
    cx: 19.5,
    cz: -1.5,
    w: 7,
    d: 23,
    floorKind: 'wood',
    accent: 'red',
    door: { side: 'w', at: 0 },
    props: [
      { kind: 'crates', x: -2.7, z: -10.6 },
      { kind: 'fireplace', x: 0, z: -11 },
      { kind: 'longTable', x: 0.6, z: -6.5 },
      { kind: 'longTable', x: 0.6, z: -1 },
      { kind: 'longTable', x: 0.6, z: 4.5 },
      { kind: 'barrel', x: 2.8, z: -9 },
      { kind: 'barrel', x: 2.8, z: -8.1 },
      { kind: 'barrel', x: -2.8, z: -9.4 },
      { kind: 'lockers', x: 3.1, z: 9 },
    ],
    seats: [-6.5, -1, 4.5].flatMap((tz) => [
      ...[-1.2, 0, 1.2].map((dz) => ({ x: -0.4, z: tz + dz, facing: E })),
      ...[-1.2, 0, 1.2].map((dz) => ({ x: 1.6, z: tz + dz, facing: W })),
    ]),
  },
];

export const ROOM_BY_ID = new Map(ROOMS.map((r) => [r.id, r]));

/** Outer bounds of the dungeon, corridors included. */
export const BOUNDS = { x0: -24, x1: 23, z0: -13, z1: 10 };

/**
 * Corridor centre lines. A corridor is 2 m wide and runs between two rows or columns of
 * rooms; every door opens 1 m away from one of these lines.
 */
export const CORRIDORS: [Point, Point][] = [
  [{ x: -15, z: -12.5 }, { x: -15, z: 3 }],
  [{ x: -5, z: -12.5 }, { x: -5, z: 3 }],
  [{ x: 5, z: -12.5 }, { x: 5, z: 9.5 }],
  [{ x: 15, z: -12.5 }, { x: 15, z: 9.5 }],
  [{ x: -23.5, z: -8 }, { x: -5, z: -8 }],
  [{ x: -23.5, z: 3 }, { x: 5, z: 3 }],
  [{ x: -5, z: -3.5 }, { x: 5, z: -3.5 }],
  [{ x: 5, z: -7.5 }, { x: 15, z: -7.5 }],
  [{ x: 5, z: -1 }, { x: 15, z: -1 }],
  [{ x: 5, z: 5.5 }, { x: 15, z: 5.5 }],
];

const DOOR_INSET = 0.8;

/** The door of a room: a point just inside, and the point on the corridor in front of it. */
export function doorOf(room: RoomDef): { inside: Point; outside: Point; wall: Point } {
  const r = room.insideOf ? ROOM_BY_ID.get(room.insideOf)! : room;
  const { side, at } = r.door;
  const hw = r.w / 2;
  const hd = r.d / 2;
  const dir = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[side];
  const wall =
    side === 'n' || side === 's' ? { x: r.cx + at, z: r.cz + dir[1] * hd } : { x: r.cx + dir[0] * hw, z: r.cz + at };
  return {
    wall,
    inside: { x: wall.x - dir[0] * DOOR_INSET, z: wall.z - dir[1] * DOOR_INSET },
    outside: { x: wall.x + dir[0], z: wall.z + dir[1] },
  };
}

function spaceOf(room: RoomDef): string {
  return room.insideOf ?? room.id;
}

function toSpot(room: RoomDef, seat: Seat, id: string): Spot {
  const door = doorOf(room);
  return {
    ...seat,
    x: room.cx + seat.x,
    z: room.cz + seat.z,
    id,
    space: spaceOf(room),
    anchor: door.outside,
    entry: [door.inside],
  };
}

const WALL_SEAT_STEP = 1;
const WALL_SEAT_MARGIN = 0.6;

/** Rooms are static: their wall seats are computed once. */
const wallSeatsCache = new WeakMap<RoomDef, readonly Seat[]>();

/** Standing places along the inner walls, facing the room centre, the door left clear. Shared, read-only. */
export function wallSeats(room: RoomDef): readonly Seat[] {
  let seats = wallSeatsCache.get(room);
  if (!seats) {
    seats = computeWallSeats(room);
    wallSeatsCache.set(room, seats);
  }
  return seats;
}

function computeWallSeats(room: RoomDef): Seat[] {
  // The Scriptorium is a corner of the library: its overflow goes to the library walls.
  if (room.insideOf) return [];
  const hw = room.w / 2 - WALL_SEAT_MARGIN;
  const hd = room.d / 2 - WALL_SEAT_MARGIN;
  const door = doorOf(room);
  const zones = ROOMS.filter((r) => r.insideOf === room.id);
  const taken = [...room.seats, ...Object.values(room.stations ?? {}).flat()];
  const out: Seat[] = [];
  const push = (x: number, z: number) => {
    const gx = room.cx + x;
    const gz = room.cz + z;
    if (Math.hypot(gx - door.inside.x, gz - door.inside.z) < 1.2) return;
    // Never inside furniture, on top of a seat, or inside a nested zone.
    if (room.props.some((p) => inFootprint(p, x, z))) return;
    if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < MIN_SEAT_GAP)) return;
    if (zones.some((zn) => Math.abs(gx - zn.cx) < zn.w / 2 + 0.4 && Math.abs(gz - zn.cz) < zn.d / 2 + 0.4)) return;
    out.push({ x, z, facing: faceTo(x, z, 0, 0) });
  };
  for (let x = -hw; x <= hw + 1e-6; x += WALL_SEAT_STEP) {
    push(x, -hd);
    push(x, hd);
  }
  for (let z = -hd + WALL_SEAT_STEP; z <= hd - WALL_SEAT_STEP + 1e-6; z += WALL_SEAT_STEP) {
    push(-hw, z);
    push(hw, z);
  }
  return out;
}

/** Minimum distance between two standing places: a figure is 0.64 m wide. */
export const MIN_SEAT_GAP = 0.75;

// Half extents (x, z) of each prop's footprint, before rotation. Rugs can be walked on.
const FOOTPRINTS: Record<PropKind, [number, number]> = {
  altar: [0.9, 0.35],
  pew: [1.1, 0.25],
  candles: [0.2, 0.2],
  mapTable: [2, 1.1],
  globe: [0.45, 0.45],
  bench: [1, 0.5],
  toolRack: [1.7, 0.1],
  easel: [0.5, 0.3],
  bookcase: [1.1, 0.25],
  readingTable: [0.9, 0.5],
  lectern: [0.35, 0.25],
  telescope: [0.4, 0.6],
  starTable: [1.1, 0.5],
  aviary: [1.3, 0.6],
  boiler: [0.8, 0.8],
  engine: [0.8, 0.5],
  abacus: [1.25, 0.15],
  slate: [1.4, 0.1],
  portcullis: [1.3, 0.1],
  weaponRack: [1, 0.15],
  lantern: [0.15, 0.15],
  guardTable: [0.6, 0.6],
  alchemyBench: [1.7, 0.45],
  stage: [1.3, 1.3],
  inspectionDesk: [0.7, 0.4],
  couch: [1.4, 0.45],
  diceTable: [0.6, 0.6],
  posters: [1.2, 0.05],
  brooms: [0.4, 0.1],
  cart: [0.5, 0.3],
  longTable: [0.6, 2],
  fireplace: [1.5, 0.4],
  barrel: [0.4, 0.4],
  lockers: [0.25, 1.6],
  rug: [0, 0],
  crates: [0.6, 0.6],
  barrels: [0.8, 0.4],
  chest: [0.5, 0.45],
  coins: [0.3, 0.3],
  candle: [0.12, 0.12],
};

/** True when (x, z), relative to the room centre, stands on the prop (plus a body's half width). */
export function inFootprint(prop: Prop, x: number, z: number): boolean {
  const [fx, fz] = FOOTPRINTS[prop.kind];
  if (fx === 0 && fz === 0) return false;
  const quarter = Math.abs(Math.sin(prop.rot ?? 0)) > 0.7;
  const [hx, hz] = quarter ? [fz, fx] : [fx, fz];
  return Math.abs(x - prop.x) < hx + 0.35 && Math.abs(z - prop.z) < hz + 0.35;
}

/** Last resort when every seat is taken: a spot near the room centre, offset pseudo-randomly. */
function scatterSeat(room: RoomDef, n: number): Seat {
  const angle = n * 2.39996; // golden angle: successive spots never line up
  const radius = Math.min(room.w, room.d) * 0.3 * Math.sqrt(((n % 12) + 1) / 12);
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  return { x, z, facing: faceTo(x, z, 0, 0) };
}

// Agent types that have a dedicated post inside their room. Keys are lower case.
const STATIONS: Record<string, string> = {
  oracle: 'lunette',
  barbapapa: 'chevalet',
  hermione: 'relecture',
  dexter: 'labo',
  gatsby: 'estrade',
  timmy: 'inspection',
  curator: 'ia',
  otis: 'humains',
  turing: 'boulier',
  'claude-code-guide': 'sacristain',
};

/** Candidate lists by room, then by station ('' for none). */
const candidatesCache = new WeakMap<RoomDef, Map<string, readonly { id: string; seat: Seat }[]>>();

/**
 * Seats an agent may take in a room, in order of preference: its own post, the shared
 * seats, then the standing places along the walls. Each comes with a stable id.
 */
export function candidateSeats(room: RoomDef, agentType: string): readonly { id: string; seat: Seat }[] {
  const key = agentType.toLowerCase();
  const station = Object.hasOwn(STATIONS, key) ? STATIONS[key] : undefined;
  // Cached by station, not by type: the types come from the server, the stations are few.
  let byStation = candidatesCache.get(room);
  if (!byStation) {
    byStation = new Map();
    candidatesCache.set(room, byStation);
  }
  const cacheKey = station ?? '';
  let list = byStation.get(cacheKey);
  if (!list) {
    list = computeCandidates(room, station);
    byStation.set(cacheKey, list);
  }
  return list;
}

function computeCandidates(room: RoomDef, station: string | undefined): { id: string; seat: Seat }[] {
  const own = station ? (room.stations?.[station] ?? []) : [];
  return [
    ...own.map((seat, i) => ({ id: `${room.id}:${station}:${i}`, seat })),
    ...room.seats.map((seat, i) => ({ id: `${room.id}:seat:${i}`, seat })),
    ...wallSeats(room).map((seat, i) => ({ id: `${room.id}:wall:${i}`, seat })),
  ];
}

// ---------------------------------------------------------------- altar queue

const ALTAR_ROOM = ROOM_BY_ID.get('autel')!;
const QUEUE_STEP = 0.9;

/**
 * The queue's path: from the kneeling place up the aisle, out of the nave's door, then
 * around the nave along the corridors, then west along the southern corridor.
 */
export const QUEUE_PATH: Point[] = [
  { x: 0, z: -1.15 },
  { x: 0, z: 1.75 },
  { x: 0, z: 3 },
  { x: 5, z: 3 },
  { x: 5, z: -3.5 },
  { x: -5, z: -3.5 },
  { x: -5, z: 3 },
  { x: -23, z: 3 },
];

function onCorridor(p: Point): boolean {
  return CORRIDORS.some(([a, b]) => onSegment(p, a, b));
}

/** The `rank`-th place in the queue (0 kneels at the altar), facing the one before it. */
export function queueSpot(rank: number): Spot {
  let remaining = rank * QUEUE_STEP;
  for (let i = 0; i < QUEUE_PATH.length - 1; i++) {
    const a = QUEUE_PATH[i];
    const b = QUEUE_PATH[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (remaining <= len || i === QUEUE_PATH.length - 2) {
      const t = Math.min(remaining / len, 1);
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const id = `queue:${rank}`;
      // Looks back along the path, towards the altar.
      const facing = rank === 0 ? NORTH : faceTo(x, z, a.x, a.z);
      const door = doorOf(ALTAR_ROOM);
      if (i === 0) {
        return { id, x, z, facing, kneel: rank === 0, space: 'autel', anchor: door.outside, entry: [door.inside] };
      }
      // In the corridor: its own space, reached along the corridors. In the doorway: from the door.
      const anchor = onCorridor({ x, z }) ? { x, z } : door.outside;
      return { id, x, z, facing, space: id, anchor, entry: [] };
    }
    remaining -= len;
  }
  throw new Error('unreachable');
}

// ---------------------------------------------------------------- seat assignment

export interface SeatRequest {
  id: string;
  room: RoomId;
  agentType: string;
  /** Waiting agents at the altar queue up instead of taking a seat. */
  queued: boolean;
  /** Queue order: the oldest wait comes first. */
  since: number;
}

/** Seat each agent keeps while it stays in the same room. */
export type SeatMemory = Map<string, { room: RoomId; seatId: string }>;

/**
 * Gives every agent a spot. An agent keeps its seat while it stays in a room, so it does
 * not jump from seat to seat at each event; a newcomer takes the first free seat of its
 * candidates. Agents queued at the altar are ranked by the time they started waiting.
 */
export function assignSpots(agents: SeatRequest[], memory: SeatMemory): Map<string, Spot> {
  const spots = new Map<string, Spot>();
  const ids = new Set(agents.map((a) => a.id));
  for (const id of memory.keys()) if (!ids.has(id)) memory.delete(id);

  const queue = agents.filter((a) => a.queued).sort((a, b) => a.since - b.since || a.id.localeCompare(b.id));
  queue.forEach((a, rank) => {
    memory.delete(a.id);
    spots.set(a.id, queueSpot(rank));
  });

  const seated = agents.filter((a) => !a.queued);
  const taken = new Set<string>();
  const keep = new Set<string>();
  for (const a of seated) {
    const m = memory.get(a.id);
    if (m && m.room === a.room && !taken.has(m.seatId)) {
      taken.add(m.seatId);
      keep.add(a.id);
    }
  }
  const scatterCount = new Map<RoomId, number>();
  for (const a of seated) {
    const room = ROOM_BY_ID.get(a.room) ?? ALTAR_ROOM;
    const candidates = candidateSeats(room, a.agentType);
    if (keep.has(a.id)) {
      const seatId = memory.get(a.id)!.seatId;
      const found = candidates.find((c) => c.id === seatId);
      if (found) {
        spots.set(a.id, toSpot(room, found.seat, seatId));
        continue;
      }
      if (seatId.startsWith(`${room.id}:scatter:`)) {
        const n = Number(seatId.slice(`${room.id}:scatter:`.length));
        spots.set(a.id, toSpot(room, scatterSeat(room, n), seatId));
        continue;
      }
    }
    let pick = candidates.find((c) => !taken.has(c.id));
    if (!pick) {
      let n = scatterCount.get(room.id) ?? 0;
      while (taken.has(`${room.id}:scatter:${n}`)) n++;
      scatterCount.set(room.id, n + 1);
      pick = { id: `${room.id}:scatter:${n}`, seat: scatterSeat(room, n) };
    }
    taken.add(pick.id);
    memory.set(a.id, { room: room.id, seatId: pick.id });
    spots.set(a.id, toSpot(room, pick.seat, pick.id));
  }
  return spots;
}

// ---------------------------------------------------------------- routes

/** Lockers at the back of the tavern, where new subagents come out from. */
export const SPAWN: Spot = (() => {
  const tavern = ROOM_BY_ID.get('taverne')!;
  return toSpot(tavern, { x: 2.4, z: 9, facing: W }, 'spawn');
})();

const EPS = 1e-6;

function onSegment(p: Point, a: Point, b: Point): boolean {
  const cross = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
  if (Math.abs(cross) > 1e-3) return false;
  return (
    p.x >= Math.min(a.x, b.x) - 1e-3 &&
    p.x <= Math.max(a.x, b.x) + 1e-3 &&
    p.z >= Math.min(a.z, b.z) - 1e-3 &&
    p.z <= Math.max(a.z, b.z) + 1e-3
  );
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.z - b.z) < 1e-3;
}

/** Intersections of axis-aligned corridors (all of them are horizontal or vertical). */
const JUNCTIONS: Point[] = (() => {
  const out: Point[] = [];
  for (const [a, b] of CORRIDORS) {
    out.push(a, b);
    for (const [c, d] of CORRIDORS) {
      const vertical = Math.abs(a.x - b.x) < EPS;
      const otherHorizontal = Math.abs(c.z - d.z) < EPS;
      if (!vertical || !otherHorizontal) continue;
      const p = { x: a.x, z: c.z };
      if (onSegment(p, a, b) && onSegment(p, c, d)) out.push(p);
    }
  }
  return out;
})();

/**
 * Shortest way along the corridors from `from` to `to`, both lying on a corridor.
 * Returns the turning points after `from`, ending with `to`. A point off every corridor
 * gets a straight line, so a broken layout never freezes an agent.
 */
export function corridorPath(from: Point, to: Point): Point[] {
  const nodes: Point[] = [from, to];
  for (const p of JUNCTIONS) if (!nodes.some((n) => samePoint(n, p))) nodes.push(p);
  const adj: number[][] = nodes.map(() => []);
  for (const [a, b] of CORRIDORS) {
    const on = nodes.map((p, i) => [p, i] as const).filter(([p]) => onSegment(p, a, b));
    const key = (p: Point) => (Math.abs(a.x - b.x) < EPS ? p.z : p.x);
    on.sort((u, v) => key(u[0]) - key(v[0]));
    for (let k = 1; k < on.length; k++) {
      adj[on[k - 1][1]].push(on[k][1]);
      adj[on[k][1]].push(on[k - 1][1]);
    }
  }
  const dist = nodes.map(() => Infinity);
  const prev = nodes.map(() => -1);
  const done = nodes.map(() => false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || u === 1) break;
    done[u] = true;
    for (const v of adj[u]) {
      const d = dist[u] + Math.hypot(nodes[u].x - nodes[v].x, nodes[u].z - nodes[v].z);
      if (d < dist[v]) {
        dist[v] = d;
        prev[v] = u;
      }
    }
  }
  if (dist[1] === Infinity) return [to];
  const path: Point[] = [];
  for (let i = 1; i !== 0; i = prev[i]) path.unshift(nodes[i]);
  return path;
}

/**
 * New waypoints for an agent that gets a new spot while it may still be walking.
 * `remaining` is what is left of its current route towards `from`. The agent keeps going
 * to the next corridor point of that route, then takes the corridors to the new spot; if
 * no corridor point is left, it is already inside `from`'s space and leaves from there.
 */
export function reroute(remaining: Point[], from: Spot, to: Spot): Point[] {
  const k = remaining.findIndex(onCorridor);
  if (k < 0) return routeBetween(from, to);
  const corner = remaining[k];
  const points = [...remaining.slice(0, k + 1), ...corridorPath(corner, to.anchor), ...to.entry, { x: to.x, z: to.z }];
  return points.filter((p, i) => i === 0 || !samePoint(p, points[i - 1]));
}

/** Waypoints from one spot to another: out of the door, along the corridors, in through the other door. */
export function routeBetween(from: Spot, to: Spot): Point[] {
  if (from.space === to.space) return [{ x: to.x, z: to.z }];
  const points: Point[] = [
    ...[...from.entry].reverse(),
    from.anchor,
    ...corridorPath(from.anchor, to.anchor),
    ...to.entry,
    { x: to.x, z: to.z },
  ];
  return points.filter((p, i) => i === 0 || !samePoint(p, points[i - 1]));
}
