import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  MAX_PASSWORD, MIN_PASSWORD, SESSION_COOKIE, getSessionUser, hashPassword, verifyPassword,
} from "@/lib/auth";
import { query, transaction } from "@/lib/db/pool";
import { getDict } from "@/lib/i18n/server";

/**
 * Choosing a new password. Requires the current one as well as the session,
 * so a borrowed browser cannot be used to take an account over.
 *
 * Clearing `must_change_password` is what releases someone from the forced
 * change after an admin issued them a temporary password.
 *
 * Changing a password also signs out **every other session**, and keeps this
 * one. Somebody changing a password because they think someone else has it
 * would otherwise leave that someone signed in — the change would look like an
 * action and be none. The session doing the changing survives, because throwing
 * this person out of the screen they are standing on teaches nothing.
 *
 * A reset is the stricter case and ends every session including its own: there,
 * the person could not sign in to begin with, and any live session is more
 * likely to be the problem than the point. See lib/auth/passwordReset.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const b = await request.json().catch(() => null);
  const current = typeof b?.current === "string" ? b.current : "";
  const next = typeof b?.next === "string" ? b.next : "";
  const msg = getDict().errors;

  if (next.length < MIN_PASSWORD) {
    return NextResponse.json({ error: msg.passwordTooShort(MIN_PASSWORD) }, { status: 400 });
  }
  if (next.length > MAX_PASSWORD) {
    return NextResponse.json({ error: msg.passwordTooLong(MAX_PASSWORD) }, { status: 400 });
  }

  const rows = await query<{ password_hash: string }>(
    "select password_hash from users where id = $1", [user.id]);
  if (!rows[0] || !await verifyPassword(current, rows[0].password_hash)) {
    return NextResponse.json({ error: msg.wrongCredentials }, { status: 401 });
  }

  const current_session = cookies().get(SESSION_COOKIE)?.value ?? "";
  const passwordHash = await hashPassword(next);

  /* One transaction: a password that changed while the old sessions survived,
     or sessions dropped while the password did not change, are both worse than
     either failing cleanly. */
  const revoked = await transaction(async (q) => {
    await q("update users set password_hash = $2, must_change_password = false where id = $1",
      [user.id, passwordHash]);
    const gone = await q<{ id: string }>(
      "delete from sessions where user_id = $1 and id <> $2 returning id",
      [user.id, current_session],
    );
    return gone.length;
  });

  return NextResponse.json({ ok: true, otherSessionsSignedOut: revoked });
}
