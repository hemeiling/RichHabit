import { body, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { setHabitReminder } from "@/lib/notifications/server";

/** One habit's reminder: `{ on: true, time?: "HH:MM" | null }` or `{ on: false }`. The habit's owner only. */
export async function PUT(request: Request, { params }: { params: { habitId: string } }) {
  return withUser(async (userId) => {
    const b = await body<{ on?: unknown; time?: unknown }>(request);
    const r = await setHabitReminder(userId, params.habitId, b.on, b.time);
    await trackEvent({ userId, event: "habit_reminder_set", page: "/habits", properties: { on: r.on, ownTime: r.time !== null } });
    return r;
  });
}
