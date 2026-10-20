import { NextResponse } from "next/server";
import { trackEvent } from "@/lib/analytics/track";
import { getLocale } from "@/lib/i18n/server";
import { exportProgress } from "@/lib/together/progressRead";
import { togetherRoute } from "@/lib/together/route";

/**
 * The Excel workbook of a space's progress: `scope=view` for exactly the
 * dashboard's filters (the same parameters as Progress), `scope=all` for the
 * entire project. Members only — the same gate as every Together read, so
 * anyone else gets the same 404 as a space that does not exist.
 *
 * Never cached anywhere: it holds the space's task titles and members' names.
 * The audit event carries the scope and a count, never a word of what is in it.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return togetherRoute(async (userId) => {
    const url = new URL(request.url).searchParams;
    const file = await exportProgress(userId, params.id, {
      scope: url.get("scope"), period: url.get("period"), from: url.get("from"), to: url.get("to"),
      group: url.get("group"), member: url.get("member"), tz: url.get("tz"),
    }, getLocale());
    const response = new NextResponse(new Uint8Array(file.body), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${file.asciiName}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
    // Recorded once the file exists — never for an export that failed.
    await trackEvent({ userId, event: "together_progress_exported", page: "/together",
      properties: { scope: file.scope, tasks: file.tasks } });
    return response;
  });
}
