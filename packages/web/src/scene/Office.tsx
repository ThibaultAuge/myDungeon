import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, SoftShadows } from '@react-three/drei';
import { NeutralToneMapping } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { AgentView, SessionView } from '@agent-office/shared';
import { agentName, sessionColor } from '../format.ts';
import { useT } from '../i18n/useT.ts';
import { useOffice } from '../store.ts';
import { useNow } from '../useNow.ts';
import { AgentFigure, agentPositions } from './AgentFigure.tsx';
import { assignSpots, BOUNDS, SPAWN, type SeatMemory, type SeatRequest, type Spot } from './layout.ts';
import { OfficeRooms } from './Room.tsx';
import { inheritSeats, NEUTRAL_COLOR, restId, restingAgent, restingTypes, startOrigins } from './tavern.ts';

/**
 * Finished subagents leave the scene when they reach the tavern. This cap only hides the
 * ones that never get there (a background tab renders no frame).
 */
const DONE_VISIBLE_MS = 3 * 60_000;

/** Middle of the dungeon, where the camera looks at first. */
const CENTER: [number, number, number] = [(BOUNDS.x0 + BOUNDS.x1) / 2, 0, (BOUNDS.z0 + BOUNDS.z1) / 2];

interface Placed {
  agent: AgentView;
  session: SessionView;
}

/**
 * Agents shown in 3D: main agents of live sessions and their recent subagents. The
 * subagents of a session that just ended still walk back to the tavern.
 */
export function visibleAgents(sessions: SessionView[], now: number): Placed[] {
  const out: Placed[] = [];
  for (const s of sessions) {
    if (s.live) out.push({ agent: s.main, session: s });
    for (const sub of s.subagents) {
      if (!s.live && sub.state !== 'done') continue;
      if (sub.state !== 'done' || now - sub.since < DONE_VISIBLE_MS) out.push({ agent: sub, session: s });
    }
  }
  return out;
}

/**
 * Keeps each agent on the same seat while it stays in a room; queues the waiting ones at
 * the altar. Resting figures sit in the tavern, where the agent of their type came back.
 */
function useSpots(placed: Placed[], resting: AgentView[], returned: AgentView[]): Map<string, Spot> {
  const memory = useRef<SeatMemory>(new Map());
  // Resting figures first: they keep their seats when a main agent comes to rest.
  const requests: SeatRequest[] = [...resting, ...placed.map((p) => p.agent)].map((agent) => ({
    id: agent.id,
    room: agent.room,
    agentType: agent.agentType,
    queued: agent.state === 'waiting' && agent.room === 'autel',
    since: agent.since,
  }));
  const key = requests.map((r) => `${r.id}@${r.room}/${r.queued}/${r.since}`).join('|');
  return useMemo(
    () => {
      inheritSeats(
        memory.current,
        resting.map((a) => a.agentType),
        returned,
      );
      return assignSpots(requests, memory.current);
    },
    [key], // eslint-disable-line react-hooks/exhaustive-deps
  );
}

/**
 * Where each figure appearing now starts walking from: the seat of the resting figure of
 * its type, the lockers, or its own spot. `AgentFigure` reads it on mount only.
 */
function useStarts(
  shown: AgentView[],
  resting: AgentView[],
  spots: Map<string, Spot>,
  snapshotReceived: boolean,
): Map<string, Spot> {
  const mounted = useRef(new Set<string>());
  const previous = useRef<{ resting: Set<string>; spots: Map<string, Spot> }>({ resting: new Set(), spots: new Map() });
  // The agents of the route's first snapshot (page load, environment change) are already in
  // place: nobody walks in. Only the ones appearing in later snapshots walk.
  const loaded = useRef(false);
  const newcomers = shown.filter((a) => !mounted.current.has(a.id));
  const origins = startOrigins(newcomers, previous.current.resting);
  const starts = new Map<string, Spot>();
  for (const a of loaded.current ? newcomers : []) {
    const origin = origins.get(a.id);
    if (origin === 'rest') starts.set(a.id, previous.current.spots.get(restId(a.agentType)) ?? SPAWN);
    else if (origin === 'lockers') starts.set(a.id, SPAWN);
  }
  useEffect(() => {
    mounted.current = new Set(shown.map((a) => a.id));
    loaded.current = snapshotReceived;
    previous.current = { resting: new Set(resting.map((a) => a.agentType.toLowerCase())), spots };
  });
  return starts;
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

/** Warm sun from the south-east, casting soft shadows over the whole dungeon. */
function SunLight() {
  const { x0, x1, z0, z1 } = BOUNDS;
  const half = Math.max(x1 - x0, z1 - z0) / 2 + 6;
  return (
    <directionalLight
      position={[CENTER[0] + 14, 32, CENTER[2] + 12]}
      intensity={2.2}
      color="#fff1dc"
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.03}
      shadow-camera-left={-half}
      shadow-camera-right={half}
      shadow-camera-top={half}
      shadow-camera-bottom={-half}
      shadow-camera-near={1}
      shadow-camera-far={90}
    >
      <object3D attach="target" position={CENTER} />
    </directionalLight>
  );
}

export function OfficeScene() {
  const sessions = useOffice((s) => s.sessions);
  const roster = useOffice((s) => s.roster);
  const snapshotReceived = useOffice((s) => s.snapshotReceived);
  const selected = useOffice((s) => s.selectedAgentId);
  const select = useOffice((s) => s.select);
  const selectPost = useOffice((s) => s.selectPost);
  const now = useNow();
  const { t } = useT();
  // Finished subagents that reached the tavern: they have left the scene.
  const [arrived, setArrived] = useState<ReadonlySet<string>>(() => new Set());
  const onArrive = useCallback((id: string) => setArrived((prev) => (prev.has(id) ? prev : new Set(prev).add(id))), []);
  useEffect(() => {
    // Keep only the ones the server still reports as finished: a resumed agent walks back again when it ends.
    const ids = new Set(sessions.flatMap((s) => s.subagents.filter((a) => a.state === 'done').map((a) => a.id)));
    setArrived((prev) => ([...prev].every((id) => ids.has(id)) ? prev : new Set([...prev].filter((id) => ids.has(id)))));
  }, [sessions]);

  const placed = visibleAgents(sessions, now).filter((p) => !(p.agent.state === 'done' && arrived.has(p.agent.id)));
  const shown = placed.map((p) => p.agent);
  // Stable objects while the resting types do not change, so memoised figures skip renders.
  const restingKey = restingTypes(roster, shown).join('\n');
  const resting = useMemo(() => (restingKey ? restingKey.split('\n').map(restingAgent) : []), [restingKey]);
  const returned = sessions.flatMap((s) => s.subagents.filter((a) => arrived.has(a.id)));
  const spots = useSpots(placed, resting, returned);
  const starts = useStarts(shown, resting, spots, snapshotReceived);

  return (
    <Canvas
      shadows
      camera={{ position: [CENTER[0], 40, CENTER[2] + 30], fov: 42 }}
      dpr={[1, 2]}
      gl={{ toneMapping: NeutralToneMapping }}
      onPointerMissed={() => {
        select(null);
        selectPost(null);
      }}
    >
      <SoftShadows size={18} samples={10} focus={0.6} />
      <hemisphereLight args={['#fff6e8', '#8a8478', 1.6]} />
      <SunLight />
      <OfficeRooms />
      {resting.map((agent) => (
        <AgentFigure
          key={agent.id}
          agent={agent}
          name={agent.agentType}
          color={NEUTRAL_COLOR}
          spot={spots.get(agent.id)!}
          start={spots.get(agent.id)!}
          selected={false}
        />
      ))}
      {placed.map(({ agent, session }) => (
        <AgentFigure
          key={agent.id}
          agent={agent}
          name={agentName(agent, session, t)}
          color={agent.state === 'done' ? NEUTRAL_COLOR : sessionColor(session.main.id)}
          spot={spots.get(agent.id)!}
          start={starts.get(agent.id) ?? spots.get(agent.id)!}
          selected={selected === agent.id}
          onSelect={select}
          onArrive={agent.kind === 'sub' ? onArrive : undefined}
        />
      ))}
      <OrbitControls makeDefault target={CENTER} enableDamping maxPolarAngle={1.35} minDistance={8} maxDistance={80} />
      <CameraFollow selected={selected} />
    </Canvas>
  );
}
