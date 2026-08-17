import { NextResponse } from "next/server";
import { redeem } from "@/lib/email/verify";
import { getDict } from "@/lib/i18n/server";

/**
 * Redeeming a verification link.
 *
 * **POST, not GET, and that is not an accident.** Corporate mail filters and
 * link-preview bots fetch every URL in a message before the recipient sees it.
 * A GET that activated the account would be spent by a scanner, and the person
 * would click a dead link. So the emailed URL opens a page that asks, and this
 * is what the button calls.
 *
 * Answers carry a `status` the page maps to its own wording, rather than the
 * server picking the sentence — the page is a client component and follows the
 * language toggle, so the text has to come from the dictionary the reader is
 * currently looking at.
 */
export async function POST(request: Request) {
  const msg = getDict().errors;
  const parsed = await request.json().catch(() => null);
  const token = typeof parsed?.token === "string" ? parsed.token : "";

  let outcome;
  try {
    outcome = await redeem(token);
  } catch (e) {
    console.error("[verify]", e);
    return NextResponse.json({ error: msg.serviceUnavailable }, { status: 503 });
  }

  // 200 for "already": nothing failed, the account is verified, and the page
  // should say so warmly rather than showing an error.
  const status = outcome.status === "ok" || outcome.status === "already" ? 200
    : outcome.status === "full" ? 409
      : 400;

  return NextResponse.json(outcome, { status });
}

export const dynamic = "force-dynamic";
