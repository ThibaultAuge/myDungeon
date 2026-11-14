import type { RoomId } from '@agent-office/shared';
import type { Spot, StationId } from './layout.ts';

// Where a walking agent is heading, as shown by the icon above its head. Pure, testable in node.

/** A place with its own icon: a room, or a dedicated post inside a room. */
export type Destination = RoomId | StationId;

/** The post when the agent's seat is one of its seats, else the room. */
export function destinationOf(spot: Pick<Spot, 'room' | 'station'>): Destination {
  return spot.station ?? spot.room;
}
