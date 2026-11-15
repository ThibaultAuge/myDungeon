import { describe, expect, it } from 'vitest';
import { gagCommands } from '../src/scene/gagCommands.ts';
import { installCelebrationCommands } from '../src/scene/celebrate.ts';
import { installPotionCommand } from '../src/scene/potion.ts';

type Host = { agentOffice?: unknown; [key: string]: unknown };

describe('gagCommands', () => {
  /** Verifies that a bare host gets an empty agentOffice object, which is returned */
  it('creates an empty agentOffice object on a bare host and returns it', () => {
    const host: Host = {};
    const commands = gagCommands(host);
    expect(commands).toEqual({});
    expect(host.agentOffice).toBe(commands);
  });

  /** Verifies that an existing agentOffice object is returned as is, keys included */
  it('returns the existing agentOffice object unchanged', () => {
    const potion = () => true;
    const existing = { potion, other: 'kept' };
    const host: Host = { agentOffice: existing };
    const commands = gagCommands(host);
    expect(commands).toBe(existing);
    expect(commands).toEqual({ potion, other: 'kept' });
  });

  /** Verifies that two calls on the same host share one namespace */
  it('returns the same object on every call for a host', () => {
    const host: Host = {};
    const a = gagCommands(host);
    a.first = 1;
    const b = gagCommands(host);
    expect(b).toBe(a);
    expect(b.first).toBe(1);
  });

  /** Verifies that a non-object value under agentOffice is replaced by a fresh object */
  it.each([
    ['a string', 'oops'],
    ['a number', 0],
    ['NaN', NaN],
    ['null', null],
    ['undefined', undefined],
    ['false', false],
    ['a function', () => 'x'],
    ['a symbol', Symbol('s')],
  ] as const)('replaces %s with a fresh object', (_label, value) => {
    const host: Host = { agentOffice: value };
    const commands = gagCommands(host);
    expect(typeof commands).toBe('object');
    expect(commands).not.toBeNull();
    expect(commands).toEqual({});
    expect(host.agentOffice).toBe(commands);
  });

  /** Verifies that other properties of the host are left untouched */
  it('does not touch other host properties', () => {
    const host: Host = { title: 'keep', agentOffice: 3 };
    gagCommands(host);
    expect(host.title).toBe('keep');
    expect(Object.keys(host).sort()).toEqual(['agentOffice', 'title']);
  });

  /** Verifies that separate hosts get separate namespaces */
  it('gives separate hosts separate namespaces', () => {
    const a = gagCommands({});
    const b = gagCommands({});
    expect(a).not.toBe(b);
  });
});

describe('gag command installers sharing agentOffice', () => {
  /** Verifies that potion, heraut and feuArtifice coexist when potion is installed first */
  it('keeps the potion command when the celebration commands are installed after it', () => {
    const host: Host = {};
    installPotionCommand(() => null, host);
    installCelebrationCommands(host);
    const commands = gagCommands(host);
    expect(typeof commands.potion).toBe('function');
    expect(typeof commands.heraut).toBe('function');
    expect(typeof commands.feuArtifice).toBe('function');
  });

  /** Verifies that potion, heraut and feuArtifice coexist when the celebrations come first */
  it('keeps the celebration commands when the potion command is installed after them', () => {
    const host: Host = {};
    installCelebrationCommands(host);
    const before = host.agentOffice;
    installPotionCommand(() => null, host);
    expect(host.agentOffice).toBe(before);
    const commands = gagCommands(host);
    expect(typeof commands.potion).toBe('function');
    expect(typeof commands.heraut).toBe('function');
    expect(typeof commands.feuArtifice).toBe('function');
  });
});
