import { typeLabel } from '../format.ts';
import { useT } from '../i18n/useT.ts';
import { restId } from '../scene/tavern.ts';
import { useOffice } from '../store.ts';

/** DOM id of an agent type's button, where focus goes back when its introduction card closes. */
export function rosterButtonId(type: string): string {
  // Any character is valid in an id: the whole lower-case type keeps two types apart.
  return `roster-button-${type.toLowerCase()}`;
}

/** Keyboard and screen-reader route to the introduction cards that a click on a tavern figure opens. */
export function RosterList() {
  const roster = useOffice((s) => s.roster);
  const selected = useOffice((s) => s.selectedAgentId);
  const select = useOffice((s) => s.select);
  const { t } = useT();
  if (roster.length === 0) return null;
  return (
    <section aria-labelledby="roster-list-title">
      <h2 id="roster-list-title" tabIndex={-1}>{t.roster.title}</h2>
      <ul className="post-list" role="list">
        {roster.map((type) => {
          const id = restId(type);
          return (
            <li key={id}>
              <button
                type="button"
                id={rosterButtonId(type)}
                className="agent-row"
                aria-pressed={selected === id}
                onClick={() => select(selected === id ? null : id)}
              >
                {typeLabel(type)}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
