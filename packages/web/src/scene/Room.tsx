import { Suspense, useMemo } from 'react';
import { DECOR_RECIPES, decorPlacement } from './decor.ts';
import { preloadKit, type Pack } from './kit.ts';
import { KitInstances } from './KitInstances.tsx';
import { postGroups, ROOMS, type Prop, type RoomDef } from './layout.ts';
import { Post } from './Post.tsx';
import { PROPS } from './props.tsx';
import { Floors, Walls } from './Structure.tsx';

// The static dungeon: KayKit floor tiles and walls, workstations and decoration.

preloadKit();

function PropMesh({ room, prop }: { room: RoomDef; prop: Prop }) {
  return (
    <group position={[room.cx + prop.x, 0, room.cz + prop.z]} rotation={[0, prop.rot ?? 0, 0]}>
      {PROPS[prop.kind](room)}
    </group>
  );
}

function RoomFurniture({ room }: { room: RoomDef }) {
  const { posts, decor } = postGroups(room);
  return (
    <>
      {posts.map(({ post, props }) => (
        <Post key={post} post={post}>
          {props.map((p, i) => (
            <PropMesh key={i} room={room} prop={p} />
          ))}
        </Post>
      ))}
      {/* Decoration with a recipe is drawn by DecorInstances, all rooms at once. */}
      {decor
        .filter((p) => !DECOR_RECIPES[p.kind])
        .map((p, i) => (
          <PropMesh key={`decor:${i}`} room={room} prop={p} />
        ))}
    </>
  );
}

/** Every decoration model of the map, one instanced draw per model. */
function DecorInstances() {
  const batches = useMemo(() => decorPlacement(ROOMS), []);
  return (
    <>
      {batches.map((b) => (
        <KitInstances key={`${b.pack}/${b.name}/${b.shadow}`} pack={b.pack as Pack} name={b.name} items={b.items} shadow={b.shadow} />
      ))}
    </>
  );
}

/** Height of the mood lights: under the top of the walls, above the figures. */
const LIGHT_Y = 2.6;

/** One coloured light per room, no shadow: each room has its own mood. */
function RoomLights() {
  return (
    <>
      {ROOMS.filter((r) => r.light).map((r) => (
        <pointLight
          key={r.id}
          position={[r.cx, LIGHT_Y, r.cz]}
          color={r.light!.color}
          intensity={r.light!.intensity}
          distance={Math.max(r.w, r.d) * 0.75 + 2}
          decay={1.6}
        />
      ))}
    </>
  );
}

/** Static dungeon: floors, walls, workstations, decoration and room lights. */
export function OfficeRooms() {
  return (
    <>
      <RoomLights />
      <Suspense fallback={null}>
        <Floors />
        <Walls />
        <DecorInstances />
        {ROOMS.map((r) => (
          <RoomFurniture key={r.id} room={r} />
        ))}
      </Suspense>
    </>
  );
}
