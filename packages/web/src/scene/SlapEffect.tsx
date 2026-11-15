import { useT } from '../i18n/useT.ts';

/**
 * What a slap shows over the figure's head in HTML: stars turning and a comic "SLAP!"
 * bubble (the hand is in 3D, SlapHand.tsx). Remounted on every slap (keyed by the slap count) so the CSS
 * animations start over. Decorative: the slap changes nothing about the agent. A dodged slap
 * (dodge.ts) shows no stars and a "missed" bubble.
 */
export function SlapEffect({ dodged = false }: { dodged?: boolean }) {
  const { t } = useT();
  return (
    <span className="slap" aria-hidden="true">
      {!dodged && (
        <span className="slap__stars">
          <span className="slap__star">★</span>
          <span className="slap__star">★</span>
          <span className="slap__star">★</span>
        </span>
      )}
      <span className="slap__bubble">{dodged ? t.slap.miss : t.slap.sound}</span>
    </span>
  );
}
