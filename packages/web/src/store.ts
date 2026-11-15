import { create } from 'zustand';
import { NO_ENV_ID, type EnvironmentView, type HookEventSummary, type ServerMessage, type SessionView } from '@agent-office/shared';
import { initialLang, saveLang, type Lang } from './i18n/index.ts';
import type { PostId } from './scene/layout.ts';
import { celebrate } from './scene/celebrate.ts';
import { drinkPotion, installPotionCommand, potionTarget } from './scene/potion.ts';
import { installMishapCommands } from './scene/mishap.ts';
import { isRestId, restType } from './scene/tavern.ts';

export type Route = { page: 'home' } | { page: 'env'; envId: string } | { page: 'debug' };

export function parseRoute(pathname: string): Route {
  const m = /^\/env\/([^/]+)\/?$/.exec(pathname);
  if (m) return { page: 'env', envId: decodeURIComponent(m[1]) };
  if (pathname.startsWith('/debug')) return { page: 'debug' };
  return { page: 'home' };
}

export function routePath(r: Route): string {
  if (r.page === 'env') return `/env/${encodeURIComponent(r.envId)}`;
  if (r.page === 'debug') return '/debug';
  return '/';
}

const MAX_EVENTS = 150;

/** `localStorage` itself throws when site data is blocked. */
function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

const startLang = initialLang(browserStorage(), navigator);

document.documentElement.lang = startLang;

interface OfficeStore {
  route: Route;
  connected: boolean;
  environments: EnvironmentView[];
  sessions: SessionView[];
  /** Agent types resting in the tavern of the shown environment. */
  roster: string[];
  /** True once a snapshot for the current route arrived; reset on every route change. */
  snapshotReceived: boolean;
  /** Server clock of the last snapshot, to compute elapsed times without client clock drift. */
  serverOffset: number;
  events: HookEventSummary[];
  selectedAgentId: string | null;
  /** Workstation whose card is open. */
  selectedPost: PostId | null;
  /** The conversation box of the selected agent. Selecting an agent opens it. */
  dialogOpen: boolean;
  lang: Lang;
  navigate(r: Route): void;
  select(agentId: string | null): void;
  selectPost(post: PostId | null): void;
  closeDialog(): void;
  setLang(lang: Lang): void;
}

export const useOffice = create<OfficeStore>((set) => ({
  route: parseRoute(location.pathname),
  connected: false,
  environments: [],
  sessions: [],
  roster: [],
  snapshotReceived: false,
  serverOffset: 0,
  events: [],
  selectedAgentId: null,
  selectedPost: null,
  dialogOpen: false,
  lang: startLang,
  navigate(r) {
    history.pushState(null, '', routePath(r));
    set({ route: r, sessions: [], roster: [], snapshotReceived: false, selectedAgentId: null, selectedPost: null });
    connect();
  },
  select(agentId) {
    // A resting figure has no conversation: only its short introduction card opens.
    set({ selectedAgentId: agentId, dialogOpen: agentId !== null && !isRestId(agentId) });
  },
  closeDialog() {
    set({ dialogOpen: false });
  },
  selectPost(post) {
    set({ selectedPost: post });
  },
  setLang(lang) {
    document.documentElement.lang = lang;
    saveLang(browserStorage(), lang);
    set({ lang });
  },
}));

// Test command in the console: `agentOffice.potion()` (selected agent) or `agentOffice.potion(id)`.
installPotionCommand(() => useOffice.getState().selectedAgentId, window);
// Same for the mishaps: `agentOffice.boiler(id?)` and `agentOffice.flask(id?)`.
installMishapCommands(() => useOffice.getState().selectedAgentId, window);

window.addEventListener('popstate', () => {
  useOffice.setState({
    route: parseRoute(location.pathname),
    sessions: [],
    roster: [],
    snapshotReceived: false,
    selectedAgentId: null,
    selectedPost: null,
  });
  connect();
});

let socket: WebSocket | null = null;
let retry: number | undefined;
let backoff = 1000;

function onMessage(msg: ServerMessage): void {
  if (msg.type === 'snapshot') {
    const route = useOffice.getState().route;
    if (route.page === 'env' && route.envId !== msg.envId) return;
    const selected = useOffice.getState().selectedAgentId;
    const stillThere =
      selected !== null &&
      (isRestId(selected)
        ? restType(selected, msg.roster ?? []) !== undefined
        : msg.sessions.some((s) => s.main.id === selected || s.subagents.some((a) => a.id === selected)));
    useOffice.setState({
      sessions: msg.sessions,
      environments: msg.environments,
      roster: msg.roster ?? [],
      snapshotReceived: true,
      serverOffset: msg.at - Date.now(),
      selectedAgentId: stillThere ? selected : null,
    });
  } else if (msg.type === 'event') {
    useOffice.setState((s) => ({ events: [msg.event, ...s.events].slice(0, MAX_EVENTS) }));
    const route = useOffice.getState().route;
    if (route.page === 'env' && (msg.event.envId ?? NO_ENV_ID) === route.envId) {
      for (const kind of msg.event.celebrations ?? []) celebrate(kind);
    }
    // Context compaction: the agent drinks the potion of oblivion (a purely visual gag).
    const drinker = potionTarget(msg.event, useOffice.getState().sessions);
    if (drinker) drinkPotion(drinker);
  }
}

/** (Re)connects the WebSocket for the current route. Snapshots replace the whole state, so a reconnect is a full resync. */
export function connect(): void {
  window.clearTimeout(retry);
  if (socket) {
    socket.onclose = null;
    socket.close();
  }
  const route = useOffice.getState().route;
  const env = route.page === 'env' ? `?env=${encodeURIComponent(route.envId)}` : '';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws${env}`);
  socket = ws;
  ws.onopen = () => {
    backoff = 1000;
    useOffice.setState({ connected: true });
  };
  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data as string) as ServerMessage);
    } catch {
      /* ignore malformed frame */
    }
  };
  ws.onclose = () => {
    useOffice.setState({ connected: false });
    retry = window.setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 8000);
  };
}

export async function loadEnvironments(): Promise<void> {
  try {
    const res = await fetch('/api/environments');
    if (res.ok) useOffice.setState({ environments: (await res.json()) as EnvironmentView[] });
  } catch {
    /* server down: the WebSocket retry loop will report it */
  }
}
