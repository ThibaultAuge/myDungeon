import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, SoftShadows } from '@react-three/drei';
import { NeutralToneMapping } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { AgentView, SessionView } from '@agent-office/shared';
import { agentName, sessionColor, typeLabel } from '../format.ts';
import { useT } from '../i18n/useT.ts';
import { useOffice } from '../store.ts';
import { useNow } from '../useNow.ts';
import { AgentFigure, agentPositions } from './AgentFigure.tsx';
import { altarForceVersion, installAltarCommand, onAltarForce, shownAltarStage } from './altarWait.ts';
import { Ambush } from './ambush.ts';
import { AmbushScene } from './Ambush.tsx';
import { DungeonSign } from './DungeonSign.tsx';
import { Forest } from './Forest.tsx';
import { Ghosts, isGhost } from './ghost.ts';
import { GhostFigure } from './GhostFigure.tsx';
import { NIGHT_SKY, scatterTrees } from './forest.ts';
import { assignSpots, BOUNDS, SPAWN, type SeatMemory, type SeatRequest, type Spot } from './layout.ts';
import { ENTRY_SPOT, PAN_MARGIN } from './outside.ts';
import { PigeonFlights } from './Pigeons.tsx';
import { OfficeRooms } from './Room.tsx';
import { MishapProps } from './MishapProps.tsx';
import { MishapWatcher } from './MishapWatcher.tsx';
import { Stage } from './stage.ts';
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
 * Agents shown in 3D: main agents of every session still listed (a stopped one rests in the
 * tavern until it is deleted) and their recent subagents. The subagents of a session that
 * just ended still walk back to the tavern.
 */
export function visibleAgents(sessions: SessionView[], now: number): Placed[] {
  const out: Placed[] = [];
  for (const s of sessions) {
    // A ghost session is drawn as a wandering ghost (GhostFigure), never as a seated agent.
    if ((s.live || !s.archived) && !isGhost(s)) out.push({ agent: s.main, session: s });
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
  stage: Stage,
): Map<string, Spot> {
  const mounted = useRef(new Set<string>());
  const previous = useRef<{ resting: Set<string>; spots: Map<string, Spot> }>({ resting: new Set(), spots: new Map() });
  // The agents of the route's first snapshot (page load, environment change) are already in
  // place: nobody walks in. Only the ones appearing in later snapshots walk.
  const loaded = useRef(false);
  const newcomers = shown.filter((a) => !mounted.current.has(a.id));
  const origins = startOrigins(newcomers, previous.current.resting, stage.fromForest);
  const starts = new Map<string, Spot>();
  for (const a of loaded.current ? newcomers : []) {
    const origin = origins.get(a.id);
    if (origin === 'rest') starts.set(a.id, previous.current.spots.get(restId(a.agentType)) ?? SPAWN);
    else if (origin === 'lockers') starts.set(a.id, SPAWN);
    else if (origin === 'forest') starts.set(a.id, ENTRY_SPOT);
  }
  useEffect(() => {
    stage.shown(shown);
    mounted.current = new Set(shown.map((a) => a.id));
    loaded.current = snapshotReceived;
    previous.current = { resting: new Set(resting.map((a) => a.agentType.toLowerCase())), spots };
  });
  return starts;
}

function CameraFollow({ selected }: { selected: string | null }) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  useFrame(() => {
    if (!controls) return;
    const pos = selected ? agentPositions.get(selected) : undefined;
    // OrbitControls already updates itself every frame.
    if (pos) controls.target.lerp(pos, 0.06);
    const t = controls.target;
    t.x = Math.min(Math.max(t.x, BOUNDS.x0 - PAN_MARGIN), BOUNDS.x1 + PAN_MARGIN);
    t.z = Math.min(Math.max(t.z, BOUNDS.z0 - PAN_MARGIN), BOUNDS.z1 + PAN_MARGIN);
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

/** The dungeon shown: its name on the sign past the drawbridge, its colour on the pennants. */
export interface Dungeon {
  name: string;
  color: string;
}

export function OfficeScene({ dungeon }: { dungeon?: Dungeon }) {
  const sessions = useOffice((s) => s.sessions);
  const roster = useOffice((s) => s.roster);
  const snapshotReceived = useOffice((s) => s.snapshotReceived);
  const selected = useOffice((s) => s.selectedAgentId);
  const select = useOffice((s) => s.select);
  const selectPost = useOffice((s) => s.selectPost);
  const now = useNow();
  const { t } = useT();
  // The endless wait at the altar: a forced stage (test command) re-renders at once.
  useSyncExternalStore(onAltarForce, altarForceVersion);
  // Test command `agentOffice.autel(stage?, id?)`, for the console.
  useEffect(
    () =>
      installAltarCommand(window, {
        selected: () => useOffice.getState().selectedAgentId,
        atAltar: () =>
          useOffice
            .getState()
            .sessions.flatMap((s) => [s.main, ...s.subagents])
            .filter((a) => a.state === 'waiting' && a.room === 'autel')
            .map((a) => a.id),
        log: (message) => console.info(message),
      }),
    [],
  );
  // Finished subagents that reached the tavern: they have left the scene.
  const [arrived, setArrived] = useState<ReadonlySet<string>>(() => new Set());
  const onArrive = useCallback((id: string) => setArrived((prev) => (prev.has(id) ? prev : new Set(prev).add(id))), []);
  useEffect(() => {
    // Keep only the ones the server still reports as finished: a resumed agent walks back again when it ends.
    const ids = new Set(sessions.flatMap((s) => s.subagents.filter((a) => a.state === 'done').map((a) => a.id)));
    setArrived((prev) => ([...prev].every((id) => ids.has(id)) ? prev : new Set([...prev].filter((id) => ids.has(id)))));
  }, [sessions]);

  // Deleted sessions: their main agent walks out and dies at the skeletons' hands.
  // useState, not useMemo: these hold state for the scene's whole life, never a cache.
  const [ambush] = useState(() => new Ambush(scatterTrees().near.map((tree) => ({ x: tree.x, z: tree.z }))));
  const [stage] = useState(() => new Stage());
  const lastSpots = useRef(new Map<string, Spot>());
  const [goneCount, setGoneCount] = useState(0);
  const onGone = useCallback(
    (id: string) => {
      stage.gone(id);
      ambush.release(id);
      setGoneCount((n) => n + 1);
    },
    [stage, ambush],
  );
  // Computed during render, not in an effect: a departed figure must not unmount for a frame.
  // Idempotent for the same sessions, so a repeated render (StrictMode) changes nothing more.
  useMemo(() => {
    for (const id of stage.update(sessions, snapshotReceived, lastSpots.current)) ambush.release(id);
  }, [sessions, snapshotReceived, stage, ambush]);

  // Ghost sessions wander the corridors and evaporate when they leave.
  const [ghostRoll] = useState(() => new Ghosts());
  // goneCount: an evaporated ghost leaves the list on the render its `gone` triggers.
  const ghosts = useMemo(
    () => ghostRoll.update(sessions, snapshotReceived),
    [sessions, snapshotReceived, ghostRoll, goneCount], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const onGhostGone = useCallback(
    (id: string) => {
      ghostRoll.gone(id);
      setGoneCount((n) => n + 1);
    },
    [ghostRoll],
  );

  const placed = visibleAgents(sessions, now).filter(
    (p) => !(p.agent.state === 'done' && arrived.has(p.agent.id)) && !stage.hidden(p.agent.id),
  );
  const shown = placed.map((p) => p.agent);
  // Stable objects while the resting types do not change, so memoised figures skip renders.
  const restingKey = restingTypes(roster, shown).join('\n');
  const resting = useMemo(() => (restingKey ? restingKey.split('\n').map(restingAgent) : []), [restingKey]);
  const returned = sessions.flatMap((s) => s.subagents.filter((a) => arrived.has(a.id)));
  const spots = useSpots(placed, resting, returned);
  lastSpots.current = spots;
  const starts = useStarts(shown, resting, spots, snapshotReceived, stage);

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
      <color attach="background" args={[NIGHT_SKY]} />
      <SoftShadows size={18} samples={10} focus={0.6} />
      <hemisphereLight args={['#fff6e8', '#8a8478', 1.6]} />
      <SunLight />
      <Forest />
      {dungeon?.name && <DungeonSign name={dungeon.name} color={dungeon.color} />}
      <OfficeRooms />
      <MishapWatcher />
      <MishapProps />
      {resting.map((agent) => (
        <AgentFigure
          key={agent.id}
          agent={agent}
          name={typeLabel(agent.agentType)}
          color={NEUTRAL_COLOR}
          spot={spots.get(agent.id)!}
          start={spots.get(agent.id)!}
          selected={selected === agent.id}
          altarStage={shownAltarStage(agent, now)}
          // Clicking a resting figure opens its short introduction (keyboard route: RosterList).
          onSelect={select}
        />
      ))}
      {/* One list, so a figure whose session leaves keeps its mount (and position) as it walks
          out; the key changes once it is gone, so a reappeared agent is a new figure. */}
      {[
        ...placed.map(({ agent, session }) => (
          <AgentFigure
            key={stage.key(agent.id)}
            agent={agent}
            name={agentName(agent, session, t)}
            // A stopped session's main agent keeps its colour in the tavern: still recognisable.
            color={agent.state === 'done' && agent.kind === 'sub' ? NEUTRAL_COLOR : sessionColor(session.main.id)}
            spot={spots.get(agent.id)!}
            start={starts.get(agent.id) ?? spots.get(agent.id)!}
            selected={selected === agent.id}
            // A stopped session's main agent rests, not selectable: the side panel (the
            // keyboard route) lists live sessions only.
            onSelect={agent.kind === 'main' && !session.live ? undefined : select}
            onArrive={agent.kind === 'sub' ? onArrive : undefined}
            altarStage={shownAltarStage(agent, now)}
          />
        )),
        ...[...stage.leaving.values()].map(({ agent, session, spot }) => (
          <AgentFigure
            key={stage.key(agent.id)}
            agent={agent}
            name={agentName(agent, session, t)}
            color={sessionColor(session.main.id)}
            spot={spot}
            start={spot}
            selected={false}
            exit={ambush}
            onGone={onGone}
          />
        )),
      ]}
      {ghosts.map(({ session, leaving }) => (
        <GhostFigure
          key={`ghost:${session.id}`}
          id={session.id}
          name={agentName(session.main, session, t)}
          color={sessionColor(session.main.id)}
          // A seated agent that just became a ghost: the ghost rises from its body.
          bodyId={session.main.id}
          leaving={leaving}
          onGone={onGhostGone}
        />
      ))}
      <AmbushScene ambush={ambush} />
      <PigeonFlights />

      <OrbitControls makeDefault target={CENTER} enableDamping maxPolarAngle={1.35} minDistance={8} maxDistance={80} />
      <CameraFollow selected={selected} />
    </Canvas>
  );
}
