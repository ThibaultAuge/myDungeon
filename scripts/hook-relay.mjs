#!/usr/bin/env node
// Claude Code hook relay (command hook, run with `async: true`).
// Forwards the hook payload from stdin to the local Agent Office server and IGNORES the response:
// it prints nothing and always exits 0, so whatever listens on the port can observe but never
// steer Claude Code (no permission decision, no injected context). One-way by construction.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TIMEOUT_MS = 1500;

function readEnv() {
  // Installed copy: ~/.claude/agent-office/hook-relay.mjs, with relay.env (token, port) beside it.
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'relay.env');
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) out[m[1]] = m[2];
    }
  } catch {
    /* not installed: nothing to relay */
  }
  return out;
}

function done() {
  process.exit(0);
}

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('error', done);
process.stdin.on('end', () => {
  // Same precedence as the server (packages/server/src/config.ts): process env, then relay.env.
  const file = readEnv();
  const token = process.env.AGENT_OFFICE_TOKEN ?? file.AGENT_OFFICE_TOKEN;
  const port = Number(process.env.AGENT_OFFICE_PORT ?? file.AGENT_OFFICE_PORT ?? 4777);
  if (!token || !Number.isInteger(port) || port < 1 || port > 65535) return done();
  const body = Buffer.concat(chunks);
  const req = http.request(
    {
      host: '127.0.0.1',
      port,
      path: '/hooks',
      method: 'POST',
      timeout: TIMEOUT_MS,
      headers: {
        'content-type': 'application/json',
        'content-length': body.length,
        'x-agent-office-token': token,
      },
    },
    (res) => {
      res.resume(); // response deliberately discarded
      res.on('end', done);
    },
  );
  req.on('timeout', () => req.destroy());
  req.on('error', done);
  req.end(body);
});
setTimeout(done, TIMEOUT_MS + 500).unref();
