import { describe, expect, it } from 'vitest';
import type { RoomId } from '@agent-office/shared';
import { destinationOf } from '../src/scene/destinations.ts';
import {
  POST_IDS,
  POST_ROOM,
  ROOMS,
  ROOM_BY_ID,
  SPAWN,
  STATION_POST,
  assignSpots,
  candidateSeats,
  postOfSeat,
  queueSpot,
  wallSeats,
  type PostId,
  type Prop,
  type RoomDef,
  type SeatRequest,
  type Spot,
  type StationId,
} from '../src/scene/layout.ts';

function room(id: RoomId): RoomDef {
  const r = ROOM_BY_ID.get(id);
  if (!r) throw new Error(`missing room ${id}`);
  return r;
}

function req(id: string, roomId: RoomId, agentType = 'general-purpose'): SeatRequest {
  return { id, room: roomId, agentType, queued: false, since: 0 };
}

/** The spot a lone agent of the given type gets in a room. */
function spotIn(roomId: RoomId, agentType = 'general-purpose'): Spot {
  return assignSpots([req('solo', roomId, agentType)], new Map()).get('solo')!;
}

/** A copy of a real room with other furniture, to exercise the nearest-furniture rule alone. */
function withProps(props: Prop[]): RoomDef {
  return { ...room('taverne'), props };
}

/** Agent types with a dedicated post, the room holding it, and the post their badge must show. */
const STATION_AGENTS: [string, RoomId, StationId, PostId][] = [
  ['oracle', 'observatoire', 'lunette', 'observatoire'],
  ['barbapapa', 'atelier', 'chevalet', 'chevalet'],
  ['hermione', 'epreuves', 'relecture', 'relecture'],
  ['dexter', 'epreuves', 'labo', 'labo'],
  ['gatsby', 'heraut', 'estrade', 'estrade'],
  ['timmy', 'heraut', 'inspection', 'inspection'],
  ['curator', 'scriptorium', 'ia', 'scriptorium'],
  ['otis', 'scriptorium', 'humains', 'scriptorium'],
  ['turing', 'arithmetique', 'boulier', 'arithmetique'],
  ['claude-code-guide', 'autel', 'sacristain', 'autel'],
];

/** Every station key declared by a room, with that room. */
const ROOM_STATIONS = ROOMS.flatMap((r) => Object.keys(r.stations ?? {}).map((k) => [r.id, k as StationId] as const));

describe('destinationOf', () => {
  /**
   * Verifies that the badge is the spot's workstation, whatever the room or station
   */
  it('returns the post of the spot', () => {
    expect(destinationOf({ post: 'chevalet' })).toBe('chevalet');
    expect(destinationOf({ post: 'taverne' })).toBe('taverne');
  });

  /**
   * Verifies that every workstation id passes through unchanged, so each one has a badge
   */
  it.each(POST_IDS.map((p) => [p]))('passes %s through', (post) => {
    expect(destinationOf({ post })).toBe(post);
  });

  /**
   * Verifies that an oracle at the telescope shows the observatory post icon, not a station one
   */
  it('gives an oracle at the telescope the observatoire badge', () => {
    const s = spotIn('observatoire', 'oracle');
    expect(s.station).toBe('lunette');
    expect(destinationOf(s)).toBe('observatoire');
  });

  /**
   * Verifies that curator and otis at the scriptorium lecterns both show the scriptorium badge
   */
  it('gives curator and otis in the scriptorium the scriptorium badge', () => {
    const spots = assignSpots([req('c', 'scriptorium', 'curator'), req('o', 'scriptorium', 'otis')], new Map());
    expect(spots.get('c')!.station).toBe('ia');
    expect(spots.get('o')!.station).toBe('humains');
    expect(destinationOf(spots.get('c')!)).toBe('scriptorium');
    expect(destinationOf(spots.get('o')!)).toBe('scriptorium');
  });

  /**
   * Verifies that the sacristan and the abacus seats show their room-wide post badges
   */
  it('gives claude-code-guide the autel badge and turing the arithmetique badge', () => {
    expect(destinationOf(spotIn('autel', 'claude-code-guide'))).toBe('autel');
    expect(destinationOf(spotIn('arithmetique', 'turing'))).toBe('arithmetique');
  });

  /**
   * Verifies that each station agent in its post's room heads for STATION_POST of its station
   */
  it.each(STATION_AGENTS)('%s in %s (station %s) shows %s', (type, roomId, station, post) => {
    const s = spotIn(roomId, type);
    expect(s.station).toBe(station);
    expect(destinationOf(s)).toBe(STATION_POST[s.station!]);
    expect(destinationOf(s)).toBe(post);
    expect(POST_ROOM.get(destinationOf(s))).toBe(roomId);
  });

  /**
   * Verifies that a generic agent in a two-post room heads for the post nearest its seat
   */
  it('gives a generic agent in the trials room the post nearest its seat', () => {
    // epreuves:seat:0 is (-1, -1.6), nearest to the reading table.
    expect(spotIn('epreuves')).toMatchObject({ id: 'epreuves:seat:0', post: 'relecture' });
    expect(destinationOf(spotIn('atelier'))).toBe('atelier');
  });

  /**
   * Verifies that the altar queue, at every rank, and the spawn lockers show their posts
   */
  it('maps queue spots to autel and the spawn to taverne', () => {
    for (const rank of [0, 1, 2, 5, 20, 1000]) expect(destinationOf(queueSpot(rank))).toBe('autel');
    expect(destinationOf(SPAWN)).toBe('taverne');
  });
});

describe('postOfSeat: every seat resolves to a post of its room', () => {
  /**
   * Verifies that each shared seat of a room belongs to a workstation standing in that room
   */
  it.each(ROOMS.map((r) => [r.id, r] as const))('%s shared seats', (id, r) => {
    for (const seat of r.seats) {
      const post = postOfSeat(r, seat);
      expect(POST_IDS).toContain(post);
      expect(POST_ROOM.get(post)).toBe(id);
    }
  });

  /**
   * Verifies that each station seat belongs to its station's post, standing in that room
   */
  it.each(ROOM_STATIONS)('%s station %s seats', (id, key) => {
    for (const seat of room(id).stations![key]!) {
      const post = postOfSeat(room(id), seat, key);
      expect(post).toBe(STATION_POST[key]);
      expect(POST_ROOM.get(post)).toBe(id);
    }
  });

  /**
   * Verifies that each standing place along the walls belongs to a post of that room
   */
  it.each(ROOMS.map((r) => [r.id, r] as const))('%s wall seats', (id, r) => {
    for (const seat of wallSeats(r)) expect(POST_ROOM.get(postOfSeat(r, seat))).toBe(id);
  });

  /**
   * Verifies that every spot of an overfull room, scatter spots included, has a post of that room
   */
  it.each(ROOMS.map((r) => [r.id, r] as const))('%s spots, overflow included', (id, r) => {
    const count = candidateSeats(r, 'general-purpose').length + 3;
    const reqs = Array.from({ length: count }, (_, i) => req(`g${i}`, id));
    const spots = [...assignSpots(reqs, new Map()).values()];
    const scatter = spots.filter((s) => s.id.startsWith(`${id}:scatter:`));
    expect(scatter).toHaveLength(3);
    for (const s of spots) {
      expect(POST_IDS).toContain(s.post);
      expect(POST_ROOM.get(s.post)).toBe(id);
    }
  });

  /**
   * Verifies that a spot's post matches postOfSeat on its seat, relative to the room centre
   */
  it.each(ROOMS.map((r) => [r.id, r] as const))('%s spot posts follow postOfSeat', (id, r) => {
    const all = candidateSeats(r, 'general-purpose');
    const spots = assignSpots(all.map((_, i) => req(`g${i}`, id)), new Map());
    for (const s of spots.values()) {
      const c = all.find((cand) => cand.id === s.id)!;
      expect(s.post).toBe(postOfSeat(r, c.seat));
    }
  });

  /**
   * Verifies that every queue rank is bound for the altar post
   */
  it.each([0, 1, 2, 3, 5, 10, 20, 1000])('queue rank %i has post autel', (rank) => {
    expect(queueSpot(rank).post).toBe('autel');
  });

  /**
   * Verifies that the spawn lockers belong to the tavern post
   */
  it('gives the spawn the taverne post', () => {
    expect(SPAWN.post).toBe('taverne');
  });

  /**
   * Verifies that an unknown room falls back to an altar seat, hence the altar post
   */
  it('gives the unknown room fallback the autel post', () => {
    const s = assignSpots([req('a', 'accueil' as RoomId)], new Map()).get('a')!;
    expect(s.post).toBe('autel');
  });
});

describe('postOfSeat: nearest furniture rule', () => {
  /**
   * Verifies that generic seats in the trials room go to the nearer of the table and the bench
   */
  it.each([
    [-1, -1.6, 'relecture'],
    [1, -1.6, 'relecture'],
    [3.4, -1.6, 'labo'],
    [0.6, 1.5, 'labo'],
  ] as const)('epreuves seat (%s, %s) belongs to %s', (x, z, post) => {
    expect(postOfSeat(room('epreuves'), { x, z })).toBe(post);
  });

  /**
   * Verifies that the declared generic seats of the trials room resolve as the rule says
   */
  it('resolves the declared epreuves seats in order', () => {
    const r = room('epreuves');
    expect(r.seats.map((s) => postOfSeat(r, s))).toEqual(['relecture', 'relecture', 'labo', 'labo']);
  });

  /**
   * Verifies that every bench seat of the workshop belongs to the workshop, not the easel
   */
  it('gives every atelier bench seat the atelier post', () => {
    const r = room('atelier');
    expect(r.seats.length).toBeGreaterThan(0);
    for (const seat of r.seats) expect(postOfSeat(r, seat)).toBe('atelier');
  });

  /**
   * Verifies that a seat beside the easel without a station still belongs to the easel post
   */
  it('gives a station-less seat by the easel the chevalet post', () => {
    expect(postOfSeat(room('atelier'), { x: -3.1, z: 2.4 })).toBe('chevalet');
    expect(postOfSeat(room('atelier'), { x: -2.2, z: 2.6 })).toBe('chevalet');
  });

  /**
   * Verifies that the herald's back row goes to the inspection desk, nearer than the stage edge
   */
  it.each([0.6, 2.2, 3.2])('heraut seat (%s, -1.8) belongs to inspection', (x) => {
    // Stage (-1.6, 1.6) half [1.3, 1.3]; desk (2.2, 0.6) half [0.7, 0.4].
    // At x=0.6: stage edge ~2.285 m away, desk edge ~2.193 m away.
    expect(postOfSeat(room('heraut'), { x, z: -1.8 })).toBe('inspection');
  });

  /**
   * Verifies that a seat on the herald's stage belongs to the stage
   */
  it('gives a seat on the heraut stage the estrade post', () => {
    expect(postOfSeat(room('heraut'), { x: -1.6, z: 1.6 })).toBe('estrade');
  });

  /**
   * Verifies that distance runs to the footprint edge: inside a big piece beats a nearer centre
   */
  it('measures to the footprint edge, not the centre', () => {
    // Seat 1.25 m from the stage centre (inside it), 0.95 m from the desk centre.
    const r = withProps([
      { kind: 'stage', x: 0, z: 0, post: 'estrade' },
      { kind: 'inspectionDesk', x: 2.2, z: 0, post: 'inspection' },
    ]);
    expect(postOfSeat(r, { x: 1.25, z: 0 })).toBe('estrade');
  });

  /**
   * Verifies that a quarter-turned piece's footprint is rotated before measuring
   */
  it('accounts for a quarter-turned footprint', () => {
    const props = (rot?: number): Prop[] => [
      { kind: 'bookcase', x: 0, z: 0, rot, post: 'biblio' },
      { kind: 'barrel', x: 0, z: 1.5, post: 'taverne' },
    ];
    // Turned, the bookcase reaches z=1.1 and covers the seat; unturned it stops at z=0.25.
    expect(postOfSeat(withProps(props(Math.PI / 2)), { x: 0, z: 1 })).toBe('biblio');
    expect(postOfSeat(withProps(props()), { x: 0, z: 1 })).toBe('taverne');
  });

  /**
   * Verifies that decoration never claims a seat, even when it is the nearest piece
   */
  it('ignores decoration', () => {
    const r = withProps([
      { kind: 'crates', x: 0, z: 0 },
      { kind: 'barrel', x: 3, z: 0, post: 'taverne' },
    ]);
    expect(postOfSeat(r, { x: 0, z: 0 })).toBe('taverne');
  });

  /**
   * Verifies that on an exact tie the first piece in the room's order wins
   */
  it('breaks a tie by room order', () => {
    const a: Prop = { kind: 'barrel', x: -1, z: 0, post: 'taverne' };
    const b: Prop = { kind: 'barrel', x: 1, z: 0, post: 'concierge' };
    expect(postOfSeat(withProps([a, b]), { x: 0, z: 0 })).toBe('taverne');
    expect(postOfSeat(withProps([b, a]), { x: 0, z: 0 })).toBe('concierge');
  });

  /**
   * Verifies that a room without any workstation furniture throws for a station-less seat
   */
  it('throws when the room has no workstation', () => {
    expect(() => postOfSeat(withProps([]), { x: 0, z: 0 })).toThrow(/no workstation/);
    expect(() => postOfSeat(withProps([{ kind: 'crates', x: 0, z: 0 }]), { x: 0, z: 0 })).toThrow(/no workstation/);
  });
});

describe('postOfSeat: station argument', () => {
  /**
   * Verifies that a station wins over distance, even where another post is nearer
   */
  it('returns the station post whatever the distance', () => {
    expect(postOfSeat(room('atelier'), { x: -3.1, z: 2.4 }, 'chevalet')).toBe('chevalet');
    // A generic atelier bench seat given the easel station still belongs to the easel.
    expect(postOfSeat(room('atelier'), { x: 2.5, z: -1.6 }, 'chevalet')).toBe('chevalet');
    expect(postOfSeat(room('observatoire'), { x: -100, z: 100 }, 'lunette')).toBe('observatoire');
    expect(postOfSeat(room('heraut'), { x: 3.2, z: -1.8 }, 'estrade')).toBe('estrade');
  });

  /**
   * Verifies that a station resolves even in a room with no workstation furniture
   */
  it('does not need furniture when a station is given', () => {
    expect(postOfSeat(withProps([]), { x: 0, z: 0 }, 'ia')).toBe('scriptorium');
  });

  /**
   * Verifies that an explicit undefined station falls back to the nearest-furniture rule
   */
  it('treats an undefined station as none', () => {
    expect(postOfSeat(room('epreuves'), { x: 3.4, z: -1.6 }, undefined)).toBe('labo');
  });
});

describe('STATION_POST', () => {
  /**
   * Verifies that the station-to-post table matches the documented mapping exactly
   */
  it('maps each station to its documented post', () => {
    expect({ ...STATION_POST }).toEqual({
      lunette: 'observatoire',
      ia: 'scriptorium',
      humains: 'scriptorium',
      chevalet: 'chevalet',
      sacristain: 'autel',
      boulier: 'arithmetique',
      relecture: 'relecture',
      labo: 'labo',
      estrade: 'estrade',
      inspection: 'inspection',
    });
  });

  /**
   * Verifies that every value of the table is a declared workstation id
   */
  it('only names declared workstations', () => {
    for (const post of Object.values(STATION_POST)) expect(POST_IDS).toContain(post);
  });

  /**
   * Verifies that each room's station maps to a post standing in that same room
   */
  it.each(ROOM_STATIONS)('%s station %s maps to a post of that room', (id, key) => {
    expect(POST_ROOM.get(STATION_POST[key])).toBe(id);
  });

  /**
   * Verifies that every declared station key has an entry in the table
   */
  it('covers every station of the floor plan', () => {
    expect(ROOM_STATIONS.length).toBeGreaterThan(0);
    for (const [, key] of ROOM_STATIONS) expect(Object.hasOwn(STATION_POST, key)).toBe(true);
  });

  /**
   * Verifies that the table cannot be changed at run time
   */
  it('is frozen', () => {
    expect(Object.isFrozen(STATION_POST)).toBe(true);
  });
});

describe('badges cover every workstation card', () => {
  /** Every post a seat of a room (station, shared or wall) resolves to. */
  function postsReachedIn(r: RoomDef): Set<PostId> {
    const out = new Set<PostId>();
    for (const [key, seats] of Object.entries(r.stations ?? {})) {
      for (const seat of seats ?? []) out.add(postOfSeat(r, seat, key as StationId));
    }
    for (const seat of [...r.seats, ...wallSeats(r)]) out.add(postOfSeat(r, seat));
    return out;
  }

  /**
   * Verifies that each post's card icon is also the badge of at least one seat in its room
   */
  it.each(POST_IDS.map((p) => [p]))('%s is reachable as a badge', (post) => {
    const roomId = POST_ROOM.get(post);
    expect(roomId).toBeDefined();
    expect(postsReachedIn(room(roomId!)).has(post)).toBe(true);
  });
});
