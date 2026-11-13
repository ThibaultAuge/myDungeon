import type { RoomId } from '@agent-office/shared';

// Office floor plan: four 8.6 m rooms around an open hub at (0, 0).
// Inner walls sit on the x and z axes with a gap at the centre, so an agent going from
// one room to another walks to the hub and back out, never through a wall.

export interface Seat {
  x: number;
  z: number;
  /** Y rotation so the agent faces its desk, shelf or rack. */
  facing: number;
}

export const ROOMS: { id: RoomId; center: [number, number]; floor: string }[] = [
  { id: 'accueil', center: [-4.6, -4.6], floor: '#E8E4DA' },
  { id: 'atelier', center: [4.6, -4.6], floor: '#DCE8E2' },
  { id: 'biblio', center: [-4.6, 4.6], floor: '#E6E2F2' },
  { id: 'serveur', center: [4.6, 4.6], floor: '#DFE6EF' },
];

const NORTH = Math.PI; // faces -z
const SOUTH = 0; // faces +z
const EAST = Math.PI / 2;
const WEST = -Math.PI / 2;

const SEATS: Record<RoomId, Seat[]> = {
  accueil: [
    { x: -6.6, z: -5.95, facing: NORTH },
    { x: -3.2, z: -5.95, facing: NORTH },
    { x: -6.4, z: -2.4, facing: EAST },
    { x: -5.2, z: -2.4, facing: EAST },
    { x: -3.4, z: -2.6, facing: EAST },
    { x: -7.4, z: -4.2, facing: EAST },
    { x: -5.8, z: -4.2, facing: SOUTH },
    { x: -4.2, z: -4.4, facing: SOUTH },
  ],
  atelier: [
    { x: 2.6, z: -5.75, facing: NORTH },
    { x: 6.6, z: -5.75, facing: NORTH },
    { x: 2.6, z: -2.15, facing: NORTH },
    { x: 6.6, z: -2.15, facing: NORTH },
    { x: 4.6, z: -7.6, facing: EAST },
    { x: 8.2, z: -4.4, facing: WEST },
    { x: 4.6, z: -4.4, facing: NORTH },
    { x: 8.2, z: -2.2, facing: WEST },
  ],
  biblio: [
    { x: -7.2, z: 7.3, facing: SOUTH },
    { x: -4.6, z: 7.3, facing: SOUTH },
    { x: -2.0, z: 7.3, facing: SOUTH },
    { x: -4.6, z: 4.1, facing: NORTH },
    { x: -5.9, z: 3.1, facing: EAST },
    { x: -3.3, z: 3.1, facing: WEST },
    { x: -4.6, z: 2.1, facing: SOUTH },
    { x: -7.6, z: 5.4, facing: SOUTH },
  ],
  serveur: [
    { x: 3.0, z: 7.2, facing: SOUTH },
    { x: 4.6, z: 7.2, facing: SOUTH },
    { x: 6.2, z: 7.2, facing: SOUTH },
    { x: 7.8, z: 7.2, facing: SOUTH },
    { x: 3.0, z: 5.4, facing: SOUTH },
    { x: 4.6, z: 5.4, facing: SOUTH },
    { x: 6.2, z: 5.4, facing: SOUTH },
    { x: 7.8, z: 5.4, facing: SOUTH },
  ],
};

/** Seat `index` of a room; past the furniture, agents stand in a spiral around the room centre. */
export function seatAt(room: RoomId, index: number): Seat {
  const list = SEATS[room];
  if (index < list.length) return list[index];
  const extra = index - list.length;
  const [cx, cz] = ROOMS.find((r) => r.id === room)!.center;
  const angle = extra * 2.4;
  const radius = 1 + 0.35 * Math.sqrt(extra);
  const x = cx + Math.cos(angle) * radius;
  const z = cz + Math.sin(angle) * radius;
  // Same atan2(dx, dz) convention as walking: face the room centre.
  return { x, z, facing: Math.atan2(cx - x, cz - z) };
}

/** Waypoints from one room to another through the hub. */
export function routeBetween(from: { x: number; z: number }, to: Seat, sameRoom: boolean): { x: number; z: number }[] {
  if (sameRoom) return [{ x: to.x, z: to.z }];
  return [
    { x: from.x * 0.3, z: from.z * 0.3 },
    { x: 0, z: 0 },
    { x: to.x * 0.3, z: to.z * 0.3 },
    { x: to.x, z: to.z },
  ];
}
