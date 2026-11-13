import { useEffect, useState } from 'react';
import type { HookEventSummary } from '@agent-office/shared';
import { envName as displayEnvName } from '../format.ts';
import { useT } from '../i18n/useT.ts';
import { loadEnvironments, useOffice } from '../store.ts';

/** Raw view used to validate the plumbing: environments and the live hook stream. */
export function Debug() {
  const environments = useOffice((s) => s.environments);
  const live = useOffice((s) => s.events);
  const { t, lang } = useT();
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
  const envName = (id: string | null) => {
    const env = environments.find((e) => e.id === id);
    return env ? displayEnvName(env, t) : t.env.none;
  };

  return (
    <main className="debug">
      {/* Same technical term in the three languages, marked as English (WCAG 3.1.2). */}
      <h1 lang="en">Debug</h1>
      <section aria-labelledby="dbg-env">
        <h2 id="dbg-env">{t.debug.environments}</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">{t.debug.name}</th>
              <th scope="col">{t.debug.activeSessions}</th>
              <th scope="col">{t.debug.folders}</th>
            </tr>
          </thead>
          <tbody>
            {environments.map((e) => (
              <tr key={e.id}>
                <td>{displayEnvName(e, t)}</td>
                <td>{e.activeSessions}</td>
                <td className="path">{e.folders.join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section aria-labelledby="dbg-events">
        <h2 id="dbg-events">{t.debug.events(events.length)}</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">{t.debug.time}</th>
              <th scope="col">{t.debug.event}</th>
              <th scope="col">{t.debug.environment}</th>
              <th scope="col">{t.debug.session}</th>
              <th scope="col">{t.debug.agent}</th>
              <th scope="col">{t.debug.tool}</th>
              <th scope="col">{t.debug.detail}</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.seq}>
                <td>{new Date(e.at).toLocaleTimeString(lang)}</td>
                <td>{e.event}</td>
                <td>{envName(e.envId)}</td>
                <td className="path">{e.sessionId}</td>
                <td>{e.agentType ? `${e.agentType} (${e.agentId})` : t.debug.mainAgent}</td>
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
