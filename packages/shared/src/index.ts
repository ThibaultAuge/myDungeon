// Types shared by the server and the web client. Type-only module: import it with `import type`.

/** The places of the dungeon. See docs/lieux-et-personnages.md. */
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
  | { type: 'snapshot'; envId: string; sessions: SessionView[]; environments: EnvironmentView[]; at: number }
  | { type: 'event'; event: HookEventSummary };
