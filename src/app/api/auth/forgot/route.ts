import { NextResponse } from "next/server";
import { requestReset } from "@/lib/auth/passwordReset";
import { getDict, getLocale } from "@/lib/i18n/server";
import { throttle } from "@/lib/throttle";

/**
 * "I've forgotten my password."
 *
 * Unauthenticated by necessity — the person asking cannot sign in, which is the
 * whole problem — so it is built to be useless for anything else.
 *
 * **It always answers the same.** Unknown identifier, an account with no
 * address, an address nobody ever proved, a disabled account, a perfectly live
 * one: one sentence, one status code, one shape. Otherwise this becomes a way
 * to ask "does this person have an account here", and a way to learn which
 * addresses are verified — and the sign-in form is careful not to answer either.
 *
 * **Mail only ever goes to the address on the account**, which the library
 * reads for itself. Nothing in this request can redirect it.
 *
 * **Limits are applied in two places.** Per caller here, so one source cannot
 * pump the queue; and per account in the database, so many callers cannot
 * combine to flood one inbox, and a restart cannot reset the allowance.
 */
export async function POST(request: Request) {
  const t = getDict();
  const parsed = await request.json().catch(() => null);
  const identifier = typeof parsed?.identifier === "string" ? parsed.identifier : "";

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  if (!throttle(`forgot:${ip}`)) {
    return NextResponse.json({ error: t.errors.tooManyAttempts }, { status: 429 });
  }

  // The answer, decided before anything is looked up, and returned whatever
  // happens below.
  const answer = NextResponse.json({ ok: true });

  if (!identifier.trim()) return answer;

  try {
    await requestReset(identifier, getLocale());
  } catch (e) {
    /*
     * Logged, never surfaced: telling the caller that sending failed would
     * distinguish a real account from an unknown one. Addresses are scrubbed,
     * because a provider refusal sometimes quotes the recipient; no token is in
     * this error's path at all.
     */
    const reason = (e instanceof Error ? e.message : String(e))
      .replace(/[\w.+-]+@[\w.-]+/g, "<address>");
    console.error("[auth/forgot]", reason);
  }

  return answer;
}

export const dynamic = "force-dynamic";
