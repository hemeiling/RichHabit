import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { previewConnection } from "@/lib/together/connections";

/**
 * What the holder of an emailed connection token may learn before accepting:
 * who asked, and — when signed in — whether it is for this account. Signed
 * out is allowed, exactly like the space invitation preview: the token is
 * the capability.
 */
export async function POST(request: Request) {
  const token = (await request.json().catch(() => null))?.token;
  const viewer = await getSessionUser();
  return NextResponse.json(await previewConnection(token, viewer?.id ?? null));
}

export const dynamic = "force-dynamic";
