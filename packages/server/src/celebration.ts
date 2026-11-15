// Celebrations, a purely visual gag: a successful git commit or push makes a herald sound his
// trumpet on a castle tower, a passing test suite sets off fireworks. The server classifies the
// command and sends only the kind, never the command text. Pure module, tested.
import type { Celebration } from '@agent-office/shared';
import type { HookEvent } from './reducer.ts';

/** Longest command looked at: the start of a command is where git or the test runner shows. */
const MAX_COMMAND = 4096;
/** Tail of the tool output searched for failures masked by a pipe (`npm test | tail`). */
const MAX_OUTPUT = 64 * 1024;

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
/** Words that only launch the next one. */
const LAUNCHERS = new Set(['npx', 'bunx', 'sudo', 'time', 'command', 'env', 'exec', 'call']);
/** Shell operators, subshells and blocks: `&&`, `||`, `;`, `|`, `&`, `(`, `)`, `{`, `}`, backticks, line breaks. */
const SEPARATORS = /&&|\|\||[;|&(){}`\n\r]/;
/** Linear pattern (no nested quantifier): a test summary that reports failures (vitest, jest, mocha, cargo, pytest, maven). */
const FAILURE = /\b[1-9]\d* (?:failed|failing)\b|\bFAIL(?:ED)?\b|Tests failed|BUILD FAILURE/;
/**
 * Start of a heredoc and its delimiter: `<<EOF`, `<<-EOF`, `<<'END-MSG'`, `<<"EOF"`. Not a
 * here-string (`<<<`). Known limits (a missed celebration at worst): `<<` inside quotes or in
 * arithmetic, and a second heredoc on the same line, are not told apart.
 */
const HEREDOC = /(?<!<)<<(?!<)-?[ \t]*(['"]?)([^\s'"<>|&;()]{1,64})\1/;

/** Last path component, lower case, without a Windows executable extension. */
function program(word: string): string {
  const base = word.slice(Math.max(word.lastIndexOf('/'), word.lastIndexOf('\\')) + 1).toLowerCase();
  return base.replace(/\.(?:exe|cmd|bat|ps1)$/, '');
}

/**
 * Removes heredoc bodies (`git commit -F - <<'EOF' … EOF`): their lines are text, not commands.
 * A body runs from the line after `<<DELIM` to the line that is exactly DELIM, or to the end.
 */
function dropHeredocs(command: string): string {
  let out = '';
  let rest = command;
  for (let m = HEREDOC.exec(rest); m; m = HEREDOC.exec(rest)) {
    const delimiter = m[2];
    const after = m.index + m[0].length;
    const lineEnd = rest.indexOf('\n', after);
    // Keep what follows the operator on its own line (`<<'EOF')"` closes a $( … )).
    out += rest.slice(0, m.index) + (lineEnd < 0 ? rest.slice(after) : rest.slice(after, lineEnd));
    if (lineEnd < 0) return out;
    const lines = rest.slice(lineEnd + 1).split('\n');
    const close = lines.findIndex((line) => line.trim() === delimiter);
    if (close < 0) return out;
    rest = '\n' + lines.slice(close + 1).join('\n');
  }
  return out + rest;
}

/**
 * Blanks quoted strings (`git commit -m "wip; git push later"`): their separators and words are
 * text. Each quoted string becomes a lone `Q`. As in the shell, a quote runs to its closing
 * character across lines (`"$(cat <<'EOF'` … `)"`), or to the end of the command when unclosed.
 */
function dropQuoted(command: string): string {
  let out = '';
  let quote = '';
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      out += 'Q';
    } else out += c;
  }
  return out;
}

/**
 * The simple commands of a shell line, as word lists: heredoc bodies and quoted strings dropped,
 * split on `&&`, `||`, `;`, `|`, `&`, parentheses, braces, backticks and line breaks, leading
 * `VAR=value` assignments and launchers (`npx`, `sudo`…) removed.
 */
export function commandSegments(command: string): string[][] {
  const out: string[][] = [];
  const text = dropQuoted(dropHeredocs(command.slice(0, MAX_COMMAND)));
  for (const part of text.split(SEPARATORS)) {
    const words = part.trim().split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < words.length && (/^[A-Za-z_]\w*=/.test(words[i]) || LAUNCHERS.has(program(words[i])))) i++;
    // `pnpm exec vitest`, `yarn exec jest`: the runner is after `exec`.
    if (i + 1 < words.length && ['pnpm', 'yarn'].includes(program(words[i])) && words[i + 1] === 'exec') i += 2;
    if (i < words.length) out.push(words.slice(i));
  }
  return out;
}

/** Git global options that take a separate value (`git -C dir push`). */
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);

/** `commit` or `push` when the segment runs that git subcommand for real (not a dry run). */
export function gitAction(words: string[]): 'commit' | 'push' | undefined {
  if (words.length === 0 || program(words[0]) !== 'git') return undefined;
  let i = 1;
  while (i < words.length && words[i].startsWith('-')) i += GIT_VALUE_OPTIONS.has(words[i]) ? 2 : 1;
  const sub = words[i];
  if (sub !== 'commit' && sub !== 'push') return undefined;
  // `-n` is a dry run for push only (for commit it means --no-verify).
  if (words.slice(i + 1).some((w) => w === '--dry-run' || (w === '-n' && sub === 'push'))) return undefined;
  return sub;
}

const SCRIPT_RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

/** A test script name: `test`, `t` (npm alias), `test:unit`… */
function isTestScript(name: string | undefined): boolean {
  return name === 'test' || name === 't' || (name?.startsWith('test:') ?? false);
}

/** True when the segment runs a test suite once (watch modes excluded). */
export function isTestSegment(words: string[]): boolean {
  if (words.length === 0) return false;
  const [first, second, third] = words;
  const prog = program(first);
  if (words.some((w) => w === '--watch' || w === 'watch' || (w === '-w' && prog === 'vitest'))) return false;
  if (SCRIPT_RUNNERS.has(prog)) return isTestScript(second) || (second === 'run' && isTestScript(third));
  switch (prog) {
    case 'vitest':
    case 'jest':
    case 'pytest':
      return true;
    case 'playwright':
      return second === 'test';
    case 'python':
    case 'python3':
    case 'py':
      return second === '-m' && third === 'pytest';
    case 'mvn':
    case 'mvnw':
      return words.slice(1).some((w) => w === 'test' || w === 'verify');
    case 'gradle':
    case 'gradlew':
      return words.slice(1).some((w) => w === 'test' || w === 'check');
    case 'cargo':
    case 'go':
    case 'dotnet':
      return second === 'test';
    case 'node':
      return second === '--test';
    default:
      return false;
  }
}

/** True when any simple command of the line runs a test suite. Reusable by other gags. */
export function isTestCommand(command: string): boolean {
  return commandSegments(command).some(isTestSegment);
}

/** Text of the tool output (stdout and stderr), last `MAX_OUTPUT` characters. */
function outputText(response: unknown): string {
  if (typeof response === 'string') return response.slice(-MAX_OUTPUT);
  if (!response || typeof response !== 'object') return '';
  const r = response as Record<string, unknown>;
  const parts = [r.stdout, r.stderr, r.output].filter((v): v is string => typeof v === 'string');
  return parts.join('\n').slice(-MAX_OUTPUT);
}

/**
 * What a hook event celebrates. Only a successful shell command counts (PostToolUse, never
 * PostToolUseFailure): a push beats a commit in the same line, tests count unless the output
 * reports failures (a pipe or `|| true` can hide the exit code).
 */
export function celebrationsFor(ev: HookEvent): Celebration[] {
  if (ev.hook_event_name !== 'PostToolUse' || !ev.tool_name || !SHELL_TOOLS.has(ev.tool_name)) return [];
  const input = ev.tool_input;
  const command = input && typeof input === 'object' ? (input as Record<string, unknown>).command : undefined;
  if (typeof command !== 'string') return [];
  const response = (ev as Record<string, unknown>).tool_response;
  // An interrupted command (timeout, user stop) proves nothing.
  if (response && typeof response === 'object' && (response as Record<string, unknown>).interrupted === true) return [];
  const segments = commandSegments(command);
  const out: Celebration[] = [];
  const git = segments.map(gitAction);
  if (git.includes('push')) out.push('push');
  else if (git.includes('commit')) out.push('commit');
  if (segments.some(isTestSegment) && !FAILURE.test(outputText(response))) {
    out.push('tests');
  }
  return out;
}
