import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin";
import { updateFeedback } from "@/lib/admin/feedback";
import { check } from "@/lib/http";

/** Triage: status, area, and the admin's private note. Admin-only, 404 to anyone else. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return withAdmin(async () => {
    const id = check.uuid(params.id, "id");
    const b = await request.json().catch(() => null);
    await updateFeedback(id, {
      status: typeof b?.status === "string" ? b.status : undefined,
      area: b?.area === null ? null : typeof b?.area === "string" ? b.area : undefined,
      adminNote: typeof b?.adminNote === "string"
        ? b.adminNote.slice(0, 4000) : undefined,
    });
    return { ok: true };
  });
}

/**
 * There is nothing to GET here — triage is a PATCH, and users never read
 * feedback back. Without this, Next answers 405 *before* any authorisation
 * runs, which tells an ordinary user the route exists; every other route under
 * /api/admin answers 404 to them. This keeps that uniform.
 */
export async function GET() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export const dynamic = "force-dynamic";
