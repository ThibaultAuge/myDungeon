// Type declarations for hooks-lib.mjs, so TypeScript tests can import it with types.

export interface HookHandler {
  type: string;
  url?: string;
  command?: string;
  timeout?: number;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export interface HookGroup {
  matcher?: string;
  hooks?: HookHandler[];
  [key: string]: unknown;
}

export interface ClaudeSettings {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

export declare const REPO_ROOT: string;
export declare const ENV_FILE: string;
export declare const SETTINGS_FILE: string;
export declare const RELAY_SCRIPT: string;
export declare const RELAY_DIR: string;
export declare function installRelay(): string;
export declare function removeRelay(): void;
export declare const EVENTS: string[];

export declare function relayCommand(relayPath?: string): string;
export declare function isOurs(handler: unknown): boolean;
export declare function readSettings(): ClaudeSettings;
export declare function backupSettings(): string | null;
export declare function writeSettings(settings: ClaudeSettings): void;
/** Mutates and returns `settings`. */
export declare function stripOurs(settings: ClaudeSettings): ClaudeSettings;
/** Mutates and returns `settings`. */
export declare function addOurs(settings: ClaudeSettings, opts?: { relayPath?: string }): ClaudeSettings;
export declare function readEnvFile(): Record<string, string>;
export declare function writeEnvFile(values: Record<string, string>): void;
