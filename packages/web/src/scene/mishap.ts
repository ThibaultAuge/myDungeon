// Mishaps: a purely visual gag when a tool fails. A failed command in the engine room makes
// the boiler go "poof" and leaves the agent covered in soot; a failed test run makes the
// alchemy flask of the trial room blow up in green. Nothing is sent to the server and the
// agent's work is not touched. Pure module, no three.js, testable in node.
import type { HookEventSummary, RoomId } from '@agent-office/shared';
import { gagCommands } from './gagCommands.ts';

export type MishapKind = 'boiler' | 'flask';

/** How long the soot stays at full strength, then how long it takes to wash off, in milliseconds. */
export const SOOT_HOLD_MS = 3000;
export const SOOT_FADE_MS = 1500;
export const SOOT_MS = SOOT_HOLD_MS + SOOT_FADE_MS;
/** How long the comic bubble stays over the agent. */
export const MISHAP_BUBBLE_MS = 1500;
/** How long the puff of smoke over the boiler or the flask lasts. */
export const PUFF_MS = 1400;
/** Minimum time between two puffs of the same source: at most about 2–3 flashes per second (WCAG 2.3.1). */
export const PUFF_GAP_MS = 400;
/**
 * How long the watcher waits for the snapshot that follows a failure before deciding with
 * what it has: the event is sent at once, snapshots are throttled, so the agent's room in
 * the store may still be the one before the failed command.
 */
export const MISHAP_SETTLE_MS = 400;

/** Colour multiplied into the agent's materials at full soot: black from the boiler, green from the flask. */
export const SOOT_COLORS: Record<MishapKind, string> = { boiler: '#2a2622', flask: '#4fb35a' };
/** Colour of the smoke puff. */
// Light grey, not dark: a dark puff vanishes against the stone floor seen from above.
export const PUFF_COLORS: Record<MishapKind, string> = { boiler: '#e4ddd2', flask: '#5dff7a' };

/** Package runners whose `test` script runs the tests: `npm test`, `pnpm run test:unit`… */
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
/** Runners that launch packages: `npx vitest`, `bunx jest`… The next word is the command. */
const LAUNCHERS = new Set(['npx', 'pnpx', 'bunx']);
/** Test runners called directly. */
const TEST_RUNNERS = new Set(['vitest', 'jest', 'mocha', 'ava', 'pytest', 'phpunit', 'rspec', 'tox', 'nox']);
/** Build tools with a test subcommand anywhere in their arguments: `mvn -q test`, `./gradlew check`. */
const BUILD_TEST_GOALS: Record<string, ReadonlySet<string>> = {
  mvn: new Set(['test', 'verify']),
  mvnw: new Set(['test', 'verify']),
  gradle: new Set(['test', 'check']),
  gradlew: new Set(['test', 'check']),
};
/** Tools whose first argument is `test`: `cargo test`, `go test`, `dotnet test`… */
const TEST_SUBCOMMAND = new Set(['cargo', 'go', 'dotnet', 'deno', 'swift', 'mix', 'make']);
const PYTHONS = new Set(['python', 'python3', 'py']);
/** Longest command text parsed; the server sends at most 200 characters. */
const MAX_COMMAND = 1000;

/** `./node_modules/.bin/vitest.cmd` → `vitest`: the bare, lower-case program name. */
function program(word: string): string {
  const base = word.split(/[\\/]/).pop() ?? word;
  return base.toLowerCase().replace(/\.(cmd|exe|bat|ps1|sh)$/, '');
}

/** True for `test` and `test:something` (npm script names), not for `testing`. */
function isTestScript(word: string | undefined): boolean {
  return word !== undefined && /^test(?::|$)/i.test(word);
}

function segmentRunsTests(segment: string): boolean {
  const all = segment.trim().split(/\s+/).filter(Boolean);
  // `CI=1 npm test`: leading environment assignments are not the program. One slice, not a
  // `shift()` per word, which could copy a huge crafted array over and over.
  const first = all.findIndex((w) => !/^\w+=/.test(w));
  if (first < 0) return false;
  const words = all.slice(first);
  let cmd = program(words[0]);
  let args = words.slice(1);
  // `npx vitest`, `pnpm exec jest`, `yarn dlx jest`: the launched program is what counts.
  if (LAUNCHERS.has(cmd) || (PACKAGE_MANAGERS.has(cmd) && (args[0] === 'exec' || args[0] === 'dlx'))) {
    const rest = LAUNCHERS.has(cmd) ? args : args.slice(1);
    const next = rest.findIndex((w) => !w.startsWith('-'));
    if (next < 0) return false;
    cmd = program(rest[next]);
    args = rest.slice(next + 1);
  }
  if (PACKAGE_MANAGERS.has(cmd)) {
    if (isTestScript(args[0]) || args[0] === 't') return true;
    return (args[0] === 'run' || args[0] === 'run-script') && isTestScript(args[1]);
  }
  if (TEST_RUNNERS.has(cmd)) return true;
  if (cmd === 'playwright') return args[0] === 'test';
  if (PYTHONS.has(cmd)) {
    const m = args.indexOf('-m');
    return m >= 0 && (args[m + 1] === 'pytest' || args[m + 1] === 'unittest');
  }
  if (Object.hasOwn(BUILD_TEST_GOALS, cmd)) return args.some((a) => BUILD_TEST_GOALS[cmd].has(a.toLowerCase()));
  if (TEST_SUBCOMMAND.has(cmd)) return args[0] === 'test';
  return false;
}

/**
 * True when a shell command runs a test suite, anywhere in a chained command
 * (`cd web && npm test`). No regex with nested repetition: the command comes from a hook.
 * Accepted limits: the server collapses newlines to spaces and cuts the command at 200
 * characters, so a test run on a later line or past the cut is not seen (a boiler instead).
 */
export function isTestCommand(command: string | undefined): boolean {
  if (!command) return false;
  // The server already cuts the command at 200 characters: never parse more than this.
  return command.slice(0, MAX_COMMAND).split(/[;&|()\n]+/).some(segmentRunsTests);
}

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

/**
 * The mishap a hook event causes, or null. A failed test command blows up the flask,
 * wherever the agent stands; any other failure of an agent in the engine room is the boiler.
 */
export function mishapFor(event: Pick<HookEventSummary, 'event' | 'tool' | 'detail'>, agentRoom: RoomId | undefined): MishapKind | null {
  if (event.event !== 'PostToolUseFailure') return null;
  if (event.tool && SHELL_TOOLS.has(event.tool) && isTestCommand(event.detail)) return 'flask';
  return agentRoom === 'machines' ? 'boiler' : null;
}

/** The figure an event belongs to: its subagent, or the session's main agent. */
export function mishapTarget(event: Pick<HookEventSummary, 'sessionId' | 'agentId'>): string {
  return event.agentId ?? `${event.sessionId}#main`;
}

/**
 * How sooty a figure is, from 1 (just hit) to 0 (clean), `elapsed` ms after the mishap.
 * Under reduced motion the soot stays at full strength for the whole `SOOT_MS`, then comes
 * off at once instead of fading.
 */
export function sootAmount(elapsed: number, reduced = false): number {
  if (!Number.isFinite(elapsed) || elapsed < 0) return elapsed < 0 ? 1 : 0;
  if (elapsed < SOOT_HOLD_MS) return 1;
  if (elapsed >= SOOT_MS) return 0;
  return reduced ? 1 : 1 - (elapsed - SOOT_HOLD_MS) / SOOT_FADE_MS;
}

export interface PuffParticle {
  x: number;
  y: number;
  z: number;
  scale: number;
  opacity: number;
}

/** Number of smoke balls in a puff. */
export const PUFF_COUNT = 7;

/**
 * The smoke balls of a puff at `progress` (0 → 1): they burst out from the centre, rise,
 * swell, then fade. Directions are fixed, so every puff looks the same and nothing is random.
 */
export function puffParticles(progress: number): PuffParticle[] {
  // NaN counts as over; ±Infinity clamp like any other out-of-range value.
  const p = Math.min(1, Math.max(0, Number.isNaN(progress) ? 1 : progress));
  const out = 1 - (1 - p) * (1 - p); // ease-out
  return Array.from({ length: PUFF_COUNT }, (_, i) => {
    const angle = (i / PUFF_COUNT) * Math.PI * 2;
    const reach = 0.6 + (i % 3) * 0.2;
    return {
      x: Math.cos(angle) * reach * out,
      y: out * (0.7 + (i % 2) * 0.4),
      z: Math.sin(angle) * reach * out,
      scale: 0.18 + out * (0.4 + (i % 3) * 0.06),
      opacity: p < 0.25 ? p / 0.25 : 1 - (p - 0.25) / 0.75,
    };
  });
}

// --- Bus: the watcher (and the console command) triggers, figures and rooms listen. ---

type FigureListener = (kind: MishapKind) => void;
type RoomListener = (kind: MishapKind) => void;
const figureListeners = new Map<string, Set<FigureListener>>();
const roomListeners = new Set<RoomListener>();

/** True while a figure of this agent listens: only then does the agent itself show the mishap. */
export function hasMishapTarget(id: string): boolean {
  return figureListeners.has(id);
}

/** Plays a mishap: the boiler or flask effect in its room, and the soot on the agent's figure if it is in the scene. */
export function triggerMishap(id: string | null, kind: MishapKind): void {
  // Copies: a listener that unsubscribes while being called does not skip the next one.
  for (const listener of [...roomListeners]) listener(kind);
  if (id === null) return;
  for (const listener of [...(figureListeners.get(id) ?? [])]) listener(kind);
}

/** Called on every mishap of this agent. Returns the unsubscribe function. */
export function onMishap(id: string, listener: FigureListener): () => void {
  let set = figureListeners.get(id);
  if (!set) figureListeners.set(id, (set = new Set()));
  set.add(listener);
  return () => {
    const current = figureListeners.get(id);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) figureListeners.delete(id);
  };
}

/**
 * Installs the test commands `agentOffice.boiler(id?)` and `agentOffice.flask(id?)` on `host`
 * (the window), next to the other gags' commands (docs/commandes-console.md). They play the
 * mishap on agent `id`, or on the selected agent when no id is given; the room effect plays
 * either way. Return true when a figure reacted. Kept in production builds on purpose: purely
 * visual, no request to the server.
 */
export function installMishapCommands(selected: () => string | null, host: object): void {
  const commands = gagCommands(host);
  const command = (kind: MishapKind) => (id?: string) => {
    const target = typeof id === 'string' ? id : selected();
    triggerMishap(target, kind);
    return target !== null && hasMishapTarget(target);
  };
  commands.boiler = command('boiler');
  commands.flask = command('flask');
}

/** Called on every mishap, for the room effects (boiler, flask). Returns the unsubscribe function. */
export function onRoomMishap(listener: RoomListener): () => void {
  roomListeners.add(listener);
  return () => {
    roomListeners.delete(listener);
  };
}
