import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, PlaneGeometry, type Object3D } from 'three';
import { reducedMotion } from '../motion.ts';
import { Character, type Motion } from './AgentFigure.tsx';
import { heraldCheerAt, heraldClip, heraldDepth, heraldPhase, onCelebrate, TowerPool, TRUMPET_CLIP, type HeraldKind } from './celebrate.ts';
import type { Look } from './characters.ts';
import { TOWER_H, TOWERS } from './dungeon.ts';
import { towerHeights } from './Towers.tsx';

const HERALD_LOOK: Look = Object.freeze({ body: 'Rogue' });
/** Below this tower height the herald is hidden: the tower has gone down with the cutaway. */
const SHOWN_FROM = 0.35;

// The trumpet: a brass tube and its bell, shared by every herald (module scope, never disposed).
const brass = new MeshStandardMaterial({ color: '#d8a93a', metalness: 0.85, roughness: 0.3 });
const tube = new CylinderGeometry(0.018, 0.018, 0.5, 8);
tube.translate(0, 0.25, 0);
const bell = new CylinderGeometry(0.11, 0.02, 0.16, 16, 1, true);
bell.translate(0, 0.58, 0);
const pennant = new PlaneGeometry(0.26, 0.22);
pennant.translate(0, -0.11, 0);
const cloth = new MeshStandardMaterial({ color: '#b3261e', roughness: 0.8, side: DoubleSide });

/** The trumpet object, pointing along +Y of its group; with a pennant hanging under it for a push. */
function makeTrumpet(withPennant: boolean): Group {
  const g = new Group();
  g.add(new Mesh(tube, brass), new Mesh(bell, brass));
  if (withPennant) {
    const p = new Mesh(pennant, cloth);
    p.position.set(0, 0.36, 0.02);
    p.rotation.set(0, 0, Math.PI / 2);
    g.add(p);
  }
  g.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

/**
 * Grip of the trumpet in the right hand slot, calibrated on the last frame of TRUMPET_CLIP (fist
 * at the chin, where the clip is held): the bell points skyward, about 83° up and slightly toward
 * the courtyard. Aimed lower, toward the courtyard, it points at the default camera and shrinks
 * to a stub behind the fist.
 */
const TRUMPET_GRIP = { position: [0, 0, 0] as const, rotation: [0, 0, Math.PI / 12] as const, scale: 2 };

export interface HeraldOuting {
  id: number;
  tower: number;
  kind: HeraldKind;
}

function HeraldFigure({ outing, onDone }: { outing: HeraldOuting; onDone: (o: HeraldOuting) => void }) {
  const group = useRef<Group>(null);
  const elapsed = useRef(0);
  const done = useRef(false);
  const attached = useRef<Object3D | null>(null);
  const [notes, setNotes] = useState(false);
  const notesShown = useRef(false);
  /** Where a firework show caught this herald (see heraldCheerAt): he cheers once for it. */
  const cheerAt = useRef<number | null>(null);
  const tower = TOWERS[outing.tower];
  const motion = useRef<Motion>({
    moving: false,
    speed: 0,
    kneeling: false,
    spawnLeft: 0,
    scripted: heraldClip('rising', 0),
    // The herald cannot be slapped.
    hit: null,
    hitId: 0,
    hitWait: 0,
    hitLeft: 0,
  });
  const setGroup = useCallback(
    (g: Group | null) => {
      group.current = g;
      if (g) {
        g.position.set(tower.x, TOWER_H * towerHeights[outing.tower], tower.z);
        g.rotation.y = tower.facing;
      }
    },
    [tower, outing.tower],
  );

  useFrame((_, delta) => {
    const g = group.current;
    if (!g || done.current) return;
    elapsed.current += Math.min(delta, 0.1);
    const { phase, t } = heraldPhase(elapsed.current, outing.kind);
    if (phase === 'gone') {
      done.current = true;
      onDone(outing);
      return;
    }
    const still = reducedMotion();
    const clip = heraldClip(phase, t, outing.kind, cheerAt.current);
    motion.current.scripted = clip;
    const h = towerHeights[outing.tower];
    // Under reduced motion the herald does not go down: he just disappears at the end.
    g.position.y = TOWER_H * h - (still ? 0 : heraldDepth(phase, t));
    g.visible = h >= SHOWN_FROM;
    // The notes are a DOM overlay: they do not follow the group's visibility, so hide them too.
    const trumpeting = clip.name === TRUMPET_CLIP && phase === 'trumpeting' && g.visible;
    if (trumpeting !== notesShown.current) {
      notesShown.current = trumpeting;
      setNotes(trumpeting);
    }
    // The trumpet goes into the right hand once the character has loaded.
    if (!attached.current) {
      const slot = g.getObjectByName('handslotr');
      if (slot) {
        const trumpet = makeTrumpet(outing.kind === 'push');
        trumpet.position.set(...TRUMPET_GRIP.position);
        trumpet.rotation.set(...TRUMPET_GRIP.rotation);
        trumpet.scale.setScalar(TRUMPET_GRIP.scale);
        slot.add(trumpet);
        attached.current = trumpet;
      }
    }
  });

  // A firework show while he is on stage: he cheers once (the first show of his outing only).
  useEffect(
    () =>
      onCelebrate((kind) => {
        if (kind !== 'tests' || cheerAt.current !== null) return;
        const { phase, t } = heraldPhase(elapsed.current, outing.kind);
        cheerAt.current = heraldCheerAt(phase, t);
      }),
    [outing.kind],
  );

  // The trumpet is a plain group (shared geometry and materials): only detach it. The ref is
  // cleared too, so a remount (StrictMode runs this cleanup once right after mounting, possibly
  // after the first frame attached it) puts it back in the hand on the next frame.
  useEffect(
    () => () => {
      attached.current?.removeFromParent();
      attached.current = null;
    },
    [],
  );

  return (
    <group ref={setGroup}>
      <Suspense fallback={null}>
        <Character look={HERALD_LOOK} state="working" motion={motion} />
      </Suspense>
      {notes && (
        <Html position={[0, 1.9, 0]} center zIndexRange={[25, 15]} pointerEvents="none">
          <div className="herald-notes" aria-hidden="true">
            <span>♪</span>
            <span>♫</span>
            <span>♪</span>
          </div>
        </Html>
      )}
    </group>
  );
}

let nextId = 1;

/**
 * Heralds on the corner towers: each git commit or push sends one to a free tower (none when all
 * four are taken). Celebrations come from server events and from `agentOffice.heraut()`.
 */
export function Heralds() {
  const [pool] = useState(() => new TowerPool(TOWERS.length));
  const [outings, setOutings] = useState<HeraldOuting[]>([]);
  useEffect(
    () =>
      onCelebrate((kind) => {
        if (kind !== 'commit' && kind !== 'push') return;
        // A standing tower first: the ones lowered by the cutaway would hide the herald.
        const tower = pool.claim(Math.random, (i) => towerHeights[i] >= SHOWN_FROM);
        if (tower === null) return;
        setOutings((list) => [...list, { id: nextId++, tower, kind }]);
      }),
    [pool],
  );
  const onDone = useCallback(
    (o: HeraldOuting) => {
      pool.release(o.tower);
      setOutings((list) => list.filter((x) => x.id !== o.id));
    },
    [pool],
  );
  return (
    <>
      {outings.map((o) => (
        <HeraldFigure key={o.id} outing={o} onDone={onDone} />
      ))}
    </>
  );
}
