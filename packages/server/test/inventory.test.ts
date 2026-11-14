import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AGENTS_CACHE_MS,
  agentNameFromDefinition,
  type AgentsCache,
  isWithin,
  matchEnvironment,
  normPath,
  parseDesktopSession,
  parseLiveProcess,
  parsePresets,
  readAgentTypes,
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
    ['---\nname: dexter'],
    ['---\r\ndescription: long\r\nname: dexter\r\n'],
    ['﻿---\ndescription: x\nname: "dexter"\nmodel: opus'],
  ])('reads the name of an unclosed frontmatter %j', (text) => {
    expect(agentNameFromDefinition(text)).toBe('dexter');
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
    const realReaddir = fs.readdirSync;
    vi.spyOn(fs, 'readdirSync').mockImplementation(((p: fs.PathLike, opts?: unknown) => {
      if (String(p) === dir) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      return (realReaddir as (p: fs.PathLike, o?: unknown) => unknown)(p, opts);
    }) as unknown as typeof fs.readdirSync);
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

    const realReaddir = fs.readdirSync;
    vi.spyOn(fs, 'readdirSync').mockImplementation(((p: fs.PathLike, opts?: unknown) => {
      if (String(p) === agents) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      return (realReaddir as (p: fs.PathLike, o?: unknown) => unknown)(p, opts);
    }) as unknown as typeof fs.readdirSync);

    expect(globalAt(paths, cache, 1000 + AGENTS_CACHE_MS)).toEqual(['alpha']);
    expect(cache.get(agents)?.types).toEqual(['alpha']);
  });

  /**
   * Verifies that a transient failure with nothing cached yet gives no type
   */
  it('gives [] on a transient failure with an empty cache', () => {
    const { paths, agents } = home();
    const realReaddir = fs.readdirSync;
    vi.spyOn(fs, 'readdirSync').mockImplementation(((p: fs.PathLike, opts?: unknown) => {
      if (String(p) === agents) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      return (realReaddir as (p: fs.PathLike, o?: unknown) => unknown)(p, opts);
    }) as unknown as typeof fs.readdirSync);
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
