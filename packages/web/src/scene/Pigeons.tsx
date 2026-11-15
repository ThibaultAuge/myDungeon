import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { DoubleSide, MeshStandardMaterial, PlaneGeometry, SphereGeometry, type Group, type Mesh } from 'three';
import type { HookEventSummary } from '@agent-office/shared';
import { reducedMotion } from '../motion.ts';
import { useOffice } from '../store.ts';
import { agentPositions } from './AgentFigure.tsx';
import { Kit } from './KitInstances.tsx';
import { ROOM_BY_ID } from './layout.ts';
import {
  dropFall,
  feathersAt,
  freshEvents,
  phaseAt,
  isPigeonOutcome,
  MAX_PIGEONS,
  PLUCKED_FEATHERS,
  pigeonOutcome,
  pigeonPoint,
  Pigeons,
  splatOn,
  type PigeonOutcome,
  type Places,
  type V3,
} from './pigeon.ts';

/** Top of the aviary's upper shelf, where the pigeons take off and land. */
const NEST_Y = 1.8;
/** Top of the head of a main agent, where the dropping lands; below the name tag. */
const HEAD_Y = 1.78;
/** Subagents are drawn smaller (AgentFigure `scale`). */
const SUB_SCALE = 0.85;
/** The lectern's book, where the dropping lands when no agent is there (test command). */
const LECTERN_Y = 1.15;
/** A burst outlives its pigeon's slot: room for one more burst than pigeons. */
const FEATHER_POOL = PLUCKED_FEATHERS * (MAX_PIGEONS + 1);
/** Flight target of the test command when no agent is selected nor in the dovecote. */
const NO_AGENT = '';
const SPLAT_POOL = 8;

function propPoint(kind: string, y: number): V3 {
  const room = ROOM_BY_ID.get('pigeonnier')!;
  const p = room.props.find((x) => x.kind === kind)!;
  return [room.cx + p.x, y, room.cz + p.z];
}

const NEST = propPoint('aviary', NEST_Y);
const LECTERN = propPoint('lectern', LECTERN_Y);

// Shared at module scope: a handful of meshes at most.
const featherGeometry = new PlaneGeometry(0.09, 0.26);
const featherMaterial = new MeshStandardMaterial({ color: '#f4f1ea', side: DoubleSide, roughness: 0.9 });
const dropGeometry = new SphereGeometry(0.09, 10, 8);
const splatGeometry = new SphereGeometry(0.17, 12, 6);
const dropMaterial = new MeshStandardMaterial({ color: '#f7f7f2', roughness: 0.35 });

const now = () => performance.now() / 1000;

/**
 * Figure id of the agent an event belongs to. The main agent's is the session's main id, never
 * one rebuilt from the session id: an absorbed session keeps its earlier main id (potion.ts).
 */
function eventAgentId(e: HookEventSummary): string {
  if (e.agentId !== undefined) return e.agentId;
  const session = useOffice.getState().sessions.find((s) => s.id === e.sessionId);
  return session?.main.id ?? `${e.sessionId}#main`;
}

function agentShown(id: string): boolean {
  return useOffice.getState().sessions.some((s) => s.main.id === id || s.subagents.some((a) => a.id === id));
}

/**
 * Whether an event belongs to the dungeon on screen: events reach every page. A subagent
 * of a shown session counts even before the snapshot that brings its figure.
 */
function eventShown(e: HookEventSummary): boolean {
  return agentShown(eventAgentId(e)) || useOffice.getState().sessions.some((s) => s.id === e.sessionId);
}

/** First agent working in the dovecote: the test command's target when no agent is selected. */
function dovecoteAgent(): string | undefined {
  for (const s of useOffice.getState().sessions) {
    for (const a of [s.main, ...s.subagents]) if (a.room === 'pigeonnier' && a.state !== 'done') return a.id;
  }
  return undefined;
}

function placesFor(agentId: string): Places {
  const p = agentPositions.get(agentId);
  const scale = agentId.endsWith('#main') ? 1 : SUB_SCALE;
  return { nest: NEST, head: p ? [p.x, p.y + HEAD_Y * scale, p.z] : LECTERN };
}

/**
 * Samuel-Morse's pigeons (pigeon.ts): one leaves the aviary on each HTTP call of an agent in
 * the dovecote (`httpCall` of hook events) and comes back with the outcome. Decorative,
 * 3D only. Also installs the test command `agentOffice.pigeon(issue?, agentId?)`.
 */
export function PigeonFlights() {
  const pigeons = useMemo(() => new Pigeons(), []);
  const birds = useRef<(Group | null)[]>([]);
  const feathers = useRef<(Mesh | null)[]>([]);
  const drops = useRef<(Mesh | null)[]>([]);
  const splats = useRef<(Mesh | null)[]>([]);
  /** Last drawn position of each flight, by flight id, for its heading. */
  const lastPos = useRef(new Map<number, V3>());

  // Hook events: only the ones that arrive from now on, oldest first.
  useEffect(
    () =>
      useOffice.subscribe((state, prev) => {
        for (const e of freshEvents(state.events, prev.events)) {
          if (!e.httpCall || !eventShown(e)) continue;
          const id = eventAgentId(e);
          if (e.httpCall === 'start') pigeons.start(id, now());
          else pigeons.land(id, pigeonOutcome(e.httpCall), now());
        }
      }),
    [pigeons],
  );

  // Test command, kept on purpose: `agentOffice.pigeon('dropping')` in the browser console.
  useEffect(() => {
    const w = window as unknown as { agentOffice?: unknown };
    if (typeof w.agentOffice !== 'object' || w.agentOffice === null) w.agentOffice = {};
    const ns = w.agentOffice as Record<string, unknown>;
    // Same contract as the other gags' commands (docs/commandes-console.md): true when a pigeon left.
    const command = (issue: PigeonOutcome = 'back', agentId?: string): boolean => {
      if (!isPigeonOutcome(issue)) return false;
      // An explicit id must name a figure on stage; without one, the lectern takes the dropping.
      if (agentId !== undefined && !agentPositions.has(agentId)) return false;
      const id = agentId ?? useOffice.getState().selectedAgentId ?? dovecoteAgent() ?? NO_AGENT;
      return pigeons.force(id, issue, now()) !== null;
    };
    ns.pigeon = command;
    return () => {
      if (ns.pigeon === command) delete ns.pigeon;
    };
  }, [pigeons]);

  useFrame(() => {
    const t = now();
    pigeons.update(t);
    const still = reducedMotion();
    let bird = 0;
    let feather = 0;
    let drop = 0;
    let splat = 0;
    for (const f of pigeons.flights) {
      if (f.silent) continue;
      const places = placesFor(f.agentId);
      const pos = still ? null : pigeonPoint(f, t, places);
      if (pos && bird < MAX_PIGEONS) {
        const g = birds.current[bird];
        if (g) {
          const prev = lastPos.current.get(f.id) ?? pos;
          const dx = pos[0] - prev[0];
          const dz = pos[2] - prev[2];
          if (dx * dx + dz * dz > 1e-6) g.rotation.y = Math.atan2(dx, dz);
          const flying = phaseAt(f, t).phase !== 'landed';
          g.rotation.z = flying ? Math.sin(t * 22 + f.id) * 0.35 : 0;
          g.position.set(pos[0], pos[1] + (flying ? Math.abs(Math.sin(t * 22 + f.id)) * 0.06 : 0), pos[2]);
          // A plucked pigeon comes back skinny.
          g.scale.set(f.outcome === 'plucked' ? 0.6 : 1, 1, 1);
          g.visible = true;
        }
        lastPos.current.set(f.id, pos);
        bird++;
      }
      if (!still) {
        for (const fe of feathersAt(f, t, places)) {
          const m = feathers.current[feather++];
          if (!m) break;
          m.position.set(fe.pos[0], fe.pos[1], fe.pos[2]);
          m.rotation.set(Math.sin(fe.spin) * 0.8, fe.spin, Math.cos(fe.spin) * 0.5);
          m.visible = true;
        }
        const fall = dropFall(f, t);
        if (fall !== undefined && drop < MAX_PIGEONS) {
          const m = drops.current[drop++];
          if (m) {
            const h = places.head;
            m.position.set(h[0], h[1] + 1.0 * (1 - fall * fall), h[2]);
            m.visible = true;
          }
        }
      }
      if (splatOn(f, t) && splat < SPLAT_POOL) {
        const m = splats.current[splat++];
        if (m) {
          const h = places.head;
          m.position.set(h[0], h[1], h[2]);
          m.visible = true;
        }
      }
    }
    for (let i = bird; i < MAX_PIGEONS; i++) {
      const g = birds.current[i];
      if (g) g.visible = false;
    }
    for (const id of lastPos.current.keys()) if (!pigeons.flights.some((f) => f.id === id)) lastPos.current.delete(id);
    for (let i = feather; i < FEATHER_POOL; i++) if (feathers.current[i]) feathers.current[i]!.visible = false;
    for (let i = drop; i < MAX_PIGEONS; i++) if (drops.current[i]) drops.current[i]!.visible = false;
    for (let i = splat; i < SPLAT_POOL; i++) if (splats.current[i]) splats.current[i]!.visible = false;
  });

  return (
    <group>
      {Array.from({ length: MAX_PIGEONS }, (_, i) => (
        <group
          key={`bird${i}`}
          ref={(g) => {
            birds.current[i] = g;
            // Decorative: never a pointer target.
            g?.traverse((o) => void (o.raycast = () => {}));
          }}
          visible={false}
        >
          <Kit pack="mixed1" name="chicken_plushie_A" pos={[0, -0.3, 0]} scale={0.4} shadow={false} />
        </group>
      ))}
      {Array.from({ length: FEATHER_POOL }, (_, i) => (
        <mesh
          key={`feather${i}`}
          ref={(m) => void (feathers.current[i] = m)}
          geometry={featherGeometry}
          material={featherMaterial}
          visible={false}
          raycast={() => null}
        />
      ))}
      {Array.from({ length: MAX_PIGEONS }, (_, i) => (
        <mesh
          key={`drop${i}`}
          ref={(m) => void (drops.current[i] = m)}
          geometry={dropGeometry}
          material={dropMaterial}
          visible={false}
          raycast={() => null}
        />
      ))}
      {Array.from({ length: SPLAT_POOL }, (_, i) => (
        <mesh
          key={`splat${i}`}
          ref={(m) => void (splats.current[i] = m)}
          geometry={splatGeometry}
          material={dropMaterial}
          scale={[1, 0.35, 1]}
          visible={false}
          raycast={() => null}
        />
      ))}
    </group>
  );
}
