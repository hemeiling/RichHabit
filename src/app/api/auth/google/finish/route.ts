import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSession, getSessionUser } from "@/lib/auth";
import { G_PENDING_COOKIE } from "@/lib/auth/google";
import { finishGoogleSignup, linkPendingToAccount, peekPending } from "@/lib/auth/googleAccount";
import { sendVerification } from "@/lib/email/verify";
import { trackEvent } from "@/lib/analytics/track";
import { google, isProduction } from "@/lib/env";
import { checkUsername, normaliseUsername } from "@/lib/identity";
import { getDict, getLocale } from "@/lib/i18n/server";

/**
 * The person's half of a pending Google handshake.
 *
 *   GET            — what the screen may show: which step, and the (masked on
 *                    the client) address it concerns. Spends nothing.
 *   POST {username, acceptedTerms}
 *                  — finishes a brand-new registration: the same rules as
 *                    password sign-up (username shape, explicit terms,
 *                    capacity), only the credential differs.
 *   POST {link: true}
 *                  — attaches the pending identity to the account that has
 *                    JUST proved itself: it requires the session, and the
 *                    server re-checks that the session's account is the very
 *                    one the pending row was made for.
 *
 * The token rides an httpOnly cookie set by the callback; the browser's
 * JavaScript never sees it and it never appears in a URL.
 */
export const dynamic = "force-dynamic";

const expire = () => cookies().set(G_PENDING_COOKIE, "", {
  httpOnly: true, sameSite: "lax", secure: isProduction, path: "/", expires: new Date(0),
});

export async function GET() {
  if (!google.enabled) return NextResponse.json({ step: null });
  const token = cookies().get(G_PENDING_COOKIE)?.value;
  const p = token ? await peekPending(token) : null;
  if (!p) return NextResponse.json({ step: null });
  // The address, for "continue as …" — the account's own, or the one being registered.
  return NextResponse.json({ step: p.purpose, email: p.email });
}

export async function POST(request: Request) {
  const msg = getDict().errors;
  const t = getDict();
  if (!google.enabled) return NextResponse.json({ error: msg.serviceUnavailable }, { status: 503 });
  const token = cookies().get(G_PENDING_COOKIE)?.value ?? "";
  const body = await request.json().catch(() => null);

  if (body?.link === true) {
    const me = await getSessionUser();
    if (!me) return NextResponse.json({ error: msg.notSignedIn }, { status: 401 });
    const ok = await linkPendingToAccount(token, me.id);
    expire();
    await trackEvent({ userId: me.id, event: "google_link", page: "/login", properties: { ok } });
    if (!ok) return NextResponse.json({ error: msg.googleLinkInvalid }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  const username = normaliseUsername(typeof body?.username === "string" ? body.username : "");
  if (checkUsername(username)) {
    return NextResponse.json({ error: msg.invalidUsername }, { status: 400 });
  }
  if (body?.acceptedTerms !== true) {
    return NextResponse.json({ error: t.earlyAccess.mustAgree }, { status: 400 });
  }

  const made = await finishGoogleSignup(token, username, getLocale());
  if ("refused" in made) {
    if (made.refused === "usernameTaken") return NextResponse.json({ error: msg.usernameTaken }, { status: 409 });
    if (made.refused === "emailTaken") return NextResponse.json({ error: msg.emailTaken }, { status: 409 });
    if (made.refused === "full") {
      return NextResponse.json(
        { error: t.earlyAccess.fullTitle, detail: t.earlyAccess.fullBody, full: true }, { status: 409 });
    }
    return NextResponse.json({ error: msg.googleExpired }, { status: 410 });
  }
  expire();
  await trackEvent({ userId: made.userId, event: "signup", page: "/login", properties: { method: "google" } });

  if (!made.mustVerify) {
    await createSession(made.userId);
    return NextResponse.json({ ok: true });
  }
  // Google did not vouch for the address: RichHabit's own verification does,
  // exactly as a password sign-up would. No session until then.
  let sent = true;
  try {
    await sendVerification(made.userId, made.email, getLocale());
  } catch (e) {
    console.error("[google signup] verification email", e);
    sent = false;
  }
  return NextResponse.json({ ok: true, pending: true, email: made.email, sent });
}
