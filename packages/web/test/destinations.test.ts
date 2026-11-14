import { describe, expect, it } from 'vitest';
import { destinationOf, postDestination } from '../src/scene/destinations.ts';
import { POST_IDS, ROOMS, SPAWN, assignSpots, queueSpot } from '../src/scene/layout.ts';

describe('destinationOf', () => {
  /**
   * Verifies that the station wins over the room when the spot has one
   */
  it('returns the station when present', () => {
    expect(destinationOf({ room: 'observatoire', station: 'lunette' })).toBe('lunette');
    expect(destinationOf({ room: 'scriptorium', station: 'ia' })).toBe('ia');
  });

  /**
   * Verifies that the room is returned when the spot has no station key
   */
  it('returns the room when the station is absent', () => {
    expect(destinationOf({ room: 'atelier' })).toBe('atelier');
  });

  /**
   * Verifies that an explicit undefined station falls back to the room
   */
  it('returns the room when the station is undefined', () => {
    expect(destinationOf({ room: 'biblio', station: undefined })).toBe('biblio');
  });

  /**
   * Verifies that a post agent's assigned spot points at its post, a generic one at the room
   */
  it('follows the spots given by assignSpots', () => {
    const spots = assignSpots(
      [
        { id: 'c', room: 'scriptorium', agentType: 'curator', queued: false, since: 0 },
        { id: 'g', room: 'scriptorium', agentType: 'general-purpose', queued: false, since: 0 },
        { id: 'h', room: 'atelier', agentType: 'hermione', queued: false, since: 0 },
      ],
      new Map(),
    );
    expect(destinationOf(spots.get('c')!)).toBe('ia');
    expect(destinationOf(spots.get('g')!)).toBe('scriptorium');
    expect(destinationOf(spots.get('h')!)).toBe('atelier');
  });

  /**
   * Verifies that the altar queue and the spawn lockers resolve to their rooms
   */
  it('maps queue spots to the altar and the spawn to the tavern', () => {
    expect(destinationOf(queueSpot(0))).toBe('autel');
    expect(destinationOf(queueSpot(5))).toBe('autel');
    expect(destinationOf(SPAWN)).toBe('taverne');
  });
});

describe('Destination', () => {
  /**
   * Verifies that no post shares its name with a room: each must keep its own icon
   */
  it('keeps room ids and post names apart', () => {
    const rooms = new Set<string>(ROOMS.map((r) => r.id));
    const posts = ROOMS.flatMap((r) => Object.keys(r.stations ?? {}));
    expect(posts.filter((p) => rooms.has(p))).toEqual([]);
  });
});

describe('postDestination', () => {
  /**
   * Verifies that every post resolves to a known room or station, so each card has an icon
   */
  it('maps every post to a room or a station', () => {
    const known = new Set<string>([
      ...ROOMS.map((r) => r.id),
      ...ROOMS.flatMap((r) => Object.keys(r.stations ?? {})),
    ]);
    expect(POST_IDS.length).toBeGreaterThan(0);
    expect(POST_IDS.map(postDestination).filter((d) => !known.has(d))).toEqual([]);
  });

  /**
   * Verifies that a post's icon is the badge of a generic agent walking to its room or station
   */
  it('matches the badge of a generic seat at the post', () => {
    expect(postDestination('chevalet')).toBe(destinationOf({ room: 'atelier', station: 'chevalet' }));
    expect(postDestination('atelier')).toBe(destinationOf({ room: 'atelier' }));
  });

  /**
   * Verifies that a room-wide post keeps the room icon, even where a dedicated seat inside
   * it (the telescope, the scriptorium lecterns) gives a walking agent another badge
   */
  it('keeps the room icon for a room-wide post with dedicated seats', () => {
    expect(postDestination('observatoire')).toBe('observatoire');
    expect(destinationOf({ room: 'observatoire', station: 'lunette' })).toBe('lunette');
    expect(postDestination('scriptorium')).toBe('scriptorium');
    expect(destinationOf({ room: 'scriptorium', station: 'ia' })).toBe('ia');
  });
});
