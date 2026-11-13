import type { SessionView } from '@agent-office/shared';
import { ago, sessionTitle } from '../format.ts';
import { useT } from '../i18n/useT.ts';
import { useNow } from '../useNow.ts';

export function History({ sessions }: { sessions: SessionView[] }) {
  const now = useNow();
  const { t } = useT();
  const done = sessions.filter((s) => !s.live);
  return (
    <section aria-labelledby="history-title">
      <h2 id="history-title">{t.history.title}</h2>
      {done.length === 0 ? (
        <p className="muted">{t.history.empty}</p>
      ) : (
        <ul className="history" role="list">
          {done.map((s) => (
            <li key={s.id}>
              <span className="history__title" title={sessionTitle(s, t)}>
                {sessionTitle(s, t)}
              </span>
              <span className="muted">{ago(s.lastActivityAt, now, t)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
