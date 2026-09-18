import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { requestOwnVerification } from "@/lib/email/verify";
import { getDict, getLocale } from "@/lib/i18n/server";
import { throttle } from "@/lib/throttle";

/**
 * "Send me a link to verify the address on my account."
 *
 * Three things this route deliberately does not do.
 *
 * **It never reads the request body.** There is no recipient parameter to
 * supply, misspell or abuse: the address is read from the signed-in account
 * inside `requestOwnVerification`. A route that accepted an address would be a
 * way to send RichHabit mail to a stranger, and eventually a way to attach a
 * stranger's address to an account.
 *
 * **It changes nothing about the account.** No column is written here.
 * `verification_required` stays exactly as it was — a grandfathered account
 * stays grandfathered, and keeps signing in as before whatever happens to this
 * request — and `email_verified_at` is stamped only when a live token is
 * redeemed at /verify.
 *
 * **It does not distinguish "sent" from "sent too recently".** Both answer the
 * same way, because the difference is not the caller's business and nothing
 * useful follows from it.
 */
export async function POST(request: Request) {
  const t = getDict();

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: t.errors.notSignedIn }, { status: 401 });

  /* Per account and per caller. The account gap in the database is the real
     limit — this one only stops a single client hammering the button. */
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  if (!throttle(`verify-own:${user.id}:${ip}`)) {
    return NextResponse.json({ error: t.errors.tooManyAttempts }, { status: 429 });
  }

  let outcome;
  try {
    outcome = await requestOwnVerification(user.id, getLocale());
  } catch (e) {
    /*
     * A provider refusal carries a reason worth having in the log, and the
     * reason sometimes quotes the recipient. Addresses are scrubbed, so the
     * diagnosis survives and the private part does not. No token, key or
     * password can appear here: none of them is in this error's path.
     */
    const reason = (e instanceof Error ? e.message : String(e))
      .replace(/[\w.+-]+@[\w.-]+/g, "<address>");
    console.error("[account/email/verify]", reason);
    return NextResponse.json({ error: t.verify.sendFailed }, { status: 503 });
  }

  switch (outcome) {
    case "sent":
    case "too_soon":
      return NextResponse.json({ ok: true, status: "sent", note: t.protect.sent });
    case "already_verified":
      return NextResponse.json({ ok: true, status: "already", note: t.protect.verified });
    case "no_address":
      return NextResponse.json({ error: t.protect.noAddress }, { status: 400 });
    case "not_available":
      return NextResponse.json({ error: t.errors.saveFailed }, { status: 400 });
  }
}

export const dynamic = "force-dynamic";
