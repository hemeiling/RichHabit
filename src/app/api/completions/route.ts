import { body, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { setCompletion } from "@/lib/db/queries";
import { parseCompletion } from "@/lib/validate";

export async function POST(request: Request) {
  return withUser(async (userId) => {
    const { habitId, date, done, value, note } = parseCompletion(await body(request));
    await setCompletion(userId, habitId, date, done, value, note);
    await trackEvent({
      userId,
      event: done ? "habit_completed" : "habit_uncompleted",
      entityType: "habit", entityId: habitId, page: "/today",
      // Whether a note exists is a product signal; its text is not recorded.
      properties: { hasValue: value != null, hasNote: !!note },
    });
  });
}
