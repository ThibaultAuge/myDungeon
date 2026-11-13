import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ClaudePaths {
  /** `~/.claude` */
  claudeHome: string;
  /** `~/.claude/sessions`: one `<pid>.json` per live Claude Code process. */
  liveDir: string;
  /** `%LOCALAPPDATA%\Claude-Data\claude_<id>` of the desktop app, if found. */
  desktopData: string | null;
  /** `ccd-session-presets.json` (environments). */
  presetsFile: string | null;
  /** `claude-code-sessions/<acct>/<org>` folders that hold `local_*.json` files. */
  sessionDirs: string[];
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function subdirs(p: string): string[] {
  try {
    return fs
      .readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(p, d.name));
  } catch {
    return [];
  }
}

/** Finds the desktop data folder: the `claude_*` folder that holds the presets file. */
function findDesktopData(): string | null {
  const override = process.env.AGENT_OFFICE_DESKTOP_DATA;
  if (override) return isDir(override) ? override : null;
  const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  const root = path.join(local, 'Claude-Data');
  const candidates = subdirs(root).filter((d) => fs.existsSync(path.join(d, 'ccd-session-presets.json')));
  if (candidates.length === 0) return null;
  // Most recently modified presets file wins when several app profiles exist.
  const mtime = (d: string) => {
    try {
      return fs.statSync(path.join(d, 'ccd-session-presets.json')).mtimeMs;
    } catch {
      return 0;
    }
  };
  candidates.sort((a, b) => mtime(b) - mtime(a));
  return candidates[0];
}

export function resolvePaths(): ClaudePaths {
  // Same lookup as Claude Code itself: CLAUDE_CONFIG_DIR, else ~/.claude.
  const claudeHome = process.env.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.claude');
  const desktopData = findDesktopData();
  const sessionDirs: string[] = [];
  if (desktopData) {
    for (const acct of subdirs(path.join(desktopData, 'claude-code-sessions'))) {
      for (const org of subdirs(acct)) {
        try {
          if (fs.readdirSync(org).some((f) => /^local_.*\.json$/.test(f))) sessionDirs.push(org);
        } catch {
          /* unreadable folder: skip */
        }
      }
    }
  }
  return {
    claudeHome,
    liveDir: path.join(claudeHome, 'sessions'),
    desktopData,
    presetsFile: desktopData ? path.join(desktopData, 'ccd-session-presets.json') : null,
    sessionDirs,
  };
}
