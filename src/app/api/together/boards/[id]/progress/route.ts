import { trackEvent } from "@/lib/analytics/track";
import { loadProgress } from "@/lib/together/progressRead";
import { togetherRoute } from "@/lib/together/route";

/**
 * A space's Project Progress & Contributions for one set of filters: `period`
 * (all, month, 3m, quarter, year, or custom with `from` and `to`), `group`,
 * `member`, and the reader's `tz` for what "today" and each date mean. Members
 * only. Numbers and the space's group and member names — never a task's words.
 *
 * `first=1` marks the screen's first reading, so opening Progress is counted
 * once and changing a filter is not counted at all.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return togetherRoute(async (userId) => {
    const url = new URL(request.url).searchParams;
    const view = await loadProgress(userId, params.id, {
      period: url.get("period"), from: url.get("from"), to: url.get("to"),
      group: url.get("group"), member: url.get("member"), tz: url.get("tz"),
    });
    if (url.get("first") === "1") {
      await trackEvent({ userId, event: "together_progress_viewed", page: "/together",
        properties: { period: view.filters.period.kind, filtered: view.filters.group !== "all" || view.filters.member !== "all" } });
    }
    return view;
  });
}
