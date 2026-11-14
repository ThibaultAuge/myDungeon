import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AGENT_ID,
  AGENTS_CACHE_MS,
  agentNameFromDefinition,
  type AgentsCache,
  cliVersion,
  HOOK_AGENT_TYPE,
  isRemotePath,
  isWithin,
  isWorktree,
  linkedBelow,
  matchEnvironment,
  normPath,
  parseDesktopSession,
  parseLiveProcess,
  parsePresets,
  readAgentTypes,
  readInventory,
  sessionInfo,
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
      info: {
        worktree: { name: 'wt-1' },
        branch: 'claude/wt-1',
        sourceBranch: 'main',
        model: 'fake-model',
        effort: 'medium',
        permissionMode: 'auto',
        completedTurns: 6,
      },
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
      info: {},
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
   * Verifies that a version of the wrong type is dropped without rejecting the process
   */
  it('drops a non-string version but keeps the process', () => {
    const p = parseLiveProcess({ pid: 7, sessionId: CLI_A, version: 5 });
    expect(p).not.toBeNull();
    expect(p?.version).toBeUndefined();
  });

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
    ).toEqual({ environments: [], desktopSessions: [], live: [], presentIds: new Set(), complete: false, presetsOk: false, definedAgents: { global: [], byEnv: new Map() } });
  });

  /**
   * Verifies that an unreadable presets file gives no environments instead of throwing
   */
  it('tolerates a missing presets file path', () => {
    expect(readInventory({ ...paths, presetsFile: path.join(root, 'absent.json') }, isAlive).environments).toEqual([]);
  });
});

describe('agentNameFromDefinition', () => {
  /**
   * Verifies that a crafted 4 KB name line cannot stall the event loop (former regex backtracked for ~30 s)
   */
  it('parses a pathological name line in linear time', () => {
    const start = performance.now();
    expect(agentNameFromDefinition('---\nname:' + ' \t'.repeat(2040) + '"x"y')).toBeUndefined();
    expect(performance.now() - start).toBeLessThan(200);
  });

  /**
   * Verifies that the name of a plain LF frontmatter is returned
   */
  it('reads the name from an LF frontmatter', () => {
    expect(agentNameFromDefinition('---\nname: dexter\ndescription: Writes tests\n---\nBody')).toBe('dexter');
  });

  /**
   * Verifies that a CRLF frontmatter is read like an LF one
   */
  it('reads the name from a CRLF frontmatter', () => {
    expect(agentNameFromDefinition('---\r\ndescription: x\r\nname: hermione\r\n---\r\nBody')).toBe('hermione');
  });

  /**
   * Verifies that a leading UTF-8 byte order mark does not hide the frontmatter
   */
  it('accepts a leading BOM', () => {
    expect(agentNameFromDefinition('﻿---\nname: neo\n---\n')).toBe('neo');
  });

  /**
   * Verifies that double or single quotes around the name are stripped
   */
  it.each([['"oracle"'], ["'oracle'"], ['oracle   '], ['  "oracle"  ']])('strips quotes and blanks from name: %s', (value) => {
    expect(agentNameFromDefinition(`---\nname: ${value}\n---\n`)).toBe('oracle');
  });

  /**
   * Verifies that names made of letters, digits, dots, dashes and underscores are kept as written
   */
  it.each([['Samuel-Morse'], ['agent_2'], ['v1.2'], ['A'], ['a'.repeat(64)]])('accepts valid name %s', (name) => {
    expect(agentNameFromDefinition(`---\nname: ${name}\n---\n`)).toBe(name);
  });

  /**
   * Verifies that names Claude Code would reject, or longer than 64 characters, give undefined
   */
  it.each([['my agent'], ['-lead'], ['.hidden'], ['_x'], ['a'.repeat(65)], ['a/b'], ['é'], ['']])(
    'rejects invalid name %j',
    (name) => {
      expect(agentNameFromDefinition(`---\nname: ${name}\n---\n`)).toBeUndefined();
    },
  );

  /**
   * Verifies that a text without a frontmatter at its very start gives undefined
   */
  it.each([
    ['name: dexter'],
    ['Intro\n---\nname: dexter\n---\n'],
    [' ---\nname: dexter\n---\n'],
    ['---name: dexter\n'],
    ['---'],
    [''],
  ])('returns undefined without a leading frontmatter: %j', (text) => {
    expect(agentNameFromDefinition(text)).toBeUndefined();
  });

  /**
   * Verifies that an unclosed frontmatter (truncated head) runs to the end of the text
   */
  it.each([
    ['---\nname: dexter\n'],
    ['---\r\ndescription: long\r\nname: dexter\r\n'],
    ['﻿---\ndescription: x\nname: "dexter"\nmodel: opus'],
  ])('reads the name of an unclosed frontmatter %j', (text) => {
    expect(agentNameFromDefinition(text, true)).toBe('dexter');
    // A complete text must close its frontmatter.
    expect(agentNameFromDefinition(text)).toBeUndefined();
  });

  /**
   * Verifies that the last, possibly partial line of a truncated head is never read
   */
  it.each([['---\nname: dexter'], ['---\nname: herm'], ['---\ndescription: x\nname: "dexter"'], ['---\nname: dexter\r']])(
    'ignores a name on the final unterminated line of a truncated head %j',
    (text) => {
      expect(agentNameFromDefinition(text, true)).toBeUndefined();
    },
  );

  /**
   * Verifies that a truncated head without any line break yields no name
   */
  it.each([['---'], ['name: dexter'], ['']])('returns undefined for a truncated head without line break %j', (text) => {
    expect(agentNameFromDefinition(text, true)).toBeUndefined();
  });

  /**
   * Verifies that a closed frontmatter in a truncated head is still read, partial tail ignored
   */
  it('reads a closed frontmatter of a truncated head despite a partial last line', () => {
    expect(agentNameFromDefinition('---\nname: dexter\n---\nBody that was cu', true)).toBe('dexter');
  });

  /**
   * Verifies that an unclosed frontmatter without a name line still gives undefined
   */
  it('returns undefined for an unclosed frontmatter without a name', () => {
    expect(agentNameFromDefinition('---\ndescription: x\n')).toBeUndefined();
    expect(agentNameFromDefinition('---\n')).toBeUndefined();
  });

  /**
   * Verifies that only the frontmatter before the first closing fence is searched
   */
  it('stops at the first closing fence when one exists', () => {
    expect(agentNameFromDefinition('---\ndescription: x\n---\nBody\n---\nname: late\n---\n')).toBeUndefined();
  });

  /**
   * Verifies that a name outside the frontmatter, or a key merely ending in name, is ignored
   */
  it('ignores names outside the frontmatter and other keys', () => {
    expect(agentNameFromDefinition('---\ndescription: x\n---\nname: dexter\n')).toBeUndefined();
    expect(agentNameFromDefinition('---\ndisplay_name: dexter\n---\n')).toBeUndefined();
    expect(agentNameFromDefinition('---\n  name: dexter\n---\n')).toBeUndefined();
  });
});

describe('readAgentTypes', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-agents-'));
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Creates a fresh agents folder under the temporary root with the given files. */
  function agentsDir(name: string, files: Record<string, string>): string {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), content, 'utf8');
    return dir;
  }

  const sorted = (list: string[]) => [...list].sort((a, b) => a.localeCompare(b));

  /**
   * Verifies that each .md file gives its frontmatter name, whatever its file name
   */
  it('uses the frontmatter name, not the file name', () => {
    const dir = agentsDir('mixed', {
      'dexter.md': '---\nname: Dexter\n---\nWrites tests',
      'my agent.md': '---\nname: good-one\n---\n',
    });
    expect(sorted(readAgentTypes(dir))).toEqual(['Dexter', 'good-one']);
  });

  /**
   * Verifies that a file without a valid frontmatter name defines no agent, with no file-name fallback
   */
  it.each([
    ['no frontmatter', 'No frontmatter here'],
    ['no name key', '---\ndescription: x\n---\n'],
    ['invalid name', '---\nname: not valid!\n---\n'],
    ['empty file', ''],
    ['name in the body', '# Title\n---\nname: curator\n---\n'],
  ])('skips a definition with %s', (_label, content) => {
    const dir = agentsDir(`skip-${_label.replace(/\s+/g, '-')}`, { 'curator.md': content, 'neo.md': '---\nname: neo\n---\n' });
    expect(readAgentTypes(dir)).toEqual(['neo']);
  });

  /**
   * Verifies that a long definition whose closing fence is past the head is still read
   */
  it('reads the name of a definition truncated before its closing fence', () => {
    const dir = agentsDir('unclosed', { 'long.md': `---\nname: LongOne\ndescription: ${'x'.repeat(6000)}\n---\nBody` });
    expect(readAgentTypes(dir)).toEqual(['LongOne']);
  });

  /**
   * Verifies that non-.md files and a subdirectory named like a definition are ignored
   */
  it('ignores non-md files and directories', () => {
    const dir = agentsDir('filtering', {
      'neo.md': '---\nname: neo\n---\n',
      'notes.txt': '---\nname: from-txt\n---\n',
      'neo.md.bak': '---\nname: from-bak\n---\n',
    });
    fs.mkdirSync(path.join(dir, 'x.md'));
    fs.writeFileSync(path.join(dir, 'x.md', 'inner.md'), '---\nname: nested\n---\n', 'utf8');
    expect(readAgentTypes(dir)).toEqual(['neo']);
  });

  /**
   * Verifies that two definitions differing only in case yield a single type
   */
  it('dedupes types case-insensitively', () => {
    const dir = agentsDir('dupes', {
      'first.md': '---\nname: Alpha\n---\n',
      'second.md': '---\nname: ALPHA\n---\n',
      'beta.md': '---\nname: beta\n---\n',
    });
    const types = readAgentTypes(dir);
    expect(types.filter((t) => t.toLowerCase() === 'alpha')).toHaveLength(1);
    expect(types.filter((t) => t.toLowerCase() !== 'alpha')).toEqual(['beta']);
  });

  /**
   * Verifies that a name placed beyond the first 4096 bytes is not found, so the file is skipped
   */
  it('reads only the head of each file', () => {
    const dir = agentsDir('head', {
      'far.md': `---\ndescription: ${'x'.repeat(5000)}\nname: Far\n---\n`,
      'near.md': `---\nname: Near\n---\n${'body '.repeat(3000)}`,
    });
    expect(readAgentTypes(dir)).toEqual(['Near']);
  });

  /**
   * Verifies that at most 64 definitions are read per folder
   */
  it('caps the number of definitions at 64', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 70; i++) {
      const n = `t${String(i).padStart(2, '0')}`;
      files[`${n}.md`] = `---\nname: ${n}\n---\n`;
    }
    expect(readAgentTypes(agentsDir('many', files))).toHaveLength(64);
  });

  /**
   * Verifies that an unreadable definition is skipped without dropping the others
   */
  it('skips a file that cannot be opened', () => {
    const dir = agentsDir('locked', { 'locked.md': '---\nname: Hidden\n---\n', 'open.md': '---\nname: Open\n---\n' });
    const realOpen = fs.openSync;
    vi.spyOn(fs, 'openSync').mockImplementation(((file: fs.PathLike, flags?: fs.OpenMode) => {
      if (String(file).endsWith('locked.md')) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      return realOpen(file, flags ?? 'r');
    }) as typeof fs.openSync);
    expect(readAgentTypes(dir)).toEqual(['Open']);
  });

  /**
   * Verifies that a missing folder, a file path and an empty folder give no type
   */
  it('returns [] for a missing, non-directory or empty folder', () => {
    expect(readAgentTypes(path.join(root, 'does-not-exist'))).toEqual([]);
    const file = path.join(root, 'plain-file.md');
    fs.writeFileSync(file, '---\nname: x\n---\n', 'utf8');
    expect(readAgentTypes(file)).toEqual([]);
    expect(readAgentTypes(agentsDir('empty', {}))).toEqual([]);
  });

  /**
   * Verifies that a folder that cannot be listed for a transient reason gives no type
   */
  it('returns [] when listing the folder fails transiently', () => {
    const dir = agentsDir('busy', { 'neo.md': '---\nname: neo\n---\n' });
    const realReaddir = fs.opendirSync;
    vi.spyOn(fs, 'opendirSync').mockImplementation(((p: fs.PathLike, opts?: unknown) => {
      if (String(p) === dir) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      return (realReaddir as (p: fs.PathLike, o?: unknown) => unknown)(p, opts);
    }) as unknown as typeof fs.opendirSync);
    expect(readAgentTypes(dir)).toEqual([]);
  });
});

describe('readInventory: definedAgents', () => {
  let root: string;
  let folderA: string;
  let folderB: string;
  let bare: string;
  let presetsFile: string;

  /** Writes a definition in `<dir>/<file>`, creating the folder. */
  function define(dir: string, file: string, content: string) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), content, 'utf8');
  }

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-defs-'));
    folderA = path.join(root, 'proj-a');
    folderB = path.join(root, 'proj-b');
    bare = path.join(root, 'proj-bare');
    fs.mkdirSync(bare, { recursive: true });

    define(path.join(root, 'agents'), 'dexter.md', '---\nname: dexter\n---\n');
    define(path.join(root, 'agents'), 'oracle.md', '---\nname: oracle\n---\n');
    // No frontmatter name: defines no agent.
    define(path.join(root, 'agents'), 'notes.md', 'no frontmatter');
    define(path.join(folderA, '.claude', 'agents'), 'a.md', '---\nname: alpha-agent\n---\n');
    define(path.join(folderB, '.claude', 'agents'), 'b.md', '---\nname: beta-agent\n---\n');

    presetsFile = path.join(root, 'ccd-session-presets.json');
    fs.writeFileSync(
      presetsFile,
      JSON.stringify({
        byAccount: {
          acct: {
            presets: [
              { id: 'env-x', name: 'X', target: { cwd: folderA, additionalFolders: [folderB] } },
              { id: 'env-bare', name: 'Bare', target: { cwd: bare } },
              { id: 'env-none', name: 'None' },
            ],
          },
        },
      }),
      'utf8',
    );
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const pathsFor = (presets: string | null): ClaudePaths => ({
    claudeHome: root,
    liveDir: path.join(root, 'sessions'),
    desktopData: null,
    presetsFile: presets,
    sessionDirs: [],
  });

  /**
   * Verifies that global definitions come from <claudeHome>/agents
   */
  it('reads the global definitions from the claude home', () => {
    const inv = readInventory(pathsFor(presetsFile), () => true);
    expect([...inv.definedAgents!.global].sort()).toEqual(['dexter', 'oracle']);
  });

  /**
   * Verifies that each environment lists the definitions of all its folders, main folder first
   */
  it('reads definitions per environment from every folder', () => {
    const byEnv = readInventory(pathsFor(presetsFile), () => true).definedAgents!.byEnv;
    expect(byEnv).toEqual(
      new Map([
        ['env-x', ['alpha-agent', 'beta-agent']],
        ['env-bare', []],
        ['env-none', []],
      ]),
    );
  });

  /**
   * Verifies that without presets the global definitions are still read and no env is listed
   */
  it('reads global definitions even without presets', () => {
    const defs = readInventory(pathsFor(null), () => true).definedAgents!;
    expect([...defs.global].sort()).toEqual(['dexter', 'oracle']);
    expect(defs.byEnv.size).toBe(0);
  });

  /**
   * Verifies that a repository whose `.claude` or `.claude/agents` is a link (symlink or
   * junction) defines no agent: the link could lead to a network share
   */
  it.each([['.claude'], ['.claude/agents']])('skips an environment whose %s is a link', (linked) => {
    const repo = fs.mkdtempSync(path.join(root, 'linked-'));
    const target = fs.mkdtempSync(path.join(root, 'target-'));
    const agentsInTarget = linked === '.claude' ? path.join(target, 'agents') : target;
    define(agentsInTarget, 'evil.md', '---\nname: evil-agent\n---\n');
    if (linked === '.claude/agents') fs.mkdirSync(path.join(repo, '.claude'));
    // A junction needs no privilege on Windows; elsewhere the type is ignored (directory symlink).
    fs.symlinkSync(target, path.join(repo, ...linked.split('/')), 'junction');
    const presets = path.join(repo, 'presets.json');
    fs.writeFileSync(
      presets,
      JSON.stringify({ byAccount: { acct: { presets: [{ id: 'env-l', name: 'L', target: { cwd: repo } }] } } }),
      'utf8',
    );
    const inv = readInventory(pathsFor(presets), () => true);
    expect(inv.definedAgents!.byEnv.get('env-l')).toEqual([]);
    // The global folder itself is the user's own and is not checked.
    expect([...inv.definedAgents!.global].sort()).toEqual(['dexter', 'oracle']);
  });
});

describe('readInventory: agents cache', () => {
  let root: string;
  let counter = 0;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-cache-'));
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A fresh claude home whose `agents` folder defines `alpha`. */
  function home() {
    const claudeHome = path.join(root, `home-${counter++}`);
    const agents = path.join(claudeHome, 'agents');
    fs.mkdirSync(agents, { recursive: true });
    fs.writeFileSync(path.join(agents, 'a.md'), '---\nname: alpha\n---\n', 'utf8');
    const paths: ClaudePaths = {
      claudeHome,
      liveDir: path.join(claudeHome, 'sessions'),
      desktopData: null,
      presetsFile: null,
      sessionDirs: [],
    };
    const addBeta = () => fs.writeFileSync(path.join(agents, 'b.md'), '---\nname: beta\n---\n', 'utf8');
    return { paths, agents, addBeta };
  }

  const globalAt = (paths: ClaudePaths, cache: AgentsCache | undefined, now: number) =>
    [...readInventory(paths, () => true, cache, now).definedAgents!.global].sort();

  /**
   * Verifies that the cache lifetime is one minute
   */
  it('exposes a one-minute cache lifetime', () => {
    expect(AGENTS_CACHE_MS).toBe(60_000);
  });

  /**
   * Verifies that without a cache the folders are read on every inventory
   */
  it('reads folders every time without a cache', () => {
    const { paths, addBeta } = home();
    expect(globalAt(paths, undefined, 1000)).toEqual(['alpha']);
    addBeta();
    expect(globalAt(paths, undefined, 1000)).toEqual(['alpha', 'beta']);
  });

  /**
   * Verifies that within the cache lifetime a changed folder still gives the cached list
   */
  it('reuses the cached list within AGENTS_CACHE_MS', () => {
    const { paths, agents, addBeta } = home();
    const cache: AgentsCache = new Map();
    expect(globalAt(paths, cache, 1000)).toEqual(['alpha']);
    expect(cache.get(agents)).toEqual({ at: 1000, types: ['alpha'] });
    addBeta();
    expect(globalAt(paths, cache, 1000 + 59_000)).toEqual(['alpha']);
    expect(globalAt(paths, cache, 1000 + AGENTS_CACHE_MS - 1)).toEqual(['alpha']);
  });

  /**
   * Verifies that the folder is read again once the cache lifetime has elapsed
   */
  it('refreshes the list at AGENTS_CACHE_MS', () => {
    const { paths, agents, addBeta } = home();
    const cache: AgentsCache = new Map();
    globalAt(paths, cache, 1000);
    addBeta();
    expect(globalAt(paths, cache, 1000 + AGENTS_CACHE_MS)).toEqual(['alpha', 'beta']);
    expect(cache.get(agents)?.at).toBe(1000 + AGENTS_CACHE_MS);
  });

  /**
   * Verifies that a transient listing failure keeps the previously cached list
   */
  it('keeps the previous list when the folder cannot be listed transiently', () => {
    const { paths, agents } = home();
    const cache: AgentsCache = new Map();
    expect(globalAt(paths, cache, 1000)).toEqual(['alpha']);

    const realReaddir = fs.opendirSync;
    vi.spyOn(fs, 'opendirSync').mockImplementation(((p: fs.PathLike, opts?: unknown) => {
      if (String(p) === agents) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      return (realReaddir as (p: fs.PathLike, o?: unknown) => unknown)(p, opts);
    }) as unknown as typeof fs.opendirSync);

    expect(globalAt(paths, cache, 1000 + AGENTS_CACHE_MS)).toEqual(['alpha']);
    expect(cache.get(agents)?.types).toEqual(['alpha']);
  });

  /**
   * Verifies that a transient failure with nothing cached yet gives no type
   */
  it('gives [] on a transient failure with an empty cache', () => {
    const { paths, agents } = home();
    const realReaddir = fs.opendirSync;
    vi.spyOn(fs, 'opendirSync').mockImplementation(((p: fs.PathLike, opts?: unknown) => {
      if (String(p) === agents) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      return (realReaddir as (p: fs.PathLike, o?: unknown) => unknown)(p, opts);
    }) as unknown as typeof fs.opendirSync);
    expect(globalAt(paths, new Map(), 1000)).toEqual([]);
  });

  /**
   * Verifies that a deleted folder empties the list even when a list was cached
   */
  it('gives [] when the folder was removed, despite a cached list', () => {
    const { paths, agents } = home();
    const cache: AgentsCache = new Map();
    expect(globalAt(paths, cache, 1000)).toEqual(['alpha']);
    fs.rmSync(agents, { recursive: true, force: true });
    expect(globalAt(paths, cache, 1000 + AGENTS_CACHE_MS)).toEqual([]);
    expect(cache.get(agents)?.types).toEqual([]);
  });

  /**
   * Verifies that environment folders are cached too, one entry per agents folder
   */
  it('caches environment folders by their agents path', () => {
    const { paths } = home();
    const proj = path.join(root, `proj-${counter++}`);
    const projAgents = path.join(proj, '.claude', 'agents');
    fs.mkdirSync(projAgents, { recursive: true });
    fs.writeFileSync(path.join(projAgents, 'p.md'), '---\nname: proj-agent\n---\n', 'utf8');
    const presetsFile = path.join(paths.claudeHome, 'presets.json');
    fs.writeFileSync(
      presetsFile,
      JSON.stringify({ byAccount: { acct: { presets: [{ id: 'env-p', name: 'P', target: { cwd: proj } }] } } }),
      'utf8',
    );
    const withEnv = { ...paths, presetsFile };
    const cache: AgentsCache = new Map();
    expect(readInventory(withEnv, () => true, cache, 1000).definedAgents!.byEnv.get('env-p')).toEqual(['proj-agent']);
    fs.writeFileSync(path.join(projAgents, 'q.md'), '---\nname: other\n---\n', 'utf8');
    expect(readInventory(withEnv, () => true, cache, 2000).definedAgents!.byEnv.get('env-p')).toEqual(['proj-agent']);
    expect(cache.has(projAgents)).toBe(true);
  });
});

describe('AGENT_ID', () => {
  /**
   * Verifies that hook subagent ids made of letters, digits, dots, dashes and underscores match
   */
  it.each([['ag-1'], ['a0f3c9e1b2d4'], ['A.b_c-9'], ['7'], ['a'.repeat(128)]])('accepts %s', (id) => {
    expect(AGENT_ID.test(id)).toBe(true);
  });

  /**
   * Verifies that ids able to impersonate a resting or main figure, or malformed ones, never match
   */
  it.each([
    ['rest:dexter'],
    ['x#main'],
    ['-lead'],
    ['.hidden'],
    ['_x'],
    ['a b'],
    ['a/b'],
    ['é'],
    [''],
    ['a'.repeat(129)],
    ['ag-1\n'],
  ])('rejects %j', (id) => {
    expect(AGENT_ID.test(id)).toBe(false);
  });
});

describe('HOOK_AGENT_TYPE', () => {
  /**
   * Verifies that plain names and one plugin namespace (plugin:agent) are accepted
   */
  it.each([
    ['Explore'],
    ['general-purpose'],
    ['v1.2'],
    ['a'.repeat(64)],
    ['my-plugin:reviewer'],
    ['rest:dexter'],
    ['P1:a_b.c-d'],
    [`${'p'.repeat(64)}:${'r'.repeat(64)}`],
  ])('accepts %s', (type) => {
    expect(HOOK_AGENT_TYPE.test(type)).toBe(true);
  });

  /**
   * Verifies that extra colons, empty or invalid parts, over-long parts and # are rejected
   */
  it.each([
    [''],
    [':'],
    [':a'],
    ['a:'],
    ['a::b'],
    ['a:b:c'],
    ['a:-b'],
    ['-a:b'],
    ['a:.b'],
    ['a#b'],
    ['a:b#main'],
    ['my agent'],
    ['é:x'],
    ['a'.repeat(65)],
    [`p:${'r'.repeat(65)}`],
    [`${'p'.repeat(65)}:r`],
    ['a:b\n'],
  ])('rejects %j', (type) => {
    expect(HOOK_AGENT_TYPE.test(type)).toBe(false);
  });

  /**
   * Verifies that crafted ~10 KB types are rejected in linear time (no catastrophic backtracking)
   */
  it('rejects crafted long types without backtracking', () => {
    const crafted = [
      ('a'.repeat(63) + ':').repeat(160) + '!',
      'a'.repeat(10_000) + '!',
      'a:' + 'b'.repeat(10_000) + ':',
      ':'.repeat(10_000),
      ('a.' + '-'.repeat(30) + ':').repeat(300) + '#',
    ];
    const start = performance.now();
    for (const t of crafted) expect(HOOK_AGENT_TYPE.test(t)).toBe(false);
    expect(performance.now() - start).toBeLessThan(200);
  });
});

describe('isRemotePath', () => {
  /**
   * Verifies that UNC shares and device paths, in either slash style, are reported remote
   */
  it.each([
    ['\\\\server\\share'],
    ['\\\\server\\share\\proj\\.claude\\agents'],
    ['//server/share'],
    ['\\\\?\\UNC\\server\\share\\x'],
    ['\\\\.\\pipe\\x'],
  ])('%s is remote', (p) => {
    expect(isRemotePath(p)).toBe(true);
  });

  /**
   * Verifies that local drive paths, long-path drive prefixes and POSIX paths are not remote
   */
  it.each([['\\\\?\\C:\\x'], ['\\\\?\\c:\\x'], ['//?/C:/x'], ['C:\\x'], ['C:/x'], ['/home/x'], ['\\x'], ['relative\\x'], ['']])(
    '%j is local',
    (p) => {
      expect(isRemotePath(p)).toBe(false);
    },
  );
});

describe('readAgentTypes: follow-up limits', () => {
  let root: string;
  let counter = 0;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-limits-'));
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Creates a fresh agents folder under the temporary root with the given files. */
  function agentsDir(files: Record<string, string>): string {
    const dir = path.join(root, `dir-${counter++}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), content, 'utf8');
    return dir;
  }

  /** Makes `dir` list exactly `names`, in that order, as regular files; other folders list normally. */
  function listAs(dir: string, names: string[]): { closed: () => boolean } {
    const realOpendir = fs.opendirSync;
    let closed = false;
    vi.spyOn(fs, 'opendirSync').mockImplementation(((p: fs.PathLike, opts?: unknown) => {
      if (String(p) !== dir) return (realOpendir as (p: fs.PathLike, o?: unknown) => unknown)(p, opts);
      let i = 0;
      return {
        readSync: () => (i < names.length ? { name: names[i++], isFile: () => true } : null),
        closeSync: () => {
          closed = true;
        },
      };
    }) as unknown as typeof fs.opendirSync);
    return { closed: () => closed };
  }

  const filler = (n: number) => Array.from({ length: n }, (_, i) => `f${String(i).padStart(4, '0')}.txt`);

  /**
   * Verifies that a definition listed as the 1024th entry of its folder is still read
   */
  it('reads a definition at the 1024th folder entry', () => {
    const dir = agentsDir({ 'late.md': '---\nname: Late\n---\n' });
    listAs(dir, [...filler(1023), 'late.md']);
    expect(readAgentTypes(dir)).toEqual(['Late']);
  });

  /**
   * Verifies that entries past the first 1024 of a folder are never examined
   */
  it('stops listing after 1024 entries, .md or not', () => {
    const dir = agentsDir({ 'late.md': '---\nname: Late\n---\n' });
    const listing = listAs(dir, [...filler(1024), 'late.md']);
    expect(readAgentTypes(dir)).toEqual([]);
    expect(listing.closed()).toBe(true);
  });

  /**
   * Verifies that a folder whose listing fails midway gives no type and is still closed
   */
  it('gives [] and closes the folder when reading an entry fails', () => {
    const dir = agentsDir({ 'neo.md': '---\nname: neo\n---\n' });
    let closed = false;
    vi.spyOn(fs, 'opendirSync').mockImplementation((() => ({
      readSync: () => {
        throw Object.assign(new Error('EIO'), { code: 'EIO' });
      },
      closeSync: () => {
        closed = true;
      },
    })) as unknown as typeof fs.opendirSync);
    expect(readAgentTypes(dir)).toEqual([]);
    expect(closed).toBe(true);
  });

  /**
   * Verifies that a path swapped for a non-regular file after listing is skipped
   */
  it('skips an entry that is not a regular file once opened', () => {
    const dir = agentsDir({ 'swapped.md': '---\nname: Swapped\n---\n', 'neo.md': '---\nname: neo\n---\n' });
    const realOpen = fs.openSync;
    const realFstat = fs.fstatSync as (fd: number) => fs.Stats;
    let lastOpened = '';
    vi.spyOn(fs, 'openSync').mockImplementation(((file: fs.PathLike, flags?: fs.OpenMode, mode?: fs.Mode) => {
      lastOpened = String(file);
      return realOpen(file, flags ?? 'r', mode);
    }) as typeof fs.openSync);
    vi.spyOn(fs, 'fstatSync').mockImplementation(((fd: number) => {
      const st = realFstat(fd);
      // A FIFO or a device in place of the definition: not a regular file.
      return lastOpened.endsWith('swapped.md') ? Object.assign(Object.create(st) as fs.Stats, { isFile: () => false }) : st;
    }) as unknown as typeof fs.fstatSync);
    expect(readAgentTypes(dir)).toEqual(['neo']);
  });

  /**
   * Verifies that a short file whose frontmatter is never closed defines no agent
   */
  it('skips a complete short file with an unclosed frontmatter', () => {
    const dir = agentsDir({ 'open.md': '---\nname: dexter\ndescription: x\n', 'neo.md': '---\nname: neo\n---\n' });
    expect(readAgentTypes(dir)).toEqual(['neo']);
  });

  /**
   * Verifies that a name cut by the 4096-byte head (name: herm|ione) is not read as a shorter name
   */
  it('skips a file whose head ends inside its name value', () => {
    const before = '---\ndescription: ';
    const tail = '\nname: herm';
    const text = before + 'x'.repeat(4096 - before.length - tail.length) + tail + 'ione\n---\nBody';
    expect(text.indexOf('ione')).toBe(4096);
    const dir = agentsDir({ 'cut.md': text, 'neo.md': '---\nname: neo\n---\n' });
    expect(readAgentTypes(dir)).toEqual(['neo']);
  });

  /** Makes `dir` list `names` through a fake handle whose closeSync throws. */
  function listWithFailingClose(dir: string, names: string[], readFails = false): void {
    const realOpendir = fs.opendirSync;
    vi.spyOn(fs, 'opendirSync').mockImplementation(((p: fs.PathLike, opts?: unknown) => {
      if (String(p) !== dir) return (realOpendir as (p: fs.PathLike, o?: unknown) => unknown)(p, opts);
      let i = 0;
      return {
        readSync: () => {
          if (readFails) throw Object.assign(new Error('EIO'), { code: 'EIO' });
          return i < names.length ? { name: names[i++], isFile: () => true } : null;
        },
        closeSync: () => {
          throw Object.assign(new Error('EBADF'), { code: 'EBADF' });
        },
      };
    }) as unknown as typeof fs.opendirSync);
  }

  /**
   * Verifies that a failing close of the folder handle does not change the listed types
   */
  it('keeps the result when closing the folder handle throws', () => {
    const dir = agentsDir({ 'neo.md': '---\nname: neo\n---\n', 'oracle.md': '---\nname: oracle\n---\n' });
    listWithFailingClose(dir, ['neo.md', 'oracle.md']);
    expect(readAgentTypes(dir)).toEqual(['neo', 'oracle']);
  });

  /**
   * Verifies that a failing close after a failed listing still gives [] without throwing
   */
  it('gives [] when both the listing and the close fail', () => {
    const dir = agentsDir({ 'neo.md': '---\nname: neo\n---\n' });
    listWithFailingClose(dir, ['neo.md'], true);
    expect(() => readAgentTypes(dir)).not.toThrow();
    expect(readAgentTypes(dir)).toEqual([]);
  });

  /**
   * Verifies that readInventory does not throw when an agents folder handle fails to close
   */
  it('lets readInventory succeed when closing the global agents folder throws', () => {
    const claudeHome = path.join(root, `home-${counter++}`);
    const agents = path.join(claudeHome, 'agents');
    fs.mkdirSync(agents, { recursive: true });
    fs.writeFileSync(path.join(agents, 'neo.md'), '---\nname: neo\n---\n', 'utf8');
    listWithFailingClose(agents, ['neo.md']);
    const paths: ClaudePaths = { claudeHome, liveDir: path.join(claudeHome, 'sessions'), desktopData: null, presetsFile: null, sessionDirs: [] };
    let inv: ReturnType<typeof readInventory> | undefined;
    expect(() => {
      inv = readInventory(paths, () => true);
    }).not.toThrow();
    expect(inv!.definedAgents!.global).toEqual(['neo']);
  });

  const head = '---\nname: Edge\ndescription: ';

  /**
   * Verifies that a file of exactly 4096 bytes is complete, so its unclosed frontmatter is rejected
   */
  it('rejects an unclosed frontmatter in a file of exactly 4096 bytes', () => {
    const dir = agentsDir({ 'edge.md': head + 'x'.repeat(4096 - head.length) });
    expect(fs.statSync(path.join(dir, 'edge.md')).size).toBe(4096);
    expect(readAgentTypes(dir)).toEqual([]);
  });

  /**
   * Verifies that a 4097-byte file is truncated, so its frontmatter may run to the end of the head
   */
  it('accepts an unclosed head in a file of 4097 bytes', () => {
    const dir = agentsDir({ 'edge.md': head + 'x'.repeat(4097 - head.length) });
    expect(fs.statSync(path.join(dir, 'edge.md')).size).toBe(4097);
    expect(readAgentTypes(dir)).toEqual(['Edge']);
  });

  /**
   * Verifies that a long file whose fence closes past byte 4096 yields its name from the head
   */
  it('reads the name of a long file whose frontmatter closes after byte 4096', () => {
    const dir = agentsDir({ 'long.md': `---\nname: Far-Fence\nnotes: ${'y'.repeat(4500)}\n---\nBody` });
    expect(readAgentTypes(dir)).toEqual(['Far-Fence']);
  });

  /**
   * Verifies that an agents folder on a network share is skipped without being listed
   */
  it.each([['\\\\server\\share\\.claude\\agents'], ['//server/share/.claude/agents'], ['\\\\?\\UNC\\server\\share\\agents']])(
    'returns [] for the remote folder %s without listing it',
    (dir) => {
      const spy = vi.spyOn(fs, 'opendirSync');
      expect(readAgentTypes(dir)).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
    },
  );
});

describe('readInventory: remote and pruned agents folders', () => {
  let root: string;
  let counter = 0;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-prune-'));
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A claude home defining `global-agent`, two projects defining one agent each, and a presets writer. */
  function setup() {
    const base = path.join(root, `case-${counter++}`);
    const claudeHome = path.join(base, 'home');
    const globalAgents = path.join(claudeHome, 'agents');
    fs.mkdirSync(globalAgents, { recursive: true });
    fs.writeFileSync(path.join(globalAgents, 'g.md'), '---\nname: global-agent\n---\n', 'utf8');
    const projA = path.join(base, 'proj-a');
    const projB = path.join(base, 'proj-b');
    const agentsOf = (folder: string) => path.join(folder, '.claude', 'agents');
    for (const [folder, name] of [
      [projA, 'agent-a'],
      [projB, 'agent-b'],
    ] as const) {
      fs.mkdirSync(agentsOf(folder), { recursive: true });
      fs.writeFileSync(path.join(agentsOf(folder), 'x.md'), `---\nname: ${name}\n---\n`, 'utf8');
    }
    const presetsFile = path.join(base, 'presets.json');
    const writePresets = (envs: { id: string; cwd: string }[]) =>
      fs.writeFileSync(
        presetsFile,
        JSON.stringify({ byAccount: { acct: { presets: envs.map((e) => ({ id: e.id, name: e.id, target: { cwd: e.cwd } })) } } }),
        'utf8',
      );
    const paths: ClaudePaths = {
      claudeHome,
      liveDir: path.join(base, 'sessions'),
      desktopData: null,
      presetsFile,
      sessionDirs: [],
    };
    return { paths, presetsFile, globalAgents, projA, projB, agentsOf, writePresets };
  }

  /**
   * Verifies that folders of removed environments, and stray entries, leave the cache
   */
  it('prunes cache entries of folders no environment uses any more', () => {
    const { paths, globalAgents, projA, projB, agentsOf, writePresets } = setup();
    const cache: AgentsCache = new Map();
    writePresets([{ id: 'env-a', cwd: projA }]);
    readInventory(paths, () => true, cache, 1000);
    expect([...cache.keys()].sort()).toEqual([globalAgents, agentsOf(projA)].sort());

    cache.set(path.join(root, 'stale-folder'), { at: 1000, types: ['ghost'] });
    writePresets([{ id: 'env-b', cwd: projB }]);
    const inv = readInventory(paths, () => true, cache, 2000);

    expect([...cache.keys()].sort()).toEqual([globalAgents, agentsOf(projB)].sort());
    expect(cache.get(agentsOf(projB))?.types).toEqual(['agent-b']);
    expect(inv.definedAgents!.byEnv).toEqual(new Map([['env-b', ['agent-b']]]));
  });

  /**
   * Verifies that readable presets listing no environment keep only the global folder cached
   */
  it('keeps only the global folder when the presets list no environment', () => {
    const { paths, presetsFile, globalAgents, projA, writePresets } = setup();
    const cache: AgentsCache = new Map();
    writePresets([{ id: 'env-a', cwd: projA }]);
    readInventory(paths, () => true, cache, 1000);
    fs.writeFileSync(presetsFile, JSON.stringify({ byAccount: {} }), 'utf8');
    readInventory(paths, () => true, cache, 2000);
    expect([...cache.keys()]).toEqual([globalAgents]);
  });

  /**
   * Verifies that an unreadable presets file keeps the cached folders of the unknown environments
   */
  it('keeps cache entries when the presets file is unreadable', () => {
    const { paths, presetsFile, globalAgents, projA, agentsOf, writePresets } = setup();
    const cache: AgentsCache = new Map();
    writePresets([{ id: 'env-a', cwd: projA }]);
    readInventory(paths, () => true, cache, 1000);

    fs.writeFileSync(presetsFile, '{not json', 'utf8');
    const inv = readInventory(paths, () => true, cache, 2000);

    expect(inv.presetsOk).toBe(false);
    expect([...cache.keys()].sort()).toEqual([globalAgents, agentsOf(projA)].sort());
    expect(cache.get(agentsOf(projA))).toEqual({ at: 1000, types: ['agent-a'] });

    // Once the presets read again, the kept entry is still fresh and reused as is.
    writePresets([{ id: 'env-a', cwd: projA }]);
    expect(readInventory(paths, () => true, cache, 3000).definedAgents!.byEnv.get('env-a')).toEqual(['agent-a']);
  });

  /**
   * Verifies that a missing presets path, like an unreadable file, keeps the cached folders
   */
  it('keeps cache entries when no presets file is configured', () => {
    const { paths, globalAgents, projA, agentsOf, writePresets } = setup();
    const cache: AgentsCache = new Map();
    writePresets([{ id: 'env-a', cwd: projA }]);
    readInventory(paths, () => true, cache, 1000);
    readInventory({ ...paths, presetsFile: null }, () => true, cache, 2000);
    expect([...cache.keys()].sort()).toEqual([globalAgents, agentsOf(projA)].sort());
  });

  /**
   * Verifies that an environment on a network share gets no agents and its folder is never listed
   */
  it('skips the agents folder of an environment on a network share', () => {
    const { paths, projA, writePresets } = setup();
    writePresets([
      { id: 'env-remote', cwd: '\\\\server\\share\\proj' },
      { id: 'env-a', cwd: projA },
    ]);
    const spy = vi.spyOn(fs, 'opendirSync');
    const byEnv = readInventory(paths, () => true).definedAgents!.byEnv;
    expect(byEnv.get('env-remote')).toEqual([]);
    expect(byEnv.get('env-a')).toEqual(['agent-a']);
    expect(spy.mock.calls.some(([p]) => isRemotePath(String(p)))).toBe(false);
  });
});

describe('sessionInfo', () => {
  const base = { sessionId: 'local_x' };

  /**
   * Verifies that every valid working-context field is kept, worktree wrapped in an object
   */
  it('keeps every valid field', () => {
    expect(
      sessionInfo({
        ...base,
        worktreeName: 'wt-1',
        branch: 'claude/wt-1',
        sourceBranch: 'main',
        model: 'claude-opus-5-5',
        effort: 'high',
        permissionMode: 'acceptEdits',
        completedTurns: 12,
      }),
    ).toStrictEqual({
      worktree: { name: 'wt-1' },
      branch: 'claude/wt-1',
      sourceBranch: 'main',
      model: 'claude-opus-5-5',
      effort: 'high',
      permissionMode: 'acceptEdits',
      completedTurns: 12,
    });
  });

  /**
   * Verifies that a record without context gives an empty object with no undefined keys
   */
  it('returns {} without any undefined key when nothing is set', () => {
    const info = sessionInfo(base);
    expect(info).toStrictEqual({});
    expect(Object.keys(info)).toEqual([]);
  });

  /**
   * Verifies that wrongly typed values are dropped field by field
   */
  it('drops wrongly typed values', () => {
    const info = sessionInfo({
      ...base,
      worktreeName: 5,
      branch: ['main'],
      sourceBranch: null,
      model: { id: 'x' },
      effort: 3,
      permissionMode: true,
      completedTurns: '6',
    });
    expect(info).toStrictEqual({});
  });

  /**
   * Verifies that branch and worktree labels accept any printable text up to 128 characters
   */
  it.each([['main'], ['feature/été 2'], ['a'.repeat(128)], ['fix #12 (urgent)']])('accepts the label %j', (label) => {
    expect(sessionInfo({ ...base, branch: label, sourceBranch: label, worktreeName: label })).toStrictEqual({
      worktree: { name: label },
      branch: label,
      sourceBranch: label,
    });
  });

  /**
   * Verifies that empty, over-long or control-character labels are dropped
   */
  it.each([[''], ['a'.repeat(129)], ['main\n'], ['x\u0000y'], ['x\u007f'], ['\tmain'], ['a\u001bb']])('drops the label %j', (label) => {
    expect(sessionInfo({ ...base, branch: label, sourceBranch: label, worktreeName: label })).toStrictEqual({});
  });

  /**
   * Verifies that model ids made of word characters, dots, colons, at signs and brackets are kept
   */
  it.each([['claude-opus-5-5'], ['claude-sonnet-5-5[1m]'], ['vendor.claude:v1@2026'], ['a'.repeat(64)]])('accepts the model %j', (model) => {
    expect(sessionInfo({ ...base, model }).model).toBe(model);
  });

  /**
   * Verifies that model ids with spaces, markup, accents or over 64 characters are dropped
   */
  it.each([['claude opus'], ['<img src=x>'], ['modèle'], ['a'.repeat(65)], ['']])('drops the model %j', (model) => {
    expect(sessionInfo({ ...base, model })).toStrictEqual({});
  });

  /**
   * Verifies that effort and permission mode accept enum-like words of up to 32 characters
   */
  it.each([['low'], ['xhigh'], ['bypassPermissions'], ['plan-2'], ['a_b'], ['a' + 'b'.repeat(31)]])('accepts the raw word %j', (word) => {
    expect(sessionInfo({ ...base, effort: word, permissionMode: word })).toStrictEqual({ effort: word, permissionMode: word });
  });

  /**
   * Verifies that words starting with a non-letter, with punctuation or spaces, or too long are dropped
   */
  it.each([['1high'], ['-x'], ['high!'], ['plan mode'], ['a'.repeat(33)], [''], ['élevé']])('drops the raw word %j', (word) => {
    expect(sessionInfo({ ...base, effort: word, permissionMode: word })).toStrictEqual({});
  });

  /**
   * Verifies that completed turns accept non-negative safe integers, zero included
   */
  it.each([[0], [6], [Number.MAX_SAFE_INTEGER]])('accepts %d completed turns', (n) => {
    expect(sessionInfo({ ...base, completedTurns: n })).toStrictEqual({ completedTurns: n });
  });

  /**
   * Verifies that negative, fractional, non-finite or unsafe turn counts are dropped
   */
  it.each([[-1], [1.5], [Number.NaN], [Number.POSITIVE_INFINITY], [2 ** 53]])('drops %d completed turns', (n) => {
    expect(sessionInfo({ ...base, completedTurns: n })).toStrictEqual({});
  });

  /**
   * Verifies that an invalid context field never makes the whole desktop record invalid
   */
  it('lets parseDesktopSession keep a record whose context is invalid', () => {
    const s = parseDesktopSession({ sessionId: 'local_x', title: 'T', model: 42, branch: 'main\n', completedTurns: -3, effort: 'medium' });
    expect(s).not.toBeNull();
    expect(s?.title).toBe('T');
    expect(s?.info).toStrictEqual({ effort: 'medium' });
  });
});

describe('cliVersion', () => {
  /**
   * Verifies that usual version strings are kept as they are
   */
  it.each([['2.3.1'], ['2.3.1-beta.2'], ['1.0.0+build.7'], ['a'.repeat(32)]])('keeps %j', (v) => {
    expect(cliVersion(v)).toBe(v);
  });

  /**
   * Verifies that empty, spaced, slashed, markup or over-long versions are dropped
   */
  it.each([[undefined], [''], ['2.3.1 '], ['2.3/1'], ['<b>2</b>'], ['a'.repeat(33)]])('drops %j', (v) => {
    expect(cliVersion(v)).toBeUndefined();
  });
});

describe('parseLiveProcess: version', () => {
  /**
   * Verifies that a valid Claude Code version of a live process is kept
   */
  it('keeps a valid version', () => {
    expect(parseLiveProcess({ pid: 1, sessionId: 's', version: '2.3.1' })?.version).toBe('2.3.1');
  });

  /**
   * Verifies that an invalid version string is dropped while the process is kept
   */
  it('drops an invalid version string but keeps the process', () => {
    const p = parseLiveProcess({ pid: 1, sessionId: 's', version: '2.3.1; rm -rf' });
    expect(p).not.toBeNull();
    expect(p?.version).toBeUndefined();
  });

  /**
   * Verifies that a process file without version gives no version
   */
  it('gives no version when absent', () => {
    expect(parseLiveProcess({ pid: 1, sessionId: 's' })?.version).toBeUndefined();
  });
});

describe('isWorktree', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-wt-'));
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Verifies that a folder holding a .git file (linked worktree) is a worktree
   */
  it('is true when .git is a file', () => {
    const dir = path.join(root, 'linked-wt');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, '.git'), 'gitdir: C:/work/alpha/.git/worktrees/wt-1\n', 'utf8');
    expect(isWorktree(dir)).toBe(true);
  });

  /**
   * Verifies that a main repository (.git folder) is not a worktree
   */
  it('is false when .git is a folder', () => {
    const dir = path.join(root, 'main-repo');
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    expect(isWorktree(dir)).toBe(false);
  });

  /**
   * Verifies that a folder without .git, or a missing folder, is not a worktree
   */
  it('is false without .git or folder', () => {
    const dir = path.join(root, 'plain');
    fs.mkdirSync(dir);
    expect(isWorktree(dir)).toBe(false);
    expect(isWorktree(path.join(root, 'missing'))).toBe(false);
  });

  /**
   * Verifies that empty and relative folders are never checked
   */
  it.each([[''], ['relative\\repo'], ['relative/repo']])('is false for the non-absolute folder %j', (cwd) => {
    expect(isWorktree(cwd)).toBe(false);
  });

  /**
   * Verifies that a network share is reported false without touching the file system
   */
  it.each([['\\\\server\\share\\repo'], ['//server/share/repo']])('is false for the remote folder %s without lstat', (cwd) => {
    const spy = vi.spyOn(fs, 'lstatSync');
    expect(isWorktree(cwd)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  /**
   * Verifies that an lstat failure is reported false instead of throwing
   */
  it('is false when lstat throws', () => {
    const dir = path.join(root, 'locked');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, '.git'), 'gitdir: x\n', 'utf8');
    vi.spyOn(fs, 'lstatSync').mockImplementation(() => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    });
    expect(isWorktree(dir)).toBe(false);
  });
});

describe('linkedBelow', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-linked-'));
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /**
   * Verifies that real folders below the root are not reported as links
   */
  it('is false for plain folders', () => {
    const dir = path.join(root, 'plain', '.claude');
    fs.mkdirSync(dir, { recursive: true });
    expect(linkedBelow(path.join(root, 'plain'), path.join(dir, 'launch.json'))).toBe(false);
  });

  /**
   * Verifies that a missing component stops the check without reporting a link
   */
  it('is false when a component is absent', () => {
    expect(linkedBelow(root, path.join(root, 'absent', 'deeper'))).toBe(false);
  });

  /**
   * Verifies that a junction or symlink component below the root is reported
   */
  it('is true when a component is a link', () => {
    const target = path.join(root, 'target');
    const repo = path.join(root, 'repo');
    fs.mkdirSync(target, { recursive: true });
    fs.mkdirSync(repo, { recursive: true });
    fs.symlinkSync(target, path.join(repo, '.claude'), 'junction');
    expect(linkedBelow(repo, path.join(repo, '.claude', 'launch.json'))).toBe(true);
  });
});

describe('readInventory: worktree flag of live processes', () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-livewt-'));
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /**
   * Verifies that each live process is flagged a worktree only when its cwd holds a .git file
   */
  it('sets worktree from the .git entry of each live cwd', () => {
    const liveDir = path.join(root, 'sessions');
    fs.mkdirSync(liveDir, { recursive: true });
    const wt = path.join(root, 'alpha-wt');
    const main = path.join(root, 'alpha');
    fs.mkdirSync(wt, { recursive: true });
    fs.mkdirSync(path.join(main, '.git'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.git'), 'gitdir: x\n', 'utf8');
    const live = (pid: number, cwd: string) =>
      fs.writeFileSync(path.join(liveDir, `${pid}.json`), JSON.stringify({ pid, sessionId: `s-${pid}`, cwd, version: '2.3.1' }), 'utf8');
    live(101, wt);
    live(102, main);
    live(103, '\\\\server\\share\\repo');

    const inv = readInventory(
      { claudeHome: root, liveDir, desktopData: null, presetsFile: null, sessionDirs: [] },
      () => true,
    );
    const byPid = new Map(inv.live.map((p) => [p.pid, p]));
    expect(byPid.get(101)).toMatchObject({ worktree: true, version: '2.3.1' });
    expect(byPid.get(102)?.worktree).toBe(false);
    expect(byPid.get(103)?.worktree).toBe(false);
  });
});
