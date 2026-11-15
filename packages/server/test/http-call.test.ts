import { describe, expect, it } from 'vitest';
import { SCAN_HEAD, SCAN_TAIL, httpCallOf, httpStatus, isHttpCommand } from '../src/http-call.ts';

/** A Bash tool event running `command`, with an optional stdout in the tool response. */
function bash(event: string, command: unknown, stdout?: unknown) {
  return {
    hook_event_name: event,
    tool_name: 'Bash',
    tool_input: { command },
    ...(stdout === undefined ? {} : { tool_response: { stdout } }),
  };
}

const CURL = 'curl -s -i https://api.example.com/v1/items';

describe('isHttpCommand', () => {
  /**
   * Verifies that every supported HTTP client is recognised as a whole word
   */
  it.each([
    ['curl https://x'],
    ['wget https://x'],
    ['Invoke-WebRequest -Uri https://x'],
    ['Invoke-RestMethod -Uri https://x'],
    ['iwr https://x'],
    ['irm https://x'],
  ])('recognises %j', (command) => {
    expect(isHttpCommand(command)).toBe(true);
  });

  /**
   * Verifies that the match is case-insensitive and accepts an optional .exe suffix
   */
  it.each([['CURL -I https://x'], ['curl.exe -s https://x'], ['Curl.EXE https://x'], ['WGET.exe x'], ['invoke-webrequest x'], ['IRM x']])(
    'recognises %j regardless of case and .exe',
    (command) => {
      expect(isHttpCommand(command)).toBe(true);
    },
  );

  /**
   * Verifies that the client is found anywhere in a compound command or after a path
   */
  it.each([['cd api && curl -s https://x'], ['echo {} | curl -d @- https://x'], ['/usr/bin/curl https://x'], ['C:\\tools\\curl.exe x'], ['(iwr x).Content']])(
    'recognises %j inside a longer command',
    (command) => {
      expect(isHttpCommand(command)).toBe(true);
    },
  );

  /**
   * Verifies that words merely containing a client name are not HTTP commands
   */
  it.each([['curly hair'], ['libcurl-dev'], ['curl-config --version'], ['my-curl x'], ['curl_wrapper x'], ['confirm'], ['firmware update'], ['wgetrc'], ['npm test'], ['']])(
    'rejects %j',
    (command) => {
      expect(isHttpCommand(command)).toBe(false);
    },
  );

  /**
   * Verifies that a non-string command is never an HTTP command
   */
  it.each([[undefined], [null], [42], [{ command: 'curl x' }], [['curl']]])('rejects non-string %j', (command) => {
    expect(isHttpCommand(command)).toBe(false);
  });

  /**
   * Verifies that repeated calls give the same answer (no stateful regex)
   */
  it('is stable across repeated calls', () => {
    expect([1, 2, 3].map(() => isHttpCommand('curl x'))).toEqual([true, true, true]);
  });
});

describe('httpStatus', () => {
  /**
   * Verifies that empty or non-string output has no status
   */
  it.each([[undefined], [null], [''], [200], [{ stdout: 'HTTP/1.1 200' }]])('returns undefined for %j', (stdout) => {
    expect(httpStatus(stdout)).toBeUndefined();
  });

  /**
   * Verifies that a single status line gives its code, for HTTP/1.x and HTTP/2 forms
   */
  it.each([
    ['HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{}', 200],
    ['HTTP/1.0 503 Service Unavailable', 503],
    ['HTTP/2 404\r\nserver: x\r\n\r\nnot found', 404],
    ['HTTP/2.0 201 Created', 201],
  ])('reads the status of %j', (stdout, code) => {
    expect(httpStatus(stdout)).toBe(code);
  });

  /**
   * Verifies that after redirects the last status line wins (301 then 404 gives 404)
   */
  it('returns the last status line after redirects', () => {
    const out = 'HTTP/1.1 301 Moved Permanently\r\nLocation: /b\r\n\r\nHTTP/1.1 404 Not Found\r\n\r\nnope';
    expect(httpStatus(out)).toBe(404);
  });

  /**
   * Verifies that the -w marker overrides any earlier status line
   */
  it('prefers the --- HTTP marker over status lines', () => {
    expect(httpStatus('HTTP/1.1 500 Internal Server Error\r\n\r\nbody\n--- HTTP 200')).toBe(200);
    expect(httpStatus('--- HTTP 200\nHTTP/1.1 500 Oops')).toBe(200);
  });

  /**
   * Verifies that the last marker wins when several calls print one each
   */
  it('returns the last marker when there are several', () => {
    expect(httpStatus('a\n--- HTTP 200\nb\n--- HTTP 418\n')).toBe(418);
  });

  /**
   * Verifies that a status line not at a line start is ignored
   */
  it.each([['the body mentions HTTP/1.1 500 here'], ['x\nbody: HTTP/1.1 500']])('ignores a mid-line status in %j', (stdout) => {
    expect(httpStatus(stdout)).toBeUndefined();
  });

  /**
   * Verifies that only exactly three digits form a status code
   */
  it.each([['HTTP/1.1 20 OK'], ['HTTP/1.1 2000'], ['--- HTTP 20'], ['--- HTTP 2000'], ['HTTP/1.1 abc']])('rejects malformed %j', (stdout) => {
    expect(httpStatus(stdout)).toBeUndefined();
  });

  /**
   * Verifies that output without any status (plain body) gives undefined
   */
  it('returns undefined for a body without status', () => {
    expect(httpStatus('{"items":[]}')).toBeUndefined();
  });

  /**
   * Verifies that a long output ignores a status line between the scanned head and tail
   */
  it('skips the middle of a long output', () => {
    const out = `HTTP/1.1 200 OK\n${'a'.repeat(SCAN_HEAD)}\nHTTP/1.1 500 Hidden\n${'b'.repeat(SCAN_TAIL)}`;
    expect(out.length).toBeGreaterThan(SCAN_HEAD + SCAN_TAIL);
    expect(httpStatus(out)).toBe(200);
  });

  /**
   * Verifies that a marker at the very end of a long output is still found
   */
  it('finds the marker in the tail of a long output', () => {
    const out = `HTTP/1.1 200 OK\n${'a'.repeat(SCAN_HEAD + SCAN_TAIL)}\n--- HTTP 503`;
    expect(httpStatus(out)).toBe(503);
  });

  /**
   * Verifies that a status line in the tail of a long output is found
   */
  it('finds a status line in the tail of a long output', () => {
    const out = `${'a'.repeat(SCAN_HEAD * 2)}\nHTTP/1.1 429 Too Many Requests\n${'b'.repeat(100)}`;
    expect(httpStatus(out)).toBe(429);
  });

  /**
   * Verifies that an output just at the scan limit is scanned in full
   */
  it('scans an output of exactly SCAN_HEAD + SCAN_TAIL characters entirely', () => {
    const line = '\nHTTP/1.1 404 x\n';
    const pad = SCAN_HEAD + SCAN_TAIL - line.length;
    const out = 'a'.repeat(Math.floor(pad / 2)) + line + 'b'.repeat(Math.ceil(pad / 2));
    expect(out).toHaveLength(SCAN_HEAD + SCAN_TAIL);
    expect(httpStatus(out)).toBe(404);
  });

  /**
   * Verifies that a crafted ~2 MB output of repeated prefixes is processed quickly
   */
  it.each([['HTTP/1.1 '], ['\nHTTP/1.1 '], ['--- HTTP ']])('handles 2 MB of repeated %j fast', (unit) => {
    const out = unit.repeat(Math.ceil((2 * 1024 * 1024) / unit.length));
    const t0 = performance.now();
    const status = httpStatus(out);
    const elapsed = performance.now() - t0;
    expect(status).toBeUndefined();
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('httpCallOf', () => {
  /**
   * Verifies that launching an HTTP client in the dovecote starts a call
   */
  it('returns start on PreToolUse', () => {
    expect(httpCallOf(bash('PreToolUse', CURL), 'pigeonnier')).toBe('start');
  });

  /**
   * Verifies that PowerShell web cmdlets count like curl
   */
  it('accepts the PowerShell tool', () => {
    const ev = { hook_event_name: 'PreToolUse', tool_name: 'PowerShell', tool_input: { command: 'Invoke-RestMethod -Uri https://x' } };
    expect(httpCallOf(ev, 'pigeonnier')).toBe('start');
  });

  /**
   * Verifies that a failed tool run is an error, whatever its output
   */
  it('returns error on PostToolUseFailure', () => {
    expect(httpCallOf(bash('PostToolUseFailure', CURL), 'pigeonnier')).toBe('error');
    expect(httpCallOf(bash('PostToolUseFailure', CURL, 'HTTP/1.1 200 OK'), 'pigeonnier')).toBe('error');
  });

  /**
   * Verifies the 400 boundary: below is ok, 400 and above is error
   */
  it.each([
    [200, 'ok'],
    [302, 'ok'],
    [399, 'ok'],
    [400, 'error'],
    [404, 'error'],
    [500, 'error'],
    [599, 'error'],
  ])('PostToolUse with status %i gives %s', (code, expected) => {
    expect(httpCallOf(bash('PostToolUse', CURL, `HTTP/1.1 ${code} X\r\n\r\nbody`), 'pigeonnier')).toBe(expected);
  });

  /**
   * Verifies the 100 boundary: a status below 100 (no real response) is an error
   */
  it.each([
    ['--- HTTP 000', 'error'],
    ['--- HTTP 001', 'error'],
    ['--- HTTP 099', 'error'],
    ['--- HTTP 100', 'ok'],
    ['--- HTTP 101', 'ok'],
    ['HTTP/1.1 000 X\r\n\r\n', 'error'],
    ['HTTP/1.1 099 X\r\n\r\n', 'error'],
    ['HTTP/1.1 100 Continue\r\n\r\n', 'ok'],
  ])('PostToolUse with output %j gives %s', (stdout, expected) => {
    expect(httpCallOf(bash('PostToolUse', CURL, stdout), 'pigeonnier')).toBe(expected);
  });

  /**
   * Verifies that curl's 000 marker after a piped call with no response is an error
   */
  it('returns error for a 000 marker even when the exit code was hidden', () => {
    const ev = bash('PostToolUse', `${CURL} -w "\\n--- HTTP %{http_code}\\n" | head -n 50`, 'curl: (6) Could not resolve host\n--- HTTP 000\n');
    expect(httpCallOf(ev, 'pigeonnier')).toBe('error');
  });

  /**
   * Verifies that a 000 marker overrides an earlier successful status line
   */
  it('lets a 000 marker override an earlier 200 status line', () => {
    expect(httpCallOf(bash('PostToolUse', CURL, 'HTTP/1.1 200 OK\n\nbody\n--- HTTP 000'), 'pigeonnier')).toBe('error');
  });

  /**
   * Verifies that the last of several markers decides, when the last one is 000
   */
  it('uses the last marker when a later call got no response', () => {
    expect(httpCallOf(bash('PostToolUse', CURL, '--- HTTP 200\n--- HTTP 000\n'), 'pigeonnier')).toBe('error');
    expect(httpCallOf(bash('PostToolUse', CURL, '--- HTTP 000\n--- HTTP 200\n'), 'pigeonnier')).toBe('ok');
  });

  /**
   * Verifies that a PostToolUse without any status counts as a success
   */
  it.each([['plain body'], [''], [undefined], [42]])('PostToolUse with stdout %j is ok', (stdout) => {
    const ev = { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: CURL }, tool_response: { stdout } };
    expect(httpCallOf(ev, 'pigeonnier')).toBe('ok');
  });

  /**
   * Verifies that a PostToolUse without any tool response counts as a success
   */
  it('PostToolUse without tool_response is ok', () => {
    expect(httpCallOf(bash('PostToolUse', CURL), 'pigeonnier')).toBe('ok');
  });

  /**
   * Verifies that the -w marker decides the outcome over the status lines
   */
  it('uses the marker to decide the outcome', () => {
    expect(httpCallOf(bash('PostToolUse', CURL, 'HTTP/1.1 500 X\n\n--- HTTP 200'), 'pigeonnier')).toBe('ok');
    expect(httpCallOf(bash('PostToolUse', CURL, 'HTTP/1.1 200 OK\n\n--- HTTP 404'), 'pigeonnier')).toBe('error');
  });

  /**
   * Verifies that a call made outside the dovecote is ignored
   */
  it.each([['machines'], ['biblio'], [undefined]])('ignores room %j', (room) => {
    expect(httpCallOf(bash('PreToolUse', CURL), room as never)).toBeUndefined();
  });

  /**
   * Verifies that non-shell tools are ignored even with a curl-looking input
   */
  it.each([['Read'], ['WebFetch'], ['bash'], [undefined]])('ignores tool %j', (tool) => {
    const ev = { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command: CURL } };
    expect(httpCallOf(ev, 'pigeonnier')).toBeUndefined();
  });

  /**
   * Verifies that shell commands other than an HTTP client are ignored
   */
  it.each([['npm test'], ['ls -la'], [undefined]])('ignores command %j', (command) => {
    expect(httpCallOf(bash('PreToolUse', command), 'pigeonnier')).toBeUndefined();
  });

  /**
   * Verifies that a shell event without tool input is ignored
   */
  it('ignores a missing tool_input', () => {
    expect(httpCallOf({ hook_event_name: 'PreToolUse', tool_name: 'Bash' }, 'pigeonnier')).toBeUndefined();
  });

  /**
   * Verifies that other events about an HTTP command are ignored
   */
  it.each([['PermissionRequest'], ['Stop'], ['SubagentStop'], ['Notification']])('ignores event %s', (event) => {
    expect(httpCallOf(bash(event, CURL, 'HTTP/1.1 500 X'), 'pigeonnier')).toBeUndefined();
  });
});
