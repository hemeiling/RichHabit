import { NextResponse } from "next/server";
import { createSession, findByIdentifier, verifyPassword } from "@/lib/auth";
import { clearThrottle, throttle } from "@/lib/throttle";
import { normaliseIdentifier } from "@/lib/identity";
import { getDict } from "@/lib/i18n/server";

/**
 * Signing in with an email or a username.
 *
 * The client sends one `identifier`; which kind it is, is worked out from the
 * value server-side. `email` is still accepted as the field name so an older
 * client keeps working.
 */

export async function POST(request: Request) {
  const msg = getDict().errors;
  const parsed = await request.json().catch(() => null);
  const raw = typeof parsed?.identifier === "string" ? parsed.identifier
    : typeof parsed?.email === "string" ? parsed.email : "";
  const identifier = normaliseIdentifier(raw);
  const password = typeof parsed?.password === "string" ? parsed.password : "";

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  if (!throttle(`${ip}:${identifier}`)) {
    return NextResponse.json(
      { error: msg.tooManyAttempts },
      { status: 429 },
    );
  }

  // Email or username — decided from the value, in one place, server-side.
  const user = await findByIdentifier(identifier);

  // One message for both branches, so this can't be used to enumerate accounts.
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    return NextResponse.json({ error: msg.wrongCredentials }, { status: 401 });
  }
  /*
   * The password was right and the account is still refused. This is told
   * plainly rather than hidden behind the generic message: someone whose
   * account an admin turned off needs to know that is what happened, and they
   * have already proved they own it.
   */
  if (user.disabledAt) {
    return NextResponse.json({ error: msg.accountDisabled }, { status: 403 });
  }

  clearThrottle(`${ip}:${identifier}`);
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
