import type { AgentView, EnvironmentView, SessionView } from '@agent-office/shared';
import { describe, expect, it } from 'vitest';
import { agentName, ago, elapsed, envName, sessionTitle, stateLabel } from '../src/format.ts';
import { MESSAGES, type Lang } from '../src/i18n/index.ts';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

function agent(overrides: Partial<AgentView> = {}): AgentView {
  return {
    id: 'cli:x#main',
    sessionId: 'cli:x',
    kind: 'main',
    agentType: 'Session principale',
    state: 'working',
    room: 'atelier',
    since: 0,
    ...overrides,
  };
}

function session(overrides: Partial<SessionView> = {}): SessionView {
  const main = agent();
  return {
    id: 'cli:x',
    origin: 'cli',
    cliSessionIds: ['x'],
    envId: null,
    title: 'Refactor parser',
    cwd: 'C:\\work\\alpha',
    live: true,
    archived: false,
    createdAt: 0,
    lastActivityAt: 0,
    main,
    subagents: [],
    ...overrides,
  };
}

function env(overrides: Partial<EnvironmentView> = {}): EnvironmentView {
  return { id: 'env-alpha', name: 'Alpha', folders: ['C:\\work\\alpha'], activeSessions: 1, ...overrides };
}

describe('stateLabel', () => {
  type Case = [Lang, Partial<AgentView>, string];
  const cases: Case[] = [
    ['fr', { state: 'working' }, 'Travaille'],
    ['fr', { state: 'done' }, 'Terminé'],
    ['fr', { state: 'waiting', waitReason: 'permission' }, 'Attend ta permission'],
    ['fr', { state: 'waiting', waitReason: 'question' }, 'Te pose une question'],
    ['fr', { state: 'waiting', waitReason: 'error' }, 'Bloqué par une erreur'],
    ['fr', { state: 'waiting', waitReason: 'prompt' }, 'Attend ton prochain message'],
    ['de', { state: 'working' }, 'Arbeitet'],
    ['de', { state: 'done' }, 'Fertig'],
    ['de', { state: 'waiting', waitReason: 'permission' }, 'Wartet auf deine Erlaubnis'],
    ['de', { state: 'waiting', waitReason: 'question' }, 'Stellt dir eine Frage'],
    ['de', { state: 'waiting', waitReason: 'error' }, 'Durch einen Fehler blockiert'],
    ['de', { state: 'waiting', waitReason: 'prompt' }, 'Wartet auf deine nächste Nachricht'],
    ['en', { state: 'working' }, 'Working'],
    ['en', { state: 'done' }, 'Done'],
    ['en', { state: 'waiting', waitReason: 'permission' }, 'Waiting for your permission'],
    ['en', { state: 'waiting', waitReason: 'question' }, 'Asking you a question'],
    ['en', { state: 'waiting', waitReason: 'error' }, 'Blocked by an error'],
    ['en', { state: 'waiting', waitReason: 'prompt' }, 'Waiting for your next message'],
  ];

  /**
   * Verifies that each state and wait reason maps to its label in each language
   */
  it.each(cases)('%s %j → %s', (lang, overrides, expected) => {
    expect(stateLabel(agent(overrides), MESSAGES[lang])).toBe(expected);
  });

  /**
   * Verifies that a waiting agent without a reason shows the prompt label
   */
  it.each(['fr', 'de', 'en'] as const)('defaults a reason-less wait to prompt in %s', (lang) => {
    const t = MESSAGES[lang];
    expect(stateLabel(agent({ state: 'waiting', waitReason: undefined }), t)).toBe(t.state.prompt);
  });

  /**
   * Verifies that working and done ignore a stale wait reason
   */
  it('ignores waitReason outside the waiting state', () => {
    const t = MESSAGES.en;
    expect(stateLabel(agent({ state: 'working', waitReason: 'error' }), t)).toBe('Working');
    expect(stateLabel(agent({ state: 'done', waitReason: 'permission' }), t)).toBe('Done');
  });
});

describe('elapsed', () => {
  type Case = [string, number, string, string, string];
  // [label, duration ms, fr, de, en]
  const cases: Case[] = [
    ['0 s', 0, '0 s', '0 s', '0 s'],
    ['59 s', 59 * SEC, '59 s', '59 s', '59 s'],
    ['60 s', 60 * SEC, '1 min', '1 Min.', '1 min'],
    ['59 min', 59 * MIN, '59 min', '59 Min.', '59 min'],
    ['60 min', 60 * MIN, '1 h 00', '1 Std. 00 Min.', '1 h 00 min'],
    ['61 min', 61 * MIN, '1 h 01', '1 Std. 01 Min.', '1 h 01 min'],
    ['2 h 35', 2 * HOUR + 35 * MIN, '2 h 35', '2 Std. 35 Min.', '2 h 35 min'],
    ['47 h', 47 * HOUR, '47 h 00', '47 Std. 00 Min.', '47 h 00 min'],
    ['47 h 59', 47 * HOUR + 59 * MIN, '47 h 59', '47 Std. 59 Min.', '47 h 59 min'],
    ['48 h', 48 * HOUR, '2 j', '2 Tage', '2 d'],
    ['71 h', 71 * HOUR, '2 j', '2 Tage', '2 d'],
    ['72 h', 72 * HOUR, '3 j', '3 Tage', '3 d'],
  ];

  /**
   * Verifies that durations cross unit boundaries correctly in French
   */
  it.each(cases)('fr: %s', (_label, ms, fr) => {
    expect(elapsed(1_000_000, 1_000_000 + ms, MESSAGES.fr)).toBe(fr);
  });

  /**
   * Verifies that durations cross unit boundaries correctly in German
   */
  it.each(cases)('de: %s', (_label, ms, _fr, de) => {
    expect(elapsed(1_000_000, 1_000_000 + ms, MESSAGES.de)).toBe(de);
  });

  /**
   * Verifies that durations cross unit boundaries correctly in English
   */
  it.each(cases)('en: %s', (_label, ms, _fr, _de, en) => {
    expect(elapsed(1_000_000, 1_000_000 + ms, MESSAGES.en)).toBe(en);
  });

  /**
   * Verifies that sub-second remainders are rounded to the nearest second
   */
  it('rounds to the nearest second', () => {
    expect(elapsed(0, 59_499, MESSAGES.en)).toBe('59 s');
    expect(elapsed(0, 59_500, MESSAGES.en)).toBe('1 min');
  });

  /**
   * Verifies that a future start (clock skew) is clamped to zero seconds
   */
  it('clamps a negative duration to 0 s', () => {
    expect(elapsed(10_000, 0, MESSAGES.fr)).toBe('0 s');
  });

  /**
   * Verifies that German uses the singular day form for a single day
   */
  it('uses the German singular for exactly one day count', () => {
    // 1 day is unreachable through elapsed (days start at 48 h), so check the entry directly.
    expect(MESSAGES.de.time.days(1)).toBe('1 Tag');
  });
});

describe('ago', () => {
  /**
   * Verifies that relative time follows each language's word order
   */
  it.each([
    ['fr', 5 * MIN, 'il y a 5 min'],
    ['de', 5 * MIN, 'vor 5 Min.'],
    ['en', 5 * MIN, '5 min ago'],
    ['fr', 3 * SEC, 'il y a 3 s'],
    // German "vor" takes the dative: "vor 2 Tagen", not the nominative "2 Tage" of elapsed().
    ['de', 50 * HOUR, 'vor 2 Tagen'],
    ['fr', 50 * HOUR, 'il y a 2 j'],
    ['de', 3 * SEC, 'vor 3 s'],
    ['en', 50 * HOUR, '2 d ago'],
    ['en', 90 * MIN, '1 h 30 min ago'],
  ] as [Lang, number, string][])('%s %d ms → %s', (lang, ms, expected) => {
    expect(ago(0, ms, MESSAGES[lang])).toBe(expected);
  });
});

describe('sessionTitle', () => {
  /**
   * Verifies that a null title becomes the translated placeholder
   */
  it.each([
    ['fr', 'Session sans titre'],
    ['de', 'Sitzung ohne Titel'],
    ['en', 'Untitled session'],
  ] as [Lang, string][])('shows the untitled placeholder in %s', (lang, expected) => {
    expect(sessionTitle({ title: null }, MESSAGES[lang])).toBe(expected);
  });

  /**
   * Verifies that a real title is shown untranslated in every language
   */
  it.each(['fr', 'de', 'en'] as const)('keeps a non-null title in %s', (lang) => {
    expect(sessionTitle({ title: 'Refactor parser' }, MESSAGES[lang])).toBe('Refactor parser');
  });
});

describe('envName', () => {
  /**
   * Verifies that the virtual environment shows the translated "no environment" label
   */
  it.each([
    ['fr', 'Hors environnement'],
    ['de', 'Ohne Umgebung'],
    ['en', 'No environment'],
  ] as [Lang, string][])('translates the virtual environment in %s', (lang, expected) => {
    expect(envName(env({ id: 'hors-environnement', name: 'Hors environnement', virtual: true }), MESSAGES[lang])).toBe(expected);
  });

  /**
   * Verifies that a normal environment keeps its own name in every language
   */
  it.each(['fr', 'de', 'en'] as const)('keeps a normal environment name in %s', (lang) => {
    expect(envName(env(), MESSAGES[lang])).toBe('Alpha');
    expect(envName(env({ virtual: false }), MESSAGES[lang])).toBe('Alpha');
  });
});

describe('agentName', () => {
  /**
   * Verifies that a main agent is named after its session title
   */
  it('uses the session title for the main agent', () => {
    expect(agentName(agent({ kind: 'main' }), session(), MESSAGES.en)).toBe('Refactor parser');
  });

  /**
   * Verifies that an untitled session's main agent gets the translated placeholder
   */
  it('uses the translated placeholder for an untitled main agent', () => {
    expect(agentName(agent({ kind: 'main' }), session({ title: null }), MESSAGES.de)).toBe('Sitzung ohne Titel');
  });

  /**
   * Verifies that a subagent is named after its type, not the session
   */
  it('uses the agent type for a subagent', () => {
    expect(agentName(agent({ kind: 'sub', agentType: 'Explore' }), session({ title: null }), MESSAGES.fr)).toBe('Explore');
  });
});
