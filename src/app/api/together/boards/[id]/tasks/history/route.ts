import { historyPage } from "@/lib/together/work";
import { togetherRoute } from "@/lib/together/route";

/**
 * History — Done for more than 24 hours — a page at a time after `cursor` (the
 * last one on screen), optionally for one `group` ("none": the ungrouped tasks)
 * and titles containing `q`. The first page also counts what the filter holds,
 * by month in the reader's zone (`tz`).
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return togetherRoute((userId) => {
    const url = new URL(request.url).searchParams;
    return historyPage(userId, params.id, url.get("cursor"), { group: url.get("group"), search: url.get("q"), tz: url.get("tz") });
  });
}
