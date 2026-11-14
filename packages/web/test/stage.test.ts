import { describe, expect, it } from 'vitest';
import type { AgentView, SessionView } from '@agent-office/shared';
import type { Spot } from '../src/scene/layout.ts';
import { Stage } from '../src/scene/stage.ts';

/** The main agent of a session. */
function main(sessionId: string, overrides: Partial<AgentView> = {}): AgentView {
  return { id: `m-${sessionId}`, sessionId, kind: 'main', agentType: 'Session principale', state: 'working', room: 'cartes', since: 0, ...overrides };
}

/** A subagent of a session. */
function sub(id: string, sessionId: string): AgentView {
  return { id, sessionId, kind: 'sub', agentType: 'dexter', state: 'working', room: 'atelier', since: 0 };
}

/** A session with only the fields Stage and sessionChanges read. */
function session(id: string, cliSessionIds: string[] = []): SessionView {
  return { id, cliSessionIds, main: main(id) } as unknown as SessionView;
}

/** A spot where a figure stood. */
function spot(id: string): Spot {
  return { id, x: 1, z: 2, facing: 0, space: 'cartes', anchor: { x: 0, z: 0 }, entry: [] } as unknown as Spot;
}

/** Spots of the previous render for the given agent ids. */
const spots = (...ids: string[]) => new Map(ids.map((id) => [id, spot(`spot-${id}`)]));

const NONE: ReadonlyMap<string, Spot> = new Map();

/** A stage that has seen the route's first snapshot. */
function started(sessions: SessionView[]): Stage {
  const st = new Stage();
  expect(st.update(sessions, true, NONE)).toEqual([]);
  return st;
}

describe('Stage: initial state', () => {
  /**
   * Verifies that a new stage has nobody leaving and nobody coming from the forest
   */
  it('starts empty', () => {
    const st = new Stage();
    expect([...st.leaving.keys()]).toEqual([]);
    expect([...st.fromForest]).toEqual([]);
    expect(st.hidden('m-a')).toBe(false);
  });

  /**
   * Verifies that an agent never seen dying keys its figure by its own id
   */
  it('keys a fresh agent by its id', () => {
    expect(new Stage().key('m-a')).toBe('m-a');
  });
});

describe('Stage.update: first snapshot of a route', () => {
  /**
   * Verifies that the first snapshot sends nobody in or out, whatever it holds
   */
  it('records the first snapshot without appearing or leaving', () => {
    const st = new Stage();
    expect(st.update([session('a'), session('b')], true, spots('m-a', 'm-b'))).toEqual([]);
    expect([...st.fromForest]).toEqual([]);
    expect(st.leaving.size).toBe(0);
  });

  /**
   * Verifies that a session added after the first snapshot comes in from the forest
   */
  it('sends an appeared session in from the forest', () => {
    const st = started([session('a')]);
    expect(st.update([session('a'), session('b')], true, NONE)).toEqual([]);
    expect([...st.fromForest]).toEqual(['b']);
    expect(st.leaving.size).toBe(0);
  });
});

describe('Stage.update: departures', () => {
  /**
   * Verifies that a departed session's main agent with a spot walks out from that spot
   */
  it('makes a departed main agent with a spot leave from it', () => {
    const gone = session('b');
    const st = started([session('a'), gone]);
    const last = spots('m-a', 'm-b');
    expect(st.update([session('a')], true, last)).toEqual([]);
    expect([...st.leaving.keys()]).toEqual(['m-b']);
    const l = st.leaving.get('m-b')!;
    expect(l.agent).toBe(gone.main);
    expect(l.session).toBe(gone);
    expect(l.spot).toBe(last.get('m-b'));
    expect(st.hidden('m-b')).toBe(true);
    expect(st.hidden('m-a')).toBe(false);
  });

  /**
   * Verifies that a departed main agent never placed on stage just disappears
   */
  it('does not make a departed agent without a last spot leave', () => {
    const st = started([session('a'), session('b')]);
    st.update([session('a')], true, spots('m-a'));
    expect(st.leaving.size).toBe(0);
    expect(st.hidden('m-b')).toBe(false);
  });

  /**
   * Verifies that a terminal session absorbed into a desktop session does not leave
   */
  it('does not make an absorbed cli session leave', () => {
    const st = started([session('local_1'), session('cli:abc')]);
    st.update([session('local_1', ['abc'])], true, spots('m-local_1', 'm-cli:abc'));
    expect(st.leaving.size).toBe(0);
    expect(st.fromForest.size).toBe(0);
  });

  /**
   * Verifies that several departures are kept in order of departure
   */
  it('keeps leaving agents in departure order', () => {
    const st = started([session('a'), session('b'), session('c')]);
    const last = spots('m-a', 'm-b', 'm-c');
    st.update([session('a'), session('b')], true, last);
    st.update([session('a')], true, last);
    expect([...st.leaving.keys()]).toEqual(['m-c', 'm-b']);
  });

  /**
   * Verifies that a second departure of a still-dying agent keeps the first record
   */
  it('never duplicates or replaces a leaving agent', () => {
    const first = session('a');
    const st = started([first]);
    st.update([], true, spots('m-a'));
    st.update([session('a')], true, NONE);
    st.update([], true, spots('m-a'));
    expect(st.leaving.size).toBe(1);
    expect(st.leaving.get('m-a')!.session).toBe(first);
  });

  /**
   * Verifies that the same sessions array passed twice changes nothing the second time
   */
  it('is a no-op for the same sessions array', () => {
    const st = started([session('a'), session('b')]);
    const next = [session('a'), session('c')];
    st.update(next, true, spots('m-b'));
    expect([...st.leaving.keys()]).toEqual(['m-b']);
    expect([...st.fromForest]).toEqual(['c']);
    st.gone('m-b');
    st.shown([main('c')]);
    expect(st.update(next, true, spots('m-b'))).toEqual([]);
    expect(st.leaving.size).toBe(0);
    expect(st.fromForest.size).toBe(0);
  });
});

describe('Stage.update: route change', () => {
  /**
   * Verifies that a route change drops every doomed agent and returns their ids in order
   */
  it('drops leaving agents and returns their ids', () => {
    const st = started([session('a'), session('b'), session('c')]);
    st.update([session('c'), session('d')], true, spots('m-a', 'm-b'));
    expect([...st.leaving.keys()]).toEqual(['m-a', 'm-b']);
    expect(st.update([], false, NONE)).toEqual(['m-a', 'm-b']);
    expect(st.leaving.size).toBe(0);
    expect(st.hidden('m-a')).toBe(false);
    expect(st.fromForest.size).toBe(0);
  });

  /**
   * Verifies that a route change mid-death does not bump the key of the dropped agent
   */
  it('keeps the key of an agent dropped mid-death', () => {
    const st = started([session('a')]);
    st.update([], true, spots('m-a'));
    st.update([], false, NONE);
    expect(st.key('m-a')).toBe('m-a');
    // Its figure is no longer doomed: gone is now a no-op.
    st.gone('m-a');
    expect(st.key('m-a')).toBe('m-a');
  });

  /**
   * Verifies that a route change with nobody leaving returns no id
   */
  it('returns [] when nothing was leaving', () => {
    expect(started([session('a')]).update([], false, NONE)).toEqual([]);
    expect(new Stage().update([], false, NONE)).toEqual([]);
  });

  /**
   * Verifies that the snapshot after a route change is treated as the route's first one
   */
  it('treats the next snapshot as the first of the new route', () => {
    const st = started([session('a')]);
    st.update([], false, NONE);
    st.update([session('x'), session('y')], true, spots('m-a'));
    expect(st.fromForest.size).toBe(0);
    expect(st.leaving.size).toBe(0);
    st.update([session('x'), session('y'), session('z')], true, NONE);
    expect([...st.fromForest]).toEqual(['z']);
  });
});

describe('Stage.gone and key', () => {
  /**
   * Verifies that gone ends the death and gives the agent a new figure key
   */
  it('removes the agent from leaving and bumps its key', () => {
    const st = started([session('a')]);
    st.update([], true, spots('m-a'));
    expect(st.key('m-a')).toBe('m-a');
    st.gone('m-a');
    expect(st.hidden('m-a')).toBe(false);
    expect(st.leaving.has('m-a')).toBe(false);
    expect(st.key('m-a')).toBe('m-a~1');
  });

  /**
   * Verifies that gone on an agent that is not leaving changes nothing
   */
  it('ignores unknown ids and repeated calls', () => {
    const st = started([session('a')]);
    st.gone('nobody');
    expect(st.key('nobody')).toBe('nobody');
    st.update([], true, spots('m-a'));
    st.gone('m-a');
    st.gone('m-a');
    expect(st.key('m-a')).toBe('m-a~1');
  });

  /**
   * Verifies that each death of the same agent id gives a new key
   */
  it('counts generations over successive deaths', () => {
    const st = started([session('a')]);
    st.update([], true, spots('m-a'));
    st.gone('m-a');
    st.update([session('a')], true, NONE);
    st.update([], true, spots('m-a'));
    expect(st.key('m-a')).toBe('m-a~1');
    st.gone('m-a');
    expect(st.key('m-a')).toBe('m-a~2');
  });

  /**
   * Verifies that one agent's death does not change another agent's key
   */
  it('keeps keys per agent', () => {
    const st = started([session('a'), session('b')]);
    st.update([session('b')], true, spots('m-a', 'm-b'));
    st.gone('m-a');
    expect(st.key('m-a')).toBe('m-a~1');
    expect(st.key('m-b')).toBe('m-b');
  });
});

describe('Stage.shown', () => {
  /**
   * Verifies that a main agent shown on stage uses up its session's forest arrival
   */
  it('removes the session of a shown main agent from fromForest', () => {
    const st = started([]);
    st.update([session('a'), session('b')], true, NONE);
    st.shown([main('a')]);
    expect([...st.fromForest]).toEqual(['b']);
  });

  /**
   * Verifies that a subagent of the session does not use up the main agent's arrival
   */
  it('ignores subagents', () => {
    const st = started([]);
    st.update([session('a')], true, NONE);
    st.shown([sub('s-1', 'a')]);
    expect([...st.fromForest]).toEqual(['a']);
  });

  /**
   * Verifies that showing agents of unknown sessions or nobody is harmless
   */
  it('ignores sessions not coming from the forest', () => {
    const st = started([]);
    st.update([session('a')], true, NONE);
    st.shown([]);
    st.shown([main('zzz')]);
    expect([...st.fromForest]).toEqual(['a']);
  });
});

describe('Stage: a session that comes back while its agent is still dying', () => {
  /**
   * Verifies that a returning session waits for the dead figure, then enters from the forest
   * with a new key
   */
  it('hides the new figure until gone, then gives it a new key and a forest entry', () => {
    const st = started([session('a')]);
    // The session leaves: its main agent walks out with key K.
    st.update([], true, spots('m-a'));
    const K = st.key('m-a');
    expect(st.hidden('m-a')).toBe(true);

    // It comes back while the old figure is still dying.
    expect(st.update([session('a')], true, NONE)).toEqual([]);
    expect(st.hidden('m-a')).toBe(true);
    expect(st.fromForest.has('a')).toBe(true);
    expect(st.key('m-a')).toBe(K);

    // The dead figure sinks out of sight: the new one may show, as a new figure.
    st.gone('m-a');
    expect(st.hidden('m-a')).toBe(false);
    expect(st.key('m-a')).not.toBe(K);
    // It still has to walk in from the forest.
    expect(st.fromForest.has('a')).toBe(true);

    st.shown([main('a')]);
    expect(st.fromForest.has('a')).toBe(false);
  });

  /**
   * Verifies that later renders keep the returning session's forest entry and hidden state
   */
  it('keeps the forest entry while the new figure is hidden and not shown', () => {
    const st = started([session('a')]);
    st.update([], true, spots('m-a'));
    st.update([session('a')], true, NONE);
    // Repeated renders with the same array change nothing.
    const same = [session('a')];
    st.update(same, true, NONE);
    st.update(same, true, NONE);
    expect(st.fromForest.has('a')).toBe(true);
    expect(st.hidden('m-a')).toBe(true);
  });
});
