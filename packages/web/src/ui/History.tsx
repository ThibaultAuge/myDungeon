import type { SessionView } from '@agent-office/shared';
import { ago } from '../format.ts';
import { useNow } from '../useNow.ts';

export function History({ sessions }: { sessions: SessionView[] }) {
  const now = useNow();
  const done = sessions.filter((s) => !s.live);
  return (
    <section aria-labelledby="history-title">
      <h2 id="history-title">Historique</h2>
      {done.length === 0 ? (
        <p className="muted">Aucune session terminée.</p>
      ) : (
        <ul className="history" role="list">
          {done.map((s) => (
            <li key={s.id}>
              <span className="history__title" title={s.title}>
                {s.title}
              </span>
              <span className="muted">{ago(s.lastActivityAt, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
