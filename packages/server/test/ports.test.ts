import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  attributeServers,
  LaunchPortsCache,
  type Listener,
  MAX_SERVERS,
  mentionsFolder,
  parseLaunchPorts,
  parseLsof,
  parseNetstat,
  parsePs,
  parseWindowsProcs,
  PortScanner,
  type PortTarget,
  type Proc,
  processName,
  readLaunchPorts,
} from '../src/ports.ts';

// Anonymised data only: fake folders under C:\work, fake pids and ports.

const ALPHA = 'C:\\work\\alpha';
const ALPHA_WT = 'C:\\work\\alpha\\.claude\\worktrees\\wt-1';
const BETA = 'C:\\work\\beta';
const CLAUDE_PID = 4242;

function listener(pid: number, port: number, address = '127.0.0.1'): Listener {
  return { pid, port, address };
}

function p(pid: number, ppid: number, name = 'node.exe', cmd = ''): Proc {
  return { pid, ppid, name, cmd };
}

function target(overrides: Partial<PortTarget> = {}): PortTarget {
  return { sessionId: 's-alpha', cwd: ALPHA, launchPorts: [], ...overrides };
}

describe('processName', () => {
  /**
   * Verifies that a Windows or POSIX executable path is reduced to its bare name without .exe
   */
  it.each([
    ['C:\\Program Files\\nodejs\\node.exe', 'node'],
    ['/usr/local/bin/python3', 'python3'],
    ['NODE.EXE', 'NODE'],
    ['node', 'node'],
    ['deno', 'deno'],
    ['my-server_2.1+x', 'my-server_2.1+x'],
    ['a'.repeat(32), 'a'.repeat(32)],
  ])('maps %j to %j', (raw, expected) => {
    expect(processName(raw)).toBe(expected);
  });

  /**
   * Verifies that empty, folder-only, spaced, over-long or exotic names give undefined
   */
  it.each([[undefined], [''], ['C:\\tools\\'], ['my app.exe'], ['a'.repeat(33)], ['<script>'], ['nœud']])(
    'rejects %j',
    (raw) => {
      expect(processName(raw)).toBeUndefined();
    },
  );
});

describe('parseNetstat', () => {
  /**
   * Verifies that a state translated into several words still yields the pid from the end of the line
   */
  it('reads the pid from the end when the state has several words', () => {
    expect(parseNetstat('  TCP    127.0.0.1:5173         0.0.0.0:0              IN ASCOLTO      4321')).toEqual([
      { pid: 4321, port: 5173, address: '127.0.0.1' },
    ]);
  });

  const ENGLISH = [
    '',
    'Active Connections',
    '',
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1184',
    '  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       9001',
    '  TCP    127.0.0.1:52010        127.0.0.1:5173         ESTABLISHED     9002',
    '  TCP    127.0.0.1:5173         127.0.0.1:52010        ESTABLISHED     9001',
    '  TCP    [::]:3000              [::]:0                 LISTENING       9003',
    '  TCP    [::1]:8080             [::]:0                 LISTENING       9004',
    '  TCP    [fe80::1%12]:7000      [::]:0                 LISTENING       9005',
    '  UDP    0.0.0.0:5353           *:*                                    1300',
    '  UDP    [::]:5353              *:*                                    1300',
  ].join('\r\n');

  /**
   * Verifies that only listening TCP sockets are kept, with IPv6 brackets and zone stripped
   */
  it('parses English netstat -ano output', () => {
    expect(parseNetstat(ENGLISH)).toEqual([
      { pid: 1184, port: 135, address: '0.0.0.0' },
      { pid: 9001, port: 5173, address: '127.0.0.1' },
      { pid: 9003, port: 3000, address: '::' },
      { pid: 9004, port: 8080, address: '::1' },
      { pid: 9005, port: 7000, address: 'fe80::1' },
    ]);
  });

  /**
   * Verifies that a French localized state word does not prevent detection of listeners
   */
  it('parses French netstat output whatever the state word', () => {
    const fr = [
      'Connexions actives',
      '',
      '  Proto  Adresse locale         Adresse distante       État',
      '  TCP    127.0.0.1:5173         0.0.0.0:0              ÉCOUTE          9001',
      '  TCP    127.0.0.1:52010        127.0.0.1:5173         ÉTABLIE         9002',
      '  TCP    [::]:3000              [::]:0                 ÉCOUTE          9003',
    ].join('\r\n');
    expect(parseNetstat(fr)).toEqual([
      { pid: 9001, port: 5173, address: '127.0.0.1' },
      { pid: 9003, port: 3000, address: '::' },
    ]);
  });

  /**
   * Verifies that a German localized state word does not prevent detection of listeners
   */
  it('parses German netstat output whatever the state word', () => {
    const de = [
      'Aktive Verbindungen',
      '',
      '  Proto  Lokale Adresse         Remoteadresse          Status           PID',
      '  TCP    0.0.0.0:8000           0.0.0.0:0              ABHÖREN          7001',
      '  TCP    127.0.0.1:8000         127.0.0.1:60000        HERGESTELLT      7001',
      '  TCP    [::]:8000              [::]:0                 ABHÖREN          7001',
    ].join('\n');
    expect(parseNetstat(de)).toEqual([
      { pid: 7001, port: 8000, address: '0.0.0.0' },
      { pid: 7001, port: 8000, address: '::' },
    ]);
  });

  /**
   * Verifies that a lower-case protocol column is still recognised as TCP
   */
  it('accepts a lower-case tcp column', () => {
    expect(parseNetstat('  tcp    127.0.0.1:4000    0.0.0.0:0    LISTENING    55')).toEqual([
      { pid: 55, port: 4000, address: '127.0.0.1' },
    ]);
  });

  /**
   * Verifies that invalid ports, pid 0, non-numeric pids and short lines are skipped
   */
  it.each([
    ['  TCP    127.0.0.1:0          0.0.0.0:0    LISTENING    55'],
    ['  TCP    127.0.0.1:65536      0.0.0.0:0    LISTENING    55'],
    ['  TCP    127.0.0.1:abc        0.0.0.0:0    LISTENING    55'],
    ['  TCP    127.0.0.1            0.0.0.0:0    LISTENING    55'],
    ['  TCP    0.0.0.0:445          0.0.0.0:0    LISTENING    0'],
    ['  TCP    0.0.0.0:445          0.0.0.0:0    LISTENING    x'],
    ['  TCP    0.0.0.0:445          0.0.0.0:0    55'],
    ['  TCP    0.0.0.0:445          0.0.0.0:0    LISTENING    55   extra'],
    ['  TCP    0.0.0.0:445          10.0.0.1:50  ESTABLISHED  55'],
  ])('skips %j', (line) => {
    expect(parseNetstat(line)).toEqual([]);
  });

  /**
   * Verifies that empty output gives no listener
   */
  it('returns [] for empty output', () => {
    expect(parseNetstat('')).toEqual([]);
  });
});

describe('parseWindowsProcs', () => {
  /**
   * Verifies that tab-separated pid, ppid, creation time, name and command lines become processes
   */
  it('parses the PowerShell tab-separated lines', () => {
    const out = [
      `${CLAUDE_PID}\t1000\t133700000000000000\tclaude.exe\tC:\\tools\\claude.exe --resume`,
      `9001\t${CLAUDE_PID}\t133700000100000000\tnode.exe\tnode C:\\work\\alpha\\node_modules\\vite\\bin\\vite.js`,
      '',
    ].join('\r\n');
    expect(parseWindowsProcs(out)).toEqual([
      { pid: CLAUDE_PID, ppid: 1000, name: 'claude.exe', cmd: 'C:\\tools\\claude.exe --resume', start: 133700000000000000 },
      {
        pid: 9001,
        ppid: CLAUDE_PID,
        name: 'node.exe',
        cmd: 'node C:\\work\\alpha\\node_modules\\vite\\bin\\vite.js',
        start: 133700000100000000,
      },
    ]);
  });

  /**
   * Verifies that extra tabs inside a command line are joined back with spaces
   */
  it('joins the extra tab-separated parts of a command line', () => {
    expect(parseWindowsProcs('9001\t4242\t\tnode.exe\tnode\tvite\t--port 5173')[0].cmd).toBe('node vite --port 5173');
  });

  /**
   * Verifies that a process without command line nor creation time gets an empty command and no start
   */
  it('keeps a process with an empty command line', () => {
    expect(parseWindowsProcs('4\t0\t\tSystem\t')).toEqual([{ pid: 4, ppid: 0, name: 'System', cmd: '' }]);
    expect(parseWindowsProcs('500\t4\t\tsvchost.exe')).toEqual([{ pid: 500, ppid: 4, name: 'svchost.exe', cmd: '' }]);
  });

  /**
   * Verifies that an invalid parent pid becomes 0, an invalid creation time is dropped and a missing name becomes empty
   */
  it('defaults an invalid ppid to 0 and a missing name to empty', () => {
    expect(parseWindowsProcs('77\tabc\tbad\tx.exe\tx')).toEqual([{ pid: 77, ppid: 0, name: 'x.exe', cmd: 'x' }]);
    expect(parseWindowsProcs('78')).toEqual([{ pid: 78, ppid: 0, name: '', cmd: '' }]);
  });

  /**
   * Verifies that lines without a valid positive pid are skipped
   */
  it.each([['ProcessId\tParentProcessId\tName\tCommandLine'], ['0\t0\tIdle\t'], ['-5\t1\tx\t'], ['']])('skips %j', (line) => {
    expect(parseWindowsProcs(line)).toEqual([]);
  });
});

describe('parseLsof', () => {
  /**
   * Verifies that p and n field lines give one listener per address, fd lines ignored
   */
  it('parses lsof -F pn output', () => {
    const out = ['p1234', 'f21', 'n127.0.0.1:5173', 'f22', 'n[::1]:5173', 'p5678', 'f9', 'n*:8080', ''].join('\n');
    expect(parseLsof(out)).toEqual([
      { pid: 1234, port: 5173, address: '127.0.0.1' },
      { pid: 1234, port: 5173, address: '::1' },
      { pid: 5678, port: 8080, address: '*' },
    ]);
  });

  /**
   * Verifies that addresses before any pid line, or after an invalid pid, are ignored
   */
  it('ignores addresses without a valid preceding pid', () => {
    expect(parseLsof(['n127.0.0.1:3000', 'pabc', 'n127.0.0.1:3001', 'p0', 'n127.0.0.1:3002'].join('\n'))).toEqual([]);
  });

  /**
   * Verifies that an address with an invalid port is skipped
   */
  it('skips an address without a valid port', () => {
    expect(parseLsof(['p10', 'n127.0.0.1:*', 'n127.0.0.1:70000', 'nlocalhost:4000'].join('\n'))).toEqual([
      { pid: 10, port: 4000, address: 'localhost' },
    ]);
  });

  /**
   * Verifies that empty output (nothing listening) gives no listener
   */
  it('returns [] for empty output', () => {
    expect(parseLsof('')).toEqual([]);
  });
});

describe('parsePs', () => {
  /**
   * Verifies that ps lines give pid, ppid, the first word as name and the full command
   */
  it('parses ps -A -o pid=,ppid=,args= output', () => {
    const out = [
      '    1     0 /sbin/launchd',
      '  812     1 /usr/local/bin/node /home/dev/alpha/node_modules/.bin/vite --port 5173',
      'garbage line',
      '',
    ].join('\n');
    expect(parsePs(out)).toEqual([
      { pid: 1, ppid: 0, name: '/sbin/launchd', cmd: '/sbin/launchd' },
      {
        pid: 812,
        ppid: 1,
        name: '/usr/local/bin/node',
        cmd: '/usr/local/bin/node /home/dev/alpha/node_modules/.bin/vite --port 5173',
      },
    ]);
  });
});

describe('mentionsFolder', () => {
  /**
   * Verifies that the folder followed by a separator, quote, space or the end is a mention
   */
  it.each([
    ['node C:\\work\\alpha\\node_modules\\vite\\bin\\vite.js', ALPHA],
    ['cd C:\\work\\alpha', ALPHA],
    ['"C:\\work\\alpha" --dev', ALPHA],
    ["'C:\\work\\alpha' --dev", ALPHA],
    ['serve C:\\work\\alpha --port 3000', ALPHA],
    ['node /home/dev/alpha/server.js', '/home/dev/alpha'],
  ])('finds the folder in %j', (cmd, cwd) => {
    expect(mentionsFolder(cmd, cwd)).toBe(true);
  });

  /**
   * Verifies that case, slash style and a trailing separator of either side are ignored
   */
  it('is case and separator insensitive', () => {
    expect(mentionsFolder('node c:/WORK/Alpha/server.js', 'C:\\Work\\alpha\\')).toBe(true);
  });

  /**
   * Verifies that a sibling folder sharing the name prefix is not a mention
   */
  it('rejects a sibling folder with a common prefix', () => {
    expect(mentionsFolder('node C:\\work\\alphabet\\server.js', ALPHA)).toBe(false);
    expect(mentionsFolder('node C:\\work\\alpha-2\\server.js', ALPHA)).toBe(false);
  });

  /**
   * Verifies that a path into a worktree nested in the folder belongs to the worktree, not the folder
   */
  it.each([
    ['node C:\\work\\alpha\\.claude\\worktrees\\wt-1\\server.js'],
    ['node C:/work/alpha/.claude/worktrees/wt-1/server.js'],
  ])('rejects the main folder for a nested worktree path %j', (cmd) => {
    expect(mentionsFolder(cmd, ALPHA)).toBe(false);
    expect(mentionsFolder(cmd, ALPHA_WT)).toBe(true);
  });

  /**
   * Verifies that a later valid mention is found after a rejected earlier occurrence
   */
  it('keeps looking after a rejected occurrence', () => {
    expect(mentionsFolder('x C:\\work\\alphabet C:\\work\\alpha\\src\\main.ts', ALPHA)).toBe(true);
    expect(mentionsFolder('x C:\\work\\alpha\\.claude\\worktrees\\wt-1\\a C:\\work\\alpha\\b', ALPHA)).toBe(true);
  });

  /**
   * Verifies that an empty folder (or one reduced to empty) never matches
   */
  it.each([[''], ['\\'], ['/']])('never matches the empty folder %j', (cwd) => {
    expect(mentionsFolder('node C:\\work\\alpha\\server.js', cwd)).toBe(false);
  });

  /**
   * Verifies that a command line not containing the folder is no mention
   */
  it('returns false when the folder is absent', () => {
    expect(mentionsFolder('node server.js', ALPHA)).toBe(false);
    expect(mentionsFolder('', ALPHA)).toBe(false);
  });
});

describe('attributeServers', () => {
  /** Claude (4242) → shell (5000) → node (9001) listening on 5173. */
  const descendantScan = {
    listeners: [listener(9001, 5173)],
    procs: [
      p(CLAUDE_PID, 1000, 'claude.exe', 'C:\\tools\\claude.exe'),
      p(5000, CLAUDE_PID, 'cmd.exe', 'cmd.exe /c npm run dev'),
      p(9001, 5000, 'node.exe', 'node vite.js'),
    ],
  };

  /**
   * Verifies that a port opened by a descendant of a session's Claude process goes to that session
   */
  it('attributes a listener descending from the target pid (rule a)', () => {
    const out = attributeServers(descendantScan, [target({ pid: CLAUDE_PID })]);
    expect(out).toEqual(new Map([['s-alpha', [{ port: 5173, process: 'node' }]]]));
  });

  /**
   * Verifies that a parent created after its child (a reused pid on Windows) breaks the descent
   */
  it('ignores a parent pid reused by a Claude process started after the listener', () => {
    const scan = {
      listeners: [listener(9001, 5173)],
      procs: [
        { ...p(CLAUDE_PID, 1000, 'claude.exe', 'C:\\tools\\claude.exe'), start: 200 },
        { ...p(9001, CLAUDE_PID, 'node.exe', 'node app.js'), start: 100 },
      ],
    };
    expect(attributeServers(scan, [target({ pid: CLAUDE_PID })]).size).toBe(0);
    scan.procs[0].start = 50;
    expect(attributeServers(scan, [target({ pid: CLAUDE_PID })]).get('s-alpha')).toEqual([{ port: 5173, process: 'node' }]);
  });

  /**
   * Verifies that a port opened by the Claude process itself is not attributed by descent
   */
  it('never attributes a port the Claude process itself listens on', () => {
    const scan = { listeners: [listener(CLAUDE_PID, 40000)], procs: [p(CLAUDE_PID, 1000, 'claude.exe', 'claude')] };
    expect(attributeServers(scan, [target({ pid: CLAUDE_PID })]).size).toBe(0);
  });

  /**
   * Verifies that descent (rule a) wins over a launch.json match of another session (rule b)
   */
  it('prefers the descent owner over a launch.json match', () => {
    const scan = {
      listeners: [listener(9001, 5173)],
      procs: [p(CLAUDE_PID, 1000, 'claude.exe'), p(9001, CLAUDE_PID, 'node.exe', 'node C:\\work\\beta\\server.js')],
    };
    const out = attributeServers(scan, [
      target({ sessionId: 's-alpha', pid: CLAUDE_PID }),
      target({ sessionId: 's-beta', cwd: BETA, launchPorts: [5173] }),
    ]);
    expect([...out.keys()]).toEqual(['s-alpha']);
  });

  /**
   * Verifies that a launch.json port whose listener command line mentions the folder is attributed (rule b)
   */
  it('attributes a declared port whose command mentions the session folder (rule b)', () => {
    const scan = {
      listeners: [listener(9100, 5173)],
      procs: [p(100, 1, 'Claude.exe', 'Claude.exe'), p(9100, 100, 'node.exe', 'node C:\\work\\alpha\\node_modules\\vite\\bin\\vite.js')],
    };
    expect(attributeServers(scan, [target({ launchPorts: [5173] })]).get('s-alpha')).toEqual([{ port: 5173, process: 'node' }]);
  });

  /**
   * Verifies that rule b also accepts a mention in an ancestor's command line
   */
  it('accepts a folder mention in an ancestor command line', () => {
    const scan = {
      listeners: [listener(9101, 3000)],
      procs: [p(9000, 1, 'cmd.exe', 'cmd.exe /c "cd /d C:\\work\\alpha && npm run dev"'), p(9101, 9000, 'node.exe', 'node server.js')],
    };
    expect(attributeServers(scan, [target({ launchPorts: [3000] })]).get('s-alpha')).toEqual([{ port: 3000, process: 'node' }]);
  });

  /**
   * Verifies that rule b needs both the declared port and the folder mention
   */
  it('ignores an undeclared port or a command that does not mention the folder', () => {
    const scan = {
      listeners: [listener(9100, 5173), listener(9200, 3000)],
      procs: [p(9100, 1, 'node.exe', 'node C:\\work\\alpha\\server.js'), p(9200, 1, 'node.exe', 'node C:\\work\\beta\\server.js')],
    };
    expect(attributeServers(scan, [target({ launchPorts: [3000] })]).size).toBe(0);
  });

  /**
   * Verifies that a worktree server and a main-repo server on the same declared port each go to their own session
   */
  it('separates a worktree nested in the main repo when both declare the same port', () => {
    const scan = {
      listeners: [listener(9300, 5173, '127.0.0.1'), listener(9400, 5173, '::1')],
      procs: [
        p(9300, 1, 'node.exe', `node ${ALPHA_WT}\\node_modules\\vite\\bin\\vite.js`),
        p(9400, 1, 'node.exe', `node ${ALPHA}\\node_modules\\vite\\bin\\vite.js`),
      ],
    };
    // The main repo is listed first: the nested worktree must still get its own server.
    const out = attributeServers(scan, [
      target({ sessionId: 's-main', cwd: ALPHA, launchPorts: [5173] }),
      target({ sessionId: 's-wt', cwd: ALPHA_WT, launchPorts: [5173] }),
    ]);
    expect(out.get('s-wt')).toEqual([{ port: 5173, process: 'node' }]);
    expect(out.get('s-main')).toEqual([{ port: 5173, process: 'node' }]);
  });

  /**
   * Verifies that a running worktree server is never given to the main repo session too
   */
  it('gives a worktree server only to the worktree session', () => {
    const scan = { listeners: [listener(9300, 5173)], procs: [p(9300, 1, 'node.exe', `node ${ALPHA_WT}\\server.js`)] };
    const out = attributeServers(scan, [
      target({ sessionId: 's-main', cwd: ALPHA, launchPorts: [5173] }),
      target({ sessionId: 's-wt', cwd: ALPHA_WT, launchPorts: [5173] }),
    ]);
    expect([...out.keys()]).toEqual(['s-wt']);
  });

  /**
   * Verifies that the longest matching folder wins when nested folders declare the same port
   */
  it('gives a port mentioned by nested folders to the longest one, whatever the order', () => {
    const scan = { listeners: [listener(9500, 3000)], procs: [p(9500, 1, 'node.exe', 'node C:\\work\\alpha\\web\\server.js')] };
    const outer = target({ sessionId: 's-outer', cwd: ALPHA, launchPorts: [3000] });
    const inner = target({ sessionId: 's-inner', cwd: 'C:\\work\\alpha\\web', launchPorts: [3000] });
    expect([...attributeServers(scan, [outer, inner]).keys()]).toEqual(['s-inner']);
    expect([...attributeServers(scan, [inner, outer]).keys()]).toEqual(['s-inner']);
  });

  /**
   * Verifies that a target without a folder is never matched by rule b
   */
  it('skips targets with an empty folder for rule b', () => {
    const scan = { listeners: [listener(9500, 3000)], procs: [p(9500, 1, 'node.exe', 'node C:\\work\\alpha\\server.js')] };
    expect(attributeServers(scan, [target({ cwd: '', launchPorts: [3000] })]).size).toBe(0);
  });

  /**
   * Verifies that a parent-pid cycle neither loops forever nor fakes a descent
   */
  it('is safe against parent pid cycles', () => {
    const scan = {
      listeners: [listener(9001, 5173), listener(9010, 5174)],
      procs: [
        p(9001, 9002, 'node.exe', 'node C:\\work\\alpha\\a.js'),
        p(9002, 9001, 'cmd.exe', 'cmd'),
        p(9010, 9010, 'node.exe', 'node b.js'),
        p(CLAUDE_PID, 1, 'claude.exe'),
      ],
    };
    const out = attributeServers(scan, [target({ pid: CLAUDE_PID, launchPorts: [5173] })]);
    // 5173 found by its folder mention despite the cycle, 5174 neither descends nor is declared.
    expect(out.get('s-alpha')).toEqual([{ port: 5173, process: 'node' }]);
  });

  /**
   * Verifies that a cycle passing through the Claude process still counts as descent
   */
  it('finds the owner inside a cycle that contains the target pid', () => {
    const scan = { listeners: [listener(9001, 5173)], procs: [p(9001, CLAUDE_PID), p(CLAUDE_PID, 9001, 'claude.exe')] };
    expect(attributeServers(scan, [target({ pid: CLAUDE_PID })]).get('s-alpha')).toEqual([{ port: 5173, process: 'node' }]);
  });

  /** A chain Claude (1000) → 1001 → … → 1000+n, the last one listening on 5173. */
  function chain(n: number) {
    const procs = [p(1000, 1, 'claude.exe')];
    for (let i = 1; i <= n; i++) procs.push(p(1000 + i, 1000 + i - 1, 'node.exe'));
    return { listeners: [listener(1000 + n, 5173)], procs };
  }

  /**
   * Verifies that descent is found 31 levels up (32 pids including the listener)
   */
  it('finds the Claude process 31 levels above the listener', () => {
    expect(attributeServers(chain(31), [target({ pid: 1000 })]).has('s-alpha')).toBe(true);
  });

  /**
   * Verifies that the ancestry walk stops at 32 pids, so a deeper Claude process is not reached
   */
  it('stops the ancestry walk at depth 32', () => {
    expect(attributeServers(chain(32), [target({ pid: 1000 })]).size).toBe(0);
  });

  /**
   * Verifies that the office server's own port is never attributed
   */
  it('excludes the own port of the office server', () => {
    const scan = { listeners: [listener(9001, 4000), listener(9001, 5173)], procs: descendantScan.procs };
    expect(attributeServers(scan, [target({ pid: CLAUDE_PID })], 4000).get('s-alpha')).toEqual([{ port: 5173, process: 'node' }]);
  });

  /**
   * Verifies that loopback and wildcard addresses are local, in any case
   */
  it.each([['127.0.0.1'], ['0.0.0.0'], ['::'], ['::1'], ['*'], ['localhost'], ['LOCALHOST']])('keeps local address %s', (address) => {
    const scan = { listeners: [listener(9001, 5173, address)], procs: descendantScan.procs };
    expect(attributeServers(scan, [target({ pid: CLAUDE_PID })]).has('s-alpha')).toBe(true);
  });

  /**
   * Verifies that a socket bound to a LAN, public or link-local address is never attributed
   */
  it.each([['192.168.1.20'], ['10.0.0.5'], ['fe80::1'], ['2001:db8::1'], ['']])('drops non-local address %j', (address) => {
    const scan = { listeners: [listener(9001, 5173, address)], procs: descendantScan.procs };
    expect(attributeServers(scan, [target({ pid: CLAUDE_PID })]).size).toBe(0);
  });

  /**
   * Verifies that one port listened on several addresses appears once, and ports are sorted
   */
  it('dedupes ports and sorts them', () => {
    const scan = {
      listeners: [listener(9001, 8080), listener(9001, 5173, '127.0.0.1'), listener(9001, 5173, '::1'), listener(9001, 3000, '0.0.0.0')],
      procs: descendantScan.procs,
    };
    expect(attributeServers(scan, [target({ pid: CLAUDE_PID })]).get('s-alpha')!.map((s) => s.port)).toEqual([3000, 5173, 8080]);
  });

  /**
   * Verifies that at most 8 servers, the lowest ports, are kept per session
   */
  it('keeps at most MAX_SERVERS ports per session', () => {
    expect(MAX_SERVERS).toBe(8);
    const ports = [3009, 3008, 3007, 3006, 3005, 3004, 3003, 3002, 3001, 3000];
    const scan = { listeners: ports.map((port) => listener(9001, port)), procs: descendantScan.procs };
    expect(attributeServers(scan, [target({ pid: CLAUDE_PID })]).get('s-alpha')!.map((s) => s.port)).toEqual([
      3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007,
    ]);
  });

  /**
   * Verifies that an unknown or unsafe process name is left out instead of being sent
   */
  it('omits the process name when unknown or invalid', () => {
    const scan = {
      listeners: [listener(9001, 5173), listener(9002, 5174)],
      procs: [p(CLAUDE_PID, 1, 'claude.exe'), p(9001, CLAUDE_PID, 'evil name <b>.exe')],
    };
    // 9002 has no process entry at all: no ancestry, no attribution.
    const out = attributeServers(scan, [target({ pid: CLAUDE_PID })]).get('s-alpha')!;
    expect(out).toEqual([{ port: 5173 }]);
    expect('process' in out[0]).toBe(false);
  });

  /**
   * Verifies that no command line ever appears in the result
   */
  it('never leaks a command line', () => {
    const secretCmd = 'node C:\\work\\alpha\\server.js --token=abc123';
    const scan = { listeners: [listener(9100, 5173)], procs: [p(9100, 1, 'node.exe', secretCmd)] };
    const json = JSON.stringify([...attributeServers(scan, [target({ launchPorts: [5173] })])]);
    expect(json).not.toContain('abc123');
    expect(json).not.toContain('server.js');
  });

  /**
   * Verifies that no targets or no listeners give an empty map
   */
  it('returns an empty map without targets or listeners', () => {
    expect(attributeServers(descendantScan, []).size).toBe(0);
    expect(attributeServers({ listeners: [], procs: descendantScan.procs }, [target({ pid: CLAUDE_PID })]).size).toBe(0);
  });
});

describe('parseLaunchPorts', () => {
  /**
   * Verifies that the ports of the configurations are returned deduplicated and sorted
   */
  it('reads, dedupes and sorts the configuration ports', () => {
    const text = JSON.stringify({
      version: '0.0.1',
      configurations: [
        { name: 'web', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'], port: 5173 },
        { name: 'api', port: 3000 },
        { name: 'web again', port: 5173 },
        { name: 'no port' },
      ],
    });
    expect(parseLaunchPorts(text)).toEqual([3000, 5173]);
  });

  /**
   * Verifies that non-integer, out-of-range, string and null ports are ignored
   */
  it('ignores invalid ports and non-object configurations', () => {
    const text = JSON.stringify({
      configurations: [{ port: 0 }, { port: 65536 }, { port: -1 }, { port: 3000.5 }, { port: '3000' }, { port: null }, 5, 'x', null, { port: 65535 }],
    });
    expect(parseLaunchPorts(text)).toEqual([65535]);
  });

  /**
   * Verifies that only the first 8 distinct declared ports are kept
   */
  it('keeps the first MAX_SERVERS declared ports', () => {
    const configurations = [9009, 9008, 9007, 9006, 9005, 9004, 9003, 9002, 9001, 9000].map((port) => ({ port }));
    expect(parseLaunchPorts(JSON.stringify({ configurations }))).toEqual([9002, 9003, 9004, 9005, 9006, 9007, 9008, 9009]);
  });

  /**
   * Verifies that malformed JSON or an unexpected shape gives no port instead of throwing
   */
  it.each([['{not json'], [''], ['null'], ['[]'], ['42'], ['{"configurations":"x"}'], ['{}'], ['{"configurations":[]}']])(
    'returns [] for %j',
    (text) => {
      expect(parseLaunchPorts(text)).toEqual([]);
    },
  );
});

describe('readLaunchPorts', () => {
  let root: string;
  let counter = 0;
  const VALID = JSON.stringify({ configurations: [{ name: 'web', port: 5173 }] });

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-launch-'));
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A fresh project folder, with `.claude/launch.json` holding `content` when given. */
  function project(content?: string): string {
    const dir = path.join(root, `proj-${counter++}`);
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    if (content !== undefined) fs.writeFileSync(path.join(dir, '.claude', 'launch.json'), content, 'utf8');
    return dir;
  }

  /**
   * Verifies that the ports of a regular launch.json are read
   */
  it('reads the ports of <cwd>/.claude/launch.json', () => {
    expect(readLaunchPorts(project(VALID))).toEqual([5173]);
  });

  /**
   * Verifies that a missing launch.json or .claude folder gives no port
   */
  it('returns [] when the file or its folder is missing', () => {
    expect(readLaunchPorts(project())).toEqual([]);
    const bare = path.join(root, `bare-${counter++}`);
    fs.mkdirSync(bare);
    expect(readLaunchPorts(bare)).toEqual([]);
    expect(readLaunchPorts(path.join(root, 'does-not-exist'))).toEqual([]);
  });

  /**
   * Verifies that malformed JSON in launch.json gives no port
   */
  it('returns [] for a malformed launch.json', () => {
    expect(readLaunchPorts(project('{"configurations": [ { "port": 5173 '))).toEqual([]);
  });

  /**
   * Verifies that a file of exactly 64 KiB is still read
   */
  it('reads a launch.json of exactly 64 KiB', () => {
    const dir = project(VALID + ' '.repeat(64 * 1024 - VALID.length));
    expect(fs.statSync(path.join(dir, '.claude', 'launch.json')).size).toBe(64 * 1024);
    expect(readLaunchPorts(dir)).toEqual([5173]);
  });

  /**
   * Verifies that a launch.json over 64 KiB is refused
   */
  it('refuses a launch.json larger than 64 KiB', () => {
    const dir = project(VALID + ' '.repeat(64 * 1024 + 1 - VALID.length));
    expect(fs.statSync(path.join(dir, '.claude', 'launch.json')).size).toBe(64 * 1024 + 1);
    expect(readLaunchPorts(dir)).toEqual([]);
  });

  /**
   * Verifies that a directory named launch.json is not read
   */
  it('returns [] when launch.json is a directory', () => {
    const dir = project();
    fs.mkdirSync(path.join(dir, '.claude', 'launch.json'));
    expect(readLaunchPorts(dir)).toEqual([]);
  });

  /**
   * Verifies that a .claude folder that is a link (junction or symlink) is refused
   */
  it('refuses a linked .claude folder', () => {
    const real = project(VALID);
    const linked = path.join(root, `linked-${counter++}`);
    fs.mkdirSync(linked);
    // A junction needs no privilege on Windows; elsewhere the type is ignored (directory symlink).
    fs.symlinkSync(path.join(real, '.claude'), path.join(linked, '.claude'), 'junction');
    expect(readLaunchPorts(real)).toEqual([5173]);
    expect(readLaunchPorts(linked)).toEqual([]);
  });

  /**
   * Verifies that empty and relative folders give no port
   */
  it.each([[''], ['relative\\proj'], ['relative/proj']])('returns [] for the non-absolute folder %j', (cwd) => {
    expect(readLaunchPorts(cwd)).toEqual([]);
  });

  /**
   * Verifies that a network share is never touched
   */
  it.each([['\\\\server\\share\\proj'], ['//server/share/proj']])('returns [] for the remote folder %s without I/O', (cwd) => {
    const open = vi.spyOn(fs, 'openSync');
    const lstat = vi.spyOn(fs, 'lstatSync');
    expect(readLaunchPorts(cwd)).toEqual([]);
    expect(open).not.toHaveBeenCalled();
    expect(lstat).not.toHaveBeenCalled();
  });

  /**
   * Verifies that a read failure after opening yields no port and does not throw
   */
  it('returns [] when reading the file fails', () => {
    const dir = project(VALID);
    vi.spyOn(fs, 'readSync').mockImplementation(() => {
      throw Object.assign(new Error('EIO'), { code: 'EIO' });
    });
    expect(readLaunchPorts(dir)).toEqual([]);
  });
});

describe('LaunchPortsCache', () => {
  /** A fake reader returning `answers` in turn and recording each folder read. */
  function reader(answers: number[][]) {
    const calls: string[] = [];
    const read = (cwd: string) => {
      calls.push(cwd);
      return answers[Math.min(calls.length - 1, answers.length - 1)];
    };
    return { read, calls };
  }

  /**
   * Verifies that a folder is read once and its ports reused for less than 60 s
   */
  it('reuses the ports within 60 s and reads again at 60 s', () => {
    const r = reader([[3000], [4000]]);
    const cache = new LaunchPortsCache(r.read);
    expect(cache.get(ALPHA, 1000)).toEqual([3000]);
    expect(cache.get(ALPHA, 1000 + 59_999)).toEqual([3000]);
    expect(r.calls).toHaveLength(1);
    expect(cache.get(ALPHA, 1000 + 60_000)).toEqual([4000]);
    expect(r.calls).toHaveLength(2);
  });

  /**
   * Verifies that spellings of the same folder share one cache entry
   */
  it('keys the cache on the normalised folder', () => {
    const r = reader([[3000], [4000]]);
    const cache = new LaunchPortsCache(r.read);
    cache.get('C:\\Work\\Alpha\\', 1000);
    expect(cache.get('c:/work/alpha', 2000)).toEqual([3000]);
    expect(r.calls).toEqual(['C:\\Work\\Alpha\\']);
  });

  /**
   * Verifies that different folders are cached separately
   */
  it('keeps one entry per folder', () => {
    const r = reader([[3000], [4000]]);
    const cache = new LaunchPortsCache(r.read);
    expect(cache.get(ALPHA, 1000)).toEqual([3000]);
    expect(cache.get(BETA, 1000)).toEqual([4000]);
    expect(cache.get(ALPHA, 1001)).toEqual([3000]);
  });

  /**
   * Verifies that keepOnly drops the folders no longer asked for, matching normalised spellings
   */
  it('keepOnly drops the other folders', () => {
    const r = reader([[3000], [4000], [5000]]);
    const cache = new LaunchPortsCache(r.read);
    cache.get(ALPHA, 1000);
    cache.get(BETA, 1000);
    cache.keepOnly(['c:/WORK/alpha/']);
    expect(cache.get(ALPHA, 1001)).toEqual([3000]);
    expect(cache.get(BETA, 1001)).toEqual([5000]);
    expect(r.calls).toEqual([ALPHA, BETA, BETA]);
  });

  /**
   * Verifies that keepOnly with no folder empties the cache
   */
  it('keepOnly([]) forgets every folder', () => {
    const r = reader([[3000], [4000]]);
    const cache = new LaunchPortsCache(r.read);
    cache.get(ALPHA, 1000);
    cache.keepOnly([]);
    expect(cache.get(ALPHA, 1001)).toEqual([4000]);
  });
});

describe('PortScanner', () => {
  const procs = [p(CLAUDE_PID, 1, 'claude.exe'), p(9001, CLAUDE_PID, 'node.exe', 'node vite.js')];

  /** A fake system whose answers can change between scans, counting each call. */
  function fakeSys(initial: Listener[]) {
    const sys = {
      listenersNow: initial,
      procsNow: procs,
      listenerCalls: 0,
      processCalls: 0,
      failListeners: false,
      failProcesses: false,
      listeners: async (): Promise<Listener[]> => {
        sys.listenerCalls++;
        if (sys.failListeners) throw new Error('netstat failed');
        return sys.listenersNow;
      },
      processes: async (): Promise<Proc[]> => {
        sys.processCalls++;
        if (sys.failProcesses) throw new Error('powershell failed');
        return sys.procsNow;
      },
    };
    return sys;
  }

  const targets = [target({ pid: CLAUDE_PID })];

  /**
   * Verifies that no target gives an empty map without running any system command
   */
  it('returns an empty map without calling the system when there is no target', async () => {
    const sys = fakeSys([listener(9001, 5173)]);
    const out = await new PortScanner(undefined, sys).scan([]);
    expect(out.size).toBe(0);
    expect(sys.listenerCalls + sys.processCalls).toBe(0);
  });

  /**
   * Verifies that LAN-bound sockets and the office's own port coming and going never re-list processes
   */
  it('ignores changes in sockets that can never be attributed', async () => {
    const sys = fakeSys([listener(9001, 5173)]);
    const scanner = new PortScanner(4777, sys);
    await scanner.scan(targets);
    sys.listenersNow = [listener(9001, 5173), { pid: 777, port: 50000, address: '192.168.1.20' }, listener(1, 4777)];
    const out = await scanner.scan(targets);
    expect(sys.processCalls).toBe(1);
    expect(out.get('s-alpha')).toEqual([{ port: 5173, process: 'node' }]);
  });

  /**
   * Verifies that a scan attributes the listening ports to the targets
   */
  it('attributes the scanned ports', async () => {
    const sys = fakeSys([listener(9001, 5173)]);
    expect(await new PortScanner(undefined, sys).scan(targets)).toEqual(new Map([['s-alpha', [{ port: 5173, process: 'node' }]]]));
  });

  /**
   * Verifies that unchanged listeners and targets reuse the previous result and process list
   */
  it('reuses the previous result while listeners and targets are unchanged', async () => {
    const sys = fakeSys([listener(9001, 5173)]);
    const scanner = new PortScanner(undefined, sys);
    const first = await scanner.scan(targets);
    // A new process list would change nothing: it must not even be read.
    sys.procsNow = [];
    const second = await scanner.scan(targets.map((t) => ({ ...t })));
    expect(second).toEqual(first);
    expect(sys.listenerCalls).toBe(2);
    expect(sys.processCalls).toBe(1);
  });

  /**
   * Verifies that a change in the listening sockets triggers a fresh process scan
   */
  it('rescans the processes when the listeners change', async () => {
    const sys = fakeSys([listener(9001, 5173)]);
    const scanner = new PortScanner(undefined, sys);
    await scanner.scan(targets);
    sys.listenersNow = [listener(9001, 5173), listener(9001, 5174)];
    expect((await scanner.scan(targets)).get('s-alpha')!.map((s) => s.port)).toEqual([5173, 5174]);
    expect(sys.processCalls).toBe(2);
  });

  /**
   * Verifies that a change in the targets triggers a fresh attribution
   */
  it('rescans when the targets change', async () => {
    const sys = fakeSys([listener(9001, 5173)]);
    const scanner = new PortScanner(undefined, sys);
    await scanner.scan(targets);
    const out = await scanner.scan([target({ sessionId: 's-other', pid: CLAUDE_PID })]);
    expect([...out.keys()]).toEqual(['s-other']);
    expect(sys.processCalls).toBe(2);
  });

  /**
   * Verifies that the scanner excludes its own port from the attribution
   */
  it('passes its own port to the attribution', async () => {
    const sys = fakeSys([listener(9001, 4000), listener(9001, 5173)]);
    expect((await new PortScanner(4000, sys).scan(targets)).get('s-alpha')).toEqual([{ port: 5173, process: 'node' }]);
  });

  /**
   * Verifies that an empty round forgets the cache, so the next round reads the processes again
   */
  it('forgets the cached result after a round without targets', async () => {
    const sys = fakeSys([listener(9001, 5173)]);
    const scanner = new PortScanner(undefined, sys);
    await scanner.scan(targets);
    await scanner.scan([]);
    expect((await scanner.scan(targets)).get('s-alpha')).toEqual([{ port: 5173, process: 'node' }]);
    expect(sys.processCalls).toBe(2);
  });

  /**
   * Verifies that a failing listener command rejects the scan
   */
  it('rejects when listing the listeners fails', async () => {
    const sys = fakeSys([listener(9001, 5173)]);
    sys.failListeners = true;
    await expect(new PortScanner(undefined, sys).scan(targets)).rejects.toThrow('netstat failed');
  });

  /**
   * Verifies that a failed process scan is retried next round instead of caching a stale result
   */
  it('retries the process scan after a failure', async () => {
    const sys = fakeSys([listener(9001, 5173)]);
    const scanner = new PortScanner(undefined, sys);
    sys.failProcesses = true;
    await expect(scanner.scan(targets)).rejects.toThrow('powershell failed');
    sys.failProcesses = false;
    expect((await scanner.scan(targets)).get('s-alpha')).toEqual([{ port: 5173, process: 'node' }]);
    expect(sys.processCalls).toBe(2);
  });
});
