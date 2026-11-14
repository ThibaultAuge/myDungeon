import { useT } from '../i18n/useT.ts';

/**
 * What a slap shows around the figure's head: a giant hand sweeping across, stars turning
 * and a comic "SLAP!" bubble. Remounted on every slap (keyed by the slap count) so the CSS
 * animations start over. Decorative: the slap changes nothing about the agent.
 */
export function SlapEffect({ flip }: { flip: boolean }) {
  const { t } = useT();
  return (
    <span className={`slap${flip ? ' slap--flip' : ''}`} aria-hidden="true">
      <svg className="slap__hand" viewBox="0 0 64 64" width="72" height="72" focusable="false">
        {/* Open palm, fingers pointing left: it sweeps from right to left. */}
        <path
          className="slap__hand-shape"
          d="M58 26c0-4-3-6-7-6H34l3-5c2-3 1-6-2-7s-5 1-7 3L18 22c-3 3-4 6-4 9v2H8c-3 0-4 2-4 4s1 4 4 4h6v2H6c-3 0-4 2-4 4s1 4 4 4h9c1 3 4 5 8 5h20c5 0 9-3 11-7l3-8c1-2 1-4 1-6z"
        />
        <path className="slap__hand-line" d="M14 33h10M14 43h10M23 51h12" />
        <path className="slap__hand-cuff" d="M56 22h6v28h-6z" />
      </svg>
      <span className="slap__stars">
        <span className="slap__star">★</span>
        <span className="slap__star">★</span>
        <span className="slap__star">★</span>
      </span>
      <span className="slap__bubble">{t.slap.sound}</span>
    </span>
  );
}
