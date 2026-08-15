import { NextResponse } from "next/server";
import { MAX_PASSWORD, MIN_PASSWORD, createSession, hashPassword } from "@/lib/auth";
import { transaction } from "@/lib/db/pool";
import { getDict } from "@/lib/i18n/server";
import { isUuid } from "@/lib/http";

/**
 * Redeeming a setup link. The token is the only credential — it is single use,
 * it expires, and it is consumed inside the same transaction that sets the
 * password, so two people racing the same link cannot both succeed.
 *
 * A disabled account cannot be redeemed: an admin who created it disabled meant
 * it to stay that way until they say otherwise.
 */
export async function POST(request: Request) {
  const b = await request.json().catch(() => null);
  const token = typeof b?.token === "string" ? b.token : "";
  const password = typeof b?.password === "string" ? b.password : "";
  const msg = getDict().errors;

  if (!isUuid(token)) return NextResponse.json({ error: msg.setupLinkInvalid }, { status: 400 });
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: msg.passwordTooShort(MIN_PASSWORD) }, { status: 400 });
  }
  if (password.length > MAX_PASSWORD) {
    return NextResponse.json({ error: msg.passwordTooLong(MAX_PASSWORD) }, { status: 400 });
  }

  const hash = await hashPassword(password);
  const userId = await transaction(async (q) => {
    const rows = await q<{ user_id: string }>(
      `update user_invites set used_at = now()
        where token = $1 and used_at is null and expires_at > now()
        returning user_id`,
      [token],
    );
    if (!rows[0]) return null;
    const id = rows[0].user_id;
    const live = await q<{ id: string }>(
      "select id from users where id = $1 and disabled_at is null", [id]);
    if (!live[0]) return null;
    await q("update users set password_hash = $2, must_change_password = false where id = $1",
      [id, hash]);
    return id;
  });

  if (!userId) return NextResponse.json({ error: msg.setupLinkInvalid }, { status: 400 });

  await createSession(userId);
  return NextResponse.json({ ok: true });
}
