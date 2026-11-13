import { useEffect, type ReactNode } from 'react';
import { connect, loadEnvironments, useOffice } from './store.ts';
import { OfficeScene } from './scene/Office.tsx';
import { AgentPanel } from './ui/AgentPanel.tsx';
import { EnvSwitcher } from './ui/EnvSwitcher.tsx';
import { History } from './ui/History.tsx';
import { SessionList } from './ui/SessionList.tsx';
import { Debug } from './ui/Debug.tsx';
import { StatusAnnouncer } from './ui/StatusAnnouncer.tsx';
import { STATE_COLORS } from './format.ts';

function Header({ children }: { children?: ReactNode }) {
  const connected = useOffice((s) => s.connected);
  const navigate = useOffice((s) => s.navigate);
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
        {connected ? 'Connecté' : 'Serveur injoignable, nouvelle tentative…'}
      </span>
    </header>
  );
}

function Home() {
  const environments = useOffice((s) => s.environments);
  const navigate = useOffice((s) => s.navigate);
  useEffect(() => {
    void loadEnvironments();
  }, []);
  return (
    <>
      <Header />
      <main className="home">
        <h1>Choisis une entreprise</h1>
        <p className="muted">Chaque environnement de l’app Claude est un bureau, avec ses sessions et ses agents.</p>
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
                <span className="env-card__name">{e.name}</span>
                <span className="muted">{e.activeSessions > 0 ? `${e.activeSessions} session(s) en cours` : 'Au calme'}</span>
                {e.folders[0] && <span className="path">{e.folders[0]}</span>}
              </a>
            </li>
          ))}
        </ul>
        {environments.length === 0 && <p className="muted">Aucun environnement trouvé. Le serveur tourne-t-il ?</p>}
      </main>
    </>
  );
}

function Legend() {
  return (
    <ul className="legend" aria-label="Légende">
      <li>
        <span className="dot" style={{ background: STATE_COLORS.working }} aria-hidden="true" /> Travaille
      </li>
      <li>
        <span className="dot" style={{ background: STATE_COLORS.waiting }} aria-hidden="true" /> Attend ton message
      </li>
      <li>
        <span className="dot" style={{ background: '#E24B4A' }} aria-hidden="true" /> Attend ta permission ou ta réponse
      </li>
      <li>
        <span className="dot" style={{ background: STATE_COLORS.done }} aria-hidden="true" /> Terminé
      </li>
    </ul>
  );
}

function EnvPage({ envId }: { envId: string }) {
  const sessions = useOffice((s) => s.sessions);
  const environments = useOffice((s) => s.environments);
  const env = environments.find((e) => e.id === envId);
  useEffect(() => {
    document.title = env ? `${env.name} · Agent Office` : 'Agent Office';
    return () => {
      document.title = 'Agent Office';
    };
  }, [env]);
  return (
    <>
      <Header>
        <EnvSwitcher envId={envId} />
      </Header>
      <main className="office">
        <h1 className="sr-only">Bureau {env?.name ?? ''}</h1>
        <div className="office__scene">
          <div className="office__canvas" role="img" aria-label="Vue 3D du bureau. La même information est disponible dans la liste des sessions.">
            <OfficeScene />
          </div>
          <Legend />
        </div>
        <aside className="office__side" aria-label="Détail des agents">
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
