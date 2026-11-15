// Shared helpers for install-hooks.mjs and uninstall-hooks.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Claude Code reads its config from CLAUDE_CONFIG_DIR when set, ~/.claude otherwise. */
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
export const SETTINGS_FILE = process.env.AGENT_OFFICE_SETTINGS ?? path.join(CLAUDE_DIR, 'settings.json');
/**
 * The relay runs as the user on every hook of every session, so it is installed in the user's
 * profile (owner-only by default), never run from the repository, whose folder may be writable by
 * other local accounts. Its token and port live next to it.
 */
export const RELAY_DIR = process.env.AGENT_OFFICE_RELAY_DIR ?? path.join(CLAUDE_DIR, 'agent-office');
export const RELAY_SCRIPT = path.join(RELAY_DIR, 'hook-relay.mjs');
export const ENV_FILE = path.join(RELAY_DIR, 'relay.env');
const RELAY_SOURCE = path.join(REPO_ROOT, 'scripts', 'hook-relay.mjs');

/** Copies the relay into the profile folder. */
export function installRelay() {
  fs.mkdirSync(RELAY_DIR, { recursive: true });
  fs.copyFileSync(RELAY_SOURCE, RELAY_SCRIPT);
  return RELAY_SCRIPT;
}

/** Removes the profile folder (relay and its token). */
export function removeRelay() {
  fs.rmSync(RELAY_DIR, { recursive: true, force: true });
}
const RELAY_MARKER = 'hook-relay.mjs';
/** Header of the first, HTTP-based install: still recognised so uninstall cleans it. */
const LEGACY_TOKEN_HEADER = 'X-Agent-Office-Token';

/** Hook events the office listens to. Observation only. */
export const EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Notification',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'StopFailure',
  // Context compaction: the agent drinks the potion of oblivion (packages/web/src/scene/potion.ts).
  'PreCompact',
];

/** Shell command Claude Code runs (Git Bash or PowerShell on Windows): forward slashes, quoted path. */
export function relayCommand(relayPath = RELAY_SCRIPT) {
  // The path is placed inside double quotes in a shell command: refuse anything a shell would expand.
  if (/[`$"!]/.test(relayPath)) throw new Error(`chemin du relais refusé (caractère spécial) : ${relayPath}`);
  return `node "${relayPath.replace(/\\/g, '/')}"`;
}

/** A handler belongs to Agent Office if it runs our relay (or is a legacy HTTP handler with our header). */
export function isOurs(handler) {
  if (!handler || typeof handler !== 'object') return false;
  if (handler.type === 'command' && typeof handler.command === 'string') return handler.command.includes(RELAY_MARKER);
  return Boolean(handler.type === 'http' && handler.headers && LEGACY_TOKEN_HEADER in handler.headers);
}

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

export function readSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return {};
  const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  if (!isPlainObject(parsed)) throw new Error('settings.json ne contient pas un objet JSON');
  return parsed;
}

export function backupSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${SETTINGS_FILE}.agent-office-${stamp}.bak`;
  fs.copyFileSync(SETTINGS_FILE, backup);
  return backup;
}

/** Atomic write: a crash mid-write can never leave a truncated global settings file. */
export function writeSettings(settings) {
  // Follow a symlinked settings.json (dotfiles) so the link itself is never replaced.
  const target = fs.existsSync(SETTINGS_FILE) ? fs.realpathSync(SETTINGS_FILE) : SETTINGS_FILE;
  const tmp = `${target}.agent-office.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  try {
    fs.renameSync(tmp, target);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`écriture de ${target} impossible (fichier verrouillé ?) : ${err.message}`);
  }
}

/**
 * Removes every Agent Office handler, then the groups and events that only held ours, and an
 * empty `hooks` key. Values we do not understand (non-array events) are left untouched.
 */
export function stripOurs(settings) {
  const hooks = settings.hooks;
  if (!isPlainObject(hooks)) return settings;
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    const touched = groups.some((g) => Array.isArray(g?.hooks) && g.hooks.some(isOurs));
    if (!touched) continue;
    const kept = groups
      .map((g) => (Array.isArray(g?.hooks) ? { ...g, hooks: g.hooks.filter((h) => !isOurs(h)) } : g))
      .filter((g) => !Array.isArray(g?.hooks) || g.hooks.length > 0);
    if (kept.length > 0) hooks[event] = kept;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks;
  return settings;
}

/**
 * Installs one async command hook per event. The relay discards the server's answer, so the
 * hook channel is one-way: whoever listens on the port can never return a decision.
 */
export function addOurs(settings, { relayPath = RELAY_SCRIPT } = {}) {
  stripOurs(settings);
  if (!isPlainObject(settings.hooks)) settings.hooks = {};
  for (const event of EVENTS) {
    const handler = { type: 'command', command: relayCommand(relayPath), async: true, timeout: 5 };
    const existing = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    settings.hooks[event] = [...existing, { hooks: [handler] }];
  }
  return settings;
}

export function readEnvFile() {
  const out = {};
  if (!fs.existsSync(ENV_FILE)) return out;
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export function writeEnvFile(values) {
  const text = Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  fs.writeFileSync(ENV_FILE, text + '\n', { encoding: 'utf8', mode: 0o600 });
}
