import { describe, expect, it } from 'vitest';
import { Object3D, Vector3, type Intersection } from 'three';
import { nearestTarget, POINTER_TARGET, TARGET_USER_DATA } from '../src/scene/cursor.ts';

function hit(eventObject: Object3D, distance: number): Intersection & { eventObject: Object3D } {
  return { distance, point: new Vector3(), object: eventObject, eventObject };
}

function target(): Object3D {
  const o = new Object3D();
  o.userData = TARGET_USER_DATA;
  return o;
}

describe('nearestTarget', () => {
  /** Verifies that the first clickable target along the sorted ray wins */
  it('returns the nearest flagged event object', () => {
    const post = target();
    const agent = target();
    expect(nearestTarget([hit(post, 1), hit(agent, 2)])).toBe(post);
    expect(nearestTarget([hit(agent, 1), hit(post, 2)])).toBe(agent);
  });

  /** Verifies that objects without the target flag are skipped */
  it('skips objects that are not pointer targets', () => {
    const other = new Object3D();
    const post = target();
    expect(nearestTarget([hit(other, 0.5), hit(post, 1)])).toBe(post);
  });

  /** Verifies that an empty or target-free ray gives nothing */
  it('returns undefined when no target is hit', () => {
    expect(nearestTarget([])).toBeUndefined();
    expect(nearestTarget([hit(new Object3D(), 1)])).toBeUndefined();
  });

  /** Verifies that the shared user data carries the flag */
  it('flags targets through the shared user data', () => {
    expect(TARGET_USER_DATA[POINTER_TARGET]).toBe(true);
  });
});
