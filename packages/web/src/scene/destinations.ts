import type { PostId, Spot } from './layout.ts';

// Where a walking agent is heading, as shown by the icon above its head. Pure, testable in node.

/**
 * The workstation an agent is walking to: icons belong to posts, never to rooms, so the badge
 * shows the same pictogram as that post's card.
 */
export function destinationOf(spot: Pick<Spot, 'post'>): PostId {
  return spot.post;
}
