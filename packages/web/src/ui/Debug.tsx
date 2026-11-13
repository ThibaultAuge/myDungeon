import { useEffect, useState } from 'react';
import type { HookEventSummary } from '@agent-office/shared';
import { loadEnvironments, useOffice } from '../store.ts';

/** Raw view used to validate the plumbing: environments and the live hook stream. */
export function Debug() {
  const environments = useOffice((s) => s.environments);
  const live = useOffice((s) => s.events);
  const [initial, setInitial] = useState<HookEventSummary[]>([]);
  useEffect(() => {
    void loadEnvironments();
    fetch('/api/events')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: HookEventSummary[]) => setInitial(list.reverse()))
      .catch(() => undefined);
  }, []);
  const seen = new Set(live.map((e) => e.seq));
  const events = [...live, ...initial.filter((e) => !seen.has(e.seq))];
  const envName = (id: string | null) => environments.find((e) => e.id === id)?.name ?? 'Hors environnement';

  return (
    <main className="debug">
      <h1>Debug</h1>
      <section aria-labelledby="dbg-env">
        <h2 id="dbg-env">Environnements</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">Nom</th>
              <th scope="col">Sessions en cours</th>
              <th scope="col">Dossiers</th>
            </tr>
          </thead>
          <tbody>
            {environments.map((e) => (
              <tr key={e.id}>
                <td>{e.name}</td>
                <td>{e.activeSessions}</td>
                <td className="path">{e.folders.join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section aria-labelledby="dbg-events">
        <h2 id="dbg-events">Flux des hooks ({events.length})</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">Heure</th>
              <th scope="col">Événement</th>
              <th scope="col">Environnement</th>
              <th scope="col">Session</th>
              <th scope="col">Agent</th>
              <th scope="col">Outil</th>
              <th scope="col">Détail</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.seq}>
                <td>{new Date(e.at).toLocaleTimeString('fr-FR')}</td>
                <td>{e.event}</td>
                <td>{envName(e.envId)}</td>
                <td className="path">{e.sessionId}</td>
                <td>{e.agentType ? `${e.agentType} (${e.agentId})` : 'principal'}</td>
                <td>{e.tool ?? ''}</td>
                <td>{e.detail ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
