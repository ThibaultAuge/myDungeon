import { Suspense, useEffect, useState } from 'react';
import { Html } from '@react-three/drei';
import { useT } from '../i18n/useT.ts';
import { DestinationIcon } from './DestinationIcon.tsx';
import { preloadKit } from './kit.ts';
import { ROOMS, type Prop, type RoomDef } from './layout.ts';
import { PROPS } from './props.tsx';
import { Floors, Walls } from './Structure.tsx';

// The static dungeon: KayKit floor tiles and walls, furniture and room signs.

preloadKit();

function PropMesh({ room, prop }: { room: RoomDef; prop: Prop }) {
  return (
    <group position={[room.cx + prop.x, 0, room.cz + prop.z]} rotation={[0, prop.rot ?? 0, 0]}>
      {PROPS[prop.kind](room)}
    </group>
  );
}

/** Static dungeon: floors, walls, furniture and room signs. */
export function OfficeRooms() {
  const { t } = useT();
  // drei's Html loses the content of a label mounted before the canvas is connected to its
  // events (its target changes and the new root is never rendered): mount the signs a tick later.
  const [signs, setSigns] = useState(false);
  useEffect(() => setSigns(true), []);
  return (
    <group>
      <Suspense fallback={null}>
        <Floors />
        <Walls />
        {ROOMS.map((r) => r.props.map((p, i) => <PropMesh key={`${r.id}:${i}`} room={r} prop={p} />))}
      </Suspense>
      {signs &&
        ROOMS.map((r) => (
          <Html
            key={r.id}
            position={[r.cx, 2.4, r.cz - r.d / 2 + (r.insideOf ? 0.4 : 0.2)]}
            center
            className="room-sign"
            zIndexRange={[5, 0]}
          >
            {/* Same pictogram as above an agent walking here. */}
            <DestinationIcon kind={r.id} className="room-sign__icon" />
            {t.rooms[r.id]}
          </Html>
        ))}
    </group>
  );
}
