import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  isWithin,
  matchEnvironment,
  normPath,
  parseDesktopSession,
  parseLiveProcess,
  parsePresets,
  readInventory,
} from '../src/inventory.ts';
import type { ClaudePaths } from '../src/paths.ts';
import { ENV_ALPHA, ENV_ALPHA_API, ENV_BETA, ENVS, LOCAL_A, LOCAL_B, CLI_A, loadFixture } from './fixtures/builders.ts';

describe('parsePresets', () => {
  /**
   * Verifies that every valid preset of every account becomes an environment, main folder first
   */
  it('parses presets across accounts with main then additional folders', () => {
    expect(parsePresets(loadFixture('presets.json'))).toEqual([
      { id: 'env-alpha', name: 'Alpha', folders: ['C:\\work\\alpha', 'C:\\work\\shared'] },
      { id: 'env-beta', name: 'Beta', folders: ['C:\\work\\beta'] },
      { id: 'env-remote', name: 'Remote', folders: [] },
    ]);
  });

  /**
   * Verifies that a preset missing its name is skipped without dropping the others
   */
  it('skips an invalid preset', () => {
    const ids = parsePresets(loadFixture('presets.json')).map((e) => e.id);
    expect(ids).not.toContain('env-no-name');
  });

  /**
   * Verifies that empty folder strings are filtered out of an environment's folders
   */
  it('drops empty folder strings', () => {
    const raw = { byAccount: { a: { presets: [{ id: 'e', name: 'E', target: { cwd: '', additionalFolders: ['', 'D:\\x'] } }] } } };
    expect(parsePresets(raw)).toEqual([{ id: 'e', name: 'E', folders: ['D:\\x'] }]);
  });

  /**
   * Verifies that a file with an unexpected shape yields no environment instead of throwing
   */
  it.each([[undefined], [null], ['text'], [{}], [{ byAccount: 'nope' }]])('returns [] for malformed input %j', (raw) => {
    expect(parsePresets(raw)).toEqual([]);
  });
});

describe('parseDesktopSession', () => {
  /**
   * Verifies that a full desktop record maps every field used by the office
   */
  it('maps a complete desktop session record', () => {
    expect(parseDesktopSession(loadFixture('desktop-session.json'))).toEqual({
      localId: LOCAL_A,
      cliSessionIds: [CLI_A, 'aaaaaaaa-0000-4000-8000-000000000000'],
      envId: 'env-alpha',
      title: 'Refactor parser',
      matchFolders: ['C:\\work\\alpha', 'C:\\work\\alpha\\.claude\\worktrees\\wt-1'],
      cwd: 'C:\\work\\alpha\\.claude\\worktrees\\wt-1',
      archived: false,
      createdAt: 1700000000000,
      lastActivityAt: 1700000500000,
      parent: { sessionId: 'local_22222222-2222-4222-8222-222222222222', title: 'Parent task' },
    });
  });

  /**
   * Verifies that a minimal record gets defaults and lastActivityAt falls back to createdAt
   */
  it('applies defaults on a minimal record', () => {
    expect(parseDesktopSession(loadFixture('desktop-session-minimal.json'))).toEqual({
      localId: LOCAL_B,
      cliSessionIds: [],
      envId: null,
      title: 'Second session',
      matchFolders: ['C:\\work\\beta'],
      cwd: 'C:\\work\\beta',
      archived: false,
      createdAt: 1700000100000,
      lastActivityAt: 1700000100000,
      parent: undefined,
    });
  });

  /**
   * Verifies that a record with only an id gets an untitled, empty, zero-dated session
   */
  it('defaults title, cwd and dates when absent', () => {
    const s = parseDesktopSession({ sessionId: 'local_x' });
    expect(s).toMatchObject({ title: null, cwd: '', createdAt: 0, lastActivityAt: 0, archived: false });
  });

  /**
   * Verifies that an empty-string title is reported as null, never as French text
   */
  it('maps an empty title to null', () => {
    expect(parseDesktopSession({ sessionId: 'local_x', title: '' })?.title).toBeNull();
  });

  /**
   * Verifies that envScopeId is used when startedFromEnvironmentId is null
   */
  it('falls back to envScopeId for the environment', () => {
    expect(parseDesktopSession({ sessionId: 'local_x', startedFromEnvironmentId: null, envScopeId: 'env-beta' })?.envId).toBe(
      'env-beta',
    );
  });

  /**
   * Verifies that cwd falls back to originCwd and matchFolders keep the documented order
   */
  it('builds matchFolders from originCwd, folderPlace and cwd', () => {
    const s = parseDesktopSession({
      sessionId: 'local_x',
      originCwd: 'C:\\o',
      folderPlace: { cwd: 'C:\\f', realPath: 'C:\\r' },
    });
    expect(s?.cwd).toBe('C:\\o');
    expect(s?.matchFolders).toEqual(['C:\\o', 'C:\\f', 'C:\\r']);
  });

  /**
   * Verifies that a forked session gets the fork origin as its parent
   */
  it('uses forkedFromSessionId as parent when not spawned', () => {
    expect(parseDesktopSession({ sessionId: 'local_x', forkedFromSessionId: 'local_p' })?.parent).toEqual({ sessionId: 'local_p' });
  });

  /**
   * Verifies that empty cli session ids are discarded
   */
  it('filters empty cli session ids', () => {
    expect(parseDesktopSession({ sessionId: 'local_x', cliSessionId: '', priorCliSessionIds: ['', 'c1'] })?.cliSessionIds).toEqual([
      'c1',
    ]);
  });

  /**
   * Verifies that non-local ids, missing ids and wrongly typed fields are rejected
   */
  it.each([
    [{ sessionId: 'remote_x' }],
    [{ title: 'no id' }],
    [{ sessionId: 'local_x', isArchived: 'yes' }],
    [null],
    ['local_x'],
  ])('returns null for %j', (raw) => {
    expect(parseDesktopSession(raw)).toBeNull();
  });
});

describe('parseLiveProcess', () => {
  /**
   * Verifies that a live process maps its ids and prefers statusUpdatedAt as timestamp
   */
  it('maps a live process file', () => {
    expect(parseLiveProcess(loadFixture('live-process.json'))).toEqual({
      pid: 4242,
      cliSessionId: CLI_A,
      hostSessionId: LOCAL_A,
      cwd: 'C:\\work\\alpha',
      status: 'busy',
      updatedAt: 1700000450000,
      name: undefined,
    });
  });

  /**
   * Verifies that updatedAt falls back to updatedAt, then 0, and cwd defaults to empty
   */
  it('falls back on missing timestamps and cwd', () => {
    expect(parseLiveProcess({ pid: 1, sessionId: 's', updatedAt: 5 })).toMatchObject({ updatedAt: 5, cwd: '' });
    expect(parseLiveProcess({ pid: 1, sessionId: 's' })?.updatedAt).toBe(0);
  });

  /**
   * Verifies that any status other than busy or idle is reported as unknown
   */
  it.each([['stopping'], [undefined]])('maps status %s to unknown', (status) => {
    expect(parseLiveProcess({ pid: 1, sessionId: 's', status })?.status).toBe('unknown');
  });

  /**
   * Verifies that idle status and the process name are kept
   */
  it('keeps idle status and name', () => {
    expect(parseLiveProcess({ pid: 1, sessionId: 's', status: 'idle', name: 'job' })).toMatchObject({ status: 'idle', name: 'job' });
  });

  /**
   * Verifies that records missing pid or session id, or with a string pid, are rejected
   */
  it.each([[{ sessionId: 's' }], [{ pid: 1 }], [{ pid: '1', sessionId: 's' }], [undefined]])('returns null for %j', (raw) => {
    expect(parseLiveProcess(raw)).toBeNull();
  });
});

describe('normPath', () => {
  /**
   * Verifies that paths are lowercased, use backslashes and lose trailing separators
   */
  it('normalises separators, case and trailing slashes', () => {
    expect(normPath('C:/Work/Alpha//')).toBe('c:\\work\\alpha');
    expect(normPath('C:\\Work\\Alpha\\')).toBe('c:\\work\\alpha');
  });
});

describe('isWithin', () => {
  /**
   * Verifies that a folder is within itself and its descendants are within it
   */
  it('accepts the folder itself and its children', () => {
    expect(isWithin('C:\\work\\alpha', 'C:\\work\\alpha')).toBe(true);
    expect(isWithin('C:\\work\\alpha\\src\\a.ts', 'C:\\work\\alpha')).toBe(true);
  });

  /**
   * Verifies that comparison ignores case, slash style and a trailing separator
   */
  it('is case and separator insensitive', () => {
    expect(isWithin('c:/WORK/alpha/src', 'C:\\Work\\Alpha\\')).toBe(true);
  });

  /**
   * Verifies that a sibling sharing a name prefix is not considered inside
   */
  it('rejects a sibling with a common prefix', () => {
    expect(isWithin('C:\\work\\alphabet', 'C:\\work\\alpha')).toBe(false);
    expect(isWithin('C:\\work', 'C:\\work\\alpha')).toBe(false);
  });
});

describe('matchEnvironment', () => {
  /**
   * Verifies that the most specific (longest) environment folder wins over its parent
   */
  it('prefers the longest matching folder regardless of order', () => {
    expect(matchEnvironment(['c:/work/alpha/api/src'], ENVS)).toBe('env-alpha-api');
    expect(matchEnvironment(['c:/work/alpha/api/src'], [ENV_ALPHA_API, ENV_ALPHA])).toBe('env-alpha-api');
    expect(matchEnvironment(['C:\\work\\alpha\\web'], ENVS)).toBe('env-alpha');
  });

  /**
   * Verifies that any of the candidate folders can produce the match
   */
  it('matches on any candidate folder', () => {
    expect(matchEnvironment(['D:\\elsewhere', 'C:\\work\\beta\\x'], ENVS)).toBe(ENV_BETA.id);
  });

  /**
   * Verifies that an additional folder of an environment also matches
   */
  it('matches additional folders', () => {
    const env = { id: 'e', name: 'E', folders: ['C:\\main', 'C:\\extra'] };
    expect(matchEnvironment(['C:\\extra\\lib'], [env])).toBe('e');
  });

  /**
   * Verifies that null is returned when no environment contains the folders
   */
  it('returns null without a match', () => {
    expect(matchEnvironment(['D:\\elsewhere'], ENVS)).toBeNull();
    expect(matchEnvironment([], ENVS)).toBeNull();
    expect(matchEnvironment(['C:\\work\\alpha'], [])).toBeNull();
  });
});

describe('readInventory', () => {
  let root: string;
  let paths: ClaudePaths;
  const write = (file: string, content: unknown) =>
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-inv-'));
    const sessionDir = path.join(root, 'claude-code-sessions', 'acct', 'org');
    const liveDir = path.join(root, 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.mkdirSync(liveDir, { recursive: true });

    write(path.join(root, 'ccd-session-presets.json'), loadFixture('presets.json'));
    write(path.join(sessionDir, `${LOCAL_A}.json`), loadFixture('desktop-session.json'));
    write(path.join(sessionDir, `${LOCAL_B}.json`), loadFixture('desktop-session-minimal.json'));
    write(path.join(sessionDir, 'archived-sessions.idx'), { archived: [LOCAL_B, 42] });
    write(path.join(sessionDir, 'local_broken.json'), '{not json');
    write(path.join(sessionDir, 'local_wrongid.json'), { sessionId: 'remote_x' });
    write(path.join(sessionDir, 'local_backup.json.bak'), { sessionId: 'local_from_backup' });
    // Sensitive files: valid-looking content, so reading them would change the result.
    write(path.join(sessionDir, 'config.json'), { sessionId: 'local_from_config', title: 'secret' });
    write(path.join(sessionDir, '123.abc.key'), { sessionId: 'local_from_key' });

    write(path.join(liveDir, '4242.json'), loadFixture('live-process.json'));
    write(path.join(liveDir, '4343.json'), { pid: 4343, sessionId: 'dead-process', status: 'idle' });
    write(path.join(liveDir, 'notes.json'), { pid: 5555, sessionId: 'from-notes' });
    write(path.join(liveDir, 'config.json'), { pid: 6666, sessionId: 'from-config' });
    write(path.join(liveDir, '123.abc.key'), { pid: 7777, sessionId: 'from-key' });

    paths = {
      claudeHome: root,
      liveDir,
      desktopData: root,
      presetsFile: path.join(root, 'ccd-session-presets.json'),
      sessionDirs: [sessionDir, path.join(root, 'missing-dir')],
    };
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const isAlive = (pid: number) => pid !== 4343;

  /**
   * Verifies that environments come from the presets file
   */
  it('reads environments from the presets file', () => {
    expect(readInventory(paths, isAlive).environments.map((e) => e.id)).toEqual(['env-alpha', 'env-beta', 'env-remote']);
  });

  /**
   * Verifies that only valid local_*.json records are read and the archive index applies
   */
  it('reads desktop sessions and applies the archived index', () => {
    const sessions = readInventory(paths, isAlive).desktopSessions;
    const byId = new Map(sessions.map((s) => [s.localId, s]));
    expect([...byId.keys()].sort()).toEqual([LOCAL_A, LOCAL_B].sort());
    expect(byId.get(LOCAL_A)?.archived).toBe(false);
    expect(byId.get(LOCAL_B)?.archived).toBe(true);
  });

  /**
   * Verifies that only <pid>.json files of processes still alive are reported live
   */
  it('reads live processes filtered by isAlive', () => {
    const live = readInventory(paths, isAlive).live;
    expect(live.map((p) => p.pid)).toEqual([4242]);
    expect(live[0]).toMatchObject({ cliSessionId: CLI_A, hostSessionId: LOCAL_A, status: 'busy' });
  });

  /**
   * Verifies that config.json, *.key and other non-matching files are never opened
   */
  it('never reads config.json nor key files', () => {
    const spy = vi.spyOn(fs, 'readFileSync');
    const inv = readInventory(paths, () => true);
    const opened = spy.mock.calls.map((c) => path.basename(String(c[0])));
    expect(opened).not.toContain('config.json');
    expect(opened.some((f) => f.endsWith('.key'))).toBe(false);
    expect(opened).not.toContain('notes.json');
    expect(opened).not.toContain('local_backup.json.bak');
    const ids = inv.desktopSessions.map((s) => s.localId);
    expect(ids).not.toContain('local_from_config');
    expect(ids).not.toContain('local_from_key');
    expect(inv.live.map((p) => p.pid).sort()).toEqual([4242, 4343]);
  });

  /**
   * Verifies that missing presets, session dirs and live dir yield an empty inventory
   */
  it('returns an empty inventory when nothing exists', () => {
    const missing = path.join(root, 'nope');
    expect(
      readInventory(
        { claudeHome: missing, liveDir: path.join(missing, 'sessions'), desktopData: null, presetsFile: null, sessionDirs: [missing] },
        () => true,
      ),
    ).toEqual({ environments: [], desktopSessions: [], live: [], presentIds: new Set(), complete: false, presetsOk: false });
  });

  /**
   * Verifies that an unreadable presets file gives no environments instead of throwing
   */
  it('tolerates a missing presets file path', () => {
    expect(readInventory({ ...paths, presetsFile: path.join(root, 'absent.json') }, isAlive).environments).toEqual([]);
  });
});
