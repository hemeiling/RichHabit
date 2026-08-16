import { body, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { savePriorities } from "@/lib/db/queries";
import { parsePriorities } from "@/lib/validate";

/**
 * The day's post-it. Private user content: what someone means to do today is
 * never read by an admin screen and never leaves this account.
 */
export async function POST(request: Request) {
  return withUser(async (userId) => {
    const { date, items } = parsePriorities(await body(request));
    await savePriorities(userId, date, items);
    // How many, and how many are done. Never what they say.
    await trackEvent({
      userId, event: "priorities_set", page: "/today",
      properties: { count: items.length, done: items.filter((i: { done: boolean }) => i.done).length },
    });
  });
}
