import type { RoomId } from '@agent-office/shared';
import type { PostId, Spot, StationId } from './layout.ts';

// Where a walking agent is heading, as shown by the icon above its head. Pure, testable in node.

/** A place with its own icon: a room, or a dedicated post inside a room. */
export type Destination = RoomId | StationId;

/** The post when the agent's seat is one of its seats, else the room. */
export function destinationOf(spot: Pick<Spot, 'room' | 'station'>): Destination {
  return spot.station ?? spot.room;
}

/**
 * The icon of a clickable workstation: every post is named after its room or its dedicated
 * post, so its card shows the badge of an agent walking to a generic seat there. A room-wide
 * post keeps the room icon even where a dedicated seat inside it (the observatory telescope,
 * the scriptorium lecterns) gives the walking agent that station's badge. Typecheck fails if
 * a new `PostId` is neither a room nor a station.
 */
export function postDestination(post: PostId): Destination {
  return post;
}
