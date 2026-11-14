import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ListeningServer } from '@agent-office/shared';
import { z } from 'zod';
import { isRemotePath, linkedBelow, normPath } from './inventory.ts';

// Finds the web servers a session started: TCP ports listening on this machine, attributed
// to a session either because the listening process descends from the session's Claude Code
// process, or because the port is declared in the session folder's `.claude/launch.json`
// (servers started by the desktop app's preview are children of the app, not of the CLI).
//
// Command lines stay in this module: only port numbers and executable names leave it.

export interface Listener {
  pid: number;
  port: number;
  address: string;
}

export interface Proc {
  pid: number;
  ppid: number;
  name: string;
  /** Command line, empty when unknown. Never sent to a client. */
  cmd: string;
  /**
   * Creation time (any monotonic unit), when known. Windows keeps the pid of a parent that
   * exited and reuses pids, so a parent created after its child is not its real parent.
   */
  start?: number;
}

export interface Scan {
  listeners: Listener[];
  procs: Proc[];
}

export interface PortTarget {
  sessionId: string;
  cwd: string;
  /** Pid of the session's Claude Code process, when known. */
  pid?: number;
  /** Ports declared in `<cwd>/.claude/launch.json`. */
  launchPorts: number[];
}

/** At most this many servers per session. */
export const MAX_SERVERS = 8;
const MAX_DEPTH = 32;
const SCAN_TIMEOUT_MS = 8_000;
const SCAN_MAX_BUFFER = 16 * 1024 * 1024;
const LAUNCH_MAX_BYTES = 64 * 1024;
const PROCESS_NAME = /^[\w.+-]{1,32}$/;

const LOCAL_ADDRESSES = new Set(['127.0.0.1', '0.0.0.0', '::', '::1', '*', 'localhost']);

function isLocalAddress(address: string): boolean {
  return LOCAL_ADDRESSES.has(address.toLowerCase());
}

function validPort(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 65535;
}

function validPid(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}

/** Executable name without folder nor `.exe`, or undefined when it does not look like one. */
export function processName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const base = raw.split(/[\\/]/).pop()!.replace(/\.exe$/i, '');
  return PROCESS_NAME.test(base) ? base : undefined;
}

// ---------------------------------------------------------------------------------------
// Parsing (pure)

/** `host:port` or `[v6]:port` → its parts, or null. */
function splitEndpoint(endpoint: string): { address: string; port: number } | null {
  const i = endpoint.lastIndexOf(':');
  if (i < 0) return null;
  const port = Number(endpoint.slice(i + 1));
  const address = endpoint.slice(0, i).replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  return validPort(port) ? { address, port } : null;
}

/**
 * Parses Windows `netstat -ano` output. The state column is translated by Windows, so a
 * listening TCP socket is recognised by its foreign address ending in `:0` instead, and the
 * pid is read from the end of the line (a translated state may hold several words).
 */
export function parseNetstat(stdout: string): Listener[] {
  const out: Listener[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || cols[0].toUpperCase() !== 'TCP' || !/:0$/.test(cols[2])) continue;
    const local = splitEndpoint(cols[1]);
    const pid = Number(cols[cols.length - 1]);
    if (local && validPid(pid)) out.push({ pid, port: local.port, address: local.address });
  }
  return out;
}

/**
 * Parses the tab-separated `pid ppid start name commandline` lines printed by
 * `WINDOWS_PROCS` (`start`: creation time as a FILETIME, empty when unknown).
 */
export function parseWindowsProcs(stdout: string): Proc[] {
  const out: Proc[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const [pid, ppid, start, name, ...cmd] = line.split('\t');
    const p = Number(pid);
    if (!validPid(p)) continue;
    const pp = Number(ppid);
    const st = start ? Number(start) : NaN;
    out.push({
      pid: p,
      ppid: validPid(pp) ? pp : 0,
      name: name ?? '',
      cmd: cmd.join(' ').trim(),
      ...(Number.isFinite(st) && st > 0 ? { start: st } : {}),
    });
  }
  return out;
}

/** Parses `lsof -nP -iTCP -sTCP:LISTEN -F pn` output (`p<pid>` then `n<addr>:<port>` lines). */
export function parseLsof(stdout: string): Listener[] {
  const out: Listener[] = [];
  let pid = 0;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && validPid(pid)) {
      const local = splitEndpoint(line.slice(1));
      if (local) out.push({ pid, port: local.port, address: local.address });
    }
  }
  return out;
}

/** Parses `ps -A -o pid=,ppid=,args=` output. */
export function parsePs(stdout: string): Proc[] {
  const out: Proc[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const cmd = m[3].trim();
    out.push({ pid: Number(m[1]), ppid: Number(m[2]), name: cmd.split(/\s+/)[0] ?? '', cmd });
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Attribution (pure)

/**
 * Pids from `pid` up to the root, `pid` included, bounded and cycle-safe. Stops at a parent
 * created after its child: the real parent exited and its pid was reused (Windows).
 */
function ancestry(pid: number, byPid: Map<number, Proc>): number[] {
  const chain: number[] = [];
  const seen = new Set<number>();
  let current: number | undefined = pid;
  while (current !== undefined && validPid(current) && !seen.has(current) && chain.length < MAX_DEPTH) {
    seen.add(current);
    chain.push(current);
    const child = byPid.get(current);
    const parentPid = child?.ppid;
    const parent = parentPid !== undefined ? byPid.get(parentPid) : undefined;
    if (child?.start !== undefined && parent?.start !== undefined && parent.start > child.start) break;
    current = parentPid;
  }
  return chain;
}

/**
 * True when a command line mentions `cwd` as a path of its own: followed by a separator, a
 * quote, a space or the end, and not by `\.claude\worktrees\` (a worktree nested in that
 * folder is another session's).
 */
export function mentionsFolder(cmd: string, cwd: string): boolean {
  const c = normPath(cmd);
  const folder = normPath(cwd);
  if (!folder) return false;
  let from = 0;
  for (;;) {
    const i = c.indexOf(folder, from);
    if (i < 0) return false;
    const rest = c.slice(i + folder.length);
    if ((rest === '' || /^[\\"' ]/.test(rest)) && !rest.startsWith('\\.claude\\worktrees\\')) return true;
    from = i + 1;
  }
}

/**
 * Attributes the listening ports of `scan` to the targets. A port whose process descends
 * from a target's Claude Code process goes to that target first; otherwise a port declared
 * in a target's `launch.json` goes to the target whose folder appears in the command line
 * of the listening process or one of its ancestors, the longest folder winning.
 */
export function attributeServers(scan: Scan, targets: PortTarget[], ownPort?: number): Map<string, ListeningServer[]> {
  const byPid = new Map(scan.procs.map((p) => [p.pid, p]));
  const pidOwner = new Map<number, string>();
  for (const t of targets) if (t.pid !== undefined) pidOwner.set(t.pid, t.sessionId);
  const byLongestCwd = [...targets].filter((t) => t.cwd).sort((a, b) => normPath(b.cwd).length - normPath(a.cwd).length);

  const result = new Map<string, Map<number, ListeningServer>>();
  const add = (sessionId: string, l: Listener) => {
    let ports = result.get(sessionId);
    if (!ports) result.set(sessionId, (ports = new Map()));
    if (!ports.has(l.port)) ports.set(l.port, { port: l.port, ...compactName(byPid.get(l.pid)?.name) });
  };

  for (const l of scan.listeners) {
    if (l.port === ownPort || !isLocalAddress(l.address)) continue;
    const chain = ancestry(l.pid, byPid);
    // The listener itself is never a Claude process: start the descent check at its parent.
    const owner = chain.slice(1).map((pid) => pidOwner.get(pid)).find(Boolean);
    if (owner) {
      add(owner, l);
      continue;
    }
    const cmds = chain.map((pid) => byPid.get(pid)?.cmd ?? '').filter(Boolean);
    const target = byLongestCwd.find((t) => t.launchPorts.includes(l.port) && cmds.some((c) => mentionsFolder(c, t.cwd)));
    if (target) add(target.sessionId, l);
  }

  const out = new Map<string, ListeningServer[]>();
  for (const [id, ports] of result) {
    out.set(id, [...ports.values()].sort((a, b) => a.port - b.port).slice(0, MAX_SERVERS));
  }
  return out;
}

function compactName(raw: string | undefined): { process?: string } {
  const name = processName(raw);
  return name ? { process: name } : {};
}

// ---------------------------------------------------------------------------------------
// launch.json

const launchSchema = z.object({ configurations: z.array(z.unknown()).optional() }).passthrough();
const launchConfig = z.object({ port: z.unknown().optional() }).passthrough();

/** Ports of a `launch.json` text; anything invalid is ignored. */
export function parseLaunchPorts(text: string): number[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const p = launchSchema.safeParse(raw);
  if (!p.success) return [];
  const ports = new Set<number>();
  for (const item of p.data.configurations ?? []) {
    const c = launchConfig.safeParse(item);
    if (c.success && validPort(c.data.port)) ports.add(c.data.port);
    if (ports.size >= MAX_SERVERS) break;
  }
  return [...ports].sort((a, b) => a - b);
}

/**
 * Ports declared in `<cwd>/.claude/launch.json`. Same guards as the agent definitions: no
 * remote path, no link below `cwd`, `O_NOFOLLOW`, regular file only, bounded read.
 */
export function readLaunchPorts(cwd: string): number[] {
  if (!cwd || !path.isAbsolute(cwd) || isRemotePath(cwd)) return [];
  const file = path.join(cwd, '.claude', 'launch.json');
  if (linkedBelow(cwd, file)) return [];
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > LAUNCH_MAX_BYTES) return [];
    const buf = Buffer.alloc(st.size);
    const n = fs.readSync(fd, buf, 0, st.size, 0);
    return parseLaunchPorts(buf.subarray(0, n).toString('utf8'));
  } catch {
    return [];
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}

const LAUNCH_TTL_MS = 60_000;

/** `launch.json` ports cached per folder, read at most once a minute. */
export class LaunchPortsCache {
  private readonly entries = new Map<string, { at: number; ports: number[] }>();

  constructor(private readonly read: (cwd: string) => number[] = readLaunchPorts) {}

  get(cwd: string, now = Date.now()): number[] {
    const key = normPath(cwd);
    const hit = this.entries.get(key);
    if (hit && now - hit.at < LAUNCH_TTL_MS) return hit.ports;
    const ports = this.read(cwd);
    this.entries.set(key, { at: now, ports });
    return ports;
  }

  /** Drops the folders no longer asked for. */
  keepOnly(cwds: string[]): void {
    const keep = new Set(cwds.map(normPath));
    for (const k of this.entries.keys()) if (!keep.has(k)) this.entries.delete(k);
  }
}

// ---------------------------------------------------------------------------------------
// System scan (I/O)

/**
 * Fixed script, no argument is ever interpolated into it: one tab-separated line per
 * process (pid, parent pid, creation FILETIME, name, command line), tabs and line breaks of the command line replaced by spaces. (`ConvertTo-Json`
 * took about 4 s on 500 processes; this takes about 1 s.)
 */
const WINDOWS_PROCS = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,Name,CommandLine | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() })`t$($_.Name)`t$($_.CommandLine -replace "[\\t\\r\\n]", " ")" }',
].join('; ');

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: SCAN_TIMEOUT_MS, maxBuffer: SCAN_MAX_BUFFER, windowsHide: true, encoding: 'utf8' },
      (err, stdout) => {
        // lsof exits with 1 when nothing listens, or after a partial error (a process it could
        // not inspect): what it printed is still the answer. Spawn errors and timeouts reject.
        const lsofAnswer = path.basename(file) === 'lsof' && typeof (err as { code?: unknown } | null)?.code === 'number' && !err?.killed;
        if (err && !lsofAnswer) reject(err);
        else resolve(stdout);
      },
    );
  });
}

/**
 * Absolute path of a system tool. A bare name would be looked up in the server's own
 * folder (Windows) or in `node_modules/.bin` (npm puts it first in PATH): a dependency or a
 * repo file could then run every 10 s.
 */
function systemTool(platform: NodeJS.Platform, name: 'netstat' | 'powershell' | 'lsof' | 'ps'): string {
  if (platform === 'win32') {
    const system32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
    return name === 'powershell' ? path.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe') : path.join(system32, `${name}.exe`);
  }
  const candidates = ['/usr/sbin', '/usr/bin', '/bin', '/sbin'].map((dir) => path.posix.join(dir, name));
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0];
}

/** Listening TCP sockets (fast: about 0.1 s). Rejects when the system command fails. */
export async function listListeners(platform: NodeJS.Platform = process.platform): Promise<Listener[]> {
  if (platform === 'win32') return parseNetstat(await run(systemTool(platform, 'netstat'), ['-ano']));
  return parseLsof(await run(systemTool(platform, 'lsof'), ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn']));
}

/** The process tree with command lines (slower: about 1 s on Windows). */
export async function listProcesses(platform: NodeJS.Platform = process.platform): Promise<Proc[]> {
  if (platform === 'win32') {
    return parseWindowsProcs(
      await run(systemTool(platform, 'powershell'), ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_PROCS]),
    );
  }
  return parsePs(await run(systemTool(platform, 'ps'), ['-A', '-o', 'pid=,ppid=,args=']));
}

/**
 * Scans the system for the targets, reusing the previous result while neither the
 * attributable listening sockets (local, not ours) nor the targets changed: most rounds
 * then cost a single `netstat`, and unrelated LAN or ephemeral sockets never trigger the
 * slower process listing.
 */
export class PortScanner {
  private lastKey = '';
  private lastResult = new Map<string, ListeningServer[]>();

  constructor(
    private readonly ownPort: number | undefined,
    private readonly sys: { listeners: () => Promise<Listener[]>; processes: () => Promise<Proc[]> } = {
      listeners: () => listListeners(),
      processes: () => listProcesses(),
    },
  ) {}

  async scan(targets: PortTarget[]): Promise<Map<string, ListeningServer[]>> {
    if (targets.length === 0) {
      this.lastKey = '';
      return (this.lastResult = new Map());
    }
    const listeners = await this.sys.listeners();
    const relevant = listeners.filter((l) => l.port !== this.ownPort && isLocalAddress(l.address));
    const key = JSON.stringify([relevant.map((l) => [l.pid, l.port]), targets]);
    if (key === this.lastKey) return this.lastResult;
    const procs = await this.sys.processes();
    this.lastResult = attributeServers({ listeners: relevant, procs }, targets, this.ownPort);
    this.lastKey = key;
    return this.lastResult;
  }
}
