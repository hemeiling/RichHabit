import { NextResponse } from "next/server";
import { createSession, verifyPassword } from "@/lib/auth";
import { clearThrottle, throttle } from "@/lib/throttle";
import { query } from "@/lib/db/pool";
import { getDict } from "@/lib/i18n/server";

export async function POST(request: Request) {
  const msg = getDict().errors;
  const parsed = await request.json().catch(() => null);
  const email = typeof parsed?.email === "string" ? parsed.email.trim().toLowerCase() : "";
  const password = typeof parsed?.password === "string" ? parsed.password : "";

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  if (!throttle(`${ip}:${email}`)) {
    return NextResponse.json(
      { error: msg.tooManyAttempts },
      { status: 429 },
    );
  }

  const rows = await query<{ id: string; password_hash: string; disabled_at: string | null }>(
    "select id, password_hash, disabled_at from users where lower(email) = $1",
    [email],
  );

  // One message for both branches, so this can't be used to enumerate accounts.
  const user = rows[0];
  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  if (!ok) {
    return NextResponse.json({ error: msg.wrongCredentials }, { status: 401 });
  }
  /*
   * The password was right and the account is still refused. This is told
   * plainly rather than hidden behind the generic message: someone whose
   * account an admin turned off needs to know that is what happened, and they
   * have already proved they own it.
   */
  if (user.disabled_at) {
    return NextResponse.json({ error: msg.accountDisabled }, { status: 403 });
  }

  clearThrottle(`${ip}:${email}`);
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
