import { useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { AgentView, SessionView } from '@agent-office/shared';
import { agentName, sessionColor } from '../format.ts';
import { useOffice } from '../store.ts';
import { useNow } from '../useNow.ts';
import { AgentFigure, agentPositions } from './AgentFigure.tsx';
import { assignSpots, BOUNDS, type SeatMemory, type Spot } from './layout.ts';
import { OfficeRooms } from './Room.tsx';

/** Finished subagents stay in the tavern this long before leaving the scene. */
const DONE_VISIBLE_MS = 3 * 60_000;

/** Middle of the dungeon, where the camera looks at first. */
const CENTER: [number, number, number] = [(BOUNDS.x0 + BOUNDS.x1) / 2, 0, (BOUNDS.z0 + BOUNDS.z1) / 2];

interface Placed {
  agent: AgentView;
  session: SessionView;
}

/** Agents shown in 3D: main agents of live sessions and their recent subagents. */
export function visibleAgents(sessions: SessionView[], now: number): Placed[] {
  const out: Placed[] = [];
  for (const s of sessions) {
    if (!s.live) continue;
    out.push({ agent: s.main, session: s });
    for (const sub of s.subagents) {
      if (sub.state !== 'done' || now - sub.since < DONE_VISIBLE_MS) out.push({ agent: sub, session: s });
    }
  }
  return out;
}

/** Keeps each agent on the same seat while it stays in a room; queues the waiting ones at the altar. */
function useSpots(placed: Placed[]): Map<string, Spot> {
  const memory = useRef<SeatMemory>(new Map());
  const key = placed.map((p) => `${p.agent.id}@${p.agent.room}/${p.agent.state}/${p.agent.since}`).join('|');
  return useMemo(
    () =>
      assignSpots(
        placed.map(({ agent }) => ({
          id: agent.id,
          room: agent.room,
          agentType: agent.agentType,
          queued: agent.state === 'waiting' && agent.room === 'autel',
          since: agent.since,
        })),
        memory.current,
      ),
    [key], // eslint-disable-line react-hooks/exhaustive-deps
  );
}

function CameraFollow({ selected }: { selected: string | null }) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  useFrame(() => {
    const pos = selected ? agentPositions.get(selected) : undefined;
    // OrbitControls already updates itself every frame.
    if (controls && pos) controls.target.lerp(pos, 0.06);
  });
  return null;
}

export function OfficeScene() {
  const sessions = useOffice((s) => s.sessions);
  const selected = useOffice((s) => s.selectedAgentId);
  const select = useOffice((s) => s.select);
  const now = useNow();
  const placed = visibleAgents(sessions, now);
  const spots = useSpots(placed);

  return (
    <Canvas camera={{ position: [CENTER[0], 40, CENTER[2] + 30], fov: 42 }} dpr={[1, 2]} onPointerMissed={() => select(null)}>
      <hemisphereLight args={['#ffffff', '#9a9890', 1.1]} />
      <directionalLight position={[8, 18, 6]} intensity={1.2} />
      <OfficeRooms />
      {placed.map(({ agent, session }) => (
        <AgentFigure
          key={agent.id}
          agent={agent}
          name={agentName(agent, session)}
          color={sessionColor(session.main.id)}
          spot={spots.get(agent.id)!}
          selected={selected === agent.id}
          onSelect={select}
        />
      ))}
      <OrbitControls makeDefault target={CENTER} enableDamping maxPolarAngle={1.35} minDistance={8} maxDistance={80} />
      <CameraFollow selected={selected} />
    </Canvas>
  );
}
