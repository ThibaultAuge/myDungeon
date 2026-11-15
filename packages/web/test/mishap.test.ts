import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomId } from '@agent-office/shared';
import {
  PUFF_COUNT,
  SOOT_FADE_MS,
  SOOT_HOLD_MS,
  SOOT_MS,
  hasMishapTarget,
  isTestCommand,
  mishapFor,
  mishapTarget,
  onMishap,
  onRoomMishap,
  puffParticles,
  sootAmount,
  triggerMishap,
  type MishapKind,
} from '../src/scene/mishap.ts';

// The bus is module state: every test uses its own agent ids and every subscription made
// through `sub` / `subRoom` is undone after the test, so no listener leaks between tests.
let seq = 0;
const freshId = (label = 'agent') => `${label}-${++seq}`;
const subscriptions: (() => void)[] = [];
function sub(id: string, listener: (kind: MishapKind) => void): () => void {
  const off = onMishap(id, listener);
  subscriptions.push(off);
  return off;
}
function subRoom(listener: (kind: MishapKind) => void): () => void {
  const off = onRoomMishap(listener);
  subscriptions.push(off);
  return off;
}

afterEach(() => {
  for (const off of subscriptions.splice(0)) off();
});

// ---------------------------------------------------------------- isTestCommand

describe('isTestCommand', () => {
  /** Verifies that common test commands of every supported ecosystem are recognised */
  it.each([
    'npm test',
    'npm t',
    'npm run test:unit',
    'pnpm test',
    'yarn test',
    'bun test',
    'npx vitest run',
    'pnpm exec jest',
    'vitest',
    './node_modules/.bin/vitest.cmd',
    'pytest -q',
    'python -m pytest',
    'python3 -m unittest',
    'mvn -q test',
    './gradlew check',
    '.\\mvnw.cmd verify',
    'cargo test',
    'go test ./...',
    'dotnet test',
    'npx playwright test',
  ])('recognises %j as a test command', (command) => {
    expect(isTestCommand(command)).toBe(true);
  });

  /** Verifies that a test command anywhere in a chained or prefixed command is recognised */
  it.each([
    'cd packages/web && npm test',
    'CI=1 npm test',
    'npm test; echo done',
    'npm run build || npm test',
    'npm run build\nnpm test',
  ])('recognises the chained or prefixed command %j', (command) => {
    expect(isTestCommand(command)).toBe(true);
  });

  /** Verifies that non-test commands, even mentioning the word test, are rejected */
  it.each([
    'npm install',
    'npm run build',
    'npm run testing',
    'git commit -m "test"',
    'echo test',
    'go build',
    'npx playwright install',
    'cat test.txt',
    'cd test && ls',
  ])('rejects %j', (command) => {
    expect(isTestCommand(command)).toBe(false);
  });

  /** Verifies that empty, blank and missing commands are not test commands */
  it.each(['', '   ', '\n', ';;&&', 'CI=1', undefined])('rejects the empty command %j', (command) => {
    expect(isTestCommand(command)).toBe(false);
  });

  /** Verifies that program names are matched case-insensitively (Windows executables) */
  it('matches the program name regardless of case and extension', () => {
    expect(isTestCommand('NPM.CMD test')).toBe(true);
    expect(isTestCommand('C:\\tools\\Cargo.exe test')).toBe(true);
  });

  /** Verifies that very long crafted commands are processed in bounded time */
  it.each([
    ['spaces', ' '.repeat(200_000)],
    ['one long word', 'a'.repeat(200_000)],
    ['ampersands', '&'.repeat(200_000)],
    ['many short segments', 'a &'.repeat(70_000)],
    ['many words', 'a '.repeat(100_000)],
    ['environment assignments', 'A=1 '.repeat(50_000)],
  ])('returns quickly for 200 KB of %s', (_label, command) => {
    const start = performance.now();
    const result = isTestCommand(command);
    const elapsed = performance.now() - start;
    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(200);
  });
});

// ---------------------------------------------------------------- mishapFor

describe('mishapFor', () => {
  const failure = (tool: string | undefined, detail: string | undefined) => ({
    event: 'PostToolUseFailure',
    tool,
    detail,
  });

  /** Verifies that a failed test command in a shell blows up the flask, in every room */
  it.each([
    ['Bash', 'machines'],
    ['Bash', 'epreuves'],
    ['PowerShell', 'biblio'],
    ['PowerShell', undefined],
  ] as const)('returns flask for a failed %s test command (room %s)', (tool, room) => {
    expect(mishapFor(failure(tool, 'npm test'), room as RoomId | undefined)).toBe('flask');
  });

  /** Verifies that a failed non-test shell command in the engine room makes the boiler puff */
  it('returns boiler for another failed command in the machines room', () => {
    expect(mishapFor(failure('Bash', 'npm run build'), 'machines')).toBe('boiler');
    expect(mishapFor(failure('Edit', undefined), 'machines')).toBe('boiler');
    expect(mishapFor(failure(undefined, undefined), 'machines')).toBe('boiler');
  });

  /** Verifies that a non-test failure outside the engine room causes no mishap */
  it.each(['epreuves', 'biblio', 'autel', undefined] as const)('returns null for a failure in room %s', (room) => {
    expect(mishapFor(failure('Bash', 'npm run build'), room as RoomId | undefined)).toBeNull();
  });

  /** Verifies that a test command carried by a non-shell tool is not a flask */
  it('does not treat a test command from a non-shell tool as a flask', () => {
    expect(mishapFor(failure('Read', 'npm test'), 'machines')).toBe('boiler');
    expect(mishapFor(failure('Read', 'npm test'), 'epreuves')).toBeNull();
    expect(mishapFor(failure(undefined, 'npm test'), 'epreuves')).toBeNull();
  });

  /** Verifies that shell tool names are matched exactly (case-sensitive) */
  it('does not treat a lower-case bash tool as a shell', () => {
    expect(mishapFor(failure('bash', 'npm test'), 'epreuves')).toBeNull();
  });

  /** Verifies that only PostToolUseFailure events cause mishaps */
  it.each(['PostToolUse', 'PreToolUse', 'Stop', 'postToolUseFailure', ''])(
    'returns null for the %j event',
    (event) => {
      expect(mishapFor({ event, tool: 'Bash', detail: 'npm test' }, 'machines')).toBeNull();
      expect(mishapFor({ event, tool: 'Bash', detail: 'npm run build' }, 'machines')).toBeNull();
    },
  );
});

// ---------------------------------------------------------------- mishapTarget

describe('mishapTarget', () => {
  /** Verifies that a subagent event targets that subagent */
  it('returns the agentId when present', () => {
    expect(mishapTarget({ sessionId: 's1', agentId: 'a7' })).toBe('a7');
  });

  /** Verifies that an event without agentId targets the session main agent */
  it('returns <sessionId>#main when agentId is absent', () => {
    expect(mishapTarget({ sessionId: 's1' })).toBe('s1#main');
    expect(mishapTarget({ sessionId: 's1', agentId: undefined })).toBe('s1#main');
  });
});

// ---------------------------------------------------------------- sootAmount

describe('sootAmount', () => {
  /** Verifies that the hold, fade and total durations are consistent */
  it('has SOOT_MS equal to hold plus fade, both positive', () => {
    expect(SOOT_HOLD_MS).toBeGreaterThan(0);
    expect(SOOT_FADE_MS).toBeGreaterThan(0);
    expect(SOOT_MS).toBe(SOOT_HOLD_MS + SOOT_FADE_MS);
  });

  /** Verifies that the soot stays at full strength from 0 through the hold period */
  it.each([0, 1, SOOT_HOLD_MS / 2, SOOT_HOLD_MS - 1])('is 1 at %d ms', (elapsed) => {
    expect(sootAmount(elapsed)).toBe(1);
  });

  /** Verifies that the soot fades linearly from 1 to 0 between hold end and SOOT_MS */
  it('fades linearly during the fade period', () => {
    expect(sootAmount(SOOT_HOLD_MS)).toBeCloseTo(1, 10);
    expect(sootAmount(SOOT_HOLD_MS + SOOT_FADE_MS / 4)).toBeCloseTo(0.75, 10);
    expect(sootAmount(SOOT_HOLD_MS + SOOT_FADE_MS / 2)).toBeCloseTo(0.5, 10);
    expect(sootAmount(SOOT_HOLD_MS + (3 * SOOT_FADE_MS) / 4)).toBeCloseTo(0.25, 10);
  });

  /** Verifies that the fade never increases over time */
  it('is non-increasing over the whole timeline', () => {
    let previous = sootAmount(0);
    for (let t = 0; t <= SOOT_MS + 500; t += 50) {
      const v = sootAmount(t);
      expect(v, `at ${t} ms`).toBeLessThanOrEqual(previous);
      expect(v).toBeGreaterThanOrEqual(0);
      previous = v;
    }
  });

  /** Verifies that the soot is gone at and after SOOT_MS */
  it.each([SOOT_MS, SOOT_MS + 1, SOOT_MS * 10, Infinity])('is 0 at %d ms', (elapsed) => {
    expect(sootAmount(elapsed)).toBe(0);
  });

  /** Verifies that under reduced motion the soot stays full then disappears at once */
  it('stays at 1 until SOOT_MS then drops to 0 with reduced motion', () => {
    for (const t of [0, SOOT_HOLD_MS - 1, SOOT_HOLD_MS, SOOT_HOLD_MS + SOOT_FADE_MS / 2, SOOT_MS - 1]) {
      expect(sootAmount(t, true), `at ${t} ms`).toBe(1);
    }
    expect(sootAmount(SOOT_MS, true)).toBe(0);
    expect(sootAmount(SOOT_MS + 1000, true)).toBe(0);
  });

  /** Verifies that a negative elapsed time (clock skew) counts as just hit */
  it.each([-1, -1000, -Infinity])('is 1 for the negative elapsed %d', (elapsed) => {
    expect(sootAmount(elapsed)).toBe(1);
    expect(sootAmount(elapsed, true)).toBe(1);
  });

  /** Verifies that NaN elapsed time yields a clean figure instead of NaN */
  it('is 0 for NaN', () => {
    expect(sootAmount(NaN)).toBe(0);
    expect(sootAmount(NaN, true)).toBe(0);
  });
});

// ---------------------------------------------------------------- puffParticles

describe('puffParticles', () => {
  /** Verifies that a puff always has PUFF_COUNT particles */
  it.each([0, 0.25, 0.5, 1])('returns PUFF_COUNT particles at progress %d', (p) => {
    expect(PUFF_COUNT).toBeGreaterThan(0);
    expect(puffParticles(p)).toHaveLength(PUFF_COUNT);
  });

  /** Verifies that all particles start at the origin, invisible */
  it('places every particle at the origin at progress 0', () => {
    for (const particle of puffParticles(0)) {
      expect(particle.x).toBeCloseTo(0, 10);
      expect(particle.y).toBeCloseTo(0, 10);
      expect(particle.z).toBeCloseTo(0, 10);
      expect(particle.opacity).toBe(0);
      expect(particle.scale).toBeGreaterThan(0);
    }
  });

  /** Verifies that particles move away from the origin and rise as the puff progresses */
  it('spreads and rises the particles later in the puff', () => {
    for (const particle of puffParticles(0.5)) {
      expect(Math.hypot(particle.x, particle.z)).toBeGreaterThan(0);
      expect(particle.y).toBeGreaterThan(0);
    }
  });

  /** Verifies that opacity rises from 0 to a peak, then falls back to 0 at the end */
  it('fades in then out', () => {
    const opacity = (p: number) => puffParticles(p)[0].opacity;
    expect(opacity(0)).toBe(0);
    expect(opacity(0.1)).toBeGreaterThan(opacity(0));
    expect(opacity(0.25)).toBeCloseTo(1, 10);
    expect(opacity(0.6)).toBeLessThan(opacity(0.25));
    expect(opacity(0.9)).toBeLessThan(opacity(0.6));
    expect(opacity(1)).toBeCloseTo(0, 10);
    for (let p = 0; p <= 1; p += 0.05) {
      for (const particle of puffParticles(p)) {
        expect(particle.opacity).toBeGreaterThanOrEqual(-1e-12);
        expect(particle.opacity).toBeLessThanOrEqual(1 + 1e-12);
      }
    }
  });

  /** Verifies that the puff is deterministic (no randomness) */
  it('returns the same particles for the same progress', () => {
    expect(puffParticles(0.4)).toEqual(puffParticles(0.4));
  });

  /** Verifies that out-of-range progress is clamped to the 0..1 interval */
  it('clamps progress below 0 and above 1', () => {
    expect(puffParticles(-0.5)).toEqual(puffParticles(0));
    expect(puffParticles(-100)).toEqual(puffParticles(0));
    expect(puffParticles(-Infinity)).toEqual(puffParticles(0));
    expect(puffParticles(1.5)).toEqual(puffParticles(1));
    expect(puffParticles(Infinity)).toEqual(puffParticles(1));
  });

  /** Verifies that NaN progress yields a finished, invisible puff with finite values */
  it('treats NaN progress as the end of the puff', () => {
    const particles = puffParticles(NaN);
    expect(particles).toEqual(puffParticles(1));
    for (const particle of particles) {
      for (const value of Object.values(particle)) expect(Number.isFinite(value)).toBe(true);
      expect(particle.opacity).toBeCloseTo(0, 10);
    }
  });
});

// ---------------------------------------------------------------- bus

describe('triggerMishap, onMishap and onRoomMishap', () => {
  /** Verifies that a mishap reaches room listeners and that agent's figure with its kind */
  it('calls room listeners and the target figure listeners with the kind', () => {
    const id = freshId();
    const room = vi.fn();
    const figure = vi.fn();
    subRoom(room);
    sub(id, figure);
    triggerMishap(id, 'boiler');
    expect(room).toHaveBeenCalledTimes(1);
    expect(room).toHaveBeenCalledWith('boiler');
    expect(figure).toHaveBeenCalledTimes(1);
    expect(figure).toHaveBeenCalledWith('boiler');
    triggerMishap(id, 'flask');
    expect(room).toHaveBeenLastCalledWith('flask');
    expect(figure).toHaveBeenLastCalledWith('flask');
  });

  /** Verifies that room effects play before the figure reacts */
  it('calls room listeners before figure listeners', () => {
    const id = freshId();
    const order: string[] = [];
    sub(id, () => order.push('figure'));
    subRoom(() => order.push('room'));
    triggerMishap(id, 'flask');
    expect(order).toEqual(['room', 'figure']);
  });

  /** Verifies that a mishap never reaches another agent's figure listeners */
  it('does not call figure listeners of other agents', () => {
    const target = freshId();
    const other = freshId();
    const onTarget = vi.fn();
    const onOther = vi.fn();
    sub(target, onTarget);
    sub(other, onOther);
    triggerMishap(target, 'boiler');
    expect(onTarget).toHaveBeenCalledTimes(1);
    expect(onOther).not.toHaveBeenCalled();
  });

  /** Verifies that a mishap without target only plays the room effect */
  it('calls only room listeners when the id is null', () => {
    const id = freshId();
    const room = vi.fn();
    const figure = vi.fn();
    subRoom(room);
    sub(id, figure);
    triggerMishap(null, 'flask');
    expect(room).toHaveBeenCalledWith('flask');
    expect(figure).not.toHaveBeenCalled();
  });

  /** Verifies that triggering with no listener at all does not throw */
  it('does nothing when nobody listens', () => {
    expect(() => triggerMishap(freshId('nobody'), 'boiler')).not.toThrow();
    expect(() => triggerMishap(null, 'flask')).not.toThrow();
  });

  /** Verifies that unsubscribed figure and room listeners are no longer called */
  it('stops calling listeners after unsubscribe', () => {
    const id = freshId();
    const room = vi.fn();
    const figure = vi.fn();
    const offRoom = subRoom(room);
    const offFigure = sub(id, figure);
    offRoom();
    offFigure();
    triggerMishap(id, 'boiler');
    expect(room).not.toHaveBeenCalled();
    expect(figure).not.toHaveBeenCalled();
  });

  /** Verifies that a figure listener unsubscribing during a mishap does not skip the next */
  it('still calls the next figure listener when one unsubscribes itself', () => {
    const id = freshId();
    const order: string[] = [];
    const self: { off?: () => void } = {};
    self.off = sub(id, () => {
      order.push('a');
      self.off?.();
    });
    sub(id, () => order.push('b'));
    triggerMishap(id, 'boiler');
    expect(order).toEqual(['a', 'b']);
    triggerMishap(id, 'boiler');
    expect(order).toEqual(['a', 'b', 'b']);
  });

  /** Verifies that a room listener unsubscribing during a mishap does not skip the next */
  it('still calls the next room listener when one unsubscribes itself', () => {
    const order: string[] = [];
    const self: { off?: () => void } = {};
    self.off = subRoom(() => {
      order.push('a');
      self.off?.();
    });
    subRoom(() => order.push('b'));
    triggerMishap(null, 'flask');
    expect(order).toEqual(['a', 'b']);
    triggerMishap(null, 'flask');
    expect(order).toEqual(['a', 'b', 'b']);
  });

  /** Verifies that calling a figure unsubscribe twice keeps the agent's other listeners */
  it('ignores a second figure unsubscribe', () => {
    const id = freshId();
    const kept = vi.fn();
    sub(id, kept);
    const off = sub(id, vi.fn());
    off();
    expect(() => off()).not.toThrow();
    triggerMishap(id, 'boiler');
    expect(kept).toHaveBeenCalledTimes(1);
  });

  /** Verifies that a stale figure unsubscribe does not remove a newer listener */
  it('keeps a newer figure listener when an old unsubscribe is called again', () => {
    const id = freshId();
    const off = sub(id, vi.fn());
    off();
    const fresh = vi.fn();
    sub(id, fresh);
    off();
    triggerMishap(id, 'flask');
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  /** Verifies that calling a room unsubscribe twice keeps the other room listeners */
  it('ignores a second room unsubscribe', () => {
    const kept = vi.fn();
    subRoom(kept);
    const off = subRoom(vi.fn());
    off();
    expect(() => off()).not.toThrow();
    triggerMishap(null, 'boiler');
    expect(kept).toHaveBeenCalledTimes(1);
  });
});

describe('hasMishapTarget', () => {
  /** Verifies that an agent without figure listener has no target */
  it('is false for an agent without listener', () => {
    expect(hasMishapTarget(freshId('nobody'))).toBe(false);
  });

  /** Verifies that the target exists while a listener is registered, and goes after */
  it('is true while a listener is registered and false after unsubscribe', () => {
    const id = freshId();
    const off = sub(id, vi.fn());
    expect(hasMishapTarget(id)).toBe(true);
    off();
    expect(hasMishapTarget(id)).toBe(false);
    off();
    expect(hasMishapTarget(id)).toBe(false);
  });

  /** Verifies that the target stays until the last of several listeners leaves */
  it('stays true until the last listener unsubscribes', () => {
    const id = freshId();
    const offA = sub(id, vi.fn());
    const offB = sub(id, vi.fn());
    offA();
    offA();
    expect(hasMishapTarget(id)).toBe(true);
    offB();
    expect(hasMishapTarget(id)).toBe(false);
  });

  /** Verifies that room listeners do not count as figure targets */
  it('is not made true by a room listener', () => {
    subRoom(vi.fn());
    expect(hasMishapTarget(freshId())).toBe(false);
  });
});
