import { describe, expect, it } from 'vitest';
import { EVENTS, addOurs, isOurs, relayCommand, stripOurs, type ClaudeSettings } from '../../../scripts/hooks-lib.mjs';

const LEGACY_HEADER = 'X-Agent-Office-Token';
const OPTS = { relayPath: 'C:\\work\\office\\scripts\\hook-relay.mjs' };
const RELAY = { type: 'command', command: 'node "C:/work/office/scripts/hook-relay.mjs"', async: true, timeout: 5 };

/** A user's settings with unrelated keys and foreign hooks on events we also use. */
function foreignSettings(): ClaudeSettings {
  return {
    model: 'fake-model',
    permissions: { allow: ['Bash(npm test)'] },
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }],
      Stop: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:9000/x', headers: { 'X-Other': 'y' } }] }],
      CustomEvent: [{ hooks: [{ type: 'command', command: 'echo custom' }] }],
    },
  };
}

/** All handlers of an event that belong to Agent Office. */
function ours(settings: ClaudeSettings, event: string) {
  return (settings.hooks?.[event] ?? []).flatMap((g) => g.hooks ?? []).filter((h) => isOurs(h));
}

describe('isOurs', () => {
  /** Our relay command, and legacy HTTP handlers carrying our header, are ours; nothing else. */
  it('recognises the relay command and legacy http handlers', () => {
    expect(isOurs(RELAY)).toBe(true);
    expect(isOurs({ type: 'http', url: 'u', headers: { [LEGACY_HEADER]: 't' } })).toBe(true);
    expect(isOurs({ type: 'http', url: 'u', headers: { 'X-Other': 't' } })).toBe(false);
    expect(isOurs({ type: 'command', command: 'echo hi' })).toBe(false);
    expect(isOurs({ type: 'command', command: 'x', headers: { [LEGACY_HEADER]: 't' } })).toBe(false);
    expect(isOurs(null)).toBe(false);
    expect(isOurs(undefined)).toBe(false);
  });
});

describe('addOurs', () => {
  /** Every event gets one async command hook: the relay ignores the answer, so no decision can come back. */
  it('installs one async relay command per event, with no token in settings', () => {
    const s = addOurs({}, OPTS);
    expect(Object.keys(s.hooks ?? {}).sort()).toEqual([...EVENTS].sort());
    for (const event of EVENTS) expect(ours(s, event)).toEqual([RELAY]);
    expect(JSON.stringify(s)).not.toMatch(/token/i);
    expect(relayCommand('C:\\a b\\hook-relay.mjs')).toBe('node "C:/a b/hook-relay.mjs"');
  });

  /** Verifies that PreCompact (context compaction, the potion gag) is relayed like every other event. */
  it('relays PreCompact', () => {
    expect(EVENTS).toContain('PreCompact');
    expect(ours(addOurs({}, OPTS), 'PreCompact')).toEqual([RELAY]);
  });

  /** A path a shell would expand inside double quotes is refused instead of being installed. */
  it.each(['C:/a$b/hook-relay.mjs', 'C:/a`b`/hook-relay.mjs', 'C:/a"b/hook-relay.mjs', 'C:/a!b/hook-relay.mjs'])(
    'refuses the unsafe relay path %s',
    (p) => {
      expect(() => relayCommand(p)).toThrow();
      expect(() => addOurs({}, { relayPath: p })).toThrow();
    },
  );

  it('keeps foreign hooks and other settings', () => {
    const original = foreignSettings();
    const s = addOurs(foreignSettings(), OPTS);
    expect(s.model).toBe('fake-model');
    expect(s.permissions).toEqual(original.permissions);
    expect(s.hooks?.CustomEvent).toEqual(original.hooks?.CustomEvent);
    expect(s.hooks?.PreToolUse?.[0]).toEqual(original.hooks?.PreToolUse?.[0]);
    expect(s.hooks?.PreToolUse).toHaveLength(2);
    expect(s.hooks?.Stop?.[0]).toEqual(original.hooks?.Stop?.[0]);
    expect(ours(s, 'PreToolUse')).toHaveLength(1);
  });

  it('is idempotent', () => {
    const once = addOurs(foreignSettings(), OPTS);
    const twice = addOurs(addOurs(foreignSettings(), OPTS), OPTS);
    expect(twice).toEqual(once);
    for (const event of EVENTS) expect(ours(twice, event)).toHaveLength(1);
  });

  /** Upgrading from the first, HTTP-based install replaces the legacy handlers. */
  it('replaces legacy http handlers', () => {
    const legacy: ClaudeSettings = {
      hooks: { Stop: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:4777/hooks', headers: { [LEGACY_HEADER]: 't' } }] }] },
    };
    const s = addOurs(legacy, OPTS);
    expect(ours(s, 'Stop')).toEqual([RELAY]);
    expect(s.hooks?.Stop).toHaveLength(1);
  });
});

describe('stripOurs', () => {
  it('round-trips settings without hooks', () => {
    const original = { model: 'fake-model', env: { FOO: '1' } };
    expect(stripOurs(addOurs(structuredClone(original), OPTS))).toEqual(original);
  });

  it('round-trips settings with foreign hooks', () => {
    expect(stripOurs(addOurs(foreignSettings(), OPTS))).toEqual(foreignSettings());
  });

  it('removes only our handlers from a mixed group', () => {
    const foreign = { type: 'command', command: 'echo keep' };
    const s = stripOurs({ hooks: { Stop: [{ hooks: [foreign, RELAY] }] } });
    expect(s).toEqual({ hooks: { Stop: [{ hooks: [foreign] }] } });
  });

  it('cleans up empty groups, events and the hooks key', () => {
    const s = stripOurs({ other: 1, hooks: { Stop: [{ hooks: [RELAY] }] } });
    expect(s).toEqual({ other: 1 });
  });

  it('leaves settings without hooks untouched', () => {
    expect(stripOurs({ model: 'm' })).toEqual({ model: 'm' });
  });

  it('keeps groups whose hooks field is not an array', () => {
    const s = stripOurs({ hooks: { Stop: [{ matcher: 'odd' }] } });
    expect(s).toEqual({ hooks: { Stop: [{ matcher: 'odd' }] } });
  });

  /** Event values we do not understand, and events we never touched (even empty), stay as the user wrote them. */
  it('leaves foreign or odd event values untouched', () => {
    const s = stripOurs({ hooks: { Stop: [], Weird: 'x' as unknown as [] } });
    expect(s).toEqual({ hooks: { Stop: [], Weird: 'x' } });
  });
});
