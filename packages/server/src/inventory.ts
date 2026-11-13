import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
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
  title: string;
  /** Folders used to match an environment when `envId` is missing (worktree-aware). */
  matchFolders: string[];
  cwd: string;
  archived: boolean;
  createdAt: number;
  lastActivityAt: number;
  parent?: { sessionId: string; title?: string };
}

export interface LiveProcess {
  pid: number;
  cliSessionId: string;
  hostSessionId?: string;
  cwd: string;
  status: 'busy' | 'idle' | 'unknown';
  updatedAt: number;
  name?: string;
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
  })
  .passthrough();

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
    title: s.title ?? 'Session sans titre',
    matchFolders,
    cwd: s.cwd ?? s.originCwd ?? '',
    archived: s.isArchived ?? false,
    createdAt: s.createdAt ?? 0,
    lastActivityAt: s.lastActivityAt ?? s.createdAt ?? 0,
    parent,
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

function readArchivedIndex(dir: string): Set<string> {
  const raw = readJson(path.join(dir, 'archived-sessions.idx')) as { archived?: unknown } | undefined;
  return new Set(Array.isArray(raw?.archived) ? raw.archived.filter((x): x is string => typeof x === 'string') : []);
}

/**
 * Reads the whole local inventory. Only these files are ever opened: the presets file,
 * `local_*.json`, `archived-sessions.idx` and `~/.claude/sessions/<pid>.json`. Never
 * `config.json` (OAuth caches) nor the `*.key` peer tokens.
 */
export function readInventory(paths: ClaudePaths, isAlive: (pid: number) => boolean = pidAlive): Inventory {
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
      if (p && isAlive(p.pid)) live.push(p);
    }
  } catch {
    /* no live folder yet */
  }

  return { environments, desktopSessions, live, presentIds, complete, presetsOk: presetsRaw !== undefined };
}
