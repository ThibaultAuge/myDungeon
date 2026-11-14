import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useAnimations } from '@react-three/drei';
import type { Mesh, SkinnedMesh } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { reducedMotion } from '../motion.ts';
import { KIT_SCALE } from './dungeon.ts';
import { useKitGLTF } from './kit.ts';

/** The idle clip of the shared Rig_Medium skeleton (Skeletons and Adventurers use the same rig). */
const IDLE = 'Idle_B';

/**
 * A KayKit skeleton standing in the trials room as a test subject. Decoration only: no
 * handler, no target, no post. It idles; under reduced motion it holds still.
 */
export function SkeletonDummy() {
  const { scene } = useKitGLTF('skeletons', 'Skeleton_Minion');
  const { animations } = useKitGLTF('adventurers_anim', 'Rig_Medium_General');
  const model = useMemo(() => {
    const copy = cloneSkinned(scene);
    copy.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return copy;
  }, [scene]);
  const clips = useMemo(() => animations.filter((c) => c.name === IDLE), [animations]);
  const { actions } = useAnimations(clips, model);

  useEffect(() => {
    if (!actions[IDLE] && import.meta.env.DEV) console.warn('KayKit clip missing for the skeleton', IDLE);
  }, [actions]);

  // Started from the frame loop, not an effect: the first-load Suspense hide runs drei's
  // cleanup, which stops every action (same gotcha as Character). The reduced-motion setting
  // can also change while the page is open.
  useFrame(() => {
    const action = actions[IDLE];
    if (!action) return;
    if (!action.isScheduled()) action.reset().play();
    const still = reducedMotion();
    if (action.paused !== still) action.paused = still;
  });

  // Each clone has its own bones texture on the GPU.
  useEffect(
    () => () =>
      model.traverse((o) => {
        const skinned = o as SkinnedMesh;
        if (skinned.isSkinnedMesh) skinned.skeleton.dispose();
      }),
    [model],
  );

  return <primitive object={model} scale={KIT_SCALE} />;
}
