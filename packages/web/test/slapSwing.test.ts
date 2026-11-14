import { describe, expect, it } from 'vitest';
import { SWING_DURATION, SWING_IMPACT, swingAngle, swingPose, type SwingPose } from '../src/scene/slapSwing.ts';

// Evenly spaced instants covering the whole sweep, both ends included exactly.
const STEPS = 64;
const SAMPLES = Array.from({ length: STEPS + 1 }, (_, i) => (i / STEPS) * SWING_DURATION);

function pose(time: number, dir: 1 | -1): SwingPose {
  const p = swingPose(time, dir);
  if (p === null) throw new Error(`expected a pose at t=${time}`);
  return p;
}

describe('swing timing constants', () => {
  /** Verifies that the impact happens strictly inside the sweep, after it starts */
  it('places SWING_IMPACT strictly between 0 and SWING_DURATION', () => {
    expect(SWING_IMPACT).toBeGreaterThan(0);
    expect(SWING_IMPACT).toBeLessThan(SWING_DURATION);
  });
});

describe('swingAngle', () => {
  /** Verifies that the sweep angle is exactly 0 at the moment of impact */
  it('is zero at SWING_IMPACT', () => {
    expect(swingAngle(SWING_IMPACT)).toBeCloseTo(0, 12);
  });

  /** Verifies that the angle is negative before the impact and positive after it */
  it('is negative before the impact and positive after', () => {
    expect(swingAngle(0)).toBeLessThan(0);
    expect(swingAngle(SWING_DURATION)).toBeGreaterThan(0);
  });

  /** Verifies that the angle strictly increases across the whole sweep */
  it('is strictly increasing over the sweep', () => {
    for (let i = 1; i < SAMPLES.length; i++) {
      expect(swingAngle(SAMPLES[i])).toBeGreaterThan(swingAngle(SAMPLES[i - 1]));
    }
  });

  /** Verifies that the angle advances at constant speed (equal steps, equal increments) */
  it('advances linearly with time', () => {
    const d1 = swingAngle(0.1) - swingAngle(0);
    const d2 = swingAngle(0.3) - swingAngle(0.2);
    expect(d2).toBeCloseTo(d1, 12);
  });
});

describe('swingPose — range', () => {
  /** Verifies that a pose exists at both ends of the sweep, bounds included */
  it('returns a pose at 0 and at SWING_DURATION', () => {
    for (const dir of [1, -1] as const) {
      expect(swingPose(0, dir)).not.toBeNull();
      expect(swingPose(SWING_DURATION, dir)).not.toBeNull();
    }
  });

  /** Verifies that every instant inside the sweep yields a pose */
  it('returns a pose for every instant inside the sweep', () => {
    for (const time of SAMPLES) {
      expect(swingPose(time, 1)).not.toBeNull();
      expect(swingPose(time, -1)).not.toBeNull();
    }
  });

  /** Verifies that times outside [0, SWING_DURATION] or not a number yield null */
  it.each([
    ['NaN', Number.NaN],
    ['just before start', -1e-9],
    ['negative', -0.5],
    ['just past the end', SWING_DURATION + 1e-9],
    ['well past the end', SWING_DURATION * 10],
    ['+Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('returns null for %s', (_label, time) => {
    expect(swingPose(time, 1)).toBeNull();
    expect(swingPose(time, -1)).toBeNull();
  });
});

describe('swingPose — impact', () => {
  /** Verifies that at impact the hand is horizontally centred on the head */
  it('is centred horizontally at SWING_IMPACT', () => {
    for (const dir of [1, -1] as const) {
      expect(pose(SWING_IMPACT, dir).right).toBeCloseTo(0, 10);
    }
  });

  /** Verifies that at impact the hand is in front of the head (camera side) */
  it('is in front of the head at SWING_IMPACT', () => {
    for (const dir of [1, -1] as const) {
      expect(pose(SWING_IMPACT, dir).toward).toBeGreaterThan(0);
    }
  });

  /** Verifies that the hand is fully grown when it crosses the face */
  it('has full scale at SWING_IMPACT', () => {
    expect(pose(SWING_IMPACT, 1).scale).toBe(1);
    expect(pose(SWING_IMPACT, -1).scale).toBe(1);
  });

  /** Verifies that the hand is closest to the camera at impact (front of the arc) */
  it('reaches its maximum toward value at SWING_IMPACT', () => {
    const atImpact = pose(SWING_IMPACT, 1).toward;
    for (const time of SAMPLES) {
      expect(pose(time, 1).toward).toBeLessThanOrEqual(atImpact + 1e-12);
    }
  });
});

describe('swingPose — direction of the sweep', () => {
  /** Verifies that the hand starts on the -dir side and ends on the +dir side */
  it('starts on the -dir side and ends on the +dir side', () => {
    for (const dir of [1, -1] as const) {
      expect(Math.sign(pose(0, dir).right)).toBe(-dir);
      expect(Math.sign(pose(SWING_DURATION, dir).right)).toBe(dir);
    }
  });

  /** Verifies that the hand is on the -dir side before impact and +dir side after */
  it('stays on the -dir side before impact and the +dir side after', () => {
    for (const dir of [1, -1] as const) {
      for (const time of SAMPLES) {
        if (Math.abs(time - SWING_IMPACT) < 1e-9) continue;
        const expected = time < SWING_IMPACT ? -dir : dir;
        expect(Math.sign(pose(time, dir).right)).toBe(expected);
      }
    }
  });

  /** Verifies that dir -1 mirrors dir 1: right flips, everything else is equal */
  it('mirrors the pose between dir 1 and dir -1', () => {
    for (const time of SAMPLES) {
      const a = pose(time, 1);
      const b = pose(time, -1);
      expect(b.right).toBeCloseTo(-a.right, 12);
      expect(b.tangentRight).toBeCloseTo(-a.tangentRight, 12);
      expect(b.up).toBeCloseTo(a.up, 12);
      expect(b.toward).toBeCloseTo(a.toward, 12);
      expect(b.tangentToward).toBeCloseTo(a.tangentToward, 12);
      expect(b.scale).toBeCloseTo(a.scale, 12);
      expect(b.roll).toBeCloseTo(a.roll, 12);
    }
  });
});

describe('swingPose — tangent', () => {
  /** Verifies that the tangent in the right/toward plane has unit length */
  it('is a unit vector at every instant', () => {
    for (const dir of [1, -1] as const) {
      for (const time of SAMPLES) {
        const p = pose(time, dir);
        expect(Math.hypot(p.tangentRight, p.tangentToward)).toBeCloseTo(1, 10);
      }
    }
  });

  /** Verifies that the tangent points the same way as the actual motion of the hand */
  it('agrees with the finite-difference motion over the whole sweep', () => {
    const h = 1e-5;
    for (const dir of [1, -1] as const) {
      for (const time of SAMPLES) {
        const t0 = Math.max(0, time - h);
        const t1 = Math.min(SWING_DURATION, time + h);
        const p0 = pose(t0, dir);
        const p1 = pose(t1, dir);
        const vr = (p1.right - p0.right) / (t1 - t0);
        const vt = (p1.toward - p0.toward) / (t1 - t0);
        const p = pose(time, dir);
        const speed = Math.hypot(vr, vt);
        expect(speed).toBeGreaterThan(0);
        // Cosine between the tangent and the velocity: aligned, not merely same half-plane.
        expect((p.tangentRight * vr + p.tangentToward * vt) / speed).toBeCloseTo(1, 4);
      }
    }
  });

  /** Verifies that near impact the hand moves horizontally in the dir direction */
  it('moves along +dir horizontally near impact', () => {
    const h = 1e-4;
    for (const dir of [1, -1] as const) {
      const vr = (pose(SWING_IMPACT + h, dir).right - pose(SWING_IMPACT - h, dir).right) / (2 * h);
      expect(Math.sign(vr)).toBe(dir);
      expect(Math.sign(pose(SWING_IMPACT, dir).tangentRight)).toBe(dir);
    }
  });
});

describe('swingPose — scale', () => {
  /** Verifies that the hand is invisible (scale 0) at both ends of the sweep */
  it('is 0 at the start and at the end', () => {
    for (const dir of [1, -1] as const) {
      expect(pose(0, dir).scale).toBeCloseTo(0, 12);
      expect(pose(SWING_DURATION, dir).scale).toBeCloseTo(0, 12);
    }
  });

  /** Verifies that the hand is full size in the middle of the sweep */
  it('is 1 in the middle of the sweep', () => {
    expect(pose(SWING_DURATION / 2, 1).scale).toBe(1);
  });

  /** Verifies that the scale never leaves [0, 1] at any instant */
  it('stays within [0, 1] over the whole sweep', () => {
    for (const time of SAMPLES) {
      const { scale } = pose(time, 1);
      expect(scale).toBeGreaterThanOrEqual(0);
      expect(scale).toBeLessThanOrEqual(1);
    }
  });

  /** Verifies that the hand grows in before the middle and shrinks out after it */
  it('grows monotonically then shrinks monotonically', () => {
    const mid = SWING_DURATION / 2;
    for (let i = 1; i < SAMPLES.length; i++) {
      const prev = pose(SAMPLES[i - 1], 1).scale;
      const cur = pose(SAMPLES[i], 1).scale;
      if (SAMPLES[i] <= mid) expect(cur).toBeGreaterThanOrEqual(prev);
      else expect(cur).toBeLessThanOrEqual(prev);
    }
  });
});
