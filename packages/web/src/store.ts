import { create } from 'zustand';
import type { EnvironmentView, HookEventSummary, ServerMessage, SessionView } from '@agent-office/shared';
import { initialLang, saveLang, type Lang } from './i18n/index.ts';

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

/** `/login` redirects to `/?login=failed` on a wrong or expired code: noted, then removed from the URL. */
function takeLoginFailed(): boolean {
  const params = new URLSearchParams(location.search);
  if (params.get('login') !== 'failed') return false;
  params.delete('login');
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
  return true;
}
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
  /** The conversation box of the selected agent. Selecting an agent opens it. */
  dialogOpen: boolean;
  /** The last sign-in link was wrong or expired. */
  loginFailed: boolean;
  lang: Lang;
  navigate(r: Route): void;
  select(agentId: string | null): void;
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
  dialogOpen: false,
  loginFailed: takeLoginFailed(),
  lang: startLang,
  navigate(r) {
    history.pushState(null, '', routePath(r));
    set({ route: r, sessions: [], roster: [], snapshotReceived: false, selectedAgentId: null });
    connect();
  },
  select(agentId) {
    set({ selectedAgentId: agentId, dialogOpen: agentId !== null });
  },
  closeDialog() {
    set({ dialogOpen: false });
  },
  setLang(lang) {
    document.documentElement.lang = lang;
    saveLang(browserStorage(), lang);
    set({ lang });
  },
}));

window.addEventListener('popstate', () => {
  useOffice.setState({
    route: parseRoute(location.pathname),
    sessions: [],
    roster: [],
    snapshotReceived: false,
    selectedAgentId: null,
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
      selected !== null && msg.sessions.some((s) => s.main.id === selected || s.subagents.some((a) => a.id === selected));
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
