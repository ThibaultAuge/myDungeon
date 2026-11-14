// Types shared by the server and the web client. Type-only module: import it with `import type`.

/** The places of the dungeon. See docs/lieux.md. */
export type RoomId =
  | 'autel'
  | 'cartes'
  | 'atelier'
  | 'biblio'
  | 'scriptorium'
  | 'observatoire'
  | 'pigeonnier'
  | 'machines'
  | 'arithmetique'
  | 'garde'
  | 'epreuves'
  | 'heraut'
  | 'detente'
  | 'concierge'
  | 'taverne';

export type AgentState = 'working' | 'waiting' | 'done';

/** Why an agent waits for the human. */
export type WaitReason = 'permission' | 'question' | 'prompt' | 'error';

export interface AgentView {
  id: string;
  sessionId: string;
  kind: 'main' | 'sub';
  /** Subagent type (Explore, dexter…) or "Session principale". */
  agentType: string;
  description?: string;
  state: AgentState;
  waitReason?: WaitReason;
  room: RoomId;
  tool?: string;
  toolDetail?: string;
  /** Epoch ms of the last state change. */
  since: number;
  lastMessage?: string;
}

export type SessionOrigin = 'desktop' | 'cli';

/**
 * Working context of a session. Every field is raw data (ids, names, counts), never a
 * display string: the client translates the labels and falls back to the raw value.
 */
export interface SessionInfo {
  /** Absent when the session does not run in a git worktree. */
  worktree?: { name: string };
  branch?: string;
  /** Branch the worktree was cut from. */
  sourceBranch?: string;
  /** Model id, e.g. `claude-opus-5-5`. */
  model?: string;
  /** Raw effort level (`low`, `medium`…). */
  effort?: string;
  /** Raw permission mode (`default`, `auto`, `plan`…). */
  permissionMode?: string;
  completedTurns?: number;
  /** Claude Code version of the live process. */
  cliVersion?: string;
}

/** A TCP port listening on this machine, attributed to a session. */
export interface ListeningServer {
  port: number;
  /** Executable name of the listening process (`node`, `python`…), never its command line. */
  process?: string;
}

export interface SessionView {
  /** Desktop `local_…` id, or `cli:<cliSessionId>` for a terminal session. */
  id: string;
  origin: SessionOrigin;
  cliSessionIds: string[];
  envId: string | null;
  /** Null when the app has not titled a desktop session, or a terminal session has no name nor folder: the client shows a translated placeholder. */
  title: string | null;
  cwd: string;
  /** True while a Claude Code process runs it. */
  live: boolean;
  archived: boolean;
  createdAt: number;
  lastActivityAt: number;
  parent?: { sessionId: string; title?: string };
  info: SessionInfo;
  /** Web servers the session started, refreshed every few seconds; empty when none or ended. */
  servers: ListeningServer[];
  main: AgentView;
  subagents: AgentView[];
}

export interface EnvironmentView {
  id: string;
  name: string;
  folders: string[];
  /** Virtual environment holding sessions that match no preset. Its `name` is a French placeholder: the client translates it. */
  virtual?: boolean;
  activeSessions: number;
}

export interface HookEventSummary {
  /** Server-side sequence number, unique per server run. */
  seq: number;
  at: number;
  event: string;
  sessionId: string;
  envId: string | null;
  agentId?: string;
  agentType?: string;
  tool?: string;
  detail?: string;
}

export const NO_ENV_ID = 'hors-environnement';

export type ServerMessage =
  | {
      type: 'snapshot';
      envId: string;
      sessions: SessionView[];
      environments: EnvironmentView[];
      /** Agent types resting in the tavern, one figure each when none of them works. */
      roster: string[];
      at: number;
    }
  | { type: 'event'; event: HookEventSummary };

/** One line of an agent's conversation, as shown in the dialogue box. Text is never HTML. */
export type DialogueEntry =
  | {
      /** Stable within one transcript file: `<line byte offset>:<block index>`. */
      key: string;
      /** Epoch ms, when the transcript gives one. */
      at?: number;
      role: 'user' | 'assistant';
      text: string;
      /** True when the text was cut by the server. */
      truncated?: boolean;
    }
  | { key: string; at?: number; role: 'tool'; tool: string; detail?: string };

/** A page of a transcript, oldest entry first. */
export interface TranscriptPage {
  /** Identifies the transcript file (not a path): a change means another file, start over. */
  file: string;
  entries: DialogueEntry[];
  /** Cursor for the previous (older) page, or null at the start of the file. */
  before: number | null;
}
