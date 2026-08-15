import { NextResponse } from "next/server";
import {
  MAX_PASSWORD, MIN_PASSWORD, getSessionUser, hashPassword, verifyPassword,
} from "@/lib/auth";
import { query } from "@/lib/db/pool";
import { getDict } from "@/lib/i18n/server";

/**
 * Choosing a new password. Requires the current one as well as the session,
 * so a borrowed browser cannot be used to take an account over.
 *
 * Clearing `must_change_password` is what releases someone from the forced
 * change after an admin issued them a temporary password.
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

  await query("update users set password_hash = $2, must_change_password = false where id = $1",
    [user.id, await hashPassword(next)]);
  return NextResponse.json({ ok: true });
}
