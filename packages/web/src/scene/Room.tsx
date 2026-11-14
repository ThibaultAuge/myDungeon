import { Suspense } from 'react';
import { preloadKit } from './kit.ts';
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
      {decor.map((p, i) => (
        <PropMesh key={`decor:${i}`} room={room} prop={p} />
      ))}
    </>
  );
}

/** Static dungeon: floors, walls, workstations and decoration. */
export function OfficeRooms() {
  return (
    <Suspense fallback={null}>
      <Floors />
      <Walls />
      {ROOMS.map((r) => (
        <RoomFurniture key={r.id} room={r} />
      ))}
    </Suspense>
  );
}
