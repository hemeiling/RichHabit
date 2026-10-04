import { NextResponse } from "next/server";
import { previewInvitation } from "@/lib/together/invitations";

/**
 * What an invitation is for, before signing in: the board's name and who sent
 * it. Callable signed out — the token in the body is the credential, and it was
 * readable only in the inbox it was sent to. Every unusable token gets the same
 * answer. Nothing is written.
 */
export async function POST(request: Request) {
  const b = await request.json().catch(() => null);
  const result = await previewInvitation(b?.token);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
