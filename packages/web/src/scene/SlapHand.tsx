import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Group,
  type WebGLRenderer,
} from 'three';
import { swingPose } from './slapSwing.ts';

// The giant hand of a slap, built from simple shapes in the KayKit palette (no KayKit pack
// has a hand). It sweeps a backhand across the figure's face, in the camera's frame, so
// it always crosses the screen whatever way the figure faces. Remounted on every slap.

/** Head height in the figure's own units. Sub-agent figures are scaled 0.85, and the hand with them (intended: it stays in proportion). */
const HEAD_Y = 1.25;
/** The hand model is about 0.8 m tall: twice that, a giant's hand next to the chibi figures. */
const HAND_SCALE = 2;
/** How much the back of the hand turns to the camera rather than along the motion (seen from above, a hand facing its motion shows only its edge). */
const FACE_CAMERA = 0.8;

/** Hand meshes are never pointer targets: a click on them must not select the figure. */
const noRaycast = () => null;

/**
 * Drawn over the scene, as the player's hand in a dungeon game: the hand materials are
 * "transparent" (fully opaque) so they draw in the LAST pass, after every other transparent
 * object, and the first hand part clears the depth buffer there. Walls never hide the sweep,
 * nothing drawn afterwards can show through them, and the hand's own parts still sort by
 * depth. Rules: the hand casts no shadow (this never runs in the shadow pass), and nothing
 * else may use a renderOrder of FIRST or above. Accepted limit: two hands on screen at the
 * same instant share the clear and may overlap wrongly.
 */
function clearDepth(renderer: WebGLRenderer) {
  // The clear writes nothing if the previous material turned depth writing off.
  renderer.state.buffers.depth.setMask(true);
  renderer.clearDepth();
}
const FIRST = 1000;
const REST = 1001;

// Shared by every slap: no new geometry, material or shader per slap.
const material = (color: string) => new MeshStandardMaterial({ color, roughness: 0.9, transparent: true, opacity: 1 });
const MAT = {
  skin: material('#F2C49B'),
  skinDark: material('#D9A47A'),
  leather: material('#6E3F2C'),
  brass: material('#E3A53B'),
};
/** Index, middle, ring and little finger: x across the palm and length (middle ones longest). */
const FINGERS = [
  [-0.17, 0.22],
  [-0.06, 0.28],
  [0.05, 0.27],
  [0.16, 0.2],
] as const;
const GEO = {
  cuff: new CylinderGeometry(0.2, 0.23, 0.26, 12),
  band: new CylinderGeometry(0.215, 0.215, 0.05, 12),
  palm: new BoxGeometry(0.46, 0.4, 0.15),
  thumb: new CapsuleGeometry(0.06, 0.18, 4, 8),
  fingers: FINGERS.map(([, length]) => new CapsuleGeometry(0.055, length, 4, 8)),
};

const UP = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const head = new Vector3();
const right = new Vector3();
const toward = new Vector3();
const forward = new Vector3();
const side = new Vector3();
const fingerAxis = new Vector3();
const toCamera = new Vector3();
const world = new Vector3();
const basis = new Matrix4();
const rotation = new Quaternion();
const roll = new Quaternion();
const parentRotation = new Quaternion();

function Part({
  geometry,
  material: mat,
  position,
  rotation: rot,
  order = REST,
}: {
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
  position: [number, number, number];
  rotation?: [number, number, number];
  order?: number;
}) {
  return (
    <mesh
      geometry={geometry}
      material={mat}
      // Shared: never disposed with a slap.
      dispose={null}
      position={position}
      rotation={rot}
      raycast={noRaycast}
      renderOrder={order}
      // The depth-clearing part must draw even when it is off screen.
      frustumCulled={order !== FIRST}
      onBeforeRender={order === FIRST ? clearDepth : undefined}
    />
  );
}

/** The hand, in its own frame: fingers up (+Y), back of the hand towards +Z, thumb on +X. About 0.8 m tall before HAND_SCALE. */
function HandModel() {
  return (
    <>
      {/* Leather cuff with a brass band, below the palm. */}
      <Part order={FIRST} geometry={GEO.cuff} material={MAT.leather} position={[0, -0.2, 0]} />
      <Part geometry={GEO.band} material={MAT.brass} position={[0, -0.1, 0]} />
      <Part geometry={GEO.palm} material={MAT.skin} position={[0, 0.12, 0]} />
      {/* Fingers, a little curled towards the palm (-Z). */}
      {FINGERS.map(([x, length], i) => (
        <Part
          key={x}
          geometry={GEO.fingers[i]}
          material={MAT.skin}
          position={[x, 0.32 + length / 2, -0.02]}
          rotation={[-0.15, 0, 0]}
        />
      ))}
      {/* Thumb, sticking out on the side. */}
      <Part geometry={GEO.thumb} material={MAT.skinDark} position={[0.29, 0.12, -0.03]} rotation={[0, 0, -0.9]} />
    </>
  );
}

export function SlapHand({ dir }: { dir: 1 | -1 }) {
  const root = useRef<Group>(null);
  const start = useRef<number | null>(null);

  useFrame(({ clock, camera }) => {
    const g = root.current;
    const parent = g?.parent;
    if (!g || !parent) return;
    start.current ??= clock.elapsedTime;
    const pose = swingPose(clock.elapsedTime - start.current, dir);
    if (!pose || pose.scale <= 0) {
      g.visible = false;
      return;
    }
    g.visible = true;

    // The camera's frame around the head, kept horizontal: right on screen, towards the
    // camera. `toward` comes from `right`, so it stays defined even seen straight from above.
    parent.updateWorldMatrix(true, false);
    head.set(0, HEAD_Y, 0);
    parent.localToWorld(head);
    right.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    toward.crossVectors(right, UP);

    world
      .copy(head)
      .addScaledVector(right, pose.right)
      .addScaledVector(UP, pose.up)
      .addScaledVector(toward, pose.toward);

    // Back of the hand (+Z) between the motion and the camera, fingers towards the top of
    // the screen, then the wrist roll around the hand's own Z.
    toCamera.setFromMatrixPosition(camera.matrixWorld).sub(world).normalize();
    forward
      .copy(right)
      .multiplyScalar(pose.tangentRight)
      .addScaledVector(toward, pose.tangentToward)
      .multiplyScalar(1 - FACE_CAMERA)
      .addScaledVector(toCamera, FACE_CAMERA)
      .normalize();
    fingerAxis.setFromMatrixColumn(camera.matrixWorld, 1);
    fingerAxis.addScaledVector(forward, -fingerAxis.dot(forward)).normalize();
    side.crossVectors(fingerAxis, forward).normalize();
    basis.makeBasis(side, fingerAxis, forward);
    rotation.setFromRotationMatrix(basis);
    rotation.multiply(roll.setFromAxisAngle(Z, pose.roll));

    // From the world pose to the figure's own frame (it turns and may be scaled).
    g.position.copy(parent.worldToLocal(world));
    parent.getWorldQuaternion(parentRotation);
    g.quaternion.copy(parentRotation.invert().multiply(rotation));
    g.scale.setScalar(pose.scale * HAND_SCALE);
  });

  return (
    <group ref={root} visible={false}>
      <HandModel />
    </group>
  );
}
