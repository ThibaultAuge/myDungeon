// Reads an agent's conversation from the Claude Code transcripts (`~/.claude/projects`).
// Paths are always derived from the office state, never received from a client or a hook.
import fs from 'node:fs';
import path from 'node:path';
import type { DialogueEntry, SessionView, TranscriptPage } from '@agent-office/shared';
import { AGENT_ID } from './inventory.ts';
import { toolDetail } from './reducer.ts';

/** Entries per page. A page stops at a line boundary, so it may hold a few more. */
export const PAGE_ENTRIES = 50;
/** Characters kept from one text block. */
export const TEXT_MAX = 4000;
/** Bytes read backwards per chunk, and per request once a line was read. */
const CHUNK = 64 * 1024;
export const READ_BUDGET = 1024 * 1024;
/** Hard cap per request, even inside one huge line: the next page resumes where this one stopped. */
export const READ_HARD_CAP = 8 * 1024 * 1024;
/** A longer line (a large tool result, an API blob) is skipped without being kept in memory. */
export const LINE_MAX = 1024 * 1024;

/** Claude Code session ids are UUIDs: anything else never becomes a file name. */
const CLI_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Shared with inventory.ts (which transcript.ts imports): they live in the leaf module paths.ts.
export { isInside, projectDirName } from './paths.ts';
import { isInside, projectDirName } from './paths.ts';

function regularFile(p: string): fs.Stats | undefined {
  try {
    const st = fs.lstatSync(p);
    return st.isFile() ? st : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Candidate `<projects>/<dir>/<cliSessionId>` stems of a session, in the folder named after
 * its cwd (`all` false) or in every other project folder (`all` true: a session may have
 * moved, or its cwd be encoded differently). Only valid ids are used.
 */
function sessionStems(projectsDir: string, session: Pick<SessionView, 'cwd' | 'cliSessionIds'>, all: boolean): string[] {
  const ids = session.cliSessionIds.filter((id) => CLI_SESSION_ID.test(id));
  if (ids.length === 0) return [];
  const own = projectDirName(session.cwd);
  const dirs: string[] = [];
  if (!all) dirs.push(own);
  else {
    try {
      for (const e of fs.readdirSync(projectsDir, { withFileTypes: true })) if (e.isDirectory() && e.name !== own) dirs.push(e.name);
    } catch {
      /* no projects folder */
    }
  }
  return dirs.flatMap((d) => ids.map((id) => path.join(projectsDir, d, id)));
}

/** The most recently written candidate that exists, or null. */
function newest(projectsDir: string, files: string[]): string | null {
  let best: { file: string; mtime: number } | null = null;
  for (const file of files) {
    if (!isInside(projectsDir, file)) continue;
    const st = regularFile(file);
    if (st && (!best || st.mtimeMs > best.mtime)) best = { file, mtime: st.mtimeMs };
  }
  return best?.file ?? null;
}

/**
 * The transcript of an agent of `session`, or null when there is none (yet). `agentId` is the
 * office id: `<session>#main` for the main agent, the hook `agent_id` for a subagent.
 */
export function findTranscript(projectsDir: string, session: SessionView, agentId: string): string | null {
  let fileOf: (stem: string) => string;
  if (agentId === session.main.id) fileOf = (s) => `${s}.jsonl`;
  else if (AGENT_ID.test(agentId) && session.subagents.some((a) => a.id === agentId)) fileOf = (s) => path.join(s, 'subagents', `agent-${agentId}.jsonl`);
  else return null;
  // The cwd folder answers almost always; every project folder is listed only when it does not
  // (this runs on every 2 s poll of an open conversation).
  return (
    newest(projectsDir, sessionStems(projectsDir, session, false).map(fileOf)) ??
    newest(projectsDir, sessionStems(projectsDir, session, true).map(fileOf))
  );
}

function cut(text: string): { text: string; truncated?: boolean } {
  return text.length > TEXT_MAX ? { text: text.slice(0, TEXT_MAX), truncated: true } : { text };
}

/** Prompt text that Claude Code adds itself (slash command echoes, local command output). */
function isMetaText(text: string): boolean {
  return /^<(command-|local-command-|system-reminder|task-notification|bash-)/.test(text.trimStart());
}

/** The dialogue entries of one transcript line (several when it holds several blocks). */
export function entriesOfLine(line: string, offset: number): DialogueEntry[] {
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return []; // a line still being written, or not JSON
  }
  if (!obj || typeof obj !== 'object') return [];
  const rec = obj as Record<string, unknown>;
  // isCompactSummary: the summary Claude Code writes after compacting, not something said.
  if ((rec.type !== 'user' && rec.type !== 'assistant') || rec.isMeta === true || rec.isCompactSummary === true) return [];
  const msg = rec.message as Record<string, unknown> | undefined;
  if (!msg || typeof msg !== 'object') return [];
  const ts = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN;
  const at = Number.isFinite(ts) ? ts : undefined;
  const role = rec.type;
  const blocks: unknown[] = typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : Array.isArray(msg.content) ? msg.content : [];
  const out: DialogueEntry[] = [];
  blocks.forEach((b, i) => {
    if (!b || typeof b !== 'object') return;
    const block = b as Record<string, unknown>;
    const key = `${offset}:${i}`;
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
      if (role === 'user' && isMetaText(block.text)) return;
      out.push({ key, at, role, ...cut(block.text) });
    } else if (role === 'assistant' && block.type === 'tool_use' && typeof block.name === 'string') {
      out.push({ key, at, role: 'tool', tool: block.name.slice(0, 64), detail: toolDetail(block.input) });
    }
    // thinking, tool_result, images: not shown
  });
  return out;
}

/** Size and mtime of a transcript, as an HTTP entity tag. */
export function transcriptEtag(file: string, st: fs.Stats): string {
  return `"${path.basename(file, '.jsonl')}-${st.size}-${Math.floor(st.mtimeMs)}"`;
}

/**
 * Reads the page of `file` that ends at byte `before` (the end of the file when absent),
 * walking backwards so that a long transcript is never read whole.
 */
export function readTranscriptPage(file: string, before?: number, limit = PAGE_ENTRIES): TranscriptPage {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const end = before === undefined ? size : Math.max(0, Math.min(before, size));
    // Pages of lines, newest first; each line's entries stay in order.
    const lines: DialogueEntry[][] = [];
    let count = 0;
    let pos = end;
    /** Start of the oldest line handled: the next page ends there. */
    let oldest = end;
    /** Bytes of the current (incomplete) line, newest piece first; null once it overflowed. */
    let carry: Buffer[] | null = [];
    let carryLen = 0;
    let read = 0;

    const handle = (lineStart: number) => {
      if (carry && carryLen > 0) {
        const entries = entriesOfLine(Buffer.concat(carry.slice().reverse()).toString('utf8'), lineStart);
        if (entries.length > 0) {
          lines.push(entries);
          count += entries.length;
        }
      }
      carry = [];
      carryLen = 0;
      oldest = lineStart;
    };
    const keep = (piece: Buffer) => {
      if (piece.length === 0) return;
      if (carry && carryLen + piece.length <= LINE_MAX) {
        carry.push(Buffer.from(piece));
        carryLen += piece.length;
      } else {
        carry = null; // oversized: skipped, but its start is still searched for
      }
    };

    // A partial last line (no trailing newline yet) is still being written: it is read anyway
    // and simply dropped by JSON.parse if incomplete.
    outer: while (pos > 0 && count < limit) {
      // The budget only stops the walk once a line was handled, so a page always progresses.
      if (read >= READ_BUDGET && oldest < end) break;
      if (read >= READ_HARD_CAP) {
        // Inside a line longer than the cap: skip it from here, the next page goes on before.
        if (oldest === end) oldest = pos;
        break;
      }
      const len = Math.min(CHUNK, pos);
      pos -= len;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, pos);
      read += len;
      let lineEnd = len;
      for (let i = len - 1; i >= 0; i--) {
        if (buf[i] !== 0x0a) continue;
        keep(buf.subarray(i + 1, lineEnd));
        handle(pos + i + 1);
        lineEnd = i;
        if (count >= limit) break outer;
      }
      keep(buf.subarray(0, lineEnd));
    }
    if (pos === 0 && count < limit && oldest > 0) handle(0);

    const entries = lines.reverse().flat();
    return { file: path.basename(file, '.jsonl'), entries, before: oldest > 0 ? oldest : null };
  } finally {
    fs.closeSync(fd);
  }
}
