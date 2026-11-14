import { beforeEach, describe, expect, it } from 'vitest';
import { AuthGate, CODE_TTL_MS, SESSION_COOKIE, SESSION_TTL_MS, clearedCookie, readCookie, sessionCookie } from '../src/auth.ts';

/** 32 random bytes in base64url. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MAX_SESSIONS = 32;

describe('readCookie', () => {
  /**
   * Verifies that the named cookie is found among several, with spaces trimmed
   */
  it('reads the named cookie among others', () => {
    expect(readCookie('a=1; agent_office_session=abc ;b=2', SESSION_COOKIE)).toBe('abc');
  });

  /**
   * Verifies that a value containing "=" is returned whole
   */
  it('keeps "=" inside the value', () => {
    expect(readCookie('k=a=b==', 'k')).toBe('a=b==');
  });

  /**
   * Verifies that a cookie whose name only contains the wanted one is not matched
   */
  it.each([['xagent_office_session=1'], ['agent_office_session_x=1'], ['=agent_office_session'], ['agent_office_session']])(
    'does not match %j',
    (header) => {
      expect(readCookie(header, SESSION_COOKIE)).toBeUndefined();
    },
  );

  /**
   * Verifies that a missing or non-string header yields undefined
   */
  it.each([[undefined], [null], [42], [['agent_office_session=x']], ['']])('returns undefined for header %j', (header) => {
    expect(readCookie(header, SESSION_COOKIE)).toBeUndefined();
  });

  /**
   * Verifies that a cookie sent twice is refused (a shadowing copy could come from another port)
   */
  it('refuses a cookie that appears twice', () => {
    expect(readCookie('k=first; k=second', 'k')).toBeUndefined();
    expect(readCookie('other=1; k=only', 'k')).toBe('only');
  });

  /**
   * Verifies that an empty value is returned as an empty string
   */
  it('returns an empty value as ""', () => {
    expect(readCookie('k=; other=1', 'k')).toBe('');
  });
});

describe('sessionCookie and clearedCookie', () => {
  /**
   * Verifies that the session cookie is HttpOnly, SameSite=Strict, site-wide and lives 12 h
   */
  it('builds a hardened session cookie', () => {
    const c = sessionCookie('sid123');
    expect(c.startsWith(`${SESSION_COOKIE}=sid123;`)).toBe(true);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Strict');
    expect(c).toContain('Path=/');
    expect(c).toContain(`Max-Age=${SESSION_TTL_MS / 1000}`);
  });

  /**
   * Verifies that the cleared cookie empties the value and expires immediately
   */
  it('builds an expired, empty cookie', () => {
    const c = clearedCookie();
    expect(c.startsWith(`${SESSION_COOKIE}=;`)).toBe(true);
    expect(c).toContain('Max-Age=0');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Strict');
    expect(c).toContain('Path=/');
  });

  /**
   * Verifies that a session cookie round-trips through readCookie
   */
  it('round-trips through readCookie', () => {
    const header = sessionCookie('tok_A-b').split(';')[0];
    expect(readCookie(header, SESSION_COOKIE)).toBe('tok_A-b');
  });
});

describe('AuthGate', () => {
  let now: number;
  let codes: string[];
  let gate: AuthGate;

  const latest = () => codes[codes.length - 1]!;

  beforeEach(() => {
    now = 1_000_000;
    codes = [];
    gate = new AuthGate(
      (c) => codes.push(c),
      () => now,
    );
  });

  describe('codes', () => {
    /**
     * Verifies that a random code is printed once at construction
     */
    it('prints a code at construction', () => {
      expect(codes).toHaveLength(1);
      expect(latest()).toMatch(TOKEN);
    });

    /**
     * Verifies that two gates print different codes
     */
    it('prints a different code per gate', () => {
      const other: string[] = [];
      new AuthGate((c) => other.push(c), () => now);
      expect(other[0]).not.toBe(codes[0]);
    });

    /**
     * Verifies that a valid code yields a session id and a new code is printed
     */
    it('redeems a valid code and rotates it', () => {
      const code = latest();
      const id = gate.redeem(code);
      expect(id).toMatch(TOKEN);
      expect(id).not.toBe(code);
      expect(codes).toHaveLength(2);
      expect(latest()).not.toBe(code);
      expect(gate.check(id)).toBe(true);
    });

    /**
     * Verifies that a code works only once
     */
    it('refuses a code already redeemed', () => {
      const code = latest();
      expect(gate.redeem(code)).not.toBeNull();
      expect(gate.redeem(code)).toBeNull();
    });

    /**
     * Verifies that a wrong code is refused without replacing the valid one
     */
    it.each([['wrong'], [''], ['x'.repeat(43)]])('refuses the wrong code %j without rotating', (wrong) => {
      const code = latest();
      expect(gate.redeem(wrong)).toBeNull();
      expect(codes).toHaveLength(1);
      expect(gate.redeem(code)).not.toBeNull();
    });

    /**
     * Verifies that a non-string code is refused without rotating
     */
    it.each([[undefined], [null], [42], [['code']]])('refuses the non-string code %j', (bad) => {
      expect(gate.redeem(bad)).toBeNull();
      expect(codes).toHaveLength(1);
    });

    /**
     * Verifies that a code is still valid one millisecond before its expiry
     */
    it('accepts a code just before CODE_TTL_MS', () => {
      now += CODE_TTL_MS - 1;
      expect(gate.redeem(latest())).not.toBeNull();
    });

    /**
     * Verifies that an expired code is refused and a fresh code is printed
     */
    it('refuses an expired code and rotates', () => {
      const code = latest();
      now += CODE_TTL_MS;
      expect(gate.redeem(code)).toBeNull();
      expect(codes).toHaveLength(2);
      expect(latest()).not.toBe(code);
      expect(gate.redeem(latest())).not.toBeNull();
    });

    /**
     * Verifies that any attempt after expiry, even a wrong one, prints a fresh code
     */
    it('rotates an expired code on a wrong attempt too', () => {
      now += CODE_TTL_MS + 1;
      expect(gate.redeem('wrong')).toBeNull();
      expect(codes).toHaveLength(2);
    });

    /**
     * Verifies that a code printed after a redeem has its own fresh lifetime
     */
    it('gives a rotated code a full lifetime', () => {
      now += CODE_TTL_MS - 1;
      gate.redeem(latest());
      now += CODE_TTL_MS - 1;
      expect(gate.redeem(latest())).not.toBeNull();
    });
  });

  describe('sessions', () => {
    const open = () => gate.redeem(latest())!;

    /**
     * Verifies that unknown, empty and non-string session ids are refused
     */
    it.each([['unknown'], [''], [undefined], [null], [123]])('refuses the session id %j', (id) => {
      open();
      expect(gate.check(id)).toBe(false);
    });

    /**
     * Verifies that each redeem opens a distinct session
     */
    it('opens distinct sessions', () => {
      const a = open();
      const b = open();
      expect(a).not.toBe(b);
      expect(gate.check(a)).toBe(true);
      expect(gate.check(b)).toBe(true);
    });

    /**
     * Verifies that a session expires SESSION_TTL_MS after its last use
     */
    it('expires a session after SESSION_TTL_MS without use', () => {
      const id = open();
      now += SESSION_TTL_MS - 1;
      expect(gate.check(id)).toBe(true);
      now += SESSION_TTL_MS;
      expect(gate.check(id)).toBe(false);
    });

    /**
     * Verifies that a session is dead exactly at its expiry and stays dead
     */
    it('refuses a session exactly at expiry, then forever', () => {
      const id = open();
      now += SESSION_TTL_MS;
      expect(gate.check(id)).toBe(false);
      now -= 1; // even if the clock goes back, the session was dropped
      expect(gate.check(id)).toBe(false);
    });

    /**
     * Verifies that each successful check slides the session lifetime
     */
    it('slides the lifetime on each check', () => {
      const id = open();
      for (let i = 0; i < 5; i++) {
        now += SESSION_TTL_MS - 1;
        expect(gate.check(id)).toBe(true);
      }
    });

    /**
     * Verifies that a revoked session is refused while others stay valid
     */
    it('revokes one session only', () => {
      const a = open();
      const b = open();
      gate.revoke(a);
      expect(gate.check(a)).toBe(false);
      expect(gate.check(b)).toBe(true);
    });

    /**
     * Verifies that revoking unknown or non-string ids is a harmless no-op
     */
    it.each([['unknown'], [undefined], [42]])('ignores revoke(%j)', (id) => {
      const a = open();
      expect(() => gate.revoke(id)).not.toThrow();
      expect(gate.check(a)).toBe(true);
    });

    /**
     * Verifies that opening more than 32 sessions evicts the oldest one
     */
    it('evicts the oldest session beyond the limit', () => {
      const ids = Array.from({ length: MAX_SESSIONS + 1 }, () => open());
      expect(gate.check(ids[0])).toBe(false);
      for (const id of ids.slice(1)) expect(gate.check(id)).toBe(true);
    });

    /**
     * Verifies that a recently used session is not the one evicted
     */
    it('evicts the least recently used session', () => {
      const ids = Array.from({ length: MAX_SESSIONS }, () => open());
      expect(gate.check(ids[0])).toBe(true); // ids[0] becomes the most recent
      const extra = open();
      expect(gate.check(ids[1])).toBe(false);
      expect(gate.check(ids[0])).toBe(true);
      expect(gate.check(extra)).toBe(true);
    });

    /**
     * Verifies that a live session survives when expired ones fill the table
     */
    it('keeps a live session when expired ones are dropped', () => {
      const old = Array.from({ length: MAX_SESSIONS - 1 }, () => open());
      now += SESSION_TTL_MS / 2;
      // The code expired long ago: the first attempt only prints a new one.
      expect(gate.redeem(latest())).toBeNull();
      const live = open(); // 32 sessions, the 31 old ones expire first
      expect(live).toMatch(TOKEN);
      now += SESSION_TTL_MS / 2;
      expect(gate.redeem(latest())).toBeNull();
      const fresh = open();
      expect(fresh).toMatch(TOKEN);
      expect(gate.check(live)).toBe(true);
      expect(gate.check(fresh)).toBe(true);
      for (const id of old) expect(gate.check(id)).toBe(false);
    });
  });
});
