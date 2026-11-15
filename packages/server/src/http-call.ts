import type { HookEventSummary, RoomId } from '@agent-office/shared';

// HTTP calls made from the dovecote (Samuel-Morse probing an API with curl): a pigeon
// leaves on the call and comes back with its outcome. Pure: no I/O. Only an enum ever
// leaves this module — never the command's output, the URL or the status code.

export type HttpCall = NonNullable<HookEventSummary['httpCall']>;

/** Shell tools whose command may be an HTTP client call. */
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

/** curl, wget and the PowerShell web cmdlets (with their aliases), as whole words. */
const HTTP_COMMAND = /(?:^|[^\w-])(?:curl|wget|invoke-webrequest|invoke-restmethod|iwr|irm)(?:\.exe)?(?![\w-])/i;

/** Only the head and tail of a large output are scanned: headers come first, the `-w` marker last. */
export const SCAN_HEAD = 64 * 1024;
export const SCAN_TAIL = 4 * 1024;

// No nested quantifiers: linear on any input.
const W_MARKER = /--- HTTP (\d{3})\b/g;
const STATUS_LINE = /(?:^|\n)HTTP\/\d(?:\.\d)? (\d{3})\b/g;

export function isHttpCommand(command: unknown): boolean {
  return typeof command === 'string' && HTTP_COMMAND.test(command);
}

function lastMatch(re: RegExp, text: string): number | undefined {
  let last: string | undefined;
  for (const m of text.matchAll(re)) last = m[1];
  return last === undefined ? undefined : Number(last);
}

/**
 * The final HTTP status in a curl output: Samuel-Morse's `--- HTTP nnn` marker (`-w`) when
 * present, otherwise the last `HTTP/x nnn` status line (`-i`, so after redirects).
 */
export function httpStatus(stdout: unknown): number | undefined {
  if (typeof stdout !== 'string' || !stdout) return undefined;
  const text =
    stdout.length > SCAN_HEAD + SCAN_TAIL ? `${stdout.slice(0, SCAN_HEAD)}\n${stdout.slice(-SCAN_TAIL)}` : stdout;
  return lastMatch(W_MARKER, text) ?? lastMatch(STATUS_LINE, text);
}

interface ToolHook {
  hook_event_name: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
}

/**
 * What an event tells about an HTTP call of an agent working in `room`: `start` when it
 * launches one, `ok` / `error` when it ends, undefined otherwise or outside the dovecote.
 * A failed tool (curl exiting in error, network, timeout) or a status ≥ 400 is an error;
 * an output without any status counts as a success, since curl exited normally.
 */
export function httpCallOf(ev: ToolHook, room: RoomId | undefined): HttpCall | undefined {
  if (room !== 'pigeonnier' || !ev.tool_name || !SHELL_TOOLS.has(ev.tool_name)) return undefined;
  const input = ev.tool_input as { command?: unknown } | undefined;
  if (!isHttpCommand(input?.command)) return undefined;
  switch (ev.hook_event_name) {
    case 'PreToolUse':
      return 'start';
    case 'PostToolUseFailure':
      return 'error';
    case 'PostToolUse': {
      const status = httpStatus((ev.tool_response as { stdout?: unknown } | undefined)?.stdout);
      return status !== undefined && status >= 400 ? 'error' : 'ok';
    }
    default:
      return undefined;
  }
}
