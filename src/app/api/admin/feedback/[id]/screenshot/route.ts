import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/admin";
import { feedbackScreenshot } from "@/lib/admin/feedback";
import { isUuid } from "@/lib/http";

/**
 * The attached image, for an admin only.
 *
 * Not `withAdmin`, because that wraps the result in JSON and this returns
 * bytes — but the same check, and the same 404 for everyone else, so an image
 * cannot be fetched by guessing a feedback id.
 */
export async function GET(_r: Request, { params }: { params: { id: string } }) {
  const admin = await currentAdmin();
  if (!admin || !isUuid(params.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const row = await feedbackScreenshot(params.id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(row.screenshot), {
    headers: {
      "Content-Type": row.screenshot_type,
      // Never cached by a shared cache: it is somebody's screen.
      "Cache-Control": "private, no-store",
    },
  });
}

export const dynamic = "force-dynamic";
