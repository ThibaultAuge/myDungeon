// What a figure does once it stands at its place: a work gesture fitting its room or post,
// or a seated pose at rest in the tavern and the relaxation corner. Pure logic, no
// three.js, testable in node. `clipFor` (characters.ts) plays the result through
// `ClipInput.place`, below every gag (slap, potion), the walk and the altar wait.
import type { AgentState, RoomId } from '@agent-office/shared';
import { hold, play, type ClipChoice, type ClipName } from './characters.ts';
import type { StationId } from './layout.ts';

/** Where in a room a spot is, read from its id (`<room>:<kind>:<n>`, see layout.ts). */
export type SeatKind = 'station' | 'seat' | 'wall' | 'scatter' | 'other';

export interface SeatRef {
  kind: SeatKind;
  /** Index of the seat in its list; 0 when the id has none. */
  index: number;
}

/** Reads a spot id built by `candidateSeats` / `assignSpots`. Queue, spawn and outside spots are `other`. */
export function seatOf(spotId: string, room: RoomId, station?: StationId): SeatRef {
  const prefix = `${room}:`;
  if (!spotId.startsWith(prefix)) return { kind: 'other', index: 0 };
  const rest = spotId.slice(prefix.length);
  const cut = rest.lastIndexOf(':');
  if (cut < 0) return { kind: 'other', index: 0 };
  const tag = rest.slice(0, cut);
  const n = Number(rest.slice(cut + 1));
  const index = Number.isInteger(n) && n >= 0 ? n : 0;
  if (station && tag === station) return { kind: 'station', index };
  if (tag === 'seat' || tag === 'wall' || tag === 'scatter') return { kind: tag, index };
  return { kind: 'other', index };
}

/** A gesture: a looping clip and its rate. Several in a list alternate from seat to seat. */
interface Gesture {
  clip: ClipName;
  rate?: number;
}

const g = (clip: ClipName, rate = 1): Gesture => ({ clip, rate });

/**
 * The work gesture of each room, by seat index (neighbours do different things). Rooms
 * absent from this table keep `Interact`: the altar's sacristan (the altar belongs to
 * altarWait.ts) and the tavern, where nobody works.
 */
export const ROOM_GESTURES: Readonly<Partial<Record<RoomId, readonly Gesture[]>>> = {
  atelier: [g('Hammering'), g('Sawing'), g('Working_A')],
  machines: [g('Working_A'), g('Working_C'), g('Working_B')],
  biblio: [g('Work_A'), g('Work_C')],
  scriptorium: [g('Work_B')],
  cartes: [g('Work_C'), g('Work_A')],
  arithmetique: [g('Work_B'), g('Work_A')],
  observatoire: [g('Ranged_Magic_Spellcasting')],
  pigeonnier: [g('Work_C')],
  garde: [g('Melee_Blocking'), g('Melee_2H_Idle')],
  epreuves: [g('Melee_1H_Attack_Chop'), g('Ranged_Bow_Draw')],
  heraut: [g('Work_A')],
  concierge: [g('Lockpicking')],
};

/** Dedicated posts that call for their own gesture, over their room's. */
export const STATION_GESTURES: Readonly<Partial<Record<StationId, readonly Gesture[]>>> = {
  chevalet: [g('Working_B')],
  boulier: [g('Working_C')],
  relecture: [g('Work_A')],
  labo: [g('Working_A')],
};

/** Seated at a table or on the couch: the pose of the tavern and of the relaxation corner. */
export const CHAIR_CLIP = 'Sit_Chair_Idle' satisfies ClipName;
/** Sitting on the floor against a wall, where no stool stands. */
export const FLOOR_CLIP = 'Sit_Floor_Idle' satisfies ClipName;
/** Push-ups in the relaxation corner: the odd one out, on the first wall place. */
export const PUSH_UPS_CLIP = 'Push_Ups' satisfies ClipName;
/** Released once at the dovecote lectern when the agent's pigeon leaves (pigeon.ts). */
export const THROW_CLIP = 'Throw' satisfies ClipName;
/** Length of Throw at timeScale 1, read from Rig_Medium_General.glb (a test checks it). */
export const THROW_CLIP_TIME = 41 / 30;
/** Time in Sit_Chair_Idle / Sit_Floor_Idle shown under reduced motion: a settled pose. */
export const SIT_STILL_AT = 0;

export interface PlaceInput {
  room: RoomId;
  station?: StationId;
  seat: SeatRef;
  state: AgentState;
  reducedMotion: boolean;
  /** The agent's pigeon just left the dovecote: throw it. */
  throwing?: boolean;
}

/** Tavern and relaxation-corner seats that have a stool or the couch under them (layout.ts order). */
function hasChair(room: RoomId, seat: SeatRef): boolean {
  if (seat.kind !== 'seat') return false;
  return room === 'taverne' || room === 'detente';
}

/**
 * The clip of a figure standing still at its place, or null to keep the default chain
 * (`Interact` at work, `Idle_A` / `Idle_B` otherwise). Seated poses are held still under
 * reduced motion; moving gestures give way to the still `Idle_A`.
 */
export function placeClip(input: PlaceInput): ClipChoice | null {
  const { room, station, seat, state, reducedMotion, throwing } = input;
  if (seat.kind === 'other') return null;
  const seated = (clip: ClipName) => (reducedMotion ? hold(clip, SIT_STILL_AT) : play(clip));
  // Resting: the tavern, and the main agent waiting there for a prompt.
  if (room === 'taverne') {
    if (state === 'working') return null;
    if (hasChair(room, seat)) return seated(CHAIR_CLIP);
    return seated(FLOOR_CLIP);
  }
  if (state !== 'working') return null;
  if (room === 'detente') {
    if (hasChair(room, seat)) return seated(CHAIR_CLIP);
    if (seat.kind === 'wall' && seat.index === 0 && !reducedMotion) return play(PUSH_UPS_CLIP);
    return seated(FLOOR_CLIP);
  }
  if (reducedMotion) return null;
  if (room === 'pigeonnier' && throwing) return play(THROW_CLIP, 1, false);
  const list = (station && STATION_GESTURES[station]) || ROOM_GESTURES[room];
  if (!list) return null;
  const pick = list[seat.index % list.length];
  return play(pick.clip, pick.rate);
}

type Listener = () => void;
const throwListeners = new Map<string, Set<Listener>>();

/**
 * A pigeon really left the aviary for `agentId`'s call (Pigeons.tsx calls this when a flight is
 * drawn, never for a silent one): its figure throws. Returns true when a figure listened.
 */
export function throwPigeon(agentId: string): boolean {
  const set = throwListeners.get(agentId);
  if (!set || set.size === 0) return false;
  for (const listener of [...set]) listener();
  return true;
}

/** Called each time a pigeon leaves for this agent. Returns the unsubscribe function. */
export function onThrow(agentId: string, listener: Listener): () => void {
  let set = throwListeners.get(agentId);
  if (!set) throwListeners.set(agentId, (set = new Set()));
  set.add(listener);
  return () => {
    const current = throwListeners.get(agentId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) throwListeners.delete(agentId);
  };
}

/** Seconds since the throw began, `delta` later, or -1 once the clip is over (or when none runs). */
export function advanceThrow(at: number, delta: number): number {
  if (at < 0) return -1;
  return at + delta >= THROW_CLIP_TIME ? -1 : at + delta;
}
