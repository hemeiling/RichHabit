import { NextResponse } from "next/server";
import { MAX_PASSWORD, MIN_PASSWORD, createSession, hashPassword } from "@/lib/auth";
import { withReservedSlot } from "@/lib/db/capacity";
import { isTestInstance } from "@/lib/env";
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

  let userId: string | null;
  try {
    userId = await withReservedSlot(async (q) => {
      const rows = await q<{ id: string }>(
        `insert into users (email, username, password_hash, created_via, terms_accepted_at)
         values ($1, $2, $3, $4, now()) returning id`,
        [email, username, passwordHash, isTestInstance ? "test" : "self_signup"],
      );
      const id = rows[0].id;
      // seedAccount creates the profile row; the names go on straight after, so
      // there is one definition of what a new account starts with.
      await seedAccount(q, id, locale);
      await q("update profiles set first_name = $2, last_name = $3 where id = $1",
        [id, firstName, lastName]);
      return id;
    });
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

  await createSession(userId);
  return NextResponse.json({ ok: true });
}
