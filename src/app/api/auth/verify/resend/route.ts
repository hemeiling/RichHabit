import { NextResponse } from "next/server";
import { query } from "@/lib/db/pool";
import { mayResend, sendVerification } from "@/lib/email/verify";
import { normaliseIdentifier } from "@/lib/identity";
import { getDict, getLocale } from "@/lib/i18n/server";
import { throttle } from "@/lib/throttle";

/**
 * Sending the verification link again.
 *
 * This endpoint is unauthenticated by necessity — the person asking cannot sign
 * in yet, which is the whole problem. So it is built to be useless for anything
 * other than its purpose:
 *
 *   - **It always answers the same.** Whether the address is unknown, already
 *     verified, or genuinely pending, the reply is identical. Otherwise it
 *     becomes a way to ask "does this person have an account here", which the
 *     sign-in form is careful not to answer either.
 *   - **Mail only ever goes to the address already on the account.** Nothing in
 *     the request can redirect it, so it cannot be used to post a RichHabit
 *     message at a stranger.
 *   - **Two limits, not one.** Per caller, so one source cannot pump the queue;
 *     and per account, so a hundred callers cannot combine to flood one inbox.
 */
export async function POST(request: Request) {
  const t = getDict();
  const locale = getLocale();
  const parsed = await request.json().catch(() => null);
  const identifier = normaliseIdentifier(
    typeof parsed?.identifier === "string" ? parsed.identifier : "");

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  if (!throttle(`resend:${ip}`)) {
    return NextResponse.json({ error: t.errors.tooManyAttempts }, { status: 429 });
  }

  // The same answer regardless of what happens below.
  const answer = NextResponse.json({ ok: true, sent: t.verify.resendSent });

  if (!identifier) return answer;

  try {
    const rows = await query<{ id: string; email: string | null }>(
      `select id, email from users
        where (lower(email) = $1 or lower(username) = $1)
          and verification_required and email_verified_at is null
          and disabled_at is null`,
      [identifier],
    );
    const user = rows[0];
    if (user?.email && await mayResend(user.id)) {
      await sendVerification(user.id, user.email, locale);
    }
  } catch (e) {
    // Logged, not surfaced: telling the caller that sending failed would
    // distinguish a real pending account from an unknown one.
    console.error("[verify/resend]", e);
  }

  return answer;
}

export const dynamic = "force-dynamic";
