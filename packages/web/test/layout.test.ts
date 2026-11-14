import { describe, expect, it } from 'vitest';
import type { RoomId } from '@agent-office/shared';
import {
  BOUNDS,
  CORRIDORS,
  NORTH,
  QUEUE_PATH,
  ROOMS,
  ROOM_BY_ID,
  SPAWN,
  assignSpots,
  candidateSeats,
  corridorPath,
  doorOf,
  inFootprint,
  MIN_SEAT_GAP,
  reroute,
  queueSpot,
  routeBetween,
  wallSeats,
  type Point,
  type RoomDef,
  type SeatMemory,
  type SeatRequest,
  type Spot,
  type StationId,
  type Candidate,
} from '../src/scene/layout.ts';

const TOL = 1e-3;

/** The 15 places of the dungeon, as listed by RoomId. */
const ALL_ROOM_IDS: RoomId[] = [
  'autel',
  'cartes',
  'atelier',
  'biblio',
  'scriptorium',
  'observatoire',
  'pigeonnier',
  'machines',
  'arithmetique',
  'garde',
  'epreuves',
  'heraut',
  'detente',
  'concierge',
  'taverne',
];

function room(id: RoomId): RoomDef {
  const r = ROOM_BY_ID.get(id);
  if (!r) throw new Error(`missing room ${id}`);
  return r;
}

function rect(r: RoomDef) {
  return { x0: r.cx - r.w / 2, x1: r.cx + r.w / 2, z0: r.cz - r.d / 2, z1: r.cz + r.d / 2 };
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < TOL && Math.abs(a.z - b.z) < TOL;
}

/** Independent check: every corridor is axis-aligned, so a point lies on it when it shares the axis. */
function onCorridorSegment(p: Point, [a, b]: [Point, Point]): boolean {
  if (Math.abs(a.x - b.x) < TOL) {
    return Math.abs(p.x - a.x) < TOL && p.z >= Math.min(a.z, b.z) - TOL && p.z <= Math.max(a.z, b.z) + TOL;
  }
  return Math.abs(p.z - a.z) < TOL && p.x >= Math.min(a.x, b.x) - TOL && p.x <= Math.max(a.x, b.x) + TOL;
}

function onAnyCorridor(p: Point): boolean {
  return CORRIDORS.some((c) => onCorridorSegment(p, c));
}

function axisAligned(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < TOL || Math.abs(a.z - b.z) < TOL;
}

function pathLength(from: Point, points: Point[]): number {
  let len = 0;
  let prev = from;
  for (const p of points) {
    len += Math.hypot(p.x - prev.x, p.z - prev.z);
    prev = p;
  }
  return len;
}

function req(id: string, roomId: RoomId, extra: Partial<SeatRequest> = {}): SeatRequest {
  return { id, room: roomId, agentType: 'general-purpose', queued: false, since: 0, ...extra };
}

function queued(id: string, since: number): SeatRequest {
  return req(id, 'autel', { queued: true, since });
}

/** The spot a lone generic agent gets in a room. */
function spotIn(roomId: RoomId, agentType = 'general-purpose'): Spot {
  return assignSpots([req('solo', roomId, { agentType })], new Map()).get('solo')!;
}

describe('ROOMS', () => {
  /**
   * Verifies that the floor plan defines each RoomId exactly once (names: see i18n.test.ts)
   */
  it('lists every room id exactly once', () => {
    const ids = ROOMS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...ALL_ROOM_IDS].sort());
    for (const id of ALL_ROOM_IDS) {
      expect(ROOM_BY_ID.get(id)?.id).toBe(id);
    }
  });

  /**
   * Verifies that every room lies inside the dungeon bounds
   */
  it.each(ROOMS.map((r) => [r.id, r] as const))('%s lies inside BOUNDS', (_id, r) => {
    const b = rect(r);
    expect(b.x0).toBeGreaterThanOrEqual(BOUNDS.x0 - TOL);
    expect(b.x1).toBeLessThanOrEqual(BOUNDS.x1 + TOL);
    expect(b.z0).toBeGreaterThanOrEqual(BOUNDS.z0 - TOL);
    expect(b.z1).toBeLessThanOrEqual(BOUNDS.z1 + TOL);
  });

  /**
   * Verifies that the door of every room opens onto a corridor centre line
   */
  it.each(ROOMS.map((r) => [r.id, r] as const))("%s door's outside point is on a corridor", (_id, r) => {
    expect(onAnyCorridor(doorOf(r).outside)).toBe(true);
  });

  /**
   * Verifies that a door's inside point is within its room and its wall point on the room edge
   */
  it.each(ROOMS.filter((r) => !r.insideOf).map((r) => [r.id, r] as const))(
    '%s door inside point is in the room, wall point on its edge',
    (_id, r) => {
      const b = rect(r);
      const { inside, wall } = doorOf(r);
      expect(inside.x).toBeGreaterThan(b.x0);
      expect(inside.x).toBeLessThan(b.x1);
      expect(inside.z).toBeGreaterThan(b.z0);
      expect(inside.z).toBeLessThan(b.z1);
      const onEdge =
        Math.abs(wall.x - b.x0) < TOL || Math.abs(wall.x - b.x1) < TOL || Math.abs(wall.z - b.z0) < TOL || Math.abs(wall.z - b.z1) < TOL;
      expect(onEdge).toBe(true);
    },
  );

  /**
   * Verifies that a nested zone (the Scriptorium) shares its host room's door
   */
  it('gives the scriptorium the door of the library it sits in', () => {
    expect(room('scriptorium').insideOf).toBe('biblio');
    expect(doorOf(room('scriptorium'))).toEqual(doorOf(room('biblio')));
  });

  /**
   * Verifies that a nested zone lies fully inside its host room
   */
  it('keeps nested rooms inside their host room', () => {
    for (const r of ROOMS.filter((x) => x.insideOf)) {
      const inner = rect(r);
      const outer = rect(room(r.insideOf!));
      expect(inner.x0).toBeGreaterThanOrEqual(outer.x0 - TOL);
      expect(inner.x1).toBeLessThanOrEqual(outer.x1 + TOL);
      expect(inner.z0).toBeGreaterThanOrEqual(outer.z0 - TOL);
      expect(inner.z1).toBeLessThanOrEqual(outer.z1 + TOL);
    }
  });

  /**
   * Verifies that every shared seat and station seat lies inside its room rectangle
   */
  it.each(ROOMS.map((r) => [r.id, r] as const))('%s seats and stations lie inside the room', (_id, r) => {
    const seats = [...r.seats, ...Object.values(r.stations ?? {}).flat()];
    expect(seats.length).toBeGreaterThan(0);
    for (const s of seats) {
      expect(Math.abs(s.x)).toBeLessThanOrEqual(r.w / 2 + TOL);
      expect(Math.abs(s.z)).toBeLessThanOrEqual(r.d / 2 + TOL);
    }
  });

  /**
   * Verifies that no two non-nested rooms overlap (touching walls are allowed)
   */
  it('has no overlapping rooms apart from nested zones', () => {
    const flat = ROOMS.filter((r) => !r.insideOf);
    const overlaps: string[] = [];
    for (let i = 0; i < flat.length; i++) {
      for (let j = i + 1; j < flat.length; j++) {
        const a = rect(flat[i]);
        const b = rect(flat[j]);
        const ox = a.x0 < b.x1 - TOL && b.x0 < a.x1 - TOL;
        const oz = a.z0 < b.z1 - TOL && b.z0 < a.z1 - TOL;
        if (ox && oz) overlaps.push(`${flat[i].id}/${flat[j].id}`);
      }
    }
    expect(overlaps).toEqual([]);
  });

  /**
   * Verifies that no corridor centre line crosses the interior of any room
   */
  it('has no corridor passing through a room', () => {
    const crossings: string[] = [];
    for (const [a, b] of CORRIDORS) {
      const sx0 = Math.min(a.x, b.x);
      const sx1 = Math.max(a.x, b.x);
      const sz0 = Math.min(a.z, b.z);
      const sz1 = Math.max(a.z, b.z);
      for (const r of ROOMS) {
        const box = rect(r);
        // A degenerate (zero-width) segment intersects the open box when it lies strictly within
        // the box on its fixed axis and overlaps it on the other one.
        const inX = sx0 === sx1 ? sx0 > box.x0 + TOL && sx0 < box.x1 - TOL : sx0 < box.x1 - TOL && sx1 > box.x0 + TOL;
        const inZ = sz0 === sz1 ? sz0 > box.z0 + TOL && sz0 < box.z1 - TOL : sz0 < box.z1 - TOL && sz1 > box.z0 + TOL;
        if (inX && inZ) crossings.push(`${r.id} by (${a.x},${a.z})-(${b.x},${b.z})`);
      }
    }
    expect(crossings).toEqual([]);
  });

  /**
   * Verifies that every corridor is horizontal or vertical
   */
  it('has only axis-aligned corridors', () => {
    for (const [a, b] of CORRIDORS) expect(axisAligned(a, b)).toBe(true);
  });
});

describe('wallSeats', () => {
  /**
   * Verifies that wall standing places stay inside the room and leave the door clear
   */
  it.each(ROOMS.map((r) => [r.id, r] as const))('%s wall seats are inside and away from the door', (_id, r) => {
    const door = doorOf(r);
    for (const s of wallSeats(r)) {
      expect(Math.abs(s.x)).toBeLessThanOrEqual(r.w / 2 + TOL);
      expect(Math.abs(s.z)).toBeLessThanOrEqual(r.d / 2 + TOL);
      expect(Math.hypot(r.cx + s.x - door.inside.x, r.cz + s.z - door.inside.z)).toBeGreaterThanOrEqual(1.2);
    }
  });
});

describe('candidateSeats', () => {
  /**
   * Verifies that a station agent gets its post seats first, then shared, then wall seats
   */
  it('orders station, shared and wall seats for a station agent', () => {
    const r = room('epreuves');
    const ids = candidateSeats(r, 'hermione').map((c) => c.id);
    const relecture = r.stations!.relecture.length;
    expect(ids.slice(0, relecture)).toEqual(Array.from({ length: relecture }, (_, i) => `epreuves:relecture:${i}`));
    expect(ids[relecture]).toBe('epreuves:seat:0');
    expect(ids.at(-1)).toMatch(/^epreuves:wall:\d+$/);
    expect(ids).toHaveLength(relecture + r.seats.length + wallSeats(r).length);
  });

  /**
   * Verifies that agent types are matched to their station case-insensitively
   */
  it('matches the station case-insensitively', () => {
    expect(candidateSeats(room('epreuves'), 'Hermione')[0].id).toBe('epreuves:relecture:0');
    expect(candidateSeats(room('epreuves'), 'DEXTER')[0].id).toBe('epreuves:labo:0');
  });

  /**
   * Verifies that generic agents, and station agents outside their room, start at shared seats
   */
  it.each([
    ['epreuves', 'general-purpose'],
    ['atelier', 'hermione'],
    ['epreuves', 'constructor'],
    ['heraut', 'toString'],
  ] as const)('in %s, %s starts with the shared seats', (roomId, type) => {
    expect(candidateSeats(room(roomId), type)[0].id).toBe(`${roomId}:seat:0`);
  });

  /**
   * Verifies that candidate seat ids are unique within a room
   */
  it.each(ROOMS.map((r) => [r.id, r] as const))('%s candidate ids are unique', (_id, r) => {
    for (const type of ['general-purpose', 'hermione', 'dexter', 'oracle', 'curator', 'otis', 'gatsby', 'timmy', 'turing', 'barbapapa', 'claude-code-guide']) {
      const ids = candidateSeats(r, type).map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

/** Station of each agent type with a dedicated post (keys in lower case). */
const STATION_OF: Record<string, string> = {
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

/** The documented candidate order: own post, shared seats, then wall seats, with their ids. */
function expectedCandidates(r: RoomDef, type: string): Candidate[] {
  const key = type.toLowerCase();
  const station = Object.hasOwn(STATION_OF, key) ? STATION_OF[key] : undefined;
  const own = station ? (r.stations?.[station] ?? []) : [];
  return [
    ...own.map((seat, i) => ({ id: `${r.id}:${station}:${i}`, seat, station })),
    ...r.seats.map((seat, i) => ({ id: `${r.id}:seat:${i}`, seat })),
    ...wallSeats(r).map((seat, i) => ({ id: `${r.id}:wall:${i}`, seat })),
  ];
}

const SAMPLE_TYPES = [
  'general-purpose',
  'Explore',
  'constructor',
  '__proto__',
  'hermione',
  'Hermione',
  'DEXTER',
  'oracle',
  'curator',
  'otis',
  'gatsby',
  'timmy',
  'turing',
  'barbapapa',
  'claude-code-guide',
];

describe('wallSeats: memoisation', () => {
  /**
   * Verifies that repeated calls for a room return the very same array
   */
  it.each(ROOMS.map((r) => [r.id, r] as const))('%s returns the same instance on every call', (_id, r) => {
    const first = wallSeats(r);
    expect(wallSeats(r)).toBe(first);
    expect(wallSeats(r)).toBe(first);
  });

  /**
   * Verifies that a fresh copy of a room computes equal wall seats in a distinct array
   */
  it.each(ROOMS.map((r) => [r.id, r] as const))('%s copy gets equal seats in its own array', (_id, r) => {
    const copy = structuredClone(r);
    const seats = wallSeats(copy);
    expect(seats).not.toBe(wallSeats(r));
    expect(seats).toEqual(wallSeats(r));
  });

  /**
   * Verifies that the nested Scriptorium has no wall seats of its own
   */
  it('gives the scriptorium no wall seats', () => {
    expect(wallSeats(room('scriptorium'))).toEqual([]);
  });
});

describe('candidateSeats: memoisation', () => {
  /**
   * Verifies that repeated calls with the same room and type return the very same array
   */
  it.each(SAMPLE_TYPES)('returns the same instance for %s on repeated calls', (type) => {
    const r = room('epreuves');
    const first = candidateSeats(r, type);
    expect(candidateSeats(r, type)).toBe(first);
  });

  /**
   * Verifies that the type is matched case-insensitively, sharing a single list
   */
  it('shares one list across spellings of the same type', () => {
    const r = room('epreuves');
    const list = candidateSeats(r, 'hermione');
    expect(candidateSeats(r, 'Hermione')).toBe(list);
    expect(candidateSeats(r, 'HERMIONE')).toBe(list);
  });

  /**
   * Verifies that every type without a station shares the generic list of a room
   */
  it('shares one list between types without a station', () => {
    const r = room('atelier');
    const generic = candidateSeats(r, 'general-purpose');
    for (const type of ['Explore', 'statusline-setup', 'neo', 'constructor', '__proto__', 'toString', '']) {
      expect(candidateSeats(r, type), type).toBe(generic);
    }
  });

  /**
   * Verifies that two stations of the same room keep separate lists
   */
  it('keeps separate lists for different stations', () => {
    const r = room('epreuves');
    const relecture = candidateSeats(r, 'hermione');
    const labo = candidateSeats(r, 'dexter');
    expect(labo).not.toBe(relecture);
    expect(relecture[0].id).toBe('epreuves:relecture:0');
    expect(labo[0].id).toBe('epreuves:labo:0');
    expect(candidateSeats(r, 'general-purpose')[0].id).toBe('epreuves:seat:0');
  });

  /**
   * Verifies that the cache is per room: the same type gets each room's own seats
   */
  it('keeps separate lists per room', () => {
    const a = candidateSeats(room('atelier'), 'general-purpose');
    const b = candidateSeats(room('biblio'), 'general-purpose');
    expect(a).not.toBe(b);
    expect(a[0].id).toBe('atelier:seat:0');
    expect(b[0].id).toBe('biblio:seat:0');
  });

  /**
   * Verifies that every room and type yields the documented candidate list
   */
  it.each(ROOMS.map((r) => [r.id, r] as const))('%s candidates match post, shared then wall seats', (_id, r) => {
    for (const type of SAMPLE_TYPES) {
      expect(candidateSeats(r, type), type).toEqual(expectedCandidates(r, type));
    }
  });

  /**
   * Verifies that a station agent outside its room gets the same seats as a generic agent
   */
  it('gives a station agent outside its room the generic seats', () => {
    const r = room('atelier');
    expect(candidateSeats(r, 'hermione')).toEqual(candidateSeats(r, 'general-purpose'));
  });

  /**
   * Verifies that the results do not depend on which type asked first for a room
   */
  it.each(ROOMS.map((r) => [r.id, r] as const))('%s results do not depend on call order', (_id, r) => {
    const forward = structuredClone(r);
    const backward = structuredClone(r);
    const one = SAMPLE_TYPES.map((t) => candidateSeats(forward, t));
    const other = [...SAMPLE_TYPES].reverse().map((t) => candidateSeats(backward, t)).reverse();
    expect(one).toEqual(other);
    expect(one).toEqual(SAMPLE_TYPES.map((t) => candidateSeats(r, t)));
  });

  /**
   * Verifies that seat assignment still gives the same spots once the lists are cached
   */
  it('assigns the same spots on repeated calls with cached lists', () => {
    const reqs = [req('h', 'epreuves', { agentType: 'hermione' }), req('g', 'epreuves'), req('e', 'epreuves', { agentType: 'Explore' })];
    const first = assignSpots(reqs, new Map());
    const second = assignSpots(reqs, new Map());
    expect([...second.entries()]).toEqual([...first.entries()]);
    expect(first.get('h')!.id).toBe('epreuves:relecture:0');
    expect(first.get('g')!.id).toBe('epreuves:seat:0');
    expect(first.get('e')!.id).toBe('epreuves:seat:1');
  });
});

describe('queueSpot', () => {
  /**
   * Verifies that the first in the altar queue kneels at the head of the aisle facing north
   */
  it('makes rank 0 kneel before the altar', () => {
    const s = queueSpot(0);
    expect(s).toMatchObject({ id: 'queue:0', kneel: true, space: 'autel', facing: NORTH });
    expect(samePoint(s, QUEUE_PATH[0])).toBe(true);
  });

  /**
   * Verifies that no rank after the first kneels
   */
  it.each([1, 2, 3, 4, 5, 10, 40])('rank %i does not kneel', (rank) => {
    expect(queueSpot(rank).kneel).toBeFalsy();
  });

  /**
   * Verifies that queue spots in the aisle share the altar space and enter by its door
   */
  it.each([1, 2, 3])('rank %i stands in the aisle, in the altar space', (rank) => {
    const s = queueSpot(rank);
    const door = doorOf(room('autel'));
    expect(s.space).toBe('autel');
    expect(s.anchor).toEqual(door.outside);
    expect(s.entry).toEqual([door.inside]);
  });

  /**
   * Verifies that queue spots beyond the aisle get their own space id
   */
  it('gives corridor ranks their own space, anchored where they stand', () => {
    const s = queueSpot(5);
    expect(s.space).toBe('queue:5');
    expect(s.entry).toEqual([]);
    expect(onAnyCorridor(s)).toBe(true);
    expect(samePoint(s.anchor, s)).toBe(true);
  });

  /**
   * Verifies that ranks past the end of the queue path pile up at its last point
   */
  it('clamps very long queues to the end of the path', () => {
    const s = queueSpot(1000);
    expect(samePoint(s, QUEUE_PATH.at(-1)!)).toBe(true);
  });

  /**
   * Verifies that successive ranks are distinct places
   */
  it('gives distinct positions to successive ranks', () => {
    const pts = Array.from({ length: 30 }, (_, r) => queueSpot(r));
    for (let i = 1; i < pts.length; i++) expect(samePoint(pts[i], pts[i - 1])).toBe(false);
  });

  /**
   * Verifies that every queue rank, in the nave or in the corridors, heads for the altar room
   */
  it.each([0, 1, 3, 5, 20, 1000])('rank %i has room autel and no station', (rank) => {
    const s = queueSpot(rank);
    expect(s.room).toBe('autel');
    expect(s).not.toHaveProperty('station');
  });

  /**
   * Verifies that the corridor ranks, whose space is their own, still name the altar room
   */
  it('keeps room autel for a rank standing in a corridor', () => {
    const s = queueSpot(5);
    expect(onAnyCorridor(s)).toBe(true);
    expect(s.space).not.toBe('autel');
    expect(s.room).toBe('autel');
  });
});

describe('assignSpots', () => {
  /**
   * Verifies that an agent keeps its seat across calls while staying in the same room
   */
  it('keeps seats stable across calls, even when newcomers arrive first in the list', () => {
    const memory: SeatMemory = new Map();
    const first = assignSpots([req('a', 'atelier'), req('b', 'atelier')], memory);
    const aSeat = first.get('a')!.id;
    const bSeat = first.get('b')!.id;
    expect(aSeat).toBe('atelier:seat:0');
    expect(bSeat).toBe('atelier:seat:1');

    const second = assignSpots([req('n', 'atelier'), req('b', 'atelier'), req('a', 'atelier')], memory);
    expect(second.get('a')!.id).toBe(aSeat);
    expect(second.get('b')!.id).toBe(bSeat);
    expect(second.get('n')!.id).toBe('atelier:seat:2');
  });

  /**
   * Verifies that a remaining agent does not jump to a seat freed by another agent
   */
  it('does not move an agent to a freed better seat', () => {
    const memory: SeatMemory = new Map();
    assignSpots([req('a', 'biblio'), req('b', 'biblio')], memory);
    const after = assignSpots([req('b', 'biblio')], memory);
    expect(after.get('b')!.id).toBe('biblio:seat:1');
  });

  /**
   * Verifies that no two agents ever receive the same seat id
   */
  it('never gives two agents the same seat', () => {
    const memory: SeatMemory = new Map();
    const reqs = Array.from({ length: 25 }, (_, i) => req(`ag-${i}`, i % 2 ? 'atelier' : 'epreuves', { agentType: i % 3 ? 'hermione' : 'x' }));
    for (let round = 0; round < 3; round++) {
      const spots = assignSpots(round === 1 ? [...reqs].reverse() : reqs, memory);
      const ids = [...spots.values()].map((s) => s.id);
      expect(spots.size).toBe(reqs.length);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  /**
   * Verifies that conflicting remembered seats are resolved: the first keeps it, the other moves
   */
  it('resolves two memories pointing at the same seat', () => {
    const memory: SeatMemory = new Map([
      ['a', { room: 'atelier', seatId: 'atelier:seat:0' }],
      ['b', { room: 'atelier', seatId: 'atelier:seat:0' }],
    ]);
    const spots = assignSpots([req('a', 'atelier'), req('b', 'atelier')], memory);
    expect(spots.get('a')!.id).toBe('atelier:seat:0');
    expect(spots.get('b')!.id).toBe('atelier:seat:1');
    expect(memory.get('b')).toEqual({ room: 'atelier', seatId: 'atelier:seat:1' });
  });

  /**
   * Verifies that an agent changing room takes a seat in the new room
   */
  it('reseats an agent that moves to another room', () => {
    const memory: SeatMemory = new Map();
    assignSpots([req('a', 'atelier')], memory);
    const spots = assignSpots([req('a', 'biblio')], memory);
    expect(spots.get('a')).toMatchObject({ id: 'biblio:seat:0', space: 'biblio' });
    expect(memory.get('a')).toEqual({ room: 'biblio', seatId: 'biblio:seat:0' });
  });

  /**
   * Verifies that the altar queue is ordered by waiting time, ties broken by id
   */
  it('ranks queued agents by since then id', () => {
    const spots = assignSpots([queued('c', 300), queued('a', 100), queued('z', 200), queued('b', 200)], new Map());
    expect(spots.get('a')!.id).toBe('queue:0');
    expect(spots.get('b')!.id).toBe('queue:1');
    expect(spots.get('z')!.id).toBe('queue:2');
    expect(spots.get('c')!.id).toBe('queue:3');
    expect(spots.get('a')!.kneel).toBe(true);
    expect(spots.get('b')!.kneel).toBeFalsy();
  });

  /**
   * Verifies that the queue moves up when the agent at its head leaves
   */
  it('advances the queue when the first one leaves', () => {
    const memory: SeatMemory = new Map();
    assignSpots([queued('a', 100), queued('b', 200), queued('c', 300)], memory);
    const spots = assignSpots([queued('b', 200), queued('c', 300), req('a', 'atelier')], memory);
    expect(spots.get('b')).toMatchObject({ id: 'queue:0', kneel: true });
    expect(spots.get('c')!.id).toBe('queue:1');
    expect(spots.get('a')!.id).toBe('atelier:seat:0');
  });

  /**
   * Verifies that queuing drops an agent's remembered seat
   */
  it('forgets the seat of an agent that joins the queue', () => {
    const memory: SeatMemory = new Map();
    assignSpots([req('a', 'atelier'), req('b', 'atelier')], memory);
    assignSpots([queued('a', 5), req('b', 'atelier')], memory);
    expect(memory.has('a')).toBe(false);
    // Back to work: seat 0 is free again and goes to the first free candidate.
    const spots = assignSpots([req('a', 'atelier'), req('b', 'atelier')], memory);
    expect(spots.get('a')!.id).toBe('atelier:seat:0');
    expect(spots.get('b')!.id).toBe('atelier:seat:1');
  });

  /**
   * Verifies that a station agent takes its own post seat in its room
   */
  it('puts station agents on their station seats', () => {
    const spots = assignSpots(
      [
        req('h1', 'epreuves', { agentType: 'hermione' }),
        req('h2', 'epreuves', { agentType: 'Hermione' }),
        req('d', 'epreuves', { agentType: 'dexter' }),
        req('g', 'epreuves'),
      ],
      new Map(),
    );
    expect(spots.get('h1')!.id).toBe('epreuves:relecture:0');
    expect(spots.get('h2')!.id).toBe('epreuves:relecture:1');
    expect(spots.get('d')!.id).toBe('epreuves:labo:0');
    expect(spots.get('g')!.id).toBe('epreuves:seat:0');

    const r = room('epreuves');
    const seat = r.stations!.relecture[0];
    expect(spots.get('h1')).toMatchObject({ x: r.cx + seat.x, z: r.cz + seat.z, facing: seat.facing });
  });

  /**
   * Verifies that a spot carries world coordinates, its space and its door route
   */
  it('places scriptorium spots in the library space with the library door', () => {
    const spots = assignSpots([req('c', 'scriptorium', { agentType: 'curator' }), req('o', 'scriptorium', { agentType: 'otis' })], new Map());
    const r = room('scriptorium');
    const seat = r.stations!.ia[0];
    const door = doorOf(room('biblio'));
    expect(spots.get('c')).toMatchObject({ id: 'scriptorium:ia:0', space: 'biblio', anchor: door.outside, entry: [door.inside] });
    expect(spots.get('c')!.x).toBeCloseTo(r.cx + seat.x);
    expect(spots.get('c')!.z).toBeCloseTo(r.cz + seat.z);
    expect(spots.get('o')!.id).toBe('scriptorium:humains:0');
  });

  /**
   * Verifies that agents beyond every candidate seat get stable scatter spots inside the room
   */
  it('overflows to scatter ids when a room is full, and keeps them', () => {
    const r = room('concierge');
    const capacity = candidateSeats(r, 'general-purpose').length;
    const reqs = Array.from({ length: capacity + 2 }, (_, i) => req(`ag-${String(i).padStart(3, '0')}`, 'concierge'));
    const memory: SeatMemory = new Map();
    const spots = assignSpots(reqs, memory);

    const last = reqs.slice(-2).map((q) => spots.get(q.id)!);
    expect(last.map((s) => s.id)).toEqual(['concierge:scatter:0', 'concierge:scatter:1']);
    const ids = [...spots.values()].map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const box = rect(r);
    for (const s of last) {
      expect(s.space).toBe('concierge');
      expect(s.x).toBeGreaterThan(box.x0);
      expect(s.x).toBeLessThan(box.x1);
      expect(s.z).toBeGreaterThan(box.z0);
      expect(s.z).toBeLessThan(box.z1);
    }

    const again = assignSpots([...reqs].reverse(), memory);
    for (const q of reqs) expect(again.get(q.id)!.id).toBe(spots.get(q.id)!.id);
  });

  /**
   * Verifies that memory entries of agents no longer present are deleted
   */
  it('cleans the memory of vanished agents', () => {
    const memory: SeatMemory = new Map();
    assignSpots([req('a', 'atelier'), req('b', 'biblio')], memory);
    expect([...memory.keys()].sort()).toEqual(['a', 'b']);
    assignSpots([req('a', 'atelier')], memory);
    expect([...memory.keys()]).toEqual(['a']);
    assignSpots([], memory);
    expect(memory.size).toBe(0);
  });

  /**
   * Verifies that an empty request list yields no spots
   */
  it('returns an empty map for no agents', () => {
    expect(assignSpots([], new Map()).size).toBe(0);
  });

  /**
   * Verifies that an unknown room id falls back to the altar room instead of crashing
   */
  it('falls back to the altar for an unknown room', () => {
    const spots = assignSpots([req('a', 'accueil' as RoomId)], new Map());
    expect(spots.get('a')).toMatchObject({ space: 'autel' });
    expect(spots.get('a')!.id.startsWith('autel:')).toBe(true);
  });
});

describe('assignSpots: room and station', () => {
  /**
   * Verifies that a station agent on its post gets the room and the post's station
   */
  it('gives an oracle in the observatory the telescope station', () => {
    const s = spotIn('observatoire', 'oracle');
    expect(s).toMatchObject({ id: 'observatoire:lunette:0', room: 'observatoire', station: 'lunette' });
  });

  /**
   * Verifies that a scriptorium post spot names the scriptorium room, not the library space
   */
  it('gives a curator in the scriptorium room scriptorium and station ia', () => {
    const s = spotIn('scriptorium', 'curator');
    expect(s).toMatchObject({ id: 'scriptorium:ia:0', room: 'scriptorium', station: 'ia', space: 'biblio' });
  });

  /**
   * Verifies that a generic agent gets its room and no station key at all
   */
  it('gives a generic agent a room and no station', () => {
    const s = spotIn('observatoire');
    expect(s.room).toBe('observatoire');
    expect(s).not.toHaveProperty('station');
  });

  /**
   * Verifies that the station is matched case-insensitively, like the post seats
   */
  it('sets the station for a differently cased agent type', () => {
    expect(spotIn('epreuves', 'DEXTER')).toMatchObject({ room: 'epreuves', station: 'labo' });
  });

  /**
   * Verifies that once the post seats are all taken, the next same-type agent has no station
   */
  it('gives no station to a same-type agent on a shared seat once the post is full', () => {
    const post = room('observatoire').stations!.lunette!.length;
    const reqs = Array.from({ length: post + 1 }, (_, i) => req(`o${i}`, 'observatoire', { agentType: 'oracle' }));
    const spots = assignSpots(reqs, new Map());
    for (let i = 0; i < post; i++) {
      expect(spots.get(`o${i}`)).toMatchObject({ id: `observatoire:lunette:${i}`, room: 'observatoire', station: 'lunette' });
    }
    const extra = spots.get(`o${post}`)!;
    expect(extra).toMatchObject({ id: 'observatoire:seat:0', room: 'observatoire' });
    expect(extra).not.toHaveProperty('station');
  });

  /**
   * Verifies that a kept post seat keeps its station on the next call with the same memory
   */
  it('keeps the station of a kept post seat', () => {
    const memory: SeatMemory = new Map();
    const first = assignSpots([req('t', 'arithmetique', { agentType: 'turing' })], memory);
    expect(first.get('t')).toMatchObject({ id: 'arithmetique:boulier:0', station: 'boulier' });
    // A newcomer listed first must not change the kept seat nor its station.
    const second = assignSpots([req('n', 'arithmetique', { agentType: 'turing' }), req('t', 'arithmetique', { agentType: 'turing' })], memory);
    expect(second.get('t')).toMatchObject({ id: 'arithmetique:boulier:0', room: 'arithmetique', station: 'boulier' });
    expect(second.get('n')).toMatchObject({ id: 'arithmetique:boulier:1', room: 'arithmetique', station: 'boulier' });
  });

  /**
   * Verifies that a kept shared seat of a station agent stays without a station
   */
  it('keeps no station on a kept shared seat', () => {
    const memory: SeatMemory = new Map();
    const reqs = [req('a', 'autel', { agentType: 'claude-code-guide' }), req('b', 'autel', { agentType: 'claude-code-guide' })];
    assignSpots(reqs, memory);
    const again = assignSpots([...reqs].reverse(), memory);
    expect(again.get('a')).toMatchObject({ id: 'autel:sacristain:0', station: 'sacristain', room: 'autel' });
    expect(again.get('b')).toMatchObject({ id: 'autel:seat:0', room: 'autel' });
    expect(again.get('b')).not.toHaveProperty('station');
  });

  /**
   * Verifies that a station agent outside its post's room gets that room and no station
   */
  it.each([
    ['atelier', 'hermione'],
    ['biblio', 'curator'],
    ['taverne', 'oracle'],
  ] as const)('in %s, %s has no station', (roomId, type) => {
    const s = spotIn(roomId, type);
    expect(s.room).toBe(roomId);
    expect(s).not.toHaveProperty('station');
  });

  /**
   * Verifies that scatter seats carry the room but no station, also when kept
   */
  it('gives scatter seats a room and no station, on first and later calls', () => {
    const r = room('arithmetique');
    const capacity = candidateSeats(r, 'turing').length;
    const reqs = Array.from({ length: capacity + 2 }, (_, i) => req(`t${String(i).padStart(3, '0')}`, 'arithmetique', { agentType: 'turing' }));
    const memory: SeatMemory = new Map();
    for (const spots of [assignSpots(reqs, memory), assignSpots([...reqs].reverse(), memory)]) {
      const scatter = [...spots.values()].filter((s) => s.id.startsWith('arithmetique:scatter:'));
      expect(scatter).toHaveLength(2);
      for (const s of scatter) {
        expect(s.room).toBe('arithmetique');
        expect(s).not.toHaveProperty('station');
      }
    }
  });

  /**
   * Verifies that queued agents get the altar room and no station from assignSpots
   */
  it('gives queued agents room autel and no station', () => {
    const spots = assignSpots([queued('a', 1), queued('b', 2), queued('c', 3)], new Map());
    for (const s of spots.values()) {
      expect(s.room).toBe('autel');
      expect(s).not.toHaveProperty('station');
    }
  });

  /**
   * Verifies that an unknown room falls back to the altar room in the spot's room too
   */
  it('names the altar as the room of an unknown room fallback', () => {
    const spots = assignSpots([req('a', 'accueil' as RoomId)], new Map());
    expect(spots.get('a')!.room).toBe('autel');
  });

  /**
   * Verifies that every spot of a full room, overflow included, carries that room's id
   */
  it.each(ROOMS.map((r) => [r.id, r] as const))('%s spots all carry their room', (id, r) => {
    const count = candidateSeats(r, 'general-purpose').length + 1;
    const reqs = Array.from({ length: count }, (_, i) => req(`g${i}`, id));
    const spots = assignSpots(reqs, new Map());
    expect(spots.size).toBe(count);
    for (const s of spots.values()) {
      expect(s.room).toBe(id);
      expect(s).not.toHaveProperty('station');
    }
  });
});

describe('ROOMS: stations', () => {
  /** Every station that some agent type is sent to. */
  const REACHABLE = new Set(Object.values(STATION_OF));

  const posts = ROOMS.flatMap((r) => Object.keys(r.stations ?? {}).map((k) => [r.id, k] as const));

  /**
   * Verifies that the floor plan defines at least one post, so the checks below are not vacuous
   */
  it('defines dedicated posts', () => {
    expect(posts.length).toBeGreaterThan(0);
  });

  /**
   * Verifies that every post of every room is reached by some agent type and has seats
   */
  it.each(posts)('%s post %s is used by an agent type and has seats', (roomId, key) => {
    expect(REACHABLE.has(key)).toBe(true);
    expect(room(roomId).stations![key as StationId]!.length).toBeGreaterThan(0);
  });

  /**
   * Verifies that the agent type of every post lands on that post with its room and station
   */
  it.each(posts)('%s post %s gives its agent the room and station', (roomId, key) => {
    const type = Object.keys(STATION_OF).find((t) => STATION_OF[t] === key)!;
    const s = spotIn(roomId, type);
    expect(s).toMatchObject({ id: `${roomId}:${key}:0`, room: roomId, station: key });
  });

  /**
   * Verifies that each agent type's station is defined in exactly one room
   */
  it.each(Object.entries(STATION_OF))('%s station %s lives in exactly one room', (_type, key) => {
    expect(posts.filter(([, k]) => k === key)).toHaveLength(1);
  });
});

describe('SPAWN', () => {
  /**
   * Verifies that the spawn spot is in the tavern room, with no station
   */
  it('has room taverne and no station', () => {
    expect(SPAWN.room).toBe('taverne');
    expect(SPAWN).not.toHaveProperty('station');
  });

  /**
   * Verifies that new subagents spawn inside the tavern, entering by its door
   */
  it('lies in the tavern', () => {
    const box = rect(room('taverne'));
    expect(SPAWN).toMatchObject({ id: 'spawn', space: 'taverne', anchor: doorOf(room('taverne')).outside });
    expect(SPAWN.x).toBeGreaterThan(box.x0);
    expect(SPAWN.x).toBeLessThan(box.x1);
    expect(SPAWN.z).toBeGreaterThan(box.z0);
    expect(SPAWN.z).toBeLessThan(box.z1);
  });
});

describe('corridorPath', () => {
  /**
   * Verifies that an off-corridor start yields a straight line to the target
   */
  it('returns [to] when the start is off every corridor', () => {
    const to = { x: 5, z: 3 };
    expect(corridorPath({ x: 0, z: 0 }, to)).toEqual([to]);
  });

  /**
   * Verifies that an off-corridor target yields a straight line to it
   */
  it('returns [to] when the target is off every corridor', () => {
    const to = { x: 100, z: 100 };
    expect(corridorPath({ x: 5, z: 3 }, to)).toEqual([to]);
  });

  /**
   * Verifies that the path follows corridors, ends at the target and is the shortest one
   */
  it('finds the shortest way along the corridors', () => {
    const from = { x: 5, z: -5 };
    const to = { x: 15, z: -1 };
    const path = corridorPath(from, to);
    expect(path.at(-1)).toEqual(to);
    let prev: Point = from;
    for (const p of path) {
      expect(onAnyCorridor(p)).toBe(true);
      expect(axisAligned(prev, p)).toBe(true);
      prev = p;
    }
    // Down x=5 to z=-1 then east: 4 + 10. The northern loop via z=-7.5 is 19.
    expect(pathLength(from, path)).toBeCloseTo(14);
  });

  /**
   * Verifies that every door can reach every other door along the corridors
   */
  it('connects every pair of doors', () => {
    const anchors = ROOMS.map((r) => doorOf(r).outside);
    for (const a of anchors) {
      for (const b of anchors) {
        if (samePoint(a, b)) continue;
        const path = corridorPath(a, b);
        let prev = a;
        for (const p of path) {
          expect(axisAligned(prev, p)).toBe(true);
          prev = p;
        }
        expect(samePoint(path.at(-1)!, b)).toBe(true);
      }
    }
  });
});

describe('routeBetween', () => {
  /**
   * Verifies that two spots in the same space are joined by a straight line
   */
  it('goes straight within the same space', () => {
    const memory: SeatMemory = new Map();
    const spots = assignSpots([req('a', 'atelier'), req('b', 'atelier')], memory);
    const to = spots.get('b')!;
    expect(routeBetween(spots.get('a')!, to)).toEqual([{ x: to.x, z: to.z }]);
  });

  /**
   * Verifies that the scriptorium and the library share a space (no detour by the corridor)
   */
  it('goes straight between the library and its scriptorium', () => {
    const to = spotIn('scriptorium', 'curator');
    expect(routeBetween(spotIn('biblio'), to)).toEqual([{ x: to.x, z: to.z }]);
  });

  const pairs = ROOMS.flatMap((a) => ROOMS.filter((b) => b.id !== a.id).map((b) => [a.id, b.id] as const));

  /**
   * Verifies that a route between rooms only uses doors and corridors, never crossing walls
   */
  it.each(pairs)('route %s → %s uses only door, corridor and target points', (fromId, toId) => {
    const from = spotIn(fromId);
    const to = spotIn(toId);
    const route = routeBetween(from, to);
    const target = { x: to.x, z: to.z };
    expect(route.at(-1)).toEqual(target);
    if (from.space === to.space) {
      expect(route).toEqual([target]);
      return;
    }
    const doors = [from, to].flatMap((s) => [...s.entry, s.anchor]);
    for (const p of route.slice(0, -1)) {
      const allowed = onAnyCorridor(p) || doors.some((d) => samePoint(d, p));
      expect(allowed, `(${p.x}, ${p.z}) is neither a door nor a corridor point`).toBe(true);
    }
    // From the starting door to the arrival door, every leg is axis-aligned: no diagonal cut through a wall.
    for (let i = 1; i < route.length - 1; i++) expect(axisAligned(route[i - 1], route[i])).toBe(true);
    expect(samePoint(route[0], from.entry[0])).toBe(true);
    expect(samePoint(route.at(-2)!, to.entry.at(-1)!)).toBe(true);
    for (let i = 1; i < route.length; i++) expect(samePoint(route[i], route[i - 1])).toBe(false);
  });

  /**
   * Verifies that walking to the head of the queue ends through the altar door at the kneeling place
   */
  it('reaches the kneeling place through the altar door', () => {
    const to = queueSpot(0);
    const route = routeBetween(spotIn('biblio'), to);
    expect(samePoint(route.at(-1)!, to)).toBe(true);
    expect(samePoint(route.at(-2)!, doorOf(room('autel')).inside)).toBe(true);
  });

  /**
   * Verifies that leaving a corridor queue spot starts from where the agent stands
   */
  it('leaves a corridor queue spot straight along the corridors', () => {
    const from = queueSpot(5);
    const route = routeBetween(from, spotIn('machines'));
    expect(samePoint(route[0], from)).toBe(true);
    for (const p of route.slice(0, -2)) expect(onAnyCorridor(p)).toBe(true);
  });
});

/** True when the walk from a to b goes through a wall of a room, anywhere but its door gap. */
function crossesWall(a: Point, b: Point): RoomId | undefined {
  const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05));
  for (const r of ROOMS) {
    if (r.insideOf) continue;
    const { x0, x1, z0, z1 } = rect(r);
    const inside = (p: Point) => p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1;
    const door = doorOf(r).wall;
    let prev = a;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      if (inside(p) !== inside(prev) && Math.hypot(p.x - door.x, p.z - door.z) > 0.9) return r.id;
      prev = p;
    }
  }
  return undefined;
}

describe('reroute', () => {
  const trips: [RoomId, RoomId, RoomId][] = [
    ['biblio', 'atelier', 'machines'],
    ['garde', 'observatoire', 'taverne'],
    ['taverne', 'biblio', 'scriptorium'],
    ['cartes', 'heraut', 'cartes'],
    ['concierge', 'pigeonnier', 'epreuves'],
  ];
  /**
   * Verifies that an agent sent elsewhere at any point of its walk never goes through a wall
   */
  it.each(trips)('%s → %s, redirected to %s, never crosses a wall', (a, b, c) => {
    const from = spotIn(a);
    const via = spotIn(b, 'Explore');
    const to = { ...spotIn(c, 'turing'), id: 'target' };
    const route = routeBetween(from, via);
    let pos: Point = from;
    for (let i = 0; i < route.length; i++) {
      // Halfway along leg i, then the rest of the route is still to walk.
      const mid = { x: (pos.x + route[i].x) / 2, z: (pos.z + route[i].z) / 2 };
      for (const [here, rest] of [
        [mid, route.slice(i)],
        [route[i], route.slice(i + 1)],
      ] as [Point, Point[]][]) {
        const next = reroute(rest, via, to);
        let prev = here;
        for (const p of next) {
          expect(crossesWall(prev, p), `from ${JSON.stringify(prev)} to ${JSON.stringify(p)}`).toBeUndefined();
          prev = p;
        }
        expect(samePoint(prev, to)).toBe(true);
      }
      pos = route[i];
    }
  });

  /**
   * Verifies that with nothing left to walk, reroute is the plain route between spots
   */
  it('equals routeBetween when the agent stands at its spot', () => {
    const a = spotIn('biblio');
    const b = spotIn('machines');
    expect(reroute([], a, b)).toEqual(routeBetween(a, b));
  });
});

describe('standing places', () => {
  /**
   * Verifies that no two candidate places of a space are closer than a body width, and none is in a prop
   */
  it.each(ROOMS.filter((r) => !r.insideOf).map((r) => [r.id]))('%s keeps its places apart and off the furniture', (id) => {
    const r = room(id as RoomId);
    const zones = ROOMS.filter((z) => z.insideOf === r.id || z.id === r.id);
    const places = zones.flatMap((z) =>
      [...z.seats, ...Object.values(z.stations ?? {}).flat(), ...wallSeats(z)].map((s) => ({ x: z.cx + s.x, z: z.cz + s.z })),
    );
    for (let i = 0; i < places.length; i++) {
      for (let j = i + 1; j < places.length; j++) {
        const d = Math.hypot(places[i].x - places[j].x, places[i].z - places[j].z);
        expect(d, `${id} ${JSON.stringify(places[i])} ${JSON.stringify(places[j])}`).toBeGreaterThanOrEqual(MIN_SEAT_GAP - 0.2);
      }
    }
    for (const s of wallSeats(r)) {
      expect(r.props.some((p) => inFootprint(p, s.x, s.z)), `${id} ${JSON.stringify(s)}`).toBe(false);
    }
  });
});
