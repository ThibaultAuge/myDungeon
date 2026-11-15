import { Suspense } from 'react';
import { Kit } from './KitInstances.tsx';

/**
 * Cobwebs over an agent left asleep at the altar for ten minutes (altarWait.ts). The KayKit
 * corner web of the room decor (a web spanning a corner, hanging down from it), two of them
 * tented over the lying body from opposite corners; figure-local coordinates. Its own
 * Suspense: the model is normally loaded already (room decor), but a load must never hide
 * the scene.
 */
export function AltarCobwebs() {
  return (
    <Suspense fallback={null}>
      <Kit pack="mixed2" name="cobweb_C" pos={[-0.5, 0.7, -0.65]} rot={[0, 0, 0]} scale={0.4} shadow={false} />
      <Kit pack="mixed2" name="cobweb_C" pos={[0.5, 0.7, 0.4]} rot={[0, Math.PI, 0]} scale={0.4} shadow={false} />
    </Suspense>
  );
}
