import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { SessionInfo } from '@agent-office/shared';
import type { ClaudePaths } from './paths.ts';

// The desktop app's files are internal and undocumented: every schema below is lenient,
// keeps only the fields we use, and a file that does not parse is skipped, never fatal.

export interface Environment {
  id: string;
  name: string;
  /** Main folder first, then the additional ones. */
  folders: string[];
}

export interface DesktopSession {
  localId: string;
  cliSessionIds: string[];
  envId: string | null;
  /** Null when the app has not titled the session yet: the client shows a translated placeholder. */
  title: string | null;
  /** Folders used to match an environment when `envId` is missing (worktree-aware). */
  matchFolders: string[];
  cwd: string;
  archived: boolean;
  createdAt: number;
  lastActivityAt: number;
  parent?: { sessionId: string; title?: string };
  /** Working context read from the session file (worktree, branch, model…). */
  info: SessionInfo;
}

export interface LiveProcess {
  pid: number;
  cliSessionId: string;
  hostSessionId?: string;
  cwd: string;
  status: 'busy' | 'idle' | 'unknown';
  updatedAt: number;
  name?: string;
  /** Claude Code version. */
  version?: string;
  /** True when `cwd` holds a `.git` file, i.e. a git worktree (terminal sessions only use it). */
  worktree?: boolean;
}

export interface Inventory {
  environments: Environment[];
  desktopSessions: DesktopSession[];
  live: LiveProcess[];
  /** Ids of every `local_*.json` listed, parsed or not. Defaults to the parsed sessions. */
  presentIds?: Set<string>;
  /** False when a sessions folder could not be listed: absences then prove nothing. Defaults to true. */
  complete?: boolean;
  /** False when the presets file could not be read: the previous environments are kept. Defaults to true. */
  presetsOk?: boolean;
  /** Agent types defined in `agents` folders. Absent: the previous ones are kept. */
  definedAgents?: DefinedAgents;
}

export interface DefinedAgents {
  /** From `~/.claude/agents/`. */
  global: string[];
  /** From `<folder>/.claude/agents/` of each environment's folders, by environment id. */
  byEnv: Map<string, string[]>;
}

const presetSchema = z.object({
  id: z.string(),
  name: z.string(),
  target: z
    .object({
      cwd: z.string().optional(),
      additionalFolders: z.array(z.string()).optional(),
    })
    .passthrough()
    .optional(),
});

const presetsFileSchema = z.object({
  byAccount: z.record(z.string(), z.object({ presets: z.array(z.unknown()).optional() }).passthrough()),
});

export function parsePresets(raw: unknown): Environment[] {
  const parsed = presetsFileSchema.safeParse(raw);
  if (!parsed.success) return [];
  const out: Environment[] = [];
  for (const account of Object.values(parsed.data.byAccount)) {
    for (const item of account.presets ?? []) {
      const p = presetSchema.safeParse(item);
      if (!p.success) continue;
      const folders = [p.data.target?.cwd, ...(p.data.target?.additionalFolders ?? [])].filter(
        (f): f is string => typeof f === 'string' && f.length > 0,
      );
      out.push({ id: p.data.id, name: p.data.name, folders });
    }
  }
  return out;
}

const sessionSchema = z
  .object({
    sessionId: z.string(),
    cliSessionId: z.string().optional(),
    priorCliSessionIds: z.array(z.string()).optional(),
    startedFromEnvironmentId: z.string().nullable().optional(),
    envScopeId: z.string().nullable().optional(),
    title: z.string().optional(),
    cwd: z.string().optional(),
    originCwd: z.string().optional(),
    folderPlace: z.object({ cwd: z.string().optional(), realPath: z.string().optional() }).passthrough().nullable().optional(),
    isArchived: z.boolean().optional(),
    createdAt: z.number().optional(),
    lastActivityAt: z.number().optional(),
    spawnedFrom: z.object({ sessionId: z.string(), title: z.string().optional() }).passthrough().nullable().optional(),
    forkedFromSessionId: z.string().nullable().optional(),
    // Working context: any value of the wrong type is dropped, never fatal.
    worktreeName: z.unknown().optional(),
    branch: z.unknown().optional(),
    sourceBranch: z.unknown().optional(),
    model: z.unknown().optional(),
    effort: z.unknown().optional(),
    permissionMode: z.unknown().optional(),
    completedTurns: z.unknown().optional(),
  })
  .passthrough();

/** Model ids such as `claude-opus-5-5` or `claude-sonnet-5-5[1m]`. */
const MODEL_ID = /^[\w.:@\[\]-]{1,64}$/;
/** Raw enum-like values (effort, permission mode). */
const RAW_WORD = /^[A-Za-z][\w-]{0,31}$/;
/** Version strings such as `2.3.1` or `2.3.1-beta.2`. */
const VERSION = /^[\w.+-]{1,32}$/;
/**
 * Branch and worktree names: anything printable, bounded (React escapes it). Bidi controls
 * and zero-width characters are refused too: they could make a name read as another.
 */
const LABEL = /^[^\x00-\x1f\x7f​-‏‪-‮⁦-⁩]{1,128}$/;

function matching(v: unknown, pattern: RegExp): string | undefined {
  return typeof v === 'string' && pattern.test(v) ? v : undefined;
}

/** Strips undefined fields so an empty context is `{}` and snapshots stay small. */
function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export function sessionInfo(s: z.infer<typeof sessionSchema>): SessionInfo {
  const worktreeName = matching(s.worktreeName, LABEL);
  const turns = s.completedTurns;
  return compact({
    worktree: worktreeName ? { name: worktreeName } : undefined,
    branch: matching(s.branch, LABEL),
    sourceBranch: matching(s.sourceBranch, LABEL),
    model: matching(s.model, MODEL_ID),
    effort: matching(s.effort, RAW_WORD),
    permissionMode: matching(s.permissionMode, RAW_WORD),
    completedTurns: typeof turns === 'number' && Number.isSafeInteger(turns) && turns >= 0 ? turns : undefined,
  });
}

export function cliVersion(v: unknown): string | undefined {
  return matching(v, VERSION);
}

/** A worktree or branch name, or undefined when it fails `LABEL`. */
export function label(v: unknown): string | undefined {
  return matching(v, LABEL);
}

export function parseDesktopSession(raw: unknown): DesktopSession | null {
  const p = sessionSchema.safeParse(raw);
  if (!p.success || !p.data.sessionId.startsWith('local_')) return null;
  const s = p.data;
  const cliSessionIds = [s.cliSessionId, ...(s.priorCliSessionIds ?? [])].filter(
    (x): x is string => typeof x === 'string' && x.length > 0,
  );
  const matchFolders = [s.originCwd, s.folderPlace?.cwd, s.folderPlace?.realPath, s.cwd].filter(
    (x): x is string => typeof x === 'string' && x.length > 0,
  );
  const parent = s.spawnedFrom
    ? { sessionId: s.spawnedFrom.sessionId, title: s.spawnedFrom.title }
    : s.forkedFromSessionId
      ? { sessionId: s.forkedFromSessionId }
      : undefined;
  return {
    localId: s.sessionId,
    cliSessionIds,
    envId: s.startedFromEnvironmentId ?? s.envScopeId ?? null,
    title: s.title || null,
    matchFolders,
    cwd: s.cwd ?? s.originCwd ?? '',
    archived: s.isArchived ?? false,
    createdAt: s.createdAt ?? 0,
    lastActivityAt: s.lastActivityAt ?? s.createdAt ?? 0,
    parent,
    info: sessionInfo(s),
  };
}

const liveSchema = z
  .object({
    pid: z.number(),
    sessionId: z.string(),
    hostSessionId: z.string().optional(),
    cwd: z.string().optional(),
    status: z.string().optional(),
    updatedAt: z.number().optional(),
    statusUpdatedAt: z.number().optional(),
    name: z.string().optional(),
    // Any type: a wrong one drops the version, never the whole process.
    version: z.unknown().optional(),
  })
  .passthrough();

export function parseLiveProcess(raw: unknown): LiveProcess | null {
  const p = liveSchema.safeParse(raw);
  if (!p.success) return null;
  const s = p.data;
  return {
    pid: s.pid,
    cliSessionId: s.sessionId,
    hostSessionId: s.hostSessionId,
    cwd: s.cwd ?? '',
    status: s.status === 'busy' || s.status === 'idle' ? s.status : 'unknown',
    updatedAt: s.statusUpdatedAt ?? s.updatedAt ?? 0,
    name: s.name,
    version: cliVersion(s.version),
  };
}

/** Normalises a Windows or POSIX path for prefix comparison. */
export function normPath(p: string): string {
  return p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/** True if `child` is `parent` or inside it. */
export function isWithin(child: string, parent: string): boolean {
  const c = normPath(child);
  const p = normPath(parent);
  return c === p || c.startsWith(p + '\\');
}

/** Finds the environment whose folders contain one of `folders`; the longest match wins. */
export function matchEnvironment(folders: string[], environments: Environment[]): string | null {
  let best: { id: string; len: number } | null = null;
  for (const env of environments) {
    for (const ef of env.folders) {
      if (folders.some((f) => isWithin(f, ef)) && (!best || ef.length > best.len)) {
        best = { id: env.id, len: ef.length };
      }
    }
  }
  return best?.id ?? null;
}

/** Agent type names we accept from a definition: what Claude Code itself accepts, short. */
export const AGENT_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
/**
 * Agent types we accept from a hook: a definition name, optionally namespaced by its plugin
 * (`plugin:agent`). One colon at most, no backtracking: each part is a bounded single class.
 */
export const HOOK_AGENT_TYPE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}(?::[A-Za-z0-9][A-Za-z0-9_.-]{0,63})?$/;
/**
 * Subagent ids we accept from a hook. No `:` nor `#`, so an id can never take the place of a
 * client resting figure (`rest:<type>`) or of a main agent (`<session>#main`).
 */
export const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
/** Definitions read per folder, and bytes read per file: only the frontmatter matters. */
const MAX_AGENT_FILES = 64;
const AGENT_HEAD_BYTES = 4096;
/** Folder entries looked at, `.md` or not: a huge folder must not stall the event loop. */
const MAX_AGENT_DIR_ENTRIES = 1024;

/** A frontmatter closed by `---`, and one that may run to the end of a truncated head. */
const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---/;
const FRONTMATTER_OPEN = /^﻿?---\r?\n([\s\S]*?)(?:\r?\n---|$(?![\s\S]))/;

/**
 * The `name:` of a definition's frontmatter, or undefined. `truncated` says that only the
 * head of a longer definition was read: the closing `---` may then be missing, and the
 * frontmatter runs to the end of the text. A complete text needs its closing `---`.
 */
export function agentNameFromDefinition(text: string, truncated = false): string | undefined {
  // The cut may fall inside a line (`name: herm|ione`): a truncated head ends at its last line break.
  if (truncated) text = text.slice(0, text.lastIndexOf('\n') + 1);
  const fm = (truncated ? FRONTMATTER_OPEN : FRONTMATTER).exec(text);
  if (!fm) return undefined;
  // Plain string handling, no regex over the value: a file from a cloned repo must not be
  // able to make the matcher backtrack for seconds on the event loop.
  const line = fm[1].split(/\r?\n/).find((l) => l.startsWith('name:'));
  if (line === undefined) return undefined;
  let value = line.slice('name:'.length).trim();
  const q = value[0];
  if ((q === '"' || q === "'") && value.length >= 2 && value.endsWith(q)) value = value.slice(1, -1).trim();
  return AGENT_NAME.test(value) ? value : undefined;
}

/** Never follow a symlink, never block on a FIFO. POSIX only: both flags are absent (0) on Windows. */
const OPEN_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);

/**
 * The head of a definition and whether the file is longer than that head, or undefined when
 * the path is no longer a regular file (swapped for a link, a FIFO or a device since listing).
 */
function readHead(file: string): { text: string; truncated: boolean } | undefined {
  const fd = fs.openSync(file, OPEN_FLAGS);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return undefined;
    const buf = Buffer.alloc(AGENT_HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, AGENT_HEAD_BYTES, 0);
    return { text: buf.subarray(0, n).toString('utf8'), truncated: st.size > n };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * True for a network (UNC) or device path: `\\server\share`, `//server/share`,
 * `\\?\UNC\…`, `\\.\…`. Their synchronous reads may hang for seconds on an unreachable
 * host, so agent folders there are skipped. `\\?\C:\…` is a local drive and stays readable.
 */
export function isRemotePath(p: string): boolean {
  return /^[\\/]{2}/.test(p) && !/^[\\/]{2}\?[\\/][A-Za-z]:/.test(p);
}

/**
 * True when a path component between `root` (excluded) and `dir` (included) is a symlink or
 * a junction. Those components come from a cloned repository: a link could send the reads to
 * a network share (an SMB connection leaks NTLM credentials) or an automount, out of reach of
 * `isRemotePath`. Only `lstat` is used: resolving the target would already contact the host.
 */
export function linkedBelow(root: string, dir: string): boolean {
  const rel = path.relative(root, dir);
  let current = root;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let st: fs.Stats | undefined;
    try {
      st = fs.lstatSync(current, { throwIfNoEntry: false });
    } catch {
      return true;
    }
    if (!st) return false; // absent: opendir reports it as an empty folder
    if (st.isSymbolicLink()) return true;
  }
  return false;
}

/**
 * Agent types of an `agents` folder, or null when the folder exists but could not be
 * listed (busy or sleeping drive): absence then proves nothing. With `trustedRoot`, the
 * components below that root must not be links (see `linkedBelow`).
 */
function listAgentTypes(dir: string, trustedRoot?: string): string[] | null {
  if (isRemotePath(dir)) return [];
  if (trustedRoot !== undefined && linkedBelow(trustedRoot, dir)) return [];
  let handle: fs.Dir;
  try {
    handle = fs.opendirSync(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? [] : null;
  }
  const files: string[] = [];
  try {
    for (let seen = 0; seen < MAX_AGENT_DIR_ENTRIES && files.length < MAX_AGENT_FILES; seen++) {
      const e = handle.readSync();
      if (!e) break;
      if (e.isFile() && e.name.endsWith('.md')) files.push(e.name);
    }
  } catch {
    return null;
  } finally {
    try {
      handle.closeSync();
    } catch {
      /* a failed close must not override the result, nor escape the inventory read */
    }
  }
  const out: string[] = [];
  for (const f of files) {
    let name: string | undefined;
    try {
      const head = readHead(path.join(dir, f));
      name = head && agentNameFromDefinition(head.text, head.truncated);
    } catch {
      /* unreadable file: skipped */
    }
    if (name && !out.some((n) => n.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}

/**
 * Agent types defined in an `agents` folder: the frontmatter `name:` of each `*.md` file.
 * Like Claude Code, a file without a name in its frontmatter defines no agent. Only regular
 * files directly in the folder are read, and only their head.
 */
export function readAgentTypes(dir: string): string[] {
  return listAgentTypes(dir) ?? [];
}

/** How long a folder's agent list is reused before the folder is read again. */
export const AGENTS_CACHE_MS = 60_000;

/** Agent lists by folder, kept between inventory reads. */
export type AgentsCache = Map<string, { at: number; types: string[] }>;

/** Reads a folder's agents at most once per `AGENTS_CACHE_MS`; a failed read keeps the last list. */
function cachedAgentTypes(dir: string, cache: AgentsCache | undefined, now: number, trustedRoot?: string): string[] {
  const hit = cache?.get(dir);
  if (hit && now - hit.at < AGENTS_CACHE_MS) return hit.types;
  const types = listAgentTypes(dir, trustedRoot) ?? hit?.types ?? [];
  cache?.set(dir, { at: now, types });
  return types;
}

/** Agent types defined globally and in each environment's folders. */
function readDefinedAgents(
  claudeHome: string,
  environments: Environment[],
  cache: AgentsCache | undefined,
  now: number,
  environmentsKnown: boolean,
): DefinedAgents {
  const used = new Set<string>();
  const read = (dir: string, trustedRoot?: string) => {
    used.add(dir);
    return cachedAgentTypes(dir, cache, now, trustedRoot);
  };
  const byEnv = new Map<string, string[]>();
  // The environment folder comes from the user's presets; its `.claude/agents` from the repository.
  for (const env of environments) byEnv.set(env.id, env.folders.flatMap((f) => read(path.join(f, '.claude', 'agents'), f)));
  const global = read(path.join(claudeHome, 'agents'));
  // Folders of removed or edited environments: the cache must not grow for ever. Without the
  // presets the environments are unknown, not gone: their folders stay cached.
  if (cache && environmentsKnown) for (const dir of cache.keys()) if (!used.has(dir)) cache.delete(dir);
  return { global, byEnv };
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * True when `<cwd>/.git` is a regular file: git writes a `gitdir:` file instead of a folder
 * in a linked worktree. `lstat` only, never on a remote path (see `isRemotePath`).
 */
export function isWorktree(cwd: string): boolean {
  if (!cwd || !path.isAbsolute(cwd) || isRemotePath(cwd)) return false;
  try {
    return fs.lstatSync(path.join(cwd, '.git'), { throwIfNoEntry: false })?.isFile() ?? false;
  } catch {
    return false;
  }
}

function readArchivedIndex(dir: string): Set<string> {
  const raw = readJson(path.join(dir, 'archived-sessions.idx')) as { archived?: unknown } | undefined;
  return new Set(Array.isArray(raw?.archived) ? raw.archived.filter((x): x is string => typeof x === 'string') : []);
}

/**
 * Reads the whole local inventory. Only these files are ever opened: the presets file,
 * `local_*.json`, `archived-sessions.idx`, `~/.claude/sessions/<pid>.json`, and the first
 * 4 KB of the `*.md` agent definitions in `~/.claude/agents/` and `<env folder>/.claude/agents/`. Never
 * `config.json` (OAuth caches) nor the `*.key` peer tokens.
 */
export function readInventory(
  paths: ClaudePaths,
  isAlive: (pid: number) => boolean = pidAlive,
  agentsCache?: AgentsCache,
  now = Date.now(),
): Inventory {
  const presetsRaw = paths.presetsFile ? readJson(paths.presetsFile) : undefined;
  const environments = parsePresets(presetsRaw);

  const desktopSessions: DesktopSession[] = [];
  const presentIds = new Set<string>();
  // Deletions are only trusted when every sessions folder was listed.
  let complete = paths.sessionDirs.length > 0;
  for (const dir of paths.sessionDirs) {
    const archived = readArchivedIndex(dir);
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => /^local_[\w-]+\.json$/.test(f));
    } catch {
      complete = false;
      continue;
    }
    for (const f of files) {
      // Listed means present, even if the app is mid-write and the file does not parse yet.
      presentIds.add(f.slice(0, -'.json'.length));
      const s = parseDesktopSession(readJson(path.join(dir, f)));
      if (!s) continue;
      if (archived.has(s.localId)) s.archived = true;
      desktopSessions.push(s);
    }
  }

  const live: LiveProcess[] = [];
  try {
    for (const f of fs.readdirSync(paths.liveDir).filter((f) => /^\d+\.json$/.test(f))) {
      const p = parseLiveProcess(readJson(path.join(paths.liveDir, f)));
      if (p && isAlive(p.pid)) {
        p.worktree = isWorktree(p.cwd);
        live.push(p);
      }
    }
  } catch {
    /* no live folder yet */
  }

  return {
    environments,
    desktopSessions,
    live,
    presentIds,
    complete,
    presetsOk: presetsRaw !== undefined,
    definedAgents: readDefinedAgents(paths.claudeHome, environments, agentsCache, now, presetsRaw !== undefined),
  };
}
