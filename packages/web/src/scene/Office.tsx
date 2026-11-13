import { useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { AgentView, RoomId, SessionView } from '@agent-office/shared';
import { agentName, sessionColor } from '../format.ts';
import { useT } from '../i18n/useT.ts';
import { useOffice } from '../store.ts';
import { useNow } from '../useNow.ts';
import { AgentFigure, agentPositions } from './AgentFigure.tsx';
import { seatAt, type Seat } from './layout.ts';
import { OfficeRooms } from './Room.tsx';

/** Finished subagents stay at the coffee machine this long before leaving the scene. */
const DONE_VISIBLE_MS = 3 * 60_000;

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

/** Keeps each agent on the same seat while it stays in a room; frees it when the agent leaves. */
function useSeats(placed: Placed[]): Map<string, Seat> {
  const memory = useRef(new Map<string, { room: RoomId; index: number }>());
  const key = placed.map((p) => `${p.agent.id}@${p.agent.room}`).join('|');
  return useMemo(() => {
    const mem = memory.current;
    const ids = new Set(placed.map((p) => p.agent.id));
    for (const id of mem.keys()) if (!ids.has(id)) mem.delete(id);
    const taken = new Map<RoomId, Set<number>>();
    for (const p of placed) {
      const m = mem.get(p.agent.id);
      if (m && m.room === p.agent.room) {
        if (!taken.has(m.room)) taken.set(m.room, new Set());
        taken.get(m.room)!.add(m.index);
      }
    }
    const seats = new Map<string, Seat>();
    for (const p of placed) {
      let m = mem.get(p.agent.id);
      if (!m || m.room !== p.agent.room) {
        const used = taken.get(p.agent.room) ?? new Set<number>();
        let index = 0;
        while (used.has(index)) index++;
        used.add(index);
        taken.set(p.agent.room, used);
        m = { room: p.agent.room, index };
        mem.set(p.agent.id, m);
      }
      seats.set(p.agent.id, seatAt(m.room, m.index));
    }
    return seats;
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const { t } = useT();
  const placed = visibleAgents(sessions, now);
  const seats = useSeats(placed);

  return (
    <Canvas camera={{ position: [20, 26, 20], fov: 40 }} dpr={[1, 2]} onPointerMissed={() => select(null)}>
      <hemisphereLight args={['#ffffff', '#9a9890', 1.1]} />
      <directionalLight position={[8, 18, 6]} intensity={1.2} />
      <OfficeRooms />
      {placed.map(({ agent, session }) => (
        <AgentFigure
          key={agent.id}
          agent={agent}
          name={agentName(agent, session, t)}
          color={sessionColor(session.main.id)}
          seat={seats.get(agent.id)!}
          selected={selected === agent.id}
          onSelect={select}
        />
      ))}
      <OrbitControls makeDefault enableDamping maxPolarAngle={1.35} minDistance={8} maxDistance={45} />
      <CameraFollow selected={selected} />
    </Canvas>
  );
}
