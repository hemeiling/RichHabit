import { NextResponse } from "next/server";
import { MAX_PASSWORD, MIN_PASSWORD } from "@/lib/auth";
import { redeemReset } from "@/lib/auth/passwordReset";
import { passwordProblems } from "@/lib/password";
import { getDict } from "@/lib/i18n/server";
import { throttle } from "@/lib/throttle";

/**
 * Spending a reset link and choosing the new password.
 *
 * **POST, and only POST.** The emailed link opens a page that asks; this is
 * what that page calls. Nothing is redeemed by fetching a URL, so a mail
 * scanner cannot spend somebody's link, and the token never travels as part of
 * a URL — the page reads it from the fragment, which browsers do not send.
 *
 * The password rules are the ones the sign-up form and the admin form use, so
 * there is one definition of an acceptable password, checked here regardless of
 * what any client believed. Everything else — single use, expiry, consuming
 * outstanding tokens, ending every session — happens in one transaction in
 * lib/auth/passwordReset.
 */
export async function POST(request: Request) {
  const msg = getDict().errors;
  const t = getDict();
  const parsed = await request.json().catch(() => null);
  const token = typeof parsed?.token === "string" ? parsed.token : "";
  const password = typeof parsed?.password === "string" ? parsed.password : "";

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  if (!throttle(`reset:${ip}`)) {
    return NextResponse.json({ error: msg.tooManyAttempts }, { status: 429 });
  }

  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: msg.passwordTooShort(MIN_PASSWORD) }, { status: 400 });
  }
  if (password.length > MAX_PASSWORD) {
    return NextResponse.json({ error: msg.passwordTooLong(MAX_PASSWORD) }, { status: 400 });
  }
  if (passwordProblems(password).includes("too_simple")) {
    return NextResponse.json({ error: msg.passwordTooSimple }, { status: 400 });
  }

  let outcome;
  try {
    outcome = await redeemReset(token, password);
  } catch (e) {
    // No token, password or hash is in this error's path; the message is a
    // database or provider failure and is safe to record as-is.
    console.error("[auth/reset]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: msg.serviceUnavailable }, { status: 503 });
  }

  if (outcome.status === "expired") {
    return NextResponse.json({ status: "expired", error: t.forgot.linkExpired }, { status: 400 });
  }
  if (outcome.status === "invalid") {
    return NextResponse.json({ status: "invalid", error: t.forgot.linkInvalid }, { status: 400 });
  }

  /* Every session for that account is gone, including any this browser held —
     so there is deliberately nothing to sign in with here. The page sends them
     to the sign-in form. */
  return NextResponse.json({ status: "ok" });
}

export const dynamic = "force-dynamic";
