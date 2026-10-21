import { withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { centerFor } from "@/lib/notifications/server";
import { reminderExtras } from "@/lib/notifications/reminders";

/**
 * The Notification Center, read when the bell opens: Upcoming (worked out live
 * from the source tables, in the reader's zone — `tz` is this browser's, used
 * only until Account settings hold one) and Activity, for the signed-in
 * account only. Counted once per opening; never a title.
 */
export async function GET(request: Request) {
  return withUser(async (userId) => {
    const center = await centerFor(userId, new URL(request.url).searchParams.get("tz"), reminderExtras(userId));
    await trackEvent({ userId, event: "notification_center_opened", page: "/notifications",
      properties: { upcoming: center.upcoming.length, unread: center.unread } });
    return center;
  }, (d) => d.errors.loadFailedTitle);
}

export const dynamic = "force-dynamic";
