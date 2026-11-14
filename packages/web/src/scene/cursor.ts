import type { Intersection, Object3D } from 'three';

// Pointer rules shared by agent figures and workstations.

const hovered = new Set<string>();

/**
 * One owner for the cursor over the scene: figures and workstations register what is hovered
 * synchronously in their handlers; the cursor is a hand while anything is.
 */
export function setPointerHover(key: string, on: boolean): void {
  if (on) hovered.add(key);
  else hovered.delete(key);
  document.body.style.cursor = hovered.size > 0 ? 'pointer' : '';
}

/** A pointer that moved more than this between press and release was dragging the camera (R3F's own pointer-missed limit). */
export const CLICK_MAX_DRAG_PX = 2;

/** userData flag of every clickable target in the scene (agent figure, workstation hit boxes). */
export const POINTER_TARGET = 'pointerTarget';

/** Shared userData object, frozen so that no target writes into the others' (R3F replaces `userData` when the prop object changes). */
export const TARGET_USER_DATA = Object.freeze({ [POINTER_TARGET]: true });

/** The clickable target nearest to the camera along the ray, if any. */
export function nearestTarget(intersections: readonly (Intersection & { eventObject: Object3D })[]): Object3D | undefined {
  return intersections.find((i) => i.eventObject.userData[POINTER_TARGET])?.eventObject;
}
