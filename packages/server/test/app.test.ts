import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TOKEN_HEADER, buildApp } from '../src/app.ts';
import { OfficeStore } from '../src/store.ts';
import { projectDirName } from '../src/transcript.ts';
import { CLI_A, CLI_B, ENV_ALPHA, desk, hook, inventory, proc } from './fixtures/builders.ts';

const PORT = 4777;
const TOKEN = 'tok_0123456789abcdef0123456789abcdef01';
const HOST = { host: `127.0.0.1:${PORT}` };
const VALID_HOOK = { hook_event_name: 'UserPromptSubmit', session_id: CLI_A, cwd: 'C:/work/alpha', prompt: 'go' };

describe('buildApp', () => {
  let store: OfficeStore;
  let app: FastifyInstance;

  async function start(token: string | null = TOKEN) {
    store = new OfficeStore(() => 1000);
    app = await buildApp({ store, port: PORT, token, logger: false });
  }

  beforeEach(async () => {
    await start();
  });

  afterEach(async () => {
    store.close();
    await app.close();
  });

  function postHook(payload: unknown, headers: Record<string, string> = { [TOKEN_HEADER]: TOKEN }) {
    return app.inject({ method: 'POST', url: '/hooks', headers: { ...HOST, ...headers }, payload: payload as object });
  }

  describe('POST /hooks', () => {
    /**
     * Verifies that a valid hook with the right token returns 200 {} and reaches the store
     */
    it('accepts a valid hook with the right token', async () => {
      const res = await postHook(VALID_HOOK);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({});
      expect(store.recentEvents()).toEqual([expect.objectContaining({ event: 'UserPromptSubmit', sessionId: `cli:${CLI_A}` })]);
      expect(store.state.sessions.get(`cli:${CLI_A}`)?.main.state).toBe('working');
    });

    /**
     * Verifies that the token header name is matched case-insensitively
     */
    it('accepts the header in its installed casing', async () => {
      const res = await postHook(VALID_HOOK, { 'X-Agent-Office-Token': TOKEN });
      expect(res.statusCode).toBe(200);
    });

    /**
     * Verifies that a request without token is refused with 401 and ignored
     */
    it('returns 401 without token', async () => {
      const res = await postHook(VALID_HOOK, {});
      expect(res.statusCode).toBe(401);
      expect(res.json()).toHaveProperty('error');
      expect(store.recentEvents()).toEqual([]);
    });

    /**
     * Verifies that wrong tokens of equal or different length are refused with 401
     */
    it.each([
      ['same length', TOKEN.slice(0, -1) + 'x'],
      ['shorter', TOKEN.slice(0, 10)],
      ['longer', TOKEN + 'x'],
      ['empty', ''],
    ])('returns 401 for a wrong token (%s)', async (_label, token) => {
      const res = await postHook(VALID_HOOK, { [TOKEN_HEADER]: token });
      expect(res.statusCode).toBe(401);
      expect(store.recentEvents()).toEqual([]);
    });

    /**
     * Verifies that with no configured token every hook is refused
     */
    it('returns 401 for every request when the server has no token', async () => {
      await app.close();
      store.close();
      await start(null);
      for (const token of [TOKEN, '', 'null']) {
        const res = await postHook(VALID_HOOK, { [TOKEN_HEADER]: token });
        expect(res.statusCode).toBe(401);
      }
      expect(store.recentEvents()).toEqual([]);
    });

    /**
     * Verifies that a body failing the hook schema is rejected with 400 and ignored
     */
    it.each([
      ['missing session_id', { hook_event_name: 'Stop' }],
      ['empty session_id', { hook_event_name: 'Stop', session_id: '' }],
      ['missing event name', { session_id: CLI_A }],
      ['array body', []],
    ])('returns 400 for an invalid body (%s)', async (_label, body) => {
      const res = await postHook(body);
      expect(res.statusCode).toBe(400);
      expect(store.recentEvents()).toEqual([]);
    });

    /**
     * Verifies that a malformed JSON body is rejected with 400
     */
    it('returns 400 for malformed JSON', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hooks',
        headers: { ...HOST, [TOKEN_HEADER]: TOKEN, 'content-type': 'application/json' },
        payload: '{not json',
      });
      expect(res.statusCode).toBe(400);
      expect(store.recentEvents()).toEqual([]);
    });

    /**
     * Verifies that the token is checked before the body is validated
     */
    it('returns 401 rather than 400 for an invalid body without token', async () => {
      const res = await postHook({}, {});
      expect(res.statusCode).toBe(401);
    });
  });

  describe('host and origin guard', () => {
    /**
     * Verifies that foreign or default Host headers are refused with 403, even with a token
     */
    it.each([['evil.example:4777'], ['127.0.0.1:9999'], ['localhost:80'], ['192.168.1.10:4777']])(
      'returns 403 for host %s',
      async (host) => {
        const res = await app.inject({
          method: 'POST',
          url: '/hooks',
          headers: { host, [TOKEN_HEADER]: TOKEN },
          payload: VALID_HOOK,
        });
        expect(res.statusCode).toBe(403);
        expect(store.recentEvents()).toEqual([]);
      },
    );

    /**
     * Verifies that inject's default host (localhost:80) is refused
     */
    it('returns 403 without explicit host', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/environments' });
      expect(res.statusCode).toBe(403);
    });

    /**
     * Verifies that the server port and the Vite dev port are accepted, case-insensitively
     */
    it.each([['127.0.0.1:4777'], ['localhost:4777'], ['LOCALHOST:4777'], ['127.0.0.1:5173'], ['localhost:5173']])(
      'accepts host %s',
      async (host) => {
        const res = await app.inject({ method: 'GET', url: '/api/environments', headers: { host } });
        expect(res.statusCode).toBe(200);
      },
    );

    /**
     * Verifies that a foreign Origin header is refused with 403
     */
    it.each([['http://evil.example'], ['http://localhost:3000'], ['https://127.0.0.1:4777'], ['null']])(
      'returns 403 for origin %s',
      async (origin) => {
        const res = await app.inject({ method: 'POST', url: '/hooks', headers: { ...HOST, origin, [TOKEN_HEADER]: TOKEN }, payload: VALID_HOOK });
        expect(res.statusCode).toBe(403);
        expect(store.recentEvents()).toEqual([]);
      },
    );

    /**
     * Verifies that the local app and dev-server origins are accepted
     */
    it.each([['http://127.0.0.1:4777'], ['http://localhost:5173']])('accepts origin %s', async (origin) => {
      const res = await app.inject({ method: 'GET', url: '/api/events', headers: { ...HOST, origin } });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('read API', () => {
    /**
     * Verifies that GET /api/environments returns the environment list as JSON
     */
    it('GET /api/environments lists environments', async () => {
      store.ingestInventory(inventory({ desktopSessions: [desk()], live: [proc()] }));
      const res = await app.inject({ method: 'GET', url: '/api/environments', headers: HOST });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      const body = res.json() as { id: string; activeSessions: number }[];
      expect(body.map((e) => e.id)).toEqual(['env-alpha', 'env-alpha-api', 'env-beta']);
      expect(body[0]?.activeSessions).toBe(1);
    });

    /**
     * Verifies that GET /api/environments/:id returns the snapshot of that environment
     */
    it('GET /api/environments/:id returns its snapshot', async () => {
      store.ingestInventory(inventory({ desktopSessions: [desk()], live: [proc()] }));
      const res = await app.inject({ method: 'GET', url: `/api/environments/${ENV_ALPHA.id}`, headers: HOST });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ type: 'snapshot', envId: ENV_ALPHA.id, at: 1000 });
      expect(body.sessions).toHaveLength(1);
      expect(body.environments).toHaveLength(3);
    });

    /**
     * Verifies that an unknown environment id yields an empty snapshot, not an error
     */
    it('GET /api/environments/:id for an unknown env is empty', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/environments/env-unknown', headers: HOST });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ type: 'snapshot', envId: 'env-unknown', sessions: [] });
    });

    /**
     * Verifies that GET /api/events returns the recent hook summaries
     */
    it('GET /api/events returns recent events', async () => {
      await postHook(VALID_HOOK);
      const res = await app.inject({ method: 'GET', url: '/api/events', headers: HOST });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([
        { seq: 1, at: 1000, event: 'UserPromptSubmit', sessionId: `cli:${CLI_A}`, envId: null, detail: 'go' },
      ]);
    });

    /**
     * Verifies that the hook endpoint is not readable with GET
     */
    it('GET /hooks is not routed', async () => {
      // Only POST /hooks exists (its token check is attached to that route).
      const anon = await app.inject({ method: 'GET', url: '/hooks', headers: HOST });
      expect(anon.statusCode).toBe(404);
      const res = await app.inject({ method: 'GET', url: '/hooks', headers: { ...HOST, 'x-agent-office-token': TOKEN } });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('security hardening', () => {
    /** The token is checked before the body is parsed: malformed JSON without a token is a 401, not a 400. */
    it('rejects unauthenticated hooks before parsing the body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/hooks',
        headers: { ...HOST, 'content-type': 'application/json' },
        payload: '{not json',
      });
      expect(res.statusCode).toBe(401);
    });

    /** Alternative spellings the router maps to /hooks are authenticated too. */
    it.each(['/%68ooks', '/hooks#x', '/hooks?x=1', '/hooks/'])('requires the token on %s', async (url) => {
      const res = await app.inject({
        method: 'POST',
        url,
        headers: { ...HOST, 'content-type': 'application/json' },
        payload: VALID_HOOK,
      });
      expect([401, 404]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(200);
    });

    /** Every response forbids framing and MIME sniffing. */
    it('sends anti-framing and nosniff headers', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/environments', headers: HOST });
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });
});

describe('conversation routes', () => {
  const SESSION_ID = `cli:${CLI_A}`;
  const MAIN_ID = `${SESSION_ID}#main`;
  const SUB_ID = 'sub01';

  let store: OfficeStore;
  let app: FastifyInstance;
  let projectsDir: string;

  async function start(opts: { withProjects?: boolean } = {}) {
    const { withProjects = true } = opts;
    store = new OfficeStore(() => 1000);
    app = await buildApp({
      store,
      port: PORT,
      token: TOKEN,
      logger: false,
      projectsDir: withProjects ? projectsDir : undefined,
    });
    // A terminal session in C:/work/alpha with one Explore subagent.
    store.ingestHook(hook('UserPromptSubmit', { prompt: 'go' }));
    store.ingestHook(hook('SubagentStart', { agent_id: SUB_ID, agent_type: 'Explore' }));
  }

  async function restart(opts: { withProjects?: boolean }) {
    store.close();
    await app.close();
    await start(opts);
  }

  beforeEach(async () => {
    projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-app-'));
    await start();
  });

  afterEach(async () => {
    store.close();
    await app.close();
    fs.rmSync(projectsDir, { recursive: true, force: true });
  });

  function getTranscript(query: Record<string, string> | string, headers: Record<string, string> = {}) {
    const qs = typeof query === 'string' ? query : new URLSearchParams(query).toString();
    return app.inject({ method: 'GET', url: `/api/transcript?${qs}`, headers: { ...HOST, ...headers } });
  }

  function userLine(text: string): string {
    return JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
  }

  function writeTranscript(rel: string, lines: string[]): string {
    const file = path.join(projectsDir, projectDirName('C:/work/alpha'), rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.map((l) => l + '\n').join(''));
    return file;
  }

  describe('GET /api/transcript', () => {
    /**
     * Verifies that the conversation is readable without any sign-in or cookie
     */
    it('answers 200 without a cookie', async () => {
      writeTranscript(`${CLI_A}.jsonl`, [userLine('hello')]);
      const res = await getTranscript({ session: SESSION_ID, agent: MAIN_ID });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('hello');
    });

    /**
     * Verifies that the former sign-in routes no longer exist (API-only app, no webDist:
     * with a build, the SPA fallback serves index.html for GET /login, without a cookie)
     */
    it.each([
      ['GET', '/login?code=x'],
      ['POST', '/logout'],
    ] as const)('%s %s is a 404 without webDist', async (method, url) => {
      const res = await app.inject({ method, url, headers: HOST });
      expect(res.statusCode).toBe(404);
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    /**
     * Verifies that a foreign origin cannot read a conversation (cross-site fetch)
     */
    it('returns 403 for a foreign origin', async () => {
      writeTranscript(`${CLI_A}.jsonl`, [userLine('secret')]);
      const res = await getTranscript({ session: SESSION_ID, agent: MAIN_ID }, { origin: 'http://evil.example' });
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain('secret');
    });

    /**
     * Verifies that the host guard refuses a foreign host (DNS rebinding)
     */
    it('returns 403 for a foreign host', async () => {
      writeTranscript(`${CLI_A}.jsonl`, [userLine('secret')]);
      const res = await app.inject({
        method: 'GET',
        url: `/api/transcript?${new URLSearchParams({ session: SESSION_ID, agent: MAIN_ID })}`,
        headers: { host: 'evil.example:4777' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain('secret');
    });

    /**
     * Verifies that the latest page of the main transcript is returned with caching headers
     */
    it('returns the latest page of the main agent', async () => {
      writeTranscript(`${CLI_A}.jsonl`, [
        userLine('hello'),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi!' }, { type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } }] } }),
      ]);
      const res = await getTranscript({ session: SESSION_ID, agent: MAIN_ID });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers.etag).toMatch(new RegExp(`^"${CLI_A}-\\d+-\\d+"$`));
      const offset = Buffer.byteLength(userLine('hello')) + 1;
      expect(res.json()).toEqual({
        file: CLI_A,
        before: null,
        entries: [
          { key: '0:0', role: 'user', text: 'hello' },
          { key: `${offset}:0`, role: 'assistant', text: 'hi!' },
          { key: `${offset}:1`, role: 'tool', tool: 'Read', detail: 'a.ts' },
        ],
      });
    });

    /**
     * Verifies that a matching If-None-Match yields 304 until the transcript changes
     */
    it('answers 304 for an unchanged transcript and 200 once it grows', async () => {
      const file = writeTranscript(`${CLI_A}.jsonl`, [userLine('one')]);
      const first = await getTranscript({ session: SESSION_ID, agent: MAIN_ID });
      const etag = first.headers.etag as string;

      const same = await getTranscript({ session: SESSION_ID, agent: MAIN_ID }, { 'if-none-match': etag });
      expect(same.statusCode).toBe(304);
      expect(same.body).toBe('');

      fs.appendFileSync(file, userLine('two') + '\n');
      const grown = await getTranscript({ session: SESSION_ID, agent: MAIN_ID }, { 'if-none-match': etag });
      expect(grown.statusCode).toBe(200);
      expect(grown.headers.etag).not.toBe(etag);
      expect((grown.json() as { entries: { text: string }[] }).entries.map((e) => e.text)).toEqual(['one', 'two']);
    });

    /**
     * Verifies that a stale If-None-Match gets the full page
     */
    it('answers 200 for a non-matching If-None-Match', async () => {
      writeTranscript(`${CLI_A}.jsonl`, [userLine('one')]);
      const res = await getTranscript({ session: SESSION_ID, agent: MAIN_ID }, { 'if-none-match': '"other"' });
      expect(res.statusCode).toBe(200);
    });

    /**
     * Verifies that the before cursor pages back to the start, without an ETag on older pages
     */
    it('pages back with the before cursor', async () => {
      const texts = Array.from({ length: 60 }, (_, i) => `m${i}`);
      writeTranscript(`${CLI_A}.jsonl`, texts.map(userLine));

      const latest = await getTranscript({ session: SESSION_ID, agent: MAIN_ID });
      const page = latest.json() as { entries: { text: string }[]; before: number | null };
      expect(page.entries.map((e) => e.text)).toEqual(texts.slice(10));
      expect(typeof page.before).toBe('number');

      const older = await getTranscript({ session: SESSION_ID, agent: MAIN_ID, before: String(page.before) });
      expect(older.statusCode).toBe(200);
      expect(older.headers.etag).toBeUndefined();
      expect(older.headers['cache-control']).toBe('no-store');
      expect(older.json()).toMatchObject({ file: CLI_A, before: null });
      expect((older.json() as { entries: { text: string }[] }).entries.map((e) => e.text)).toEqual(texts.slice(0, 10));
    });

    /**
     * Verifies that an older page ignores If-None-Match and always answers 200
     */
    it('never answers 304 for an older page', async () => {
      writeTranscript(`${CLI_A}.jsonl`, [userLine('one')]);
      const etag = (await getTranscript({ session: SESSION_ID, agent: MAIN_ID })).headers.etag as string;
      const res = await getTranscript({ session: SESSION_ID, agent: MAIN_ID, before: '0' }, { 'if-none-match': etag });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ file: CLI_A, entries: [], before: null });
    });

    /**
     * Verifies that a known subagent's transcript is served
     */
    it("returns a subagent's transcript", async () => {
      writeTranscript(path.join(CLI_A, 'subagents', `agent-${SUB_ID}.jsonl`), [userLine('explore the repo')]);
      const res = await getTranscript({ session: SESSION_ID, agent: SUB_ID });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ file: `agent-${SUB_ID}`, entries: [{ role: 'user', text: 'explore the repo' }] });
    });

    /**
     * Verifies that a valid 15-digit cursor is accepted and clamped to the file
     */
    it('accepts a 15-digit cursor', async () => {
      writeTranscript(`${CLI_A}.jsonl`, [userLine('one')]);
      const res = await getTranscript({ session: SESSION_ID, agent: MAIN_ID, before: '999999999999999' });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { entries: unknown[] }).entries).toHaveLength(1);
    });

    /**
     * Verifies that missing, repeated or over-long ids and malformed cursors are rejected with 400
     */
    it.each([
      ['missing session', `agent=${encodeURIComponent(MAIN_ID)}`],
      ['missing agent', `session=${encodeURIComponent(SESSION_ID)}`],
      ['repeated session', `session=a&session=b&agent=x`],
      ['257-char session', `session=${'s'.repeat(257)}&agent=x`],
      ['257-char agent', `session=x&agent=${'a'.repeat(257)}`],
      ['letters in before', `session=x&agent=y&before=abc`],
      ['negative before', `session=x&agent=y&before=-1`],
      ['decimal before', `session=x&agent=y&before=1.5`],
      ['empty before', `session=x&agent=y&before=`],
      ['16-digit before', `session=x&agent=y&before=1234567890123456`],
    ])('returns 400 for %s', async (_label, qs) => {
      const res = await getTranscript(qs);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toHaveProperty('error');
    });

    /**
     * Verifies that 256-character ids pass validation and reach the session lookup
     */
    it('accepts 256-character ids (then 404 for an unknown session)', async () => {
      const res = await getTranscript({ session: 's'.repeat(256), agent: 'a'.repeat(256) });
      expect(res.statusCode).toBe(404);
    });

    /**
     * Verifies that 404 is returned when the session, agent or transcript file is missing
     */
    it.each([
      ['unknown session', { session: `cli:${CLI_B}`, agent: `cli:${CLI_B}#main` }],
      ['agent not in session', { session: SESSION_ID, agent: 'intruder' }],
      ['traversal agent id', { session: SESSION_ID, agent: '../../etc' }],
      ["other session's main", { session: SESSION_ID, agent: `cli:${CLI_B}#main` }],
    ])('returns 404 for %s', async (_label, query) => {
      writeTranscript(`${CLI_A}.jsonl`, [userLine('hello')]);
      writeTranscript(path.join(CLI_A, 'subagents', 'agent-intruder.jsonl'), [userLine('hidden')]);
      const res = await getTranscript(query);
      expect(res.statusCode).toBe(404);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).not.toContain('hidden');
    });

    /**
     * Verifies that a known session without a transcript file yet answers 404
     */
    it('returns 404 when the transcript does not exist yet', async () => {
      const res = await getTranscript({ session: SESSION_ID, agent: MAIN_ID });
      expect(res.statusCode).toBe(404);
    });

    /**
     * Verifies that without a projects folder no transcript is ever served
     */
    it('returns 404 when no projects folder is configured', async () => {
      writeTranscript(`${CLI_A}.jsonl`, [userLine('hello')]);
      await restart({ withProjects: false });
      const res = await getTranscript({ session: SESSION_ID, agent: MAIN_ID });
      expect(res.statusCode).toBe(404);
    });
  });
});
