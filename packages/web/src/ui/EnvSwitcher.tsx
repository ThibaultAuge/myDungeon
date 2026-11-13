import { useEffect, useState } from 'react';
import { useOffice } from '../store.ts';

/** Choosing in the list does not navigate (WCAG 3.2.2): the "Ouvrir" button does. */
export function EnvSwitcher({ envId }: { envId: string }) {
  const environments = useOffice((s) => s.environments);
  const navigate = useOffice((s) => s.navigate);
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
      <label htmlFor="env-select">Entreprise</label>
      <select id="env-select" value={choice} onChange={(e) => setChoice(e.target.value)}>
        {!environments.some((e) => e.id === envId) && <option value={envId}>Environnement inconnu</option>}
        {environments.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
            {e.activeSessions > 0 ? ` (${e.activeSessions} en cours)` : ''}
          </option>
        ))}
      </select>
      <button type="submit" className="button">
        Ouvrir
      </button>
    </form>
  );
}
