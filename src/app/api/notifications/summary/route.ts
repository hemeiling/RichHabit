import { withUser } from "@/lib/api";
import { adoptZone, unreadCount } from "@/lib/notifications/server";
import { materializeReminders, unreadReminders } from "@/lib/notifications/reminders";

/**
 * The badge, asked for when the app opens and when a tab comes back. This is
 * also when reminders that have come due are written (in-app reminders: they
 * are noticed when RichHabit is open, never pushed while it is closed), and
 * when a first visit takes this browser's zone as the account's.
 */
export async function GET(request: Request) {
  return withUser(async (userId) => {
    const tz = new URL(request.url).searchParams.get("tz");
    await adoptZone(userId, tz);
    await materializeReminders(userId, tz);
    return { unread: await unreadCount(userId, unreadReminders) };
  }, (d) => d.errors.loadFailedTitle);
}

export const dynamic = "force-dynamic";
