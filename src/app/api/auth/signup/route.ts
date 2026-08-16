import { NextResponse } from "next/server";
import { MAX_PASSWORD, MIN_PASSWORD, createSession, hashPassword } from "@/lib/auth";
import { transaction } from "@/lib/db/pool";
import { isTestInstance } from "@/lib/env";
import { getDict, getLocale } from "@/lib/i18n/server";
import { seedAccount } from "@/lib/seed";

/**
 * Creating an account. The user row and its starter habits go in together, so
 * no account can exist half-seeded — the same guarantee the old database
 * trigger gave. The starter set is created in the language the visitor is
 * using, which is what makes the app usable for someone who never switches it
 * to English.
 */
export async function POST(request: Request) {
  const parsed = await request.json().catch(() => null);
  const email = typeof parsed?.email === "string" ? parsed.email.trim().toLowerCase() : "";
  const password = typeof parsed?.password === "string" ? parsed.password : "";
  const locale = getLocale();
  const msg = getDict().errors;

  if (!email.includes("@")) {
    return NextResponse.json({ error: msg.invalidEmail }, { status: 400 });
  }
  if (email.length > 254) {
    return NextResponse.json({ error: msg.emailTooLong }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json(
      { error: msg.passwordTooShort(MIN_PASSWORD) }, { status: 400 });
  }
  if (password.length > MAX_PASSWORD) {
    return NextResponse.json(
      { error: msg.passwordTooLong(MAX_PASSWORD) }, { status: 400 });
  }
  /*
   * Accepting the free early-access terms is required to create an account, and
   * required here rather than only in the form — a checkbox is a courtesy, the
   * refusal is the rule. Signing in is untouched: nobody is asked again.
   */
  if (parsed?.acceptedTerms !== true) {
    return NextResponse.json({ error: getDict().earlyAccess.mustAgree }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  let userId: string;
  try {
    userId = await transaction(async (q) => {
      /*
       * `role` is not in this statement, and nothing in this file reads one
       * from the request. A self-registered account takes the column default,
       * which is 'user'. Sending {"role":"admin"} to this endpoint changes
       * nothing, because there is no code path here that could apply it.
       */
      const rows = await q<{ id: string }>(
        `insert into users (email, password_hash, created_via, terms_accepted_at)
         values ($1, $2, $3, now()) returning id`,
        [email, passwordHash, isTestInstance ? "test" : "self_signup"],
      );
      await seedAccount(q, rows[0].id, locale);
      return rows[0].id;
    });
  } catch (e) {
    // users_email_idx is what makes this race-safe; checking first would not be.
    if (e instanceof Error && /users_email_idx|duplicate key/.test(e.message)) {
      return NextResponse.json({ error: msg.emailTaken }, { status: 409 });
    }
    // Same reasoning as sign-in: an unreachable database says so, rather than
    // escaping as an empty 500 the form can only describe as "went wrong".
    console.error("[signup]", e);
    return NextResponse.json({ error: msg.serviceUnavailable }, { status: 503 });
  }

  await createSession(userId);
  return NextResponse.json({ ok: true });
}
