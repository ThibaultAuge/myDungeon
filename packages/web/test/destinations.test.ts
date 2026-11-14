import { describe, expect, it } from 'vitest';
import { destinationOf } from '../src/scene/destinations.ts';
import { ROOMS, SPAWN, assignSpots, queueSpot } from '../src/scene/layout.ts';

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
