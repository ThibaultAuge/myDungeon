import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentView, DialogueEntry, SessionView, TranscriptPage } from '@agent-office/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LINE_MAX,
  PAGE_ENTRIES,
  READ_HARD_CAP,
  TEXT_MAX,
  entriesOfLine,
  findTranscript,
  isInside,
  projectDirName,
  readTranscriptPage,
  transcriptEtag,
} from '../src/transcript.ts';
import { CLI_A, CLI_B } from './fixtures/builders.ts';

const CWD = 'C:\\work\\alpha';
const SESSION_ID = `cli:${CLI_A}`;
const SUB_ID = 'a1b2c3d4e5';

function agent(overrides: Partial<AgentView> = {}): AgentView {
  return {
    id: `${SESSION_ID}#main`,
    sessionId: SESSION_ID,
    kind: 'main',
    agentType: 'Session principale',
    state: 'working',
    room: 'autel',
    since: 0,
    ...overrides,
  };
}

function session(overrides: Partial<SessionView> = {}): SessionView {
  return {
    id: SESSION_ID,
    origin: 'cli',
    cliSessionIds: [CLI_A],
    envId: null,
    title: 'alpha',
    cwd: CWD,
    live: true,
    archived: false,
    createdAt: 0,
    lastActivityAt: 0,
    main: agent(),
    subagents: [agent({ id: SUB_ID, kind: 'sub', agentType: 'Explore', room: 'biblio' })],
    ...overrides,
  };
}

function userLine(content: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content }, ...extra });
}

function assistantLine(content: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: 'assistant', message: { role: 'assistant', content }, ...extra });
}

/** Text of a user/assistant entry, or the tool name of a tool entry. */
function label(e: DialogueEntry): string {
  return e.role === 'tool' ? `tool:${e.tool}` : e.text;
}

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-transcript-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function write(rel: string, content: string | Buffer): string {
  const file = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

/** Reads every page from the end to the start of the file; fails instead of looping forever. */
function readAllPages(file: string, limit?: number): TranscriptPage[] {
  const pages: TranscriptPage[] = [];
  let before: number | undefined;
  for (let guard = 0; guard < 10_000; guard++) {
    const page = readTranscriptPage(file, before, limit);
    pages.push(page);
    if (page.before === null) return pages;
    if (before !== undefined) expect(page.before).toBeLessThan(before);
    before = page.before;
  }
  throw new Error('pagination did not reach the start of the file');
}

function allEntries(pages: TranscriptPage[]): DialogueEntry[] {
  // Pages come newest first; each page is oldest-first.
  return [...pages].reverse().flatMap((p) => p.entries);
}

describe('projectDirName', () => {
  /**
   * Verifies that every non-alphanumeric character of a cwd becomes a dash
   */
  it.each([
    ['C:\\work\\alpha', 'C--work-alpha'],
    ['C:/work/alpha', 'C--work-alpha'],
    ['/home/u/my.proj_x', '-home-u-my-proj-x'],
    ['..', '--'],
    ['', ''],
  ])('encodes %j as %j', (cwd, expected) => {
    expect(projectDirName(cwd)).toBe(expected);
  });
});

describe('isInside', () => {
  const root = path.resolve(os.tmpdir(), 'agent-office-root');

  /**
   * Verifies that a path below the root is inside it
   */
  it('accepts a nested path', () => {
    expect(isInside(root, path.join(root, 'a', 'b.jsonl'))).toBe(true);
  });

  /**
   * Verifies that the root itself is not strictly inside itself
   */
  it('rejects the root itself', () => {
    expect(isInside(root, root)).toBe(false);
  });

  /**
   * Verifies that parent, sibling-prefix and traversal paths are outside the root
   */
  it.each([
    ['parent', path.dirname(root)],
    ['sibling with the same prefix', `${root}-other${path.sep}x.jsonl`],
    ['traversal', path.join(root, 'a', '..', '..', 'x.jsonl')],
  ])('rejects a %s path', (_label, p) => {
    expect(isInside(root, p)).toBe(false);
  });
});

describe('findTranscript', () => {
  const dir = projectDirName(CWD);

  /**
   * Verifies that the main agent's transcript is found under the folder named after its cwd
   */
  it('finds the main transcript in the cwd project folder', () => {
    const file = write(path.join(dir, `${CLI_A}.jsonl`), userLine('hi') + '\n');
    expect(findTranscript(tmp, session(), `${SESSION_ID}#main`)).toBe(file);
  });

  /**
   * Verifies that the main transcript is found in another project folder when the cwd one has none
   */
  it('falls back to any project folder', () => {
    const file = write(path.join('D--elsewhere', `${CLI_A}.jsonl`), userLine('hi') + '\n');
    expect(findTranscript(tmp, session(), `${SESSION_ID}#main`)).toBe(file);
  });

  /**
   * Verifies that the most recently written file wins among several cli session ids
   */
  it('picks the newest transcript among cliSessionIds', () => {
    const a = write(path.join(dir, `${CLI_A}.jsonl`), userLine('a') + '\n');
    const b = write(path.join(dir, `${CLI_B}.jsonl`), userLine('b') + '\n');
    fs.utimesSync(a, new Date(2_000_000_000_000), new Date(2_000_000_000_000));
    fs.utimesSync(b, new Date(1_000_000_000_000), new Date(1_000_000_000_000));
    const s = session({ cliSessionIds: [CLI_B, CLI_A] });
    expect(findTranscript(tmp, s, `${SESSION_ID}#main`)).toBe(a);
    fs.utimesSync(b, new Date(2_100_000_000_000), new Date(2_100_000_000_000));
    expect(findTranscript(tmp, s, `${SESSION_ID}#main`)).toBe(b);
  });

  /**
   * Verifies that null is returned when no transcript exists yet
   */
  it('returns null when the file does not exist', () => {
    fs.mkdirSync(path.join(tmp, dir));
    expect(findTranscript(tmp, session(), `${SESSION_ID}#main`)).toBeNull();
  });

  /**
   * Verifies that a missing projects folder yields null instead of throwing
   */
  it('returns null when the projects folder is missing', () => {
    expect(findTranscript(path.join(tmp, 'missing'), session(), `${SESSION_ID}#main`)).toBeNull();
  });

  /**
   * Verifies that a directory named like a transcript is not taken for one
   */
  it('ignores a directory with the transcript name', () => {
    fs.mkdirSync(path.join(tmp, dir, `${CLI_A}.jsonl`), { recursive: true });
    expect(findTranscript(tmp, session(), `${SESSION_ID}#main`)).toBeNull();
  });

  /**
   * Verifies that cli session ids that are not UUIDs never become file names
   */
  // Ids are only written as plain file names here: a traversal id would write outside tmp.
  it.each([['not-a-uuid'], ['..'], [`${CLI_A}x`], [CLI_A.slice(0, -1)]])(
    'ignores the non-UUID cliSessionId %j',
    (bad) => {
      write(path.join(dir, `${bad}.jsonl`), userLine('x') + '\n');
      write(`${bad}.jsonl`, userLine('x') + '\n');
      expect(findTranscript(tmp, session({ cliSessionIds: [bad] }), `${SESSION_ID}#main`)).toBeNull();
    },
  );

  /**
   * Verifies that a cwd made of dots cannot make the lookup leave the projects folder
   */
  it('never escapes the projects folder through the cwd', () => {
    const projects = path.join(tmp, 'projects');
    fs.mkdirSync(projects);
    write(`${CLI_A}.jsonl`, userLine('outside') + '\n');
    expect(findTranscript(projects, session({ cwd: '..' }), `${SESSION_ID}#main`)).toBeNull();
  });

  /**
   * Verifies that a known subagent's transcript is found in the session's subagents folder
   */
  it('finds a subagent transcript', () => {
    const file = write(path.join(dir, CLI_A, 'subagents', `agent-${SUB_ID}.jsonl`), userLine('task') + '\n');
    expect(findTranscript(tmp, session(), SUB_ID)).toBe(file);
  });

  /**
   * Verifies that the main lookup does not return a subagent file and vice versa
   */
  it('keeps main and subagent transcripts apart', () => {
    const sub = write(path.join(dir, CLI_A, 'subagents', `agent-${SUB_ID}.jsonl`), userLine('task') + '\n');
    expect(findTranscript(tmp, session(), `${SESSION_ID}#main`)).toBeNull();
    const main = write(path.join(dir, `${CLI_A}.jsonl`), userLine('hi') + '\n');
    expect(findTranscript(tmp, session(), `${SESSION_ID}#main`)).toBe(main);
    expect(findTranscript(tmp, session(), SUB_ID)).toBe(sub);
  });

  /**
   * Verifies that an agent id absent from the session is refused even if its file exists
   */
  it('returns null for an agent that is not in the session', () => {
    write(path.join(dir, CLI_A, 'subagents', 'agent-other01.jsonl'), userLine('x') + '\n');
    expect(findTranscript(tmp, session(), 'other01')).toBeNull();
  });

  /**
   * Verifies that the main agent id of another session is refused
   */
  it("returns null for another session's main agent id", () => {
    write(path.join(dir, `${CLI_A}.jsonl`), userLine('x') + '\n');
    expect(findTranscript(tmp, session(), `cli:${CLI_B}#main`)).toBeNull();
  });

  /**
   * Verifies that a subagent id failing the id pattern is refused even when listed
   */
  it.each([['../evil'], ['a/b'], ['-lead'], ['']])('returns null for the invalid agent id %j', (bad) => {
    write(path.join(dir, CLI_A, 'subagents', `agent-${SUB_ID}.jsonl`), userLine('x') + '\n');
    const s = session({ subagents: [agent({ id: bad, kind: 'sub', agentType: 'Explore' })] });
    expect(findTranscript(tmp, s, bad)).toBeNull();
  });

  /**
   * Verifies that a session without any valid cli session id has no transcript
   */
  it('returns null when the session has no cli session id', () => {
    write(path.join(dir, `${CLI_A}.jsonl`), userLine('x') + '\n');
    expect(findTranscript(tmp, session({ cliSessionIds: [] }), `${SESSION_ID}#main`)).toBeNull();
  });
});

describe('entriesOfLine', () => {
  /**
   * Verifies that a user string message becomes one user entry keyed by offset and block
   */
  it('maps a string user message to one entry', () => {
    const line = userLine('Hello there', { timestamp: '2026-11-14T10:00:00.000Z' });
    expect(entriesOfLine(line, 42)).toEqual([
      { key: '42:0', at: Date.parse('2026-11-14T10:00:00.000Z'), role: 'user', text: 'Hello there' },
    ]);
  });

  /**
   * Verifies that text and tool_use blocks each become an entry, skipping thinking blocks
   */
  it('maps assistant text and tool_use blocks, skipping thinking', () => {
    const line = assistantLine([
      { type: 'thinking', thinking: 'secret reasoning' },
      { type: 'text', text: 'Reading the file.' },
      { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/repo/src/a.ts' } },
      { type: 'text', text: 'Done.' },
    ]);
    expect(entriesOfLine(line, 7)).toEqual([
      { key: '7:1', role: 'assistant', text: 'Reading the file.' },
      { key: '7:2', role: 'tool', tool: 'Read', detail: '/repo/src/a.ts' },
      { key: '7:3', role: 'assistant', text: 'Done.' },
    ]);
  });

  /**
   * Verifies that a tool call without a known detail key has no detail
   */
  it('leaves detail undefined for a tool input without a known key', () => {
    const [e] = entriesOfLine(assistantLine([{ type: 'tool_use', name: 'TodoWrite', input: { todos: [] } }]), 0);
    expect(e).toMatchObject({ role: 'tool', tool: 'TodoWrite' });
    expect(e && 'detail' in e ? e.detail : undefined).toBeUndefined();
  });

  /**
   * Verifies that a tool name longer than 64 characters is cut to 64
   */
  it('cuts long tool names to 64 characters', () => {
    const name = 'x'.repeat(100);
    const [e] = entriesOfLine(assistantLine([{ type: 'tool_use', name, input: {} }]), 0);
    expect(e && e.role === 'tool' ? e.tool : '').toBe('x'.repeat(64));
  });

  /**
   * Verifies that a tool_use block without a string name is skipped
   */
  it('skips a tool_use without a name', () => {
    expect(entriesOfLine(assistantLine([{ type: 'tool_use', input: {} }]), 0)).toEqual([]);
  });

  /**
   * Verifies that tool_use blocks in a user message do not become tool entries
   */
  it('ignores tool_use blocks in user messages', () => {
    expect(entriesOfLine(userLine([{ type: 'tool_use', name: 'Bash', input: {} }]), 0)).toEqual([]);
  });

  /**
   * Verifies that tool results returned in user lines are not shown
   */
  it('skips tool_result blocks', () => {
    expect(entriesOfLine(userLine([{ type: 'tool_result', tool_use_id: 't1', content: 'file body' }]), 0)).toEqual([]);
  });

  /**
   * Verifies that a text of exactly TEXT_MAX characters is kept whole and not flagged
   */
  it('keeps a TEXT_MAX-long text whole', () => {
    const [e] = entriesOfLine(userLine('a'.repeat(TEXT_MAX)), 0);
    expect(e).toEqual({ key: '0:0', role: 'user', text: 'a'.repeat(TEXT_MAX) });
    expect(e).not.toHaveProperty('truncated');
  });

  /**
   * Verifies that a text longer than TEXT_MAX is cut and flagged as truncated
   */
  it('cuts a longer text to TEXT_MAX and flags it', () => {
    const [e] = entriesOfLine(assistantLine([{ type: 'text', text: 'b'.repeat(TEXT_MAX + 1) }]), 0);
    expect(e).toEqual({ key: '0:0', role: 'assistant', text: 'b'.repeat(TEXT_MAX), truncated: true });
  });

  /**
   * Verifies that prompt text Claude Code adds itself is hidden from user messages
   */
  it.each([
    ['<command-name>/clear</command-name>'],
    ['<local-command-stdout>ok</local-command-stdout>'],
    ['<system-reminder>ctx</system-reminder>'],
    ['<task-notification>done</task-notification>'],
    ['  \n<command-message>x</command-message>'],
  ])('skips the user meta text %j', (text) => {
    expect(entriesOfLine(userLine(text), 0)).toEqual([]);
    expect(entriesOfLine(userLine([{ type: 'text', text }]), 0)).toEqual([]);
  });

  /**
   * Verifies that an assistant text starting like a meta tag is still shown
   */
  it('keeps an assistant text that starts with a meta-like tag', () => {
    expect(entriesOfLine(assistantLine([{ type: 'text', text: '<command-name>x' }]), 3)).toEqual([
      { key: '3:0', role: 'assistant', text: '<command-name>x' },
    ]);
  });

  /**
   * Verifies that a meta block is skipped while its sibling blocks keep their indexes
   */
  it('skips meta blocks but keeps block indexes of the others', () => {
    const line = userLine([{ type: 'text', text: '<system-reminder>x</system-reminder>' }, null, { type: 'text', text: 'real question' }]);
    expect(entriesOfLine(line, 9)).toEqual([{ key: '9:2', role: 'user', text: 'real question' }]);
  });

  /**
   * Verifies that blank texts are skipped
   */
  it('skips empty and whitespace-only texts', () => {
    expect(entriesOfLine(userLine('   \n '), 0)).toEqual([]);
    expect(entriesOfLine(assistantLine([{ type: 'text', text: '' }]), 0)).toEqual([]);
  });

  /**
   * Verifies that lines flagged isMeta are skipped
   */
  it('skips isMeta lines', () => {
    expect(entriesOfLine(userLine('Caveat: generated', { isMeta: true }), 0)).toEqual([]);
  });

  /**
   * Verifies that invalid, partial or non-object JSON lines yield no entry
   */
  it.each([['{"type":"user","mess'], ['not json'], [''], ['null'], ['42'], ['"text"'], ['[]']])(
    'returns [] for the line %j',
    (line) => {
      expect(entriesOfLine(line, 0)).toEqual([]);
    },
  );

  /**
   * Verifies that line types other than user and assistant are ignored
   */
  it.each([['system'], ['summary'], ['progress'], ['attachment']])('ignores %s lines', (type) => {
    expect(entriesOfLine(JSON.stringify({ type, message: { content: 'hello' } }), 0)).toEqual([]);
  });

  /**
   * Verifies that a missing or malformed message yields no entry
   */
  it.each([
    [{ type: 'user' }],
    [{ type: 'user', message: 'text' }],
    [{ type: 'assistant', message: { content: 12 } }],
    [{ type: 'assistant', message: { content: { type: 'text', text: 'x' } } }],
  ])('returns [] for the malformed message %j', (obj) => {
    expect(entriesOfLine(JSON.stringify(obj), 0)).toEqual([]);
  });

  /**
   * Verifies that an unparsable or non-string timestamp leaves the time unset
   */
  it.each([['not a date'], [12345]])('leaves at undefined for timestamp %j', (timestamp) => {
    const [e] = entriesOfLine(userLine('hi', { timestamp }), 0);
    expect(e?.at).toBeUndefined();
    expect(e).toMatchObject({ role: 'user', text: 'hi' });
  });
});

describe('transcriptEtag', () => {
  /**
   * Verifies that the tag combines file stem, size and whole-millisecond mtime in quotes
   */
  it('builds a quoted tag from name, size and mtime', () => {
    const st = { size: 1234, mtimeMs: 1_700_000_000_123.9 } as fs.Stats;
    expect(transcriptEtag(path.join(tmp, `${CLI_A}.jsonl`), st)).toBe(`"${CLI_A}-1234-1700000000123"`);
  });

  /**
   * Verifies that a change of size or mtime gives a different tag
   */
  it('changes when the file grows or is rewritten', () => {
    const f = path.join(tmp, 'x.jsonl');
    const base = transcriptEtag(f, { size: 10, mtimeMs: 5 } as fs.Stats);
    expect(transcriptEtag(f, { size: 11, mtimeMs: 5 } as fs.Stats)).not.toBe(base);
    expect(transcriptEtag(f, { size: 10, mtimeMs: 6 } as fs.Stats)).not.toBe(base);
  });
});

describe('readTranscriptPage', () => {
  /** Writes lines joined by newlines (and a trailing one), returning each line's byte offset. */
  function writeLines(name: string, lines: string[], trailingNewline = true): { file: string; offsets: number[] } {
    const offsets: number[] = [];
    let pos = 0;
    for (const l of lines) {
      offsets.push(pos);
      pos += Buffer.byteLength(l) + 1;
    }
    const file = write(name, lines.join('\n') + (trailingNewline ? '\n' : ''));
    return { file, offsets };
  }

  /**
   * Verifies that a small file is returned whole, oldest first, with keys and a null cursor
   */
  it('returns a whole small file oldest-first with byte-offset keys', () => {
    const { file, offsets } = writeLines(`${CLI_A}.jsonl`, [userLine('one'), assistantLine([{ type: 'text', text: 'two' }]), userLine('three')]);
    const page = readTranscriptPage(file);
    expect(page.file).toBe(CLI_A);
    expect(page.before).toBeNull();
    expect(page.entries.map(label)).toEqual(['one', 'two', 'three']);
    expect(page.entries.map((e) => e.key)).toEqual(offsets.map((o) => `${o}:0`));
  });

  /**
   * Verifies that an empty file yields no entry and a null cursor
   */
  it('handles an empty file', () => {
    const file = write('empty.jsonl', '');
    expect(readTranscriptPage(file)).toEqual({ file: 'empty', entries: [], before: null });
  });

  /**
   * Verifies that a complete last line without a trailing newline is still read
   */
  it('reads a valid last line without trailing newline', () => {
    const { file } = writeLines('partial.jsonl', [userLine('first'), userLine('last')], false);
    expect(readTranscriptPage(file).entries.map(label)).toEqual(['first', 'last']);
  });

  /**
   * Verifies that a last line still being written is dropped without error
   */
  it('drops an incomplete last line', () => {
    const file = write('writing.jsonl', userLine('first') + '\n' + '{"type":"user","message":{"con');
    const page = readTranscriptPage(file);
    expect(page.entries.map(label)).toEqual(['first']);
    expect(page.before).toBeNull();
  });

  /**
   * Verifies that a page holds the newest `limit` entries and a cursor at the oldest line read
   */
  it('returns the newest entries with a cursor to the older ones', () => {
    const lines = Array.from({ length: 10 }, (_, i) => userLine(`m${i}`));
    const { file, offsets } = writeLines('ten.jsonl', lines);
    const page = readTranscriptPage(file, undefined, 4);
    expect(page.entries.map(label)).toEqual(['m6', 'm7', 'm8', 'm9']);
    expect(page.before).toBe(offsets[6]);
    const older = readTranscriptPage(file, page.before ?? undefined, 4);
    expect(older.entries.map(label)).toEqual(['m2', 'm3', 'm4', 'm5']);
    expect(older.before).toBe(offsets[2]);
    const first = readTranscriptPage(file, older.before ?? undefined, 4);
    expect(first.entries.map(label)).toEqual(['m0', 'm1']);
    expect(first.before).toBeNull();
  });

  /**
   * Verifies that the first line alone forms a last page with a null cursor
   */
  it('reads the first line alone when the previous page stopped on line 1', () => {
    const lines = Array.from({ length: 3 }, (_, i) => userLine(`m${i}`));
    const { file, offsets } = writeLines('three.jsonl', lines);
    const page = readTranscriptPage(file, undefined, 2);
    expect(page.entries.map(label)).toEqual(['m1', 'm2']);
    expect(page.before).toBe(offsets[1]);
    const last = readTranscriptPage(file, page.before ?? undefined, 2);
    expect(last).toEqual({ file: 'three', entries: [{ key: '0:0', role: 'user', text: 'm0' }], before: null });
  });

  /**
   * Verifies that the cursor is null when the first line completes the page
   */
  it('gives a null cursor when the first line fills the page', () => {
    const lines = Array.from({ length: 4 }, (_, i) => userLine(`m${i}`));
    const { file, offsets } = writeLines('four.jsonl', lines);
    const page = readTranscriptPage(file, undefined, 2);
    expect(page.before).toBe(offsets[2]);
    const last = readTranscriptPage(file, page.before ?? undefined, 2);
    expect(last.entries.map(label)).toEqual(['m0', 'm1']);
    expect(last.before).toBeNull();
  });

  /**
   * Verifies that the default page size is PAGE_ENTRIES
   */
  it('defaults to PAGE_ENTRIES entries per page', () => {
    const lines = Array.from({ length: PAGE_ENTRIES + 7 }, (_, i) => userLine(`m${i}`));
    const { file } = writeLines('default.jsonl', lines);
    const page = readTranscriptPage(file);
    expect(page.entries).toHaveLength(PAGE_ENTRIES);
    expect(label(page.entries[PAGE_ENTRIES - 1]!)).toBe(`m${PAGE_ENTRIES + 6}`);
    expect(page.before).not.toBeNull();
  });

  /**
   * Verifies that a multi-block line is never split: the page may exceed the limit
   */
  it('keeps every block of a line even past the limit', () => {
    const multi = assistantLine([
      { type: 'text', text: 'a' },
      { type: 'tool_use', name: 'Grep', input: { pattern: 'foo' } },
      { type: 'text', text: 'b' },
    ]);
    const { file, offsets } = writeLines('multi.jsonl', [userLine('q'), multi]);
    const page = readTranscriptPage(file, undefined, 2);
    expect(page.entries.map(label)).toEqual(['a', 'tool:Grep', 'b']);
    expect(page.entries.map((e) => e.key)).toEqual([`${offsets[1]}:0`, `${offsets[1]}:1`, `${offsets[1]}:2`]);
    expect(page.before).toBe(offsets[1]);
    const older = readTranscriptPage(file, page.before ?? undefined, 2);
    expect(older.entries.map(label)).toEqual(['q']);
    expect(older.before).toBeNull();
  });

  /**
   * Verifies that lines without entries are walked over without counting toward the limit
   */
  it('skips lines that produce no entry', () => {
    const lines = [
      userLine('q'),
      JSON.stringify({ type: 'progress' }),
      userLine([{ type: 'tool_result', content: 'x' }]),
      assistantLine([{ type: 'thinking', thinking: 'hm' }]),
      'garbage',
      assistantLine([{ type: 'text', text: 'answer' }]),
    ];
    const { file } = writeLines('noise.jsonl', lines);
    const page = readTranscriptPage(file, undefined, 2);
    expect(page.entries.map(label)).toEqual(['q', 'answer']);
    expect(page.before).toBeNull();
  });

  /**
   * Verifies that a cursor past the end is clamped to the file size
   */
  it('clamps a cursor beyond the end of the file', () => {
    const { file } = writeLines('clamp.jsonl', [userLine('a'), userLine('b')]);
    const page = readTranscriptPage(file, 10_000_000);
    expect(page.entries.map(label)).toEqual(['a', 'b']);
    expect(page.before).toBeNull();
  });

  /**
   * Verifies that a cursor of zero returns an empty page at the start of the file
   */
  it('returns nothing before offset 0', () => {
    const { file } = writeLines('zero.jsonl', [userLine('a')]);
    expect(readTranscriptPage(file, 0)).toEqual({ file: 'zero', entries: [], before: null });
  });

  /**
   * Verifies that paging through a file larger than one read chunk returns every entry once, in order
   */
  it('pages across 64 KB chunk boundaries without loss or duplicates', () => {
    const count = 2000;
    // Varying lengths and a multi-byte character, so lines and characters straddle chunk edges.
    const texts = Array.from({ length: count }, (_, i) => `message ${i} é ${'x'.repeat(i % 53)}`);
    const { file, offsets } = writeLines('big.jsonl', texts.map((t, i) => userLine(t, { timestamp: new Date(1_700_000_000_000 + i).toISOString() })));
    expect(fs.statSync(file).size).toBeGreaterThan(3 * 64 * 1024);

    const pages = readAllPages(file, 50);
    for (const p of pages) expect(p.entries.length).toBeLessThanOrEqual(50);
    const entries = allEntries(pages);
    expect(entries.map(label)).toEqual(texts);
    expect(entries.map((e) => e.key)).toEqual(offsets.map((o) => `${o}:0`));
    expect(entries[count - 1]?.at).toBe(1_700_000_000_000 + count - 1);
    // Each cursor is the start of the oldest line of its page.
    for (const p of pages) if (p.before !== null) expect(p.entries[0]?.key).toBe(`${p.before}:0`);
  });

  /**
   * Verifies that a line longer than LINE_MAX is skipped while its neighbours are still read
   */
  it('skips an oversized line', () => {
    const big = userLine('y'.repeat(LINE_MAX + 100));
    const { file } = writeLines('oversized.jsonl', [userLine('before'), big, userLine('after')]);
    const entries = allEntries(readAllPages(file));
    expect(entries.map(label)).toEqual(['before', 'after']);
  });

  /**
   * Verifies that a file made of a single oversized line yields an empty first page at the start
   */
  it('returns an empty page for a file with one oversized line', () => {
    const file = write('only-big.jsonl', userLine('z'.repeat(LINE_MAX + 100)) + '\n');
    expect(readTranscriptPage(file)).toEqual({ file: 'only-big', entries: [], before: null });
  });

  /**
   * Verifies that a line just under LINE_MAX is kept, its text cut to TEXT_MAX
   */
  it('keeps a line just under LINE_MAX and truncates its text', () => {
    const near = userLine('w'.repeat(LINE_MAX - 200));
    expect(Buffer.byteLength(near)).toBeLessThan(LINE_MAX);
    const { file } = writeLines('near.jsonl', [userLine('small'), near]);
    const entries = allEntries(readAllPages(file));
    expect(entries.map((e) => (e.role === 'tool' ? '' : e.text.length))).toEqual([5, TEXT_MAX]);
    expect(entries[1]).toMatchObject({ role: 'user', truncated: true });
  });

  /**
   * Verifies that the read budget ends a page early once a line was handled, and paging still progresses
   */
  it('stops a page at the read budget and resumes from its cursor', () => {
    const noise = JSON.stringify({ type: 'progress', data: 'p'.repeat(80) });
    const lines = [userLine('first'), ...Array.from({ length: 15_000 }, () => noise), userLine('last')];
    const { file } = writeLines('budget.jsonl', lines);
    expect(fs.statSync(file).size).toBeGreaterThan(1.4 * 1024 * 1024);

    const latest = readTranscriptPage(file);
    expect(latest.entries.map(label)).toEqual(['last']);
    expect(latest.before).not.toBeNull();

    const pages = readAllPages(file);
    expect(allEntries(pages).map(label)).toEqual(['first', 'last']);
  });
});

describe('readTranscriptPage: hard read cap', () => {
  /**
   * Verifies that a line longer than the hard cap stops the read and still moves the cursor back
   */
  it('stops inside a huge line and resumes before it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-cap-'));
    try {
      const file = path.join(dir, 'huge.jsonl');
      const head = `${JSON.stringify({ type: 'user', message: { content: 'hello' } })}\n`;
      fs.writeFileSync(file, head + 'x'.repeat(READ_HARD_CAP + 200 * 1024));
      const size = fs.statSync(file).size;
      const first = readTranscriptPage(file);
      expect(first.entries).toEqual([]);
      expect(first.before).not.toBeNull();
      expect(first.before!).toBeLessThan(size);
      expect(first.before!).toBeGreaterThan(0);
      const second = readTranscriptPage(file, first.before!);
      expect(second.entries.map((e) => (e.role === 'tool' ? e.tool : e.text))).toEqual(['hello']);
      expect(second.before).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
