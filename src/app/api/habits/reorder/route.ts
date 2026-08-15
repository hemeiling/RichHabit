import { body, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { reorderHabits } from "@/lib/db/queries";
import { parseIdList } from "@/lib/validate";

/**
 * The order of one section, as a list of habit ids. Ids the account does not
 * own are ignored by the query rather than refused, because a reorder is a
 * statement about this user's own list and nothing else.
 */
export async function POST(request: Request) {
  return withUser(async (userId) => {
    const ids = parseIdList(await body(request), "ids");
    await reorderHabits(userId, ids);
    // How many moved is a product signal; which habits moved is not.
    await trackEvent({
      userId, event: "habits_reordered", page: "/today",
      properties: { count: ids.length },
    });
  });
}
