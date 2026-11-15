import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentState, RoomId } from '@agent-office/shared';
import {
  CLIPS,
  WORK_CLIPS,
  clipFor,
  hold,
  play,
  type ClipChoice,
  type ClipInput,
  type ClipName,
} from '../src/scene/characters.ts';
import { CLIP_FILE } from '../src/scene/clipCatalog.ts';
import {
  ROOMS,
  ROOM_BY_ID,
  SPAWN,
  assignSpots,
  candidateSeats,
  queueSpot,
  wallSeats,
  type SeatMemory,
  type StationId,
} from '../src/scene/layout.ts';
import {
  CHAIR_CLIP,
  FLOOR_CLIP,
  PUSH_UPS_CLIP,
  ROOM_GESTURES,
  SIT_STILL_AT,
  STATION_GESTURES,
  THROW_CLIP,
  THROW_CLIP_TIME,
  advanceThrow,
  onThrow,
  placeClip,
  seatOf,
  throwPigeon,
  type PlaceInput,
  type SeatRef,
} from '../src/scene/workGestures.ts';

// ---------------------------------------------------------------- fixtures

const STATES: AgentState[] = ['working', 'waiting', 'done'];
const room = (id: RoomId) => ROOM_BY_ID.get(id)!;
/** Candidate seats of a room for an agent type with no dedicated post. */
const plainCandidates = (id: RoomId) => candidateSeats(room(id), 'no-such-type');
/** Ids of a given kind (`seat`, `wall`, a station name) among a room's candidates. */
const idsOf = (id: RoomId, tag: string, agentType = 'no-such-type') =>
  candidateSeats(room(id), agentType)
    .map((c) => c.id)
    .filter((cid) => cid.startsWith(`${id}:${tag}:`));

/** A working figure at the first shared seat of the workshop: each test overrides what it is about. */
const BASE_PLACE: PlaceInput = { room: 'atelier', seat: { kind: 'seat', index: 0 }, state: 'working', reducedMotion: false };
const place = (over: Partial<PlaceInput>) => placeClip({ ...BASE_PLACE, ...over });

/** Real scatter ids, produced by assignSpots once every candidate of a room is taken. */
function scatterIds(id: RoomId, extra = 3): string[] {
  const n = plainCandidates(id).length + extra;
  const requests = Array.from({ length: n }, (_, i) => ({
    id: `scatter-agent-${id}-${i}`,
    room: id,
    agentType: 'no-such-type',
    queued: false,
    since: i,
  }));
  const spots = assignSpots(requests, new Map() as SeatMemory);
  return [...spots.values()].map((s) => s.id).filter((sid) => sid.startsWith(`${id}:scatter:`));
}

type GestureList = readonly { clip: ClipName; rate?: number }[];
const ROOM_ENTRIES = Object.entries(ROOM_GESTURES) as [RoomId, GestureList][];
const STATION_ENTRIES = Object.entries(STATION_GESTURES) as [StationId, GestureList][];
const expectedPlay = (list: GestureList, index: number): ClipChoice => {
  const pick = list[index % list.length];
  return play(pick.clip, pick.rate);
};

// ---------------------------------------------------------------- seatOf

describe('seatOf', () => {
  /** Verifies that a station id of the agent's own post reads as a station, with its index */
  it('reads the ids of a dedicated post as station seats', () => {
    const cands = candidateSeats(room('atelier'), 'barbapapa').filter((c) => c.station === 'chevalet');
    expect(cands.length).toBeGreaterThan(0);
    cands.forEach((c, i) => expect(seatOf(c.id, 'atelier', c.station)).toEqual({ kind: 'station', index: i }));
  });

  /** Verifies that a station id reads as other when no station or another station is given */
  it('tags a station id as station only when the station matches', () => {
    const id = candidateSeats(room('epreuves'), 'hermione').find((c) => c.station === 'relecture')!.id;
    expect(seatOf(id, 'epreuves', 'relecture').kind).toBe('station');
    expect(seatOf(id, 'epreuves', 'labo')).toEqual({ kind: 'other', index: 0 });
    expect(seatOf(id, 'epreuves')).toEqual({ kind: 'other', index: 0 });
  });

  /** Verifies that every shared seat of every room reads as a seat with its list index */
  it.each(ROOMS.map((r) => [r.id]))('reads the shared seats of %s with their index', (id) => {
    const seats = idsOf(id as RoomId, 'seat');
    expect(seats).toHaveLength(room(id as RoomId).seats.length);
    seats.forEach((sid, i) => expect(seatOf(sid, id as RoomId)).toEqual({ kind: 'seat', index: i }));
  });

  /** Verifies that wall standing places read as wall seats with their index */
  it.each(ROOMS.filter((r) => !r.insideOf).map((r) => [r.id]))('reads the wall places of %s with their index', (id) => {
    const walls = idsOf(id as RoomId, 'wall');
    expect(walls).toHaveLength(wallSeats(room(id as RoomId)).length);
    walls.forEach((wid, i) => expect(seatOf(wid, id as RoomId)).toEqual({ kind: 'wall', index: i }));
  });

  /** Verifies that the shared seats are read the same whatever station the caller passes */
  it('keeps shared seats as seats even when a station is given', () => {
    const sid = idsOf('epreuves', 'seat')[2];
    expect(seatOf(sid, 'epreuves', 'labo')).toEqual({ kind: 'seat', index: 2 });
  });

  /** Verifies that scatter ids made by assignSpots read as scatter, with their number */
  it('reads overflow scatter ids from assignSpots', () => {
    const ids = scatterIds('pigeonnier');
    expect(ids.length).toBe(3);
    for (const sid of ids) {
      const n = Number(sid.slice('pigeonnier:scatter:'.length));
      expect(seatOf(sid, 'pigeonnier')).toEqual({ kind: 'scatter', index: n });
    }
  });

  /** Verifies that an id of another room is other, even with a valid seat tag */
  it('reads the ids of another room as other', () => {
    const sid = idsOf('atelier', 'seat')[1];
    expect(seatOf(sid, 'machines')).toEqual({ kind: 'other', index: 0 });
    expect(seatOf('taverne:wall:3', 'detente')).toEqual({ kind: 'other', index: 0 });
  });

  /** Verifies that the scriptorium seats do not read as library seats (room prefix is exact) */
  it('does not confuse a nested zone with its room', () => {
    expect(seatOf(idsOf('scriptorium', 'seat')[0], 'biblio').kind).toBe('other');
    expect(seatOf(idsOf('biblio', 'seat')[0], 'scriptorium').kind).toBe('other');
  });

  /** Verifies that the spawn lockers and the altar queue spots read as other */
  it('reads spawn and queue spots as other', () => {
    expect(SPAWN.id).toBe('spawn');
    expect(seatOf(SPAWN.id, 'taverne')).toEqual({ kind: 'other', index: 0 });
    for (const rank of [0, 1, 5]) {
      const q = queueSpot(rank);
      expect(seatOf(q.id, 'autel')).toEqual({ kind: 'other', index: 0 });
      expect(seatOf(q.id, 'autel', 'sacristain')).toEqual({ kind: 'other', index: 0 });
    }
  });

  /** Verifies that malformed ids never throw and fall back to other or index 0 */
  it.each([
    ['', { kind: 'other', index: 0 }],
    ['taverne', { kind: 'other', index: 0 }],
    ['taverne:', { kind: 'other', index: 0 }],
    ['taverne:seat', { kind: 'other', index: 0 }],
    ['taverne:bogus:2', { kind: 'other', index: 2 }],
    ['taverne:seat:abc', { kind: 'seat', index: 0 }],
    ['taverne:seat:-3', { kind: 'seat', index: 0 }],
    ['taverne:seat:1.5', { kind: 'seat', index: 0 }],
    ['taverne:wall:NaN', { kind: 'wall', index: 0 }],
    ['taverne:wall:Infinity', { kind: 'wall', index: 0 }],
    [':seat:1', { kind: 'other', index: 0 }],
    ['TAVERNE:seat:1', { kind: 'other', index: 0 }],
  ] as [string, SeatRef][])('reads the malformed id %j safely', (id, expected) => {
    expect(seatOf(id, 'taverne')).toEqual(expected);
  });

  /** Verifies that the index is the number after the last colon, large values included */
  it('parses the index after the last colon', () => {
    expect(seatOf('taverne:seat:17', 'taverne')).toEqual({ kind: 'seat', index: 17 });
    expect(seatOf('taverne:wall:0', 'taverne')).toEqual({ kind: 'wall', index: 0 });
    expect(seatOf('taverne:scatter:123456', 'taverne')).toEqual({ kind: 'scatter', index: 123456 });
    // A tag holding a colon is not a known kind, but its index is still read.
    expect(seatOf('taverne:seat:x:4', 'taverne')).toEqual({ kind: 'other', index: 4 });
  });
});

// ---------------------------------------------------------------- placeClip: work rooms

describe('placeClip in work rooms', () => {
  /** Verifies that each room's shared seats alternate its gestures by seat index */
  it.each(ROOM_ENTRIES)('%s plays its gestures in turn on its shared seats', (id, list) => {
    expect(list.length).toBeGreaterThan(0);
    const seats = idsOf(id, 'seat');
    expect(seats.length).toBeGreaterThan(0);
    for (const sid of seats) {
      const seat = seatOf(sid, id);
      const c = place({ room: id, seat });
      expect(c, sid).toEqual(expectedPlay(list, seat.index));
      expect(c!.loop).toBe(true);
      expect(c!.frozen).toBe(false);
    }
  });

  /** Verifies that wall and scatter places of a work room also play the room's gestures */
  it.each(ROOM_ENTRIES.filter(([id]) => !room(id).insideOf))('%s plays its gestures on wall places', (id, list) => {
    for (const wid of idsOf(id, 'wall')) {
      const seat = seatOf(wid, id);
      expect(place({ room: id, seat }), wid).toEqual(expectedPlay(list, seat.index));
    }
    expect(place({ room: id, seat: { kind: 'scatter', index: 7 } })).toEqual(expectedPlay(list, 7));
  });

  /** Verifies that neighbouring seats get different gestures in a room with several of them */
  it('alternates gestures between neighbouring seats', () => {
    const names = [0, 1, 2, 3].map((index) => place({ room: 'atelier', seat: { kind: 'seat', index } })!.name);
    expect(names).toEqual(['Hammering', 'Sawing', 'Working_A', 'Hammering']);
  });

  /** Verifies that a large seat index wraps around the gesture list instead of failing */
  it('wraps very large seat indexes around the list', () => {
    const list = ROOM_GESTURES.machines!;
    const index = 1_000_001;
    expect(place({ room: 'machines', seat: { kind: 'wall', index } })).toEqual(expectedPlay(list, index));
  });

  /** Verifies that a dedicated post with its own gesture plays it over the room's */
  it.each([
    ['atelier', 'barbapapa', 'chevalet', 'Working_B'],
    ['arithmetique', 'turing', 'boulier', 'Working_C'],
    ['epreuves', 'hermione', 'relecture', 'Work_A'],
    ['epreuves', 'dexter', 'labo', 'Working_A'],
  ] as [RoomId, string, StationId, ClipName][])('%s: %s at %s plays %s', (id, type, station, clip) => {
    const own = candidateSeats(room(id), type).filter((c) => c.station === station);
    expect(own.length).toBeGreaterThan(0);
    for (const c of own) {
      const seat = seatOf(c.id, id, c.station);
      expect(seat.kind).toBe('station');
      expect(place({ room: id, station, seat })).toEqual(play(clip));
    }
  });

  /** Verifies that a post without its own gesture falls back to its room's gestures */
  it('falls back to the room gestures for a post with none of its own', () => {
    expect(STATION_GESTURES.lunette).toBeUndefined();
    const own = candidateSeats(room('observatoire'), 'oracle').filter((c) => c.station === 'lunette');
    for (const c of own) {
      const seat = seatOf(c.id, 'observatoire', c.station);
      expect(place({ room: 'observatoire', station: 'lunette', seat })).toEqual(expectedPlay(ROOM_GESTURES.observatoire!, seat.index));
    }
  });

  /** Verifies that the rooms with no gesture table are only the altar, tavern and rest corner */
  it('leaves only the altar, the tavern and the relaxation corner out of the table', () => {
    const missing = ROOMS.map((r) => r.id).filter((id) => !Object.hasOwn(ROOM_GESTURES, id));
    expect(missing.sort()).toEqual(['autel', 'detente', 'taverne']);
  });

  /** Verifies that the altar keeps the default chain (null), sacristan post included */
  it('returns null at the altar, on every seat and the sacristan post', () => {
    for (const c of candidateSeats(room('autel'), 'claude-code-guide')) {
      const seat = seatOf(c.id, 'autel', c.station);
      for (const reducedMotion of [false, true]) {
        expect(place({ room: 'autel', station: c.station, seat, reducedMotion }), c.id).toBeNull();
      }
    }
  });

  /** Verifies that an unreadable spot (queue, spawn, foreign id) never gets a gesture */
  it('returns null for an other seat in every room and state', () => {
    for (const r of ROOMS) {
      for (const state of STATES) {
        for (const reducedMotion of [false, true]) {
          const c = place({ room: r.id, seat: { kind: 'other', index: 0 }, state, reducedMotion, throwing: true });
          expect(c, `${r.id} ${state} ${reducedMotion}`).toBeNull();
        }
      }
    }
  });

  /** Verifies that a waiting or finished figure outside the tavern keeps the default chain */
  it.each(ROOMS.filter((r) => r.id !== 'taverne').map((r) => [r.id]))('returns null in %s when not working', (id) => {
    for (const state of ['waiting', 'done'] as AgentState[]) {
      for (const seat of [{ kind: 'seat', index: 0 }, { kind: 'wall', index: 0 }, { kind: 'scatter', index: 1 }] as SeatRef[]) {
        expect(place({ room: id as RoomId, seat, state })).toBeNull();
      }
    }
  });

  /** Verifies that standing work gestures give way (null) under reduced motion */
  it.each(ROOM_ENTRIES)('returns null in %s under reduced motion', (id) => {
    expect(place({ room: id, seat: { kind: 'seat', index: 0 }, reducedMotion: true })).toBeNull();
    expect(place({ room: id, seat: { kind: 'wall', index: 1 }, reducedMotion: true })).toBeNull();
  });

  /** Verifies that a post's own gesture also gives way under reduced motion */
  it('returns null at a dedicated post under reduced motion', () => {
    expect(place({ room: 'atelier', station: 'chevalet', seat: { kind: 'station', index: 0 }, reducedMotion: true })).toBeNull();
  });

  /** Verifies that every gesture plays at a positive rate */
  it('plays every gesture at a positive rate', () => {
    for (const [id, list] of ROOM_ENTRIES) {
      list.forEach((_, index) => {
        const c = place({ room: id, seat: { kind: 'seat', index } })!;
        expect(c.timeScale, `${id} ${index}`).toBeGreaterThan(0);
      });
    }
  });
});

// ---------------------------------------------------------------- placeClip: tavern

describe('placeClip in the tavern', () => {
  /** Verifies that every table seat of the tavern sits on a stool, waiting or done */
  it('sits on a chair at every table seat when waiting or done', () => {
    const seats = idsOf('taverne', 'seat');
    for (const state of ['waiting', 'done'] as AgentState[]) {
      for (const sid of seats) {
        expect(place({ room: 'taverne', seat: seatOf(sid, 'taverne'), state }), sid).toEqual(play(CHAIR_CLIP));
      }
    }
  });

  /** Verifies that wall and overflow places of the tavern sit on the floor */
  it('sits on the floor at wall and scatter places', () => {
    const walls = idsOf('taverne', 'wall');
    expect(walls.length).toBeGreaterThan(0);
    const scatters = scatterIds('taverne', 2);
    expect(scatters.length).toBe(2);
    for (const state of ['waiting', 'done'] as AgentState[]) {
      for (const sid of [...walls, ...scatters]) {
        expect(place({ room: 'taverne', seat: seatOf(sid, 'taverne'), state }), sid).toEqual(play(FLOOR_CLIP));
      }
    }
  });

  /** Verifies that nobody works in the tavern: a working figure keeps the default chain */
  it('returns null for a working figure in the tavern', () => {
    for (const seat of [{ kind: 'seat', index: 0 }, { kind: 'wall', index: 0 }, { kind: 'scatter', index: 0 }] as SeatRef[]) {
      expect(place({ room: 'taverne', seat, state: 'working' })).toBeNull();
      expect(place({ room: 'taverne', seat, state: 'working', reducedMotion: true })).toBeNull();
    }
  });

  /** Verifies that seated poses are held still at SIT_STILL_AT under reduced motion */
  it('holds the seated poses still under reduced motion', () => {
    expect(place({ room: 'taverne', seat: { kind: 'seat', index: 4 }, state: 'waiting', reducedMotion: true })).toEqual(
      hold(CHAIR_CLIP, SIT_STILL_AT),
    );
    const c = place({ room: 'taverne', seat: { kind: 'wall', index: 2 }, state: 'done', reducedMotion: true })!;
    expect(c).toEqual(hold(FLOOR_CLIP, SIT_STILL_AT));
    expect(c.frozen).toBe(true);
    expect(c.timeScale).toBe(0);
    expect(c.frozenAt).toBe(SIT_STILL_AT);
  });

  /** Verifies that a pigeon throw never applies in the tavern */
  it('ignores throwing in the tavern', () => {
    expect(place({ room: 'taverne', seat: { kind: 'seat', index: 0 }, state: 'waiting', throwing: true })).toEqual(play(CHAIR_CLIP));
  });
});

// ---------------------------------------------------------------- placeClip: relaxation corner

describe('placeClip in the relaxation corner', () => {
  /** Verifies that the couch and dice-table seats sit on a chair while working */
  it('sits on a chair at every couch and dice seat', () => {
    const seats = idsOf('detente', 'seat');
    expect(seats).toHaveLength(5);
    for (const sid of seats) {
      expect(place({ room: 'detente', seat: seatOf(sid, 'detente') }), sid).toEqual(play(CHAIR_CLIP));
    }
  });

  /** Verifies that the first wall place does push-ups and the other walls sit on the floor */
  it('does push-ups on the first wall place only', () => {
    const walls = idsOf('detente', 'wall');
    expect(walls.length).toBeGreaterThan(1);
    expect(place({ room: 'detente', seat: seatOf(walls[0], 'detente') })).toEqual(play(PUSH_UPS_CLIP));
    for (const wid of walls.slice(1)) {
      expect(place({ room: 'detente', seat: seatOf(wid, 'detente') }), wid).toEqual(play(FLOOR_CLIP));
    }
  });

  /** Verifies that overflow places sit on the floor, scatter 0 included (no push-ups) */
  it('sits on the floor at scatter places', () => {
    const scatters = scatterIds('detente', 2);
    expect(scatters).toContain('detente:scatter:0');
    for (const sid of scatters) {
      expect(place({ room: 'detente', seat: seatOf(sid, 'detente') }), sid).toEqual(play(FLOOR_CLIP));
    }
  });

  /** Verifies that under reduced motion the push-ups give way to the held floor pose */
  it('replaces the push-ups by the held floor pose under reduced motion', () => {
    expect(place({ room: 'detente', seat: { kind: 'wall', index: 0 }, reducedMotion: true })).toEqual(hold(FLOOR_CLIP, SIT_STILL_AT));
    expect(place({ room: 'detente', seat: { kind: 'wall', index: 3 }, reducedMotion: true })).toEqual(hold(FLOOR_CLIP, SIT_STILL_AT));
    expect(place({ room: 'detente', seat: { kind: 'seat', index: 0 }, reducedMotion: true })).toEqual(hold(CHAIR_CLIP, SIT_STILL_AT));
  });
});

// ---------------------------------------------------------------- placeClip: the throw

describe('placeClip throwing a pigeon', () => {
  const pigeonSeat = () => seatOf(idsOf('pigeonnier', 'seat')[0], 'pigeonnier');

  /** Verifies that a working dovecote agent whose pigeon leaves plays Throw once */
  it('plays Throw once at the dovecote', () => {
    const c = place({ room: 'pigeonnier', seat: pigeonSeat(), throwing: true });
    expect(c).toEqual(play(THROW_CLIP, 1, false));
    expect(c!.loop).toBe(false);
    expect(c!.name).toBe('Throw');
  });

  /** Verifies that the throw applies on every kind of dovecote place, wall included */
  it('throws from wall and scatter places too', () => {
    for (const seat of [{ kind: 'wall', index: 3 }, { kind: 'scatter', index: 0 }] as SeatRef[]) {
      expect(place({ room: 'pigeonnier', seat, throwing: true })).toEqual(play(THROW_CLIP, 1, false));
    }
  });

  /** Verifies that without a throw the dovecote plays its looping gesture */
  it('plays the dovecote gesture when not throwing', () => {
    expect(place({ room: 'pigeonnier', seat: pigeonSeat(), throwing: false })).toEqual(expectedPlay(ROOM_GESTURES.pigeonnier!, 0));
    expect(place({ room: 'pigeonnier', seat: pigeonSeat() })).toEqual(expectedPlay(ROOM_GESTURES.pigeonnier!, 0));
  });

  /** Verifies that the throw is ignored under reduced motion */
  it('ignores throwing under reduced motion', () => {
    expect(place({ room: 'pigeonnier', seat: pigeonSeat(), throwing: true, reducedMotion: true })).toBeNull();
  });

  /** Verifies that the throw is ignored when the dovecote agent is not working */
  it('ignores throwing when not working', () => {
    for (const state of ['waiting', 'done'] as AgentState[]) {
      expect(place({ room: 'pigeonnier', seat: pigeonSeat(), throwing: true, state })).toBeNull();
    }
  });

  /** Verifies that the throw flag is ignored in every other work room */
  it.each(ROOM_ENTRIES.filter(([id]) => id !== 'pigeonnier'))('ignores throwing in %s', (id, list) => {
    for (const index of [0, 1, 2]) {
      expect(place({ room: id, seat: { kind: 'seat', index }, throwing: true })).toEqual(expectedPlay(list, index));
    }
  });

  /** Verifies that the throw flag does not change the relaxation corner poses */
  it('ignores throwing in the relaxation corner', () => {
    expect(place({ room: 'detente', seat: { kind: 'wall', index: 0 }, throwing: true })).toEqual(play(PUSH_UPS_CLIP));
  });
});

// ---------------------------------------------------------------- clip and layout consistency

describe('work clips and layout', () => {
  const named: [string, ClipName][] = [
    ...ROOM_ENTRIES.flatMap(([id, list]) => list.map((gst) => [`room ${id}`, gst.clip] as [string, ClipName])),
    ...STATION_ENTRIES.flatMap(([id, list]) => list.map((gst) => [`station ${id}`, gst.clip] as [string, ClipName])),
    ['CHAIR_CLIP', CHAIR_CLIP],
    ['FLOOR_CLIP', FLOOR_CLIP],
    ['PUSH_UPS_CLIP', PUSH_UPS_CLIP],
    ['THROW_CLIP', THROW_CLIP],
  ];

  /** Verifies that every clip named by the gesture tables and constants is a loaded work clip */
  it.each(named)('%s names %s, listed in WORK_CLIPS and CLIPS', (_label, clip) => {
    expect(WORK_CLIPS as readonly string[]).toContain(clip);
    expect(CLIPS).toContain(clip);
    expect(Object.hasOwn(CLIP_FILE, clip)).toBe(true);
  });

  /** Verifies that every station with its own gesture exists as a post in some room of the map */
  it.each(STATION_ENTRIES)('station %s exists in the layout', (station) => {
    const rooms = ROOMS.filter((r) => (r.stations?.[station]?.length ?? 0) > 0);
    expect(rooms.length).toBeGreaterThan(0);
  });

  /** Verifies that every station's gesture list and every room's list is non-empty */
  it('keeps every gesture list non-empty', () => {
    for (const [id, list] of [...ROOM_ENTRIES, ...STATION_ENTRIES]) expect(list.length, id).toBeGreaterThan(0);
  });

  /** Verifies that the tavern keeps 18 table seats, aligned with the stools drawn in props.tsx */
  it('keeps 18 table seats in the tavern', () => {
    expect(room('taverne').seats).toHaveLength(18);
    expect(room('taverne').props.filter((p) => p.kind === 'longTable')).toHaveLength(3);
  });

  /** Verifies that the relaxation corner keeps 5 seats (2 couch, 3 dice) around its couch and table */
  it('keeps 2 couch and 3 dice seats in the relaxation corner', () => {
    const detente = room('detente');
    expect(detente.seats).toHaveLength(5);
    const couch = detente.props.find((p) => p.kind === 'couch')!;
    const dice = detente.props.find((p) => p.kind === 'diceTable')!;
    expect(couch).toBeDefined();
    expect(dice).toBeDefined();
    const near = (s: { x: number; z: number }, p: { x: number; z: number }) => Math.hypot(s.x - p.x, s.z - p.z);
    const byCouch = detente.seats.filter((s) => near(s, couch) < near(s, dice));
    expect(byCouch).toHaveLength(2);
    // The couch seats come first in the list, then the three around the dice table.
    expect(detente.seats.slice(0, 2)).toEqual(byCouch);
  });

  /** Verifies that the reduced-motion seated time is a valid clip time */
  it('holds the seated poses at a non-negative time', () => {
    expect(SIT_STILL_AT).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(SIT_STILL_AT)).toBe(true);
  });
});

// ---------------------------------------------------------------- clipFor with a place

describe('clipFor with a place clip', () => {
  const BASE: ClipInput = { moving: false, speed: 0, state: 'waiting', spawning: false, kneeling: false, reducedMotion: false };
  const clip = (over: Partial<ClipInput>) => clipFor({ ...BASE, ...over });
  const GESTURE = play('Hammering');
  const SEATED = hold(CHAIR_CLIP, SIT_STILL_AT);

  /** Verifies that a place clip replaces the default Interact, Idle_B and done Idle_A */
  it.each(STATES)('plays the place clip over the default when %s', (state) => {
    expect(clip({ state, place: GESTURE })).toEqual(GESTURE);
    expect(clip({ state, place: SEATED })).toEqual(SEATED);
  });

  /** Verifies that a held place pose is kept under reduced motion instead of Idle_A */
  it('keeps the place clip under reduced motion', () => {
    expect(clip({ state: 'waiting', reducedMotion: true, place: SEATED })).toEqual(SEATED);
  });

  /** Verifies that a null or absent place keeps the default chain */
  it('falls back to the defaults when place is null or absent', () => {
    expect(clip({ state: 'working', place: null })).toEqual(play('Interact'));
    expect(clip({ state: 'waiting', place: null })).toEqual(play('Idle_B'));
    expect(clip({ state: 'done' })).toEqual(hold('Idle_A'));
    expect(clip({ state: 'working', reducedMotion: true, place: null })).toEqual(hold('Idle_A'));
  });

  /** Verifies that a scripted scene wins over the place clip */
  it('loses to a scripted scene', () => {
    const scripted = play('Death_A', 1, false);
    expect(clip({ scripted, place: GESTURE })).toEqual(scripted);
  });

  /** Verifies that the spawn wins over the place clip */
  it('loses to spawning', () => {
    expect(clip({ spawning: true, place: GESTURE }).name).toBe('Spawn_Ground');
  });

  /** Verifies that a slap hit wins over the place clip */
  it('loses to a hit', () => {
    expect(clip({ hit: 'Hit_B', place: GESTURE })).toEqual(play('Hit_B', 1, false));
  });

  /** Verifies that drinking the potion wins over the place clip */
  it('loses to drinking', () => {
    expect(clip({ drinking: true, place: GESTURE })).toEqual(play('Use_Item', 1, false));
  });

  /** Verifies that walking wins over the place clip, still pose included under reduced motion */
  it('loses to moving', () => {
    expect(clip({ moving: true, speed: 0.5, place: GESTURE }).name).toBe('Walking_A');
    expect(clip({ moving: true, speed: 0.5, reducedMotion: true, place: SEATED })).toEqual(hold('Idle_A'));
  });

  /** Verifies that each altar pose wins over the place clip */
  it.each(['pacing', 'sitting', 'sleeping'] as const)('loses to the altar pose %s', (altar) => {
    const withPlace = clip({ altar, place: GESTURE });
    expect(withPlace).toEqual(clip({ altar }));
    expect(withPlace.name).not.toBe(GESTURE.name);
  });

  /** Verifies that kneeling at the altar wins over the place clip */
  it('loses to kneeling', () => {
    expect(clip({ kneeling: true, place: GESTURE })).toEqual(hold('PickUp', clip({ kneeling: true }).frozenAt));
    expect(clip({ kneeling: true, place: GESTURE }).name).toBe('PickUp');
  });

  /** Verifies that under reduced motion the ignored gags leave the place clip in effect */
  it('keeps the place clip when reduced motion ignores a gag', () => {
    expect(clip({ hit: 'Hit_A', reducedMotion: true, place: SEATED })).toEqual(SEATED);
    expect(clip({ drinking: true, reducedMotion: true, place: SEATED })).toEqual(SEATED);
  });

  /** Verifies the end-to-end path: placeClip output fed to clipFor plays the tavern stool pose */
  it('plays what placeClip chooses for a resting tavern figure', () => {
    const seat = seatOf(idsOf('taverne', 'seat')[0], 'taverne');
    const p = placeClip({ room: 'taverne', seat, state: 'waiting', reducedMotion: false });
    expect(clip({ state: 'waiting', place: p })).toEqual(play(CHAIR_CLIP));
    const q = placeClip({ room: 'autel', seat: { kind: 'seat', index: 0 }, state: 'working', reducedMotion: false });
    expect(clip({ state: 'working', place: q })).toEqual(play('Interact'));
  });
});

// ---------------------------------------------------------------- throw bus

describe('throwPigeon / onThrow', () => {
  // The bus is module state: fresh ids per test, and every subscription undone afterwards.
  let seq = 0;
  const freshId = () => `throw-agent-${++seq}`;
  const subscriptions: (() => void)[] = [];
  const sub = (id: string, listener: () => void) => {
    const off = onThrow(id, listener);
    subscriptions.push(off);
    return off;
  };
  afterEach(() => {
    for (const off of subscriptions.splice(0)) off();
  });

  /** Verifies that a throw for an agent nobody listens to returns false */
  it('returns false when no figure listens', () => {
    expect(throwPigeon(freshId())).toBe(false);
    expect(throwPigeon('')).toBe(false);
  });

  /** Verifies that a throw reaches every listener of its agent, once each, and returns true */
  it('calls every listener of the agent once', () => {
    const id = freshId();
    const a = vi.fn();
    const b = vi.fn();
    sub(id, a);
    sub(id, b);
    expect(throwPigeon(id)).toBe(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(throwPigeon(id)).toBe(true);
    expect(a).toHaveBeenCalledTimes(2);
  });

  /** Verifies that a throw for one agent never reaches another agent's listener */
  it('keeps listeners separate per agent', () => {
    const id1 = freshId();
    const id2 = freshId();
    const a = vi.fn();
    const b = vi.fn();
    sub(id1, a);
    sub(id2, b);
    expect(throwPigeon(id1)).toBe(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  /** Verifies that unsubscribing the last listener makes the throw unheard again */
  it('stops calling a listener once unsubscribed', () => {
    const id = freshId();
    const a = vi.fn();
    const off = sub(id, a);
    off();
    expect(throwPigeon(id)).toBe(false);
    expect(a).not.toHaveBeenCalled();
  });

  /** Verifies that unsubscribing one listener leaves the others of that agent in place */
  it('keeps the other listeners when one unsubscribes', () => {
    const id = freshId();
    const a = vi.fn();
    const b = vi.fn();
    const offA = sub(id, a);
    sub(id, b);
    offA();
    expect(throwPigeon(id)).toBe(true);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  /** Verifies that calling an unsubscribe twice is harmless, even after a new subscription */
  it('tolerates a repeated unsubscribe', () => {
    const id = freshId();
    const a = vi.fn();
    const b = vi.fn();
    const offA = sub(id, a);
    offA();
    expect(() => offA()).not.toThrow();
    sub(id, b);
    offA(); // the stale handle must not remove b
    expect(throwPigeon(id)).toBe(true);
    expect(b).toHaveBeenCalledTimes(1);
  });

  /** Verifies that a listener can be subscribed again after its agent's entry was cleaned up */
  it('accepts a new subscription after cleanup', () => {
    const id = freshId();
    const a = vi.fn();
    sub(id, a)();
    sub(id, a);
    expect(throwPigeon(id)).toBe(true);
    expect(a).toHaveBeenCalledTimes(1);
  });

  /** Verifies that a listener removing itself during a throw is safe and gone afterwards */
  it('lets a listener unsubscribe itself during the throw', () => {
    const id = freshId();
    let off: () => void = () => {};
    const self = vi.fn(() => off());
    off = sub(id, self);
    expect(throwPigeon(id)).toBe(true);
    expect(self).toHaveBeenCalledTimes(1);
    expect(throwPigeon(id)).toBe(false);
    expect(self).toHaveBeenCalledTimes(1);
  });

  /** Verifies that a listener removed by another during a throw still gets that throw, not the next */
  it('finishes the current throw when a listener removes another', () => {
    const id = freshId();
    let offB: () => void = () => {};
    const a = vi.fn(() => offB());
    const b = vi.fn();
    sub(id, a);
    offB = sub(id, b);
    expect(throwPigeon(id)).toBe(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    throwPigeon(id);
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
  });

  /** Verifies that a listener added during a throw only hears the next throw */
  it('does not call a listener added during the throw', () => {
    const id = freshId();
    const late = vi.fn();
    let added = false;
    const a = vi.fn(() => {
      if (!added) {
        added = true;
        sub(id, late);
      }
    });
    sub(id, a);
    throwPigeon(id);
    expect(late).not.toHaveBeenCalled();
    throwPigeon(id);
    expect(late).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------- advanceThrow

describe('advanceThrow', () => {
  /** Verifies that no running throw stays at -1 whatever the delta */
  it.each([0, 0.016, 1, 100])('stays at -1 with no throw (delta %s)', (delta) => {
    expect(advanceThrow(-1, delta)).toBe(-1);
    expect(advanceThrow(-0.5, delta)).toBe(-1);
  });

  /** Verifies that the elapsed time accumulates while below the clip length */
  it('accumulates the elapsed time', () => {
    expect(advanceThrow(0, 0)).toBe(0);
    expect(advanceThrow(0, 0.25)).toBeCloseTo(0.25, 10);
    expect(advanceThrow(0.25, 0.5)).toBeCloseTo(0.75, 10);
  });

  /** Verifies that the throw ends (-1) exactly when it reaches THROW_CLIP_TIME */
  it('ends at THROW_CLIP_TIME', () => {
    expect(advanceThrow(0, THROW_CLIP_TIME)).toBe(-1);
    expect(advanceThrow(THROW_CLIP_TIME - 0.1, 0.1 + 1e-9)).toBe(-1);
    expect(advanceThrow(0, THROW_CLIP_TIME - 1e-6)).toBeCloseTo(THROW_CLIP_TIME - 1e-6, 10);
    expect(advanceThrow(0, 10)).toBe(-1);
  });

  /** Verifies that frame-by-frame updates end the throw after about the clip length */
  it('ends after the clip length when stepped frame by frame', () => {
    const dt = 1 / 60;
    let at = 0;
    let frames = 0;
    while (at >= 0 && frames < 10_000) {
      at = advanceThrow(at, dt);
      frames++;
    }
    expect(at).toBe(-1);
    expect(frames * dt).toBeGreaterThanOrEqual(THROW_CLIP_TIME - 1e-9);
    expect(frames * dt).toBeLessThan(THROW_CLIP_TIME + dt + 1e-9);
  });
});

// ---------------------------------------------------------------- THROW_CLIP_TIME vs the file

describe('THROW_CLIP_TIME', () => {
  interface AnimJson {
    accessors?: { max?: number[] }[];
    animations?: { name?: string; samplers: { input: number }[] }[];
  }

  /** Verifies that Throw lives in Rig_Medium_General, the file read below */
  it('reads Throw from Rig_Medium_General', () => {
    expect(CLIP_FILE[THROW_CLIP]).toBe('Rig_Medium_General');
  });

  /** Verifies that THROW_CLIP_TIME matches the Throw clip length in Rig_Medium_General.glb */
  it('matches the Throw clip length in the file', () => {
    const buf = fs.readFileSync(fileURLToPath(new URL('../public/kaykit/animations/Rig_Medium_General.glb', import.meta.url)));
    expect(buf.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
    const jsonLength = buf.readUInt32LE(12);
    expect(buf.readUInt32LE(16)).toBe(0x4e4f534a); // 'JSON'
    const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8')) as AnimJson;
    const anim = json.animations?.find((a) => a.name === THROW_CLIP);
    expect(anim, 'Throw found').toBeDefined();
    const length = Math.max(...anim!.samplers.map((s) => json.accessors?.[s.input]?.max?.[0] ?? 0));
    expect(length).toBeGreaterThan(0);
    expect(THROW_CLIP_TIME).toBeCloseTo(length, 2);
  });
});
