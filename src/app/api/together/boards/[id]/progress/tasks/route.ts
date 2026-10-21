import { loadProgressTasks } from "@/lib/together/progressRead";
import { togetherRoute } from "@/lib/together/route";

/**
 * The tasks behind one row of Individual contributions: `who` is a member's id,
 * or "none" for the unassigned work; `period`, `from`, `to`, `group` and `tz` are
 * the dashboard's own filters. Members only — anyone else gets the same 404 as a
 * space that does not exist.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return togetherRoute((userId) => {
    const url = new URL(request.url).searchParams;
    return loadProgressTasks(userId, params.id, {
      who: url.get("who"), period: url.get("period"), from: url.get("from"), to: url.get("to"),
      group: url.get("group"), tz: url.get("tz"),
    });
  });
}
