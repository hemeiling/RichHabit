import { NextResponse } from "next/server";
import { MAX_PASSWORD, MIN_PASSWORD, createSession, hashPassword } from "@/lib/auth";
import { withReservedSlot } from "@/lib/db/capacity";
import { transaction } from "@/lib/db/pool";
import { sendVerification } from "@/lib/email/verify";
import { capacity, isTestInstance } from "@/lib/env";
import { checkUsername, isPlausibleEmail, normaliseEmail, normaliseUsername } from "@/lib/identity";
import { passwordProblems } from "@/lib/password";
import { getDict, getLocale } from "@/lib/i18n/server";
import { seedAccount } from "@/lib/seed";

/**
 * Creating an account.
 *
 * The user row, the profile and the starter habits go in together, so no
 * account can exist half-seeded — and the whole thing happens inside the
 * transaction that reserved a place in the free early-access programme, so a
 * refusal leaves nothing behind and two simultaneous sign-ups at the last place
 * cannot both succeed.
 *
 * Nothing here reads a role from the request. A self-registered account takes
 * the column default, which is 'user'.
 */
export async function POST(request: Request) {
  const parsed = await request.json().catch(() => null);
  const locale = getLocale();
  const t = getDict();
  const msg = t.errors;

  const email = normaliseEmail(typeof parsed?.email === "string" ? parsed.email : "");
  const username = normaliseUsername(typeof parsed?.username === "string" ? parsed.username : "");
  const firstName = String(parsed?.firstName ?? "").trim().slice(0, 80);
  const lastName = String(parsed?.lastName ?? "").trim().slice(0, 80);
  const password = typeof parsed?.password === "string" ? parsed.password : "";

  if (!firstName || !lastName) {
    return NextResponse.json({ error: msg.nameRequired }, { status: 400 });
  }
  if (!isPlausibleEmail(email)) {
    return NextResponse.json({ error: msg.invalidEmail }, { status: 400 });
  }
  if (email.length > 254) {
    return NextResponse.json({ error: msg.emailTooLong }, { status: 400 });
  }
  const usernameProblem = checkUsername(username);
  if (usernameProblem) {
    return NextResponse.json({ error: msg.invalidUsername }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: msg.passwordTooShort(MIN_PASSWORD) }, { status: 400 });
  }
  if (password.length > MAX_PASSWORD) {
    return NextResponse.json({ error: msg.passwordTooLong(MAX_PASSWORD) }, { status: 400 });
  }
  // The same floor an admin-set password gets, so one rule covers both.
  if (passwordProblems(password).includes("too_simple")) {
    return NextResponse.json({ error: msg.passwordTooSimple }, { status: 400 });
  }
  if (parsed?.acceptedTerms !== true) {
    return NextResponse.json({ error: t.earlyAccess.mustAgree }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  /*
   * With verification on, an account is created but takes no place: it reserves
   * its email and username, and nothing more. Clicking the link is what
   * consumes one of the fifty — see lib/email/verify.ts, which does that count
   * behind the same lock this route uses.
   *
   * `verification_required` is written from the flag here, once. Nothing reads
   * the flag again for this account afterwards, which is what leaves every
   * existing user untouched by it.
   */
  const mustVerify = capacity.requireEmailVerification;

  const create = async (q: Parameters<Parameters<typeof withReservedSlot>[0]>[0]) => {
    const rows = await q<{ id: string }>(
      `insert into users (email, username, password_hash, created_via, terms_accepted_at,
                          verification_required)
       values ($1, $2, $3, $4, now(), $5) returning id`,
      [email, username, passwordHash, isTestInstance ? "test" : "self_signup", mustVerify],
    );
    const id = rows[0].id;
    // seedAccount creates the profile row; the names go on straight after, so
    // there is one definition of what a new account starts with.
    await seedAccount(q, id, locale);
    await q("update profiles set first_name = $2, last_name = $3 where id = $1",
      [id, firstName, lastName]);
    return id;
  };

  let userId: string | null;
  try {
    // A pending account needs no place, so it does not queue behind the
    // capacity lock and cannot be refused for being full. It is refused at the
    // link instead, where the place is actually taken.
    userId = mustVerify ? await transaction(create) : await withReservedSlot(create);
  } catch (e) {
    if (e instanceof Error && /users_email_idx/.test(e.message)) {
      return NextResponse.json({ error: msg.emailTaken }, { status: 409 });
    }
    if (e instanceof Error && /users_username_idx/.test(e.message)) {
      return NextResponse.json({ error: msg.usernameTaken }, { status: 409 });
    }
    console.error("[signup]", e);
    return NextResponse.json({ error: msg.serviceUnavailable }, { status: 503 });
  }

  /*
   * Null means the programme is full. 409 rather than 403: nothing is wrong
   * with the request, there is simply no place for it.
   */
  if (!userId) {
    return NextResponse.json({
      error: t.earlyAccess.fullTitle,
      detail: t.earlyAccess.fullBody,
      full: true,
    }, { status: 409 });
  }

  if (!mustVerify) {
    await createSession(userId);
    return NextResponse.json({ ok: true });
  }

  /*
   * No session. A pending account is not signed in, and the middleware and
   * `getSessionUser` both refuse it anyway — there is nothing to be half-inside
   * the app with.
   *
   * A send that fails does not delete the account. The address and username are
   * legitimately reserved by someone who did register, and destroying that on a
   * transient provider error would hand their username to the next person to
   * try. The screen offers to send it again instead.
   */
  let sent = true;
  try {
    await sendVerification(userId, email, locale);
  } catch (e) {
    console.error("[signup] verification email", e);
    sent = false;
  }

  return NextResponse.json({ ok: true, pending: true, email, sent });
}
