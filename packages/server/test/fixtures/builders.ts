// In-memory fixture builders shared by the reducer, store and app tests. Anonymised data only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DesktopSession, Environment, Inventory, LiveProcess } from '../../src/inventory.ts';
import type { HookEvent } from '../../src/reducer.ts';

export const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));

export function loadFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));
}

export const LOCAL_A = 'local_11111111-1111-4111-8111-111111111111';
export const LOCAL_B = 'local_33333333-3333-4333-8333-333333333333';
export const CLI_A = 'aaaaaaaa-0000-4000-8000-000000000001';
export const CLI_B = 'bbbbbbbb-0000-4000-8000-000000000002';

export const ENV_ALPHA: Environment = { id: 'env-alpha', name: 'Alpha', folders: ['C:\\work\\alpha'] };
/** Nested inside Alpha, with a different case: the longest folder must win. */
export const ENV_ALPHA_API: Environment = { id: 'env-alpha-api', name: 'Alpha API', folders: ['C:\\Work\\Alpha\\api'] };
export const ENV_BETA: Environment = { id: 'env-beta', name: 'Beta', folders: ['C:\\work\\beta'] };
/** Alpha is listed before its nested env so a naive first-match would pick the wrong one. */
export const ENVS: Environment[] = [ENV_ALPHA, ENV_ALPHA_API, ENV_BETA];

export function desk(overrides: Partial<DesktopSession> = {}): DesktopSession {
  return {
    localId: LOCAL_A,
    cliSessionIds: [CLI_A],
    envId: null,
    title: 'Alpha task',
    matchFolders: ['C:\\work\\alpha'],
    cwd: 'C:\\work\\alpha',
    archived: false,
    createdAt: 100,
    lastActivityAt: 200,
    info: {},
    ...overrides,
  };
}

export function proc(overrides: Partial<LiveProcess> = {}): LiveProcess {
  return {
    pid: 4242,
    cliSessionId: CLI_A,
    hostSessionId: LOCAL_A,
    cwd: 'C:\\work\\alpha',
    status: 'busy',
    updatedAt: 0,
    ...overrides,
  };
}

export function inventory(overrides: Partial<Inventory> = {}): Inventory {
  return { environments: ENVS, desktopSessions: [], live: [], ...overrides };
}

export function hook(name: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: CLI_A, cwd: 'C:/work/alpha', ...extra } as HookEvent;
}
