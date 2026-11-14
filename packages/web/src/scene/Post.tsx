import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { Box3, Vector3, type Group } from 'three';
import { useOffice } from '../store.ts';
import { CLICK_MAX_DRAG_PX, nearestTarget, setPointerHover, TARGET_USER_DATA } from './cursor.ts';
import { setHighlight } from './highlight.ts';
import type { PostId } from './layout.ts';

/** Margin around each piece's hit box, in metres. */
const HIT_PAD = 0.05;

interface HitBox {
  center: [number, number, number];
  size: [number, number, number];
}

/**
 * The bounding box of each piece: thin furniture (lecterns, easel) is hard to hit on its own
 * meshes. One box per piece, not per post, so a post never covers the floor between its pieces.
 */
function hitBoxes(pieces: Group): HitBox[] {
  pieces.updateWorldMatrix(true, true);
  const inverse = pieces.matrixWorld.clone().invert();
  return pieces.children.map((piece) => {
    const box = new Box3().setFromObject(piece).applyMatrix4(inverse).expandByScalar(HIT_PAD);
    const c = box.getCenter(new Vector3());
    const s = box.getSize(new Vector3());
    return { center: [c.x, c.y, c.z], size: [s.x, s.y, s.z] };
  });
}

/**
 * A workstation: its furniture glows under the pointer, a click opens its card. Only the
 * invisible hit boxes take pointer events; the furniture itself is never raycast.
 *
 * The nearest target under the pointer wins, decided again on every move and click: an agent
 * figure in front of the furniture keeps it dark, and the glow always shows what a click does.
 */
export function Post({ post, children }: { post: PostId; children: ReactNode }) {
  const pieces = useRef<Group>(null);
  const hits = useRef<Group>(null);
  const [boxes, setBoxes] = useState<HitBox[]>([]);
  const [hovered, setHovered] = useState(false);
  const selectPost = useOffice((s) => s.selectPost);
  // The workstation whose card is open stays lit, so the card points at its furniture.
  const open = useOffice((s) => s.selectedPost === post);
  const lit = hovered || open;
  const cursorKey = `post:${post}`;

  // The furniture is static and already loaded here (the dungeon's Suspense waits for it).
  useLayoutEffect(() => {
    if (pieces.current) setBoxes(hitBoxes(pieces.current));
  }, []);

  useEffect(() => {
    const g = pieces.current;
    if (!g || !lit) return;
    setHighlight(g, true);
    return () => setHighlight(g, false);
  }, [lit]);

  // A post that leaves the scene while hovered gets no pointer-out: give the cursor back.
  useEffect(() => () => setPointerHover(cursorKey, false), [cursorKey]);

  const hover = (on: boolean) => {
    setHovered(on);
    setPointerHover(cursorKey, on);
  };
  const isNearest = (e: ThreeEvent<PointerEvent | MouseEvent>) =>
    !!hits.current && nearestTarget(e.intersections) === hits.current;

  return (
    <group>
      <group ref={pieces}>{children}</group>
      {/* No stopPropagation on hover: R3F would keep stopping later moves, hiding an agent that comes in front. */}
      <group
        ref={hits}
        userData={TARGET_USER_DATA}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => hover(isNearest(e))}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => hover(isNearest(e))}
        onPointerOut={() => hover(false)}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (!isNearest(e)) return;
          e.stopPropagation();
          if (e.delta > CLICK_MAX_DRAG_PX) return;
          selectPost(post);
        }}
      >
        {boxes.map((b, i) => (
          // Invisible: never drawn, but still hit by the raycaster.
          <mesh key={i} position={b.center} visible={false}>
            <boxGeometry args={b.size} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
