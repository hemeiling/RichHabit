import { body, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { markRead } from "@/lib/notifications/server";

/** Marks notices read: `{ ids: [...] }`, or `{ all: true }`. Only ever the signed-in account's own. */
export async function POST(request: Request) {
  return withUser(async (userId) => {
    const b = await body<{ ids?: unknown; all?: unknown }>(request);
    const all = b.all === true;
    const changed = await markRead(userId, all ? "all" : b.ids);
    if (all && changed) await trackEvent({ userId, event: "notifications_marked_read", page: "/notifications", properties: { count: changed } });
    return { ok: true, changed };
  });
}
