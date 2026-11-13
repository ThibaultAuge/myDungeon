/** Live `prefers-reduced-motion` flag, read every frame by the scene's ambient animations. */
const query = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
let reduced = query?.matches ?? false;
query?.addEventListener('change', (e) => {
  reduced = e.matches;
});

export function reducedMotion(): boolean {
  return reduced;
}
