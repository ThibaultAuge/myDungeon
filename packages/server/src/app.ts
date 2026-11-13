import crypto from 'node:crypto';
import fs from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { hookEventSchema } from './reducer.ts';
import type { OfficeStore } from './store.ts';

export const TOKEN_HEADER = 'x-agent-office-token';
/** Vite dev server ports allowed as browser origins. */
const DEV_PORTS = [5173];

export interface AppOptions {
  store: OfficeStore;
  port: number;
  token: string | null;
  webDist?: string;
  logger?: boolean;
}

function tokenMatches(expected: string | null, received: unknown): boolean {
  if (!expected || typeof received !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Hosts this server answers to. Anything else is refused (DNS-rebinding guard). */
function allowedHosts(port: number): Set<string> {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`, ...DEV_PORTS.flatMap((p) => [`127.0.0.1:${p}`, `localhost:${p}`])]);
}

function allowedOrigins(port: number): Set<string> {
  return new Set([...allowedHosts(port)].map((h) => `http://${h}`));
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  // Write/Edit inputs can be large; the reducer keeps 200 characters of them anyway.
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 5 * 1024 * 1024 });
  const hosts = allowedHosts(opts.port);
  const origins = allowedOrigins(opts.port);

  app.addHook('onRequest', async (req, reply) => {
    if (!hosts.has(String(req.headers.host ?? '').toLowerCase())) {
      return reply.code(403).send({ error: 'host refusé' });
    }
    const origin = req.headers.origin;
    if (origin && !origins.has(origin.toLowerCase())) {
      return reply.code(403).send({ error: 'origine refusée' });
    }
  });

  // The UI must never be framed (clickjacking, decisive once approvals exist) nor sniffed.
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Content-Security-Policy', "frame-ancestors 'none'");
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    return payload;
  });

  await app.register(fastifyWebsocket);

  // Claude Code hooks (via scripts/hook-relay.mjs, which discards the answer).
  // The token is checked by a route-level onRequest: it runs for whatever URL spelling the router
  // matched to this route (`/%68ooks`, `/hooks#x`…) and before the body is buffered and parsed.
  const requireToken = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!tokenMatches(opts.token, req.headers[TOKEN_HEADER])) {
      return reply.code(401).send({ error: 'jeton invalide' });
    }
  };
  app.post('/hooks', { onRequest: requireToken }, async (req, reply) => {
    const parsed = hookEventSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'payload de hook invalide' });
    opts.store.ingestHook(parsed.data);
    return {};
  });

  app.get('/api/environments', async () => {
    const snap = opts.store.snapshot('__none__');
    return snap.type === 'snapshot' ? snap.environments : [];
  });

  app.get<{ Params: { id: string } }>('/api/environments/:id', async (req) => opts.store.snapshot(req.params.id));

  app.get('/api/events', async () => opts.store.recentEvents());

  app.get<{ Querystring: { env?: string } }>('/ws', { websocket: true }, (socket, req) => {
    const envId = typeof req.query.env === 'string' && req.query.env.length > 0 ? req.query.env : null;
    const unsubscribe = opts.store.subscribe({
      envId,
      send: (msg) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
      },
    });
    socket.on('close', unsubscribe);
    socket.on('error', unsubscribe);
  });

  if (opts.webDist && fs.existsSync(opts.webDist)) {
    // wildcard: files are looked up at request time, so a rebuild (new hashed names) needs no restart.
    await app.register(fastifyStatic, { root: opts.webDist, wildcard: true });
    // Single-page app: every unknown page GET serves index.html; a missing asset stays a 404.
    app.setNotFoundHandler((req, reply) => {
      const url = req.url;
      if (req.method === 'GET' && !url.startsWith('/api') && !url.startsWith('/hooks') && !url.startsWith('/assets/')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'introuvable' });
    });
  }

  return app;
}
