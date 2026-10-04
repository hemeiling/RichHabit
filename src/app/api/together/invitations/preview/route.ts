import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { previewInvitation } from "@/lib/together/invitations";

/**
 * What an invitation is for, before accepting: the board's name, who sent it,
 * the invited address masked, and — if someone is signed in — whether it is
 * for that account. Callable signed out — the token in the body is the
 * credential, and it was readable only in the inbox it was sent to. Every
 * unusable token gets the same answer. Nothing is written.
 */
export async function POST(request: Request) {
  const b = await request.json().catch(() => null);
  const viewer = await getSessionUser().catch(() => null);
  const result = await previewInvitation(b?.token, viewer?.id ?? null);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
