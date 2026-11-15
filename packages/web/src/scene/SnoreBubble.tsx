import { useT } from '../i18n/useT.ts';

/**
 * "Zzz" rising over an agent asleep at the altar after waiting too long (altarWait.ts). HTML,
 * inside the name tag like the request bubble. Decorative: the side list and the agent card
 * already say how long the agent has been waiting.
 */
export function SnoreBubble() {
  const { t } = useT();
  return (
    <span className="snore" aria-hidden="true">
      <span className="snore__z">{t.altarWait.snore}</span>
      <span className="snore__z">{t.altarWait.snore}</span>
    </span>
  );
}
