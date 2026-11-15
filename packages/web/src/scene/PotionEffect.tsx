import type { CSSProperties } from 'react';
import { useT } from '../i18n/useT.ts';
import { DRINK_S, STAGGER_S } from './potion.ts';

/** Timings of the CSS animations, taken from potion.ts so the stars and the stagger end together. */
const TIMING = { '--potion-drink': `${DRINK_S}s`, '--potion-stagger': `${STAGGER_S}s` } as CSSProperties;

/**
 * What the potion of oblivion shows over the figure's head in HTML, once the gulp is over: stars
 * orbiting the head and a dazed bubble. Remounted on every potion (keyed by its number) so the CSS
 * animations start over. Decorative: the potion changes nothing about the agent.
 */
export function PotionEffect() {
  const { t } = useT();
  return (
    <span className="potion" style={TIMING} aria-hidden="true">
      <span className="potion__stars">
        <span className="potion__star">★</span>
        <span className="potion__star">★</span>
        <span className="potion__star">★</span>
        <span className="potion__star">★</span>
      </span>
      <span className="potion__bubble">{t.potion.bubble}</span>
    </span>
  );
}
