// Browser sign-in for the routes that expose conversation contents.
// The server prints a one-time link; opening it trades the code for an HttpOnly cookie.
import crypto from 'node:crypto';

export const SESSION_COOKIE = 'agent_office_session';
/** A printed code is valid this long, then a new one is printed on the next /login visit. */
export const CODE_TTL_MS = 10 * 60_000;
/** Sliding lifetime of a browser session. */
export const SESSION_TTL_MS = 12 * 60 * 60_000;
const MAX_SESSIONS = 32;

function randomToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * The value of cookie `name` in a `Cookie` header, or undefined. A name sent twice is refused:
 * cookies are not port-scoped, so a page on another 127.0.0.1 port could plant a shadowing copy.
 */
export function readCookie(header: unknown, name: string): string | undefined {
  if (typeof header !== 'string') return undefined;
  let found: string | undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      if (found !== undefined) return undefined;
      found = part.slice(eq + 1).trim();
    }
  }
  return found;
}

export function sessionCookie(id: string): string {
  return `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

/** One-time sign-in codes and the browser sessions they open. In memory: a restart signs out. */
export class AuthGate {
  private code = '';
  private codeExpires = 0;
  private readonly sessions = new Map<string, number>();

  /**
   * @param onCode called with every new code, to print the sign-in link.
   */
  constructor(
    private readonly onCode: (code: string) => void,
    private readonly clock: () => number = Date.now,
  ) {
    this.rotate();
  }

  private rotate(): void {
    this.code = randomToken();
    this.codeExpires = this.clock() + CODE_TTL_MS;
    this.onCode(this.code);
  }

  /** A new session id for a valid, unexpired code (which is then replaced), else null. */
  redeem(code: unknown): string | null {
    const now = this.clock();
    if (now >= this.codeExpires) {
      // Expired: print a fresh link. A wrong code alone never replaces a valid one.
      this.rotate();
      return null;
    }
    if (typeof code !== 'string' || !sameSecret(this.code, code)) return null;
    this.rotate();
    for (const [id, exp] of this.sessions) if (exp <= now) this.sessions.delete(id);
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest !== undefined) this.sessions.delete(oldest);
    }
    const id = randomToken();
    this.sessions.set(id, now + SESSION_TTL_MS);
    return id;
  }

  /** True for a live session, whose lifetime is then extended. */
  check(id: unknown): boolean {
    if (typeof id !== 'string' || id.length === 0) return false;
    const now = this.clock();
    for (const [known, exp] of this.sessions) {
      if (!sameSecret(known, id)) continue;
      if (exp <= now) {
        this.sessions.delete(known);
        return false;
      }
      this.sessions.delete(known);
      this.sessions.set(known, now + SESSION_TTL_MS); // re-inserted: the map stays oldest-first
      return true;
    }
    return false;
  }

  revoke(id: unknown): void {
    if (typeof id === 'string') this.sessions.delete(id);
  }
}
