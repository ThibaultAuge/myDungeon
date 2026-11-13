import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TOKEN_HEADER, buildApp } from '../src/app.ts';
import { OfficeStore } from '../src/store.ts';
import { CLI_A, ENV_ALPHA, desk, inventory, proc } from './fixtures/builders.ts';

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
