import { Suspense, useCallback, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { skeletonClip, skeletonDepth, skeletonScale, type Ambush, type Skeleton } from './ambush.ts';
import { Character, type Motion } from './AgentFigure.tsx';
import { SKELETON_LOOKS } from './characters.ts';
import { reducedMotion } from '../motion.ts';
import { groundY } from './outside.ts';

/** Where a skeleton stands and how big it is, from the ambush state. */
function place(g: Group, s: Skeleton): void {
  g.position.set(s.pos.x, groundY(s.pos) - skeletonDepth(s), s.pos.z);
  g.rotation.y = s.heading;
  g.scale.setScalar(skeletonScale(s));
}

/**
 * One skeleton for one outing, placed and animated from the ambush state. It mounts with its
 * rising clip already chosen and in place, so its first frame never shows it standing.
 */
function SkeletonFigure({ ambush, index }: { ambush: Ambush; index: number }) {
  const group = useRef<Group>(null);
  const motion = useRef<Motion>({
    moving: false,
    speed: 0,
    kneeling: false,
    spawnLeft: 0,
    scripted: skeletonClip(ambush.skeletons[index]),
  });
  const setGroup = useCallback(
    (g: Group | null) => {
      group.current = g;
      if (g) place(g, ambush.skeletons[index]);
    },
    [ambush, index],
  );
  useFrame(() => {
    const g = group.current;
    const s = ambush.skeletons[index];
    if (!g || s.phase === 'free') return;
    // Under reduced motion the skeletons finish their outing out of sight.
    g.visible = !reducedMotion();
    motion.current.scripted = skeletonClip(s);
    place(g, s);
  });
  return (
    <group ref={setGroup}>
      <Suspense fallback={null}>
        <Character look={SKELETON_LOOKS[index]} state="working" motion={motion} />
      </Suspense>
    </group>
  );
}

/** Outing of each skeleton, or 0 while it is underground. */
function outings(ambush: Ambush): number[] {
  return ambush.skeletons.map((s) => (s.phase === 'free' ? 0 : s.sortie));
}

/**
 * Runs the deaths outside the castle: advances the ambush every frame and shows the
 * skeletons that are out. Re-renders only when a skeleton comes out, goes away or sets off
 * again: each outing is a new figure (keyed by its count).
 */
export function AmbushScene({ ambush }: { ambush: Ambush }) {
  const [out, setOut] = useState<number[]>(() => outings(ambush));
  const sent = useRef(out);
  useFrame((_, delta) => {
    ambush.step(Math.min(delta, 0.1));
    const now = outings(ambush);
    if (now.some((v, i) => v !== sent.current[i])) {
      sent.current = now;
      setOut(now);
    }
  });
  return <>{out.map((sortie, i) => (sortie > 0 ? <SkeletonFigure key={`${i}:${sortie}`} ambush={ambush} index={i} /> : null))}</>;
}
