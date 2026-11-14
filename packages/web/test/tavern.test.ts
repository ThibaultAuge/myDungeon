import { describe, expect, it } from 'vitest';
import type { AgentView } from '@agent-office/shared';
import type { SeatMemory } from '../src/scene/layout.ts';
import { NEUTRAL_COLOR, inheritSeats, restId, restingAgent, restingTypes, startOrigins } from '../src/scene/tavern.ts';

/** A subagent on stage, working by default. */
function sub(id: string, agentType: string, overrides: Partial<AgentView> = {}): AgentView {
  return { id, sessionId: 's1', kind: 'sub', agentType, state: 'working', room: 'atelier', since: 0, ...overrides };
}

/** A main agent on stage. */
function main(id: string, overrides: Partial<AgentView> = {}): AgentView {
  return { id, sessionId: 's1', kind: 'main', agentType: 'Session principale', state: 'working', room: 'cartes', since: 0, ...overrides };
}

describe('NEUTRAL_COLOR', () => {
  /**
   * Verifies that the neutral colour is a six-digit hex colour usable by three.js
   */
  it('is a hex colour', () => {
    expect(NEUTRAL_COLOR).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe('restId', () => {
  /**
   * Verifies that the resting id is the lower-case type behind a rest: prefix
   */
  it('prefixes the lower-case type', () => {
    expect(restId('Explore')).toBe('rest:explore');
    expect(restId('samuel-morse')).toBe('rest:samuel-morse');
  });

  /**
   * Verifies that the same type in any case maps to one resting id
   */
  it('is case-insensitive', () => {
    expect(restId('DEXTER')).toBe(restId('dexter'));
    expect(restId('Dexter')).toBe(restId('dexter'));
  });

  /**
   * Verifies that different types never share a resting id
   */
  it('differs between types', () => {
    expect(restId('neo')).not.toBe(restId('oracle'));
  });
});

describe('restingAgent', () => {
  /**
   * Verifies that a resting figure is a finished, sessionless subagent in the tavern
   */
  it('builds a done subagent in the tavern', () => {
    expect(restingAgent('Explore')).toEqual({
      id: 'rest:explore',
      sessionId: '',
      kind: 'sub',
      agentType: 'Explore',
      state: 'done',
      room: 'taverne',
      since: 0,
    });
  });

  /**
   * Verifies that the figure keeps the type's spelling while its id is lower-case
   */
  it('keeps the original type spelling', () => {
    const a = restingAgent('Samuel-Morse');
    expect(a.agentType).toBe('Samuel-Morse');
    expect(a.id).toBe(restId('samuel-morse'));
  });

  /**
   * Verifies that each call returns a new object, so callers cannot share mutations
   */
  it('returns a fresh object on each call', () => {
    const a = restingAgent('neo');
    a.room = 'garde';
    expect(restingAgent('neo').room).toBe('taverne');
  });
});

describe('restingTypes', () => {
  const roster = ['dexter', 'Explore', 'neo'];

  /**
   * Verifies that every roster type rests when nothing is on stage
   */
  it('returns the whole roster with an empty stage', () => {
    expect(restingTypes(roster, [])).toEqual(roster);
  });

  /**
   * Verifies that an empty roster has nothing resting
   */
  it('returns [] for an empty roster', () => {
    expect(restingTypes([], [sub('a', 'neo')])).toEqual([]);
  });

  /**
   * Verifies that a type with a working subagent on stage does not rest
   */
  it('removes types with a subagent on stage', () => {
    expect(restingTypes(roster, [sub('a', 'Explore')])).toEqual(['dexter', 'neo']);
  });

  /**
   * Verifies that waiting and walking-back (done) subagents also keep their type off the bench
   */
  it.each(['working', 'waiting', 'done'] as const)('counts a %s subagent as on stage', (state) => {
    expect(restingTypes(roster, [sub('a', 'neo', { state })])).toEqual(['dexter', 'Explore']);
  });

  /**
   * Verifies that on-stage types match roster types whatever their case
   */
  it('matches types case-insensitively', () => {
    expect(restingTypes(roster, [sub('a', 'DEXTER'), sub('b', 'explore')])).toEqual(['neo']);
  });

  /**
   * Verifies that main agents never take a type off the bench, even with a matching name
   */
  it('ignores main agents', () => {
    expect(restingTypes(roster, [main('m', { agentType: 'neo' })])).toEqual(roster);
  });

  /**
   * Verifies that subagents of types outside the roster change nothing
   */
  it('ignores on-stage types absent from the roster', () => {
    expect(restingTypes(roster, [sub('a', 'general-purpose')])).toEqual(roster);
  });

  /**
   * Verifies that the roster order is preserved and the inputs are not mutated
   */
  it('keeps roster order and does not mutate the roster', () => {
    const r = ['zeta', 'alpha', 'mid'];
    expect(restingTypes(r, [sub('a', 'alpha')])).toEqual(['zeta', 'mid']);
    expect(r).toEqual(['zeta', 'alpha', 'mid']);
  });
});

describe('startOrigins', () => {
  /**
   * Verifies that no newcomer yields an empty map
   */
  it('returns an empty map without newcomers', () => {
    expect(startOrigins([], new Set(['neo'])).size).toBe(0);
  });

  /**
   * Verifies that main agents start in place
   */
  it('starts main agents at their seat', () => {
    expect(startOrigins([main('m')], new Set(['session principale']))).toEqual(new Map([['m', 'seat']]));
  });

  /**
   * Verifies that finished subagents found on loading start in place, even if their type rested
   */
  it('starts done subagents at their seat', () => {
    expect(startOrigins([sub('d', 'neo', { state: 'done' })], new Set(['neo']))).toEqual(new Map([['d', 'seat']]));
  });

  /**
   * Verifies that a subagent of a resting type takes the resting figure's place
   */
  it('starts a subagent of a resting type from the rest', () => {
    expect(startOrigins([sub('a', 'neo')], new Set(['neo']))).toEqual(new Map([['a', 'rest']]));
  });

  /**
   * Verifies that a waiting subagent of a resting type also stands up from the rest
   */
  it('treats a waiting subagent like a working one', () => {
    expect(startOrigins([sub('a', 'neo', { state: 'waiting' })], new Set(['neo'])).get('a')).toBe('rest');
  });

  /**
   * Verifies that a subagent whose type was not resting comes out of the lockers
   */
  it('starts a subagent of a non-resting type from the lockers', () => {
    expect(startOrigins([sub('a', 'neo')], new Set(['oracle']))).toEqual(new Map([['a', 'lockers']]));
    expect(startOrigins([sub('b', 'neo')], new Set())).toEqual(new Map([['b', 'lockers']]));
  });

  /**
   * Verifies that resting types match the newcomer's type case-insensitively
   */
  it('matches the newcomer type in lower case', () => {
    expect(startOrigins([sub('a', 'Explore')], new Set(['explore'])).get('a')).toBe('rest');
  });

  /**
   * Verifies that among same-type newcomers the oldest takes the rest and others the lockers
   */
  it('gives the rest to the oldest newcomer of a type, whatever the input order', () => {
    const newcomers = [sub('late', 'neo', { since: 300 }), sub('early', 'neo', { since: 100 }), sub('mid', 'neo', { since: 200 })];
    expect(startOrigins(newcomers, new Set(['neo']))).toEqual(
      new Map([
        ['early', 'rest'],
        ['mid', 'lockers'],
        ['late', 'lockers'],
      ]),
    );
  });

  /**
   * Verifies that equal start times are broken by id so the result is stable
   */
  it('breaks ties on since by id', () => {
    const origins = startOrigins([sub('b', 'neo', { since: 5 }), sub('a', 'neo', { since: 5 })], new Set(['neo']));
    expect(origins.get('a')).toBe('rest');
    expect(origins.get('b')).toBe('lockers');
  });

  /**
   * Verifies that each resting type is claimed independently of the others
   */
  it('claims one rest per type', () => {
    const origins = startOrigins(
      [sub('n1', 'neo', { since: 1 }), sub('o1', 'oracle', { since: 2 }), sub('n2', 'NEO', { since: 3 }), sub('x', 'turing', { since: 0 })],
      new Set(['neo', 'oracle']),
    );
    expect(origins).toEqual(
      new Map([
        ['x', 'lockers'],
        ['n1', 'rest'],
        ['o1', 'rest'],
        ['n2', 'lockers'],
      ]),
    );
  });

  /**
   * Verifies that an older done subagent does not claim the rest from a working one of its type
   */
  it('does not let a done or main newcomer claim the rest', () => {
    const origins = startOrigins(
      [sub('done', 'neo', { state: 'done', since: 0 }), main('m', { since: 0 }), sub('work', 'neo', { since: 10 })],
      new Set(['neo']),
    );
    expect(origins.get('done')).toBe('seat');
    expect(origins.get('m')).toBe('seat');
    expect(origins.get('work')).toBe('rest');
  });

  /**
   * Verifies that the newcomers array keeps its order after the call
   */
  it('does not reorder the newcomers', () => {
    const newcomers = [sub('late', 'neo', { since: 300 }), sub('early', 'neo', { since: 100 })];
    startOrigins(newcomers, new Set(['neo']));
    expect(newcomers.map((a) => a.id)).toEqual(['late', 'early']);
  });
});

describe('inheritSeats', () => {
  type Seat = SeatMemory extends Map<string, infer V> ? V : never;
  const seatA: Seat = { room: 'taverne', seatId: 'taverne-3' };
  const seatB: Seat = { room: 'taverne', seatId: 'taverne-7' };

  /**
   * Verifies that a resting type takes the seat of its returned agent
   */
  it('gives the resting figure the seat of the returned agent', () => {
    const memory: SeatMemory = new Map([['ag-1', seatA]]);
    inheritSeats(memory, ['Explore'], [sub('ag-1', 'Explore', { state: 'done' })]);
    expect(memory.get(restId('Explore'))).toEqual(seatA);
  });

  /**
   * Verifies that the returned agent keeps its own seat entry
   */
  it('keeps the returned agent seat', () => {
    const memory: SeatMemory = new Map([['ag-1', seatA]]);
    inheritSeats(memory, ['Explore'], [sub('ag-1', 'Explore')]);
    expect(memory.get('ag-1')).toEqual(seatA);
  });

  /**
   * Verifies that a resting figure that already has a seat keeps it
   */
  it('never overwrites an existing resting seat', () => {
    const memory: SeatMemory = new Map([
      [restId('neo'), seatB],
      ['ag-1', seatA],
    ]);
    inheritSeats(memory, ['neo'], [sub('ag-1', 'neo')]);
    expect(memory.get(restId('neo'))).toEqual(seatB);
  });

  /**
   * Verifies that a resting type with no returned agent gets no seat
   */
  it('assigns nothing without a returned agent of the type', () => {
    const memory: SeatMemory = new Map([['ag-1', seatA]]);
    inheritSeats(memory, ['neo'], [sub('ag-1', 'oracle')]);
    expect(memory.has(restId('neo'))).toBe(false);
    expect(memory.size).toBe(1);
  });

  /**
   * Verifies that a returned agent whose type is not resting gives its seat to nobody
   */
  it('ignores returned agents of non-resting types', () => {
    const memory: SeatMemory = new Map([['ag-1', seatA]]);
    inheritSeats(memory, [], [sub('ag-1', 'oracle')]);
    expect(memory.has(restId('oracle'))).toBe(false);
  });

  /**
   * Verifies that a returned agent without a remembered seat is skipped for the next one
   */
  it('uses the first returned agent of the type that has a seat', () => {
    const memory: SeatMemory = new Map([['ag-2', seatB]]);
    inheritSeats(memory, ['neo'], [sub('ag-1', 'neo'), sub('ag-2', 'neo')]);
    expect(memory.get(restId('neo'))).toEqual(seatB);
  });

  /**
   * Verifies that the first matching returned agent wins when several have seats
   */
  it('takes the first matching agent when several have seats', () => {
    const memory: SeatMemory = new Map([
      ['ag-1', seatA],
      ['ag-2', seatB],
    ]);
    inheritSeats(memory, ['neo'], [sub('ag-1', 'neo'), sub('ag-2', 'neo')]);
    expect(memory.get(restId('neo'))).toEqual(seatA);
  });

  /**
   * Verifies that resting and returned types match case-insensitively
   */
  it('matches types case-insensitively', () => {
    const memory: SeatMemory = new Map([['ag-1', seatA]]);
    inheritSeats(memory, ['explore'], [sub('ag-1', 'EXPLORE')]);
    expect(memory.get(restId('Explore'))).toEqual(seatA);
  });

  /**
   * Verifies that several resting types each inherit from their own returned agent
   */
  it('handles several resting types at once', () => {
    const memory: SeatMemory = new Map([
      ['ag-n', seatA],
      ['ag-o', seatB],
    ]);
    inheritSeats(memory, ['neo', 'oracle'], [sub('ag-o', 'oracle'), sub('ag-n', 'neo')]);
    expect(memory.get(restId('neo'))).toEqual(seatA);
    expect(memory.get(restId('oracle'))).toEqual(seatB);
  });

  /**
   * Verifies that empty inputs leave the memory untouched
   */
  it('changes nothing with empty inputs', () => {
    const memory: SeatMemory = new Map([['ag-1', seatA]]);
    inheritSeats(memory, [], []);
    inheritSeats(memory, ['neo'], []);
    expect([...memory.entries()]).toEqual([['ag-1', seatA]]);
  });
});
