import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/cookies";
import { auth as authEnv, isProduction } from "@/lib/env";
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

export interface SessionUser {
  id: string;
  email: string;
}

/** The signed-in user, or null. Never throws on a bad or absent cookie. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const rows = await query<SessionUser>(
      `select u.id, u.email
         from sessions s join users u on u.id = s.user_id
        where s.id = $1 and s.expires_at > now()`,
      [token],
    );
    return rows[0] ?? null;
  } catch {
    // A malformed uuid in the cookie is a 401, not a 500.
    return null;
  }
}
