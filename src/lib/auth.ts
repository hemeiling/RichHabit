import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/cookies";
import { auth as authEnv, isProduction } from "@/lib/env";
import { looksLikeEmail, normaliseIdentifier } from "@/lib/identity";
import { query } from "@/lib/db/pool";

/**
 * Sessions, replacing Supabase Auth. The cookie holds an opaque session id and
 * nothing else — no user id, no claims — so a stolen cookie is revocable by
 * deleting one row, and nothing the browser sends can name a different user.
 *
 * Server-only. `getSessionUser` is the single answer to "who is asking", and
 * every query in `db/queries.ts` takes its user id from here.
 */

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, k: number) => Promise<Buffer>;

// Re-exported so callers keep one import for "the session".
export { SESSION_COOKIE };

const KEY_LEN = 64;

export const MIN_PASSWORD = authEnv.minPassword;
/**
 * scrypt cost is linear in input length, so an unbounded password is a cheap
 * way to burn server CPU. The default is far past any real passphrase.
 */
export const MAX_PASSWORD = authEnv.maxPassword;

export async function hashPassword(password: string): Promise<string> {
  if (password.length > MAX_PASSWORD) throw new Error("Password is too long.");
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (password.length > MAX_PASSWORD) return false;
  const [scheme, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  // Lengths must match before timingSafeEqual, which throws on a mismatch.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function expiry() {
  return new Date(Date.now() + authEnv.sessionTtlDays * 24 * 60 * 60 * 1000);
}

export async function createSession(userId: string): Promise<void> {
  const rows = await query<{ id: string }>(
    "insert into sessions (user_id, expires_at) values ($1, $2) returning id",
    [userId, expiry()],
  );
  cookies().set(SESSION_COOKIE, rows[0].id, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    expires: expiry(),
  });
}

/**
 * Ends the session. The row is what matters — deleting it makes the token
 * meaningless everywhere, including in any copy of the cookie that survives.
 *
 * The cookie is then expired explicitly rather than with `cookies().delete()`,
 * which emitted `rh_session=; Path=/; HttpOnly` with no `Max-Age` — an empty
 * *session* cookie rather than a deleted one. Nothing could be done with it,
 * but it lingered in the jar for the rest of the browsing session, and a
 * cookie that is supposed to be gone should be gone.
 */
export async function destroySession(): Promise<void> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) {
    // Expired rows are cleared here rather than by a scheduled job.
    await query("delete from sessions where id = $1 or expires_at < now()", [token]);
  }
  cookies().set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}

/**
 * Resolves what someone typed into the first login box to an account.
 *
 * The kind is decided here, server-side, from the value itself — the client
 * sends one string and has no say in which column it is matched against. An
 * identifier with an `@` can only ever match an email, and one without can only
 * ever match a username, so neither can be used to probe the other.
 *
 * Returns null for anything unknown, and the caller must answer the same way it
 * answers a wrong password.
 */
export interface Credentials {
  id: string;
  passwordHash: string;
  disabledAt: string | null;
}

export async function findByIdentifier(raw: string): Promise<Credentials | null> {
  const value = normaliseIdentifier(raw);
  if (!value) return null;

  const rows = await query<{ id: string; password_hash: string; disabled_at: string | null }>(
    looksLikeEmail(value)
      ? "select id, password_hash, disabled_at from users where lower(email) = $1"
      : "select id, password_hash, disabled_at from users where lower(username) = $1",
    [value],
  );
  const row = rows[0];
  return row
    ? { id: row.id, passwordHash: row.password_hash, disabledAt: row.disabled_at }
    : null;
}

export interface SessionUser {
  id: string;
  /**
   * How the account is identified: its address, or its username when it has no
   * address. Every screen that shows "signed in as" shows this.
   */
  email: string;
  /** Set when an admin issued a temporary password and it has not been changed. */
  mustChangePassword: boolean;
}

/** The signed-in user, or null. Never throws on a bad or absent cookie. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    /*
     * `disabled_at is null` is the whole of what "disabled" means. It is
     * checked here rather than in each route, so a disabled account stops
     * resolving to anyone at the single point every page and every API call
     * already asks "who is this" — no existing session survives it, and no new
     * one can be made because sign-in checks the same column.
     */
    const rows = await query<{ id: string; email: string; must_change_password: boolean }>(
      `select u.id, coalesce(u.email, u.username) as email, u.must_change_password
         from sessions s join users u on u.id = s.user_id
        where s.id = $1 and s.expires_at > now() and u.disabled_at is null`,
      [token],
    );
    const row = rows[0];
    return row
      ? { id: row.id, email: row.email, mustChangePassword: row.must_change_password }
      : null;
  } catch {
    // A malformed uuid in the cookie is a 401, not a 500.
    return null;
  }
}
