import { useT } from '../i18n/useT.ts';

/**
 * What a slap shows over the figure's head in HTML: stars turning and a comic "SLAP!"
 * bubble (the hand is in 3D, SlapHand.tsx). Remounted on every slap (keyed by the slap count) so the CSS
 * animations start over. Decorative: the slap changes nothing about the agent.
 */
export function SlapEffect() {
  const { t } = useT();
  return (
    <span className="slap" aria-hidden="true">
      <span className="slap__stars">
        <span className="slap__star">★</span>
        <span className="slap__star">★</span>
        <span className="slap__star">★</span>
      </span>
      <span className="slap__bubble">{t.slap.sound}</span>
    </span>
  );
}
