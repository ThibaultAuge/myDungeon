import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** Token and port, shared with the installed hook relay (see scripts/hooks-lib.mjs). In the user's profile. */
export const ENV_FILE =
  process.env.AGENT_OFFICE_RELAY_DIR !== undefined
    ? path.join(process.env.AGENT_OFFICE_RELAY_DIR, 'relay.env')
    : path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'agent-office', 'relay.env');
export const WEB_DIST = path.join(REPO_ROOT, 'packages', 'web', 'dist');

/** Reads `KEY=VALUE` lines from `relay.env` (written by scripts/install-hooks.mjs). */
export function readEnvFile(file = ENV_FILE): Record<string, string> {
  const out: Record<string, string> = {};
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export interface ServerConfig {
  port: number;
  /** Shared secret the hooks send in `X-Agent-Office-Token`. Null: hooks are refused. */
  token: string | null;
}

export function loadConfig(): ServerConfig {
  const file = readEnvFile();
  const port = Number(process.env.AGENT_OFFICE_PORT ?? file.AGENT_OFFICE_PORT ?? 4777);
  const token = process.env.AGENT_OFFICE_TOKEN ?? file.AGENT_OFFICE_TOKEN ?? null;
  return { port: Number.isInteger(port) && port > 0 ? port : 4777, token: token && token.length >= 32 ? token : null };
}
