import { useEffect, useState } from 'react';
import { envName } from '../format.ts';
import { useT } from '../i18n/useT.ts';
import { useOffice } from '../store.ts';

/** Choosing in the list does not navigate (WCAG 3.2.2): the "Open" button does. */
export function EnvSwitcher({ envId }: { envId: string }) {
  const environments = useOffice((s) => s.environments);
  const navigate = useOffice((s) => s.navigate);
  const { t } = useT();
  const [choice, setChoice] = useState(envId);
  useEffect(() => setChoice(envId), [envId]);
  return (
    <form
      className="env-switcher"
      onSubmit={(e) => {
        e.preventDefault();
        if (choice !== envId) navigate({ page: 'env', envId: choice });
      }}
    >
      <label htmlFor="env-select">{t.envSwitcher.label}</label>
      <select id="env-select" value={choice} onChange={(e) => setChoice(e.target.value)}>
        {!environments.some((e) => e.id === envId) && <option value={envId}>{t.env.unknown}</option>}
        {environments.map((e) => (
          <option key={e.id} value={e.id}>
            {envName(e, t)}
            {e.activeSessions > 0 ? t.envSwitcher.active(e.activeSessions) : ''}
          </option>
        ))}
      </select>
      <button type="submit" className="button">
        {t.envSwitcher.open}
      </button>
    </form>
  );
}
