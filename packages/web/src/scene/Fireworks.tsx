import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, PointsMaterial } from 'three';
import { reducedMotion } from '../motion.ts';
import {
  BURSTS,
  FIREWORKS_STILL_TIME,
  FIREWORKS_TIME,
  fireworkBursts,
  onCelebrate,
  rocketAt,
  sparkAt,
  SPARKS,
  type Burst,
  type Spark,
} from './celebrate.ts';
import { BOUNDS } from './layout.ts';

const CX = (BOUNDS.x0 + BOUNDS.x1) / 2;
const CZ = (BOUNDS.z0 + BOUNDS.z1) / 2;
/** Each burst: its rocket, then its sparks. */
const PER_BURST = 1 + SPARKS;
const COUNT = BURSTS * PER_BURST;

/** A soft round dot, so the points are not squares. Built once, in the browser only. */
let dot: CanvasTexture | null = null;
function dotTexture(): CanvasTexture {
  if (dot) return dot;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  dot = new CanvasTexture(c);
  return dot;
}

/** One show: every rocket and spark in one Points object, recomputed each frame (a few hundred points). */
function Show({ bursts, onDone }: { bursts: Burst[]; onDone: () => void }) {
  const time = useRef(0);
  const finished = useRef(false);
  const { geometry, material } = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(COUNT * 3), 3));
    geo.setAttribute('color', new BufferAttribute(new Float32Array(COUNT * 3), 3));
    // Additive blending: black adds nothing, so a hidden point is simply coloured black.
    const mat = new PointsMaterial({
      size: 1.5,
      map: dotTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    return { geometry: geo, material: mat };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame((_, delta) => {
    if (finished.current) return;
    const still = reducedMotion();
    time.current += Math.min(delta, 0.1);
    if (time.current >= (still ? FIREWORKS_STILL_TIME : FIREWORKS_TIME)) {
      finished.current = true;
      onDone();
      return;
    }
    const pos = geometry.attributes.position as BufferAttribute;
    const col = geometry.attributes.color as BufferAttribute;
    const write = (i: number, s: Spark, [r, g, b]: [number, number, number]) => {
      pos.setXYZ(i, s.x, s.y, s.z);
      col.setXYZ(i, r * s.alpha, g * s.alpha, b * s.alpha);
    };
    bursts.forEach((b, k) => {
      const base = k * PER_BURST;
      // No rocket under reduced motion: only the still bouquet.
      write(base, rocketAt(b, still ? -1 : time.current), [1, 0.9, 0.7]);
      for (let i = 0; i < SPARKS; i++) write(base + 1 + i, sparkAt(b, i, time.current, still), b.color);
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

/**
 * Fireworks in the night sky over the castle when a test suite passes. A new success restarts
 * the show. Celebrations come from server events and from `window.iaia.feuArtifice()`.
 */
export function Fireworks() {
  const [show, setShow] = useState<{ id: number; bursts: Burst[] } | null>(null);
  useEffect(
    () =>
      onCelebrate((kind) => {
        if (kind === 'tests') setShow((prev) => ({ id: (prev?.id ?? 0) + 1, bursts: fireworkBursts(CX, CZ) }));
      }),
    [],
  );
  if (!show) return null;
  return <Show key={show.id} bursts={show.bursts} onDone={() => setShow(null)} />;
}
