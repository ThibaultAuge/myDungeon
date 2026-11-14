import { useEffect, type ReactNode } from 'react';
import { connect, loadEnvironments, useOffice } from './store.ts';
import { OfficeScene } from './scene/Office.tsx';
import { AgentDialog } from './ui/AgentDialog.tsx';
import { AgentPanel } from './ui/AgentPanel.tsx';
import { EnvSwitcher } from './ui/EnvSwitcher.tsx';
import { History } from './ui/History.tsx';
import { SessionList } from './ui/SessionList.tsx';
import { Debug } from './ui/Debug.tsx';
import { StatusAnnouncer } from './ui/StatusAnnouncer.tsx';
import { LangSwitcher } from './ui/LangSwitcher.tsx';
import { envName } from './format.ts';
import { StatusIcon } from './ui/StatusIcon.tsx';
import { useT } from './i18n/useT.ts';

function Header({ children }: { children?: ReactNode }) {
  const connected = useOffice((s) => s.connected);
  const navigate = useOffice((s) => s.navigate);
  const { t } = useT();
  return (
    <header className="topbar">
      <a
        href="/"
        className="brand"
        onClick={(e) => {
          e.preventDefault();
          navigate({ page: 'home' });
        }}
      >
        Agent Office
      </a>
      {children}
      <span className={`conn ${connected ? 'conn--ok' : 'conn--ko'}`} role="status">
        {connected ? t.conn.ok : t.conn.ko}
      </span>
      <LangSwitcher />
    </header>
  );
}

function Home() {
  const environments = useOffice((s) => s.environments);
  const navigate = useOffice((s) => s.navigate);
  const { t } = useT();
  useEffect(() => {
    void loadEnvironments();
  }, []);
  return (
    <>
      <Header />
      <main className="home">
        <h1>{t.home.title}</h1>
        <p className="muted">{t.home.intro}</p>
        <ul className="env-grid">
          {environments.map((e) => (
            <li key={e.id}>
              <a
                href={`/env/${encodeURIComponent(e.id)}`}
                className="env-card"
                onClick={(ev) => {
                  ev.preventDefault();
                  navigate({ page: 'env', envId: e.id });
                }}
              >
                <span className="env-card__name">{envName(e, t)}</span>
                <span className="muted">{e.activeSessions > 0 ? t.home.activeSessions(e.activeSessions) : t.home.quiet}</span>
                {e.folders[0] && <span className="path">{e.folders[0]}</span>}
              </a>
            </li>
          ))}
        </ul>
        {environments.length === 0 && <p className="muted">{t.home.empty}</p>}
      </main>
    </>
  );
}

function Legend() {
  const { t } = useT();
  return (
    <ul className="legend" role="list" aria-label={t.legend.label}>
      <li>
        <StatusIcon kind="working" /> {t.legend.working}
      </li>
      <li>
        <StatusIcon kind="prompt" /> {t.legend.waitingPrompt}
      </li>
      <li>
        <StatusIcon kind="urgent" /> {t.legend.urgent}
      </li>
      <li>
        <StatusIcon kind="done" /> {t.legend.done}
      </li>
    </ul>
  );
}

function EnvPage({ envId }: { envId: string }) {
  const sessions = useOffice((s) => s.sessions);
  const environments = useOffice((s) => s.environments);
  const env = environments.find((e) => e.id === envId);
  const { t } = useT();
  const name = env ? envName(env, t) : '';
  useEffect(() => {
    document.title = name ? `${name} · Agent Office` : 'Agent Office';
    return () => {
      document.title = 'Agent Office';
    };
  }, [name]);
  return (
    <>
      <Header>
        <EnvSwitcher envId={envId} />
      </Header>
      <main className="office">
        <h1 className="sr-only">{t.office.heading(name || t.env.unknown)}</h1>
        <div className="office__scene">
          <div className="office__canvas" role="img" aria-label={t.office.canvas}>
            <OfficeScene />
          </div>
          <Legend />
          <AgentDialog sessions={sessions} />
        </div>
        {/* Focusable: the panel scrolls, and keyboard users must be able to scroll it. */}
        <aside className="office__side" aria-label={t.office.side} tabIndex={0}>
          <StatusAnnouncer sessions={sessions} />
          <AgentPanel sessions={sessions} />
          <SessionList sessions={sessions} />
          <History sessions={sessions} />
        </aside>
      </main>
    </>
  );
}

export function App() {
  const route = useOffice((s) => s.route);
  useEffect(() => {
    connect();
  }, []);
  if (route.page === 'env') return <EnvPage envId={route.envId} />;
  if (route.page === 'debug') {
    document.title = 'Debug · Agent Office';
    return (
      <>
        <Header />
        <Debug />
      </>
    );
  }
  document.title = 'Agent Office';
  return <Home />;
}
