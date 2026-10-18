import { ApiError, body, requireId, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { markMemberStale, viewerToday } from "@/lib/community";
import { isRepeatUnavailable } from "@/lib/db/diagnose";
import { deleteHabit, saveHabit } from "@/lib/db/queries";
import { getDict } from "@/lib/i18n/server";
import { LEGACY_FREQ_MODES } from "@/lib/types";
import { parseHabit } from "@/lib/validate";

export async function POST(request: Request) {
  return withUser(async (userId) => {
    const habit = parseHabit(await body(request));
    let created: boolean;
    try {
      // A schedule change takes effect from the person's today, not the server's.
      created = await saveHabit(userId, habit, viewerToday(request.headers.get("x-rh-timezone")));
    } catch (e) {
      /* A deploy can land before its migration. Then only the newer ways of
         repeating cannot be saved — said as such, not as a failed save — and
         every other schedule keeps working. */
      if (!LEGACY_FREQ_MODES.includes(habit.frequency.mode) && isRepeatUnavailable(e)) {
        throw new ApiError(getDict().habits.repeatUnavailable, 503);
      }
      throw e;
    }
    // A new, edited or retired habit changes what counts as scheduled, and so
    // changes the denominator of this member's board figure.
    markMemberStale(userId);
    // A behaviour the user named is not the same product action as editing a
    // habit on the sheet, and adoption of each is worth reading separately.
    const event = created
      ? habit.status === "candidate" ? "behaviour_captured" : "habit_created"
      : habit.status === "active" ? "habit_edited" : "habit_status_changed";
    await trackEvent({
      userId, event, entityType: "habit", entityId: habit.id,
      page: habit.status === "candidate" ? "/more/refine" : "/habits",
      // Shape, never content: no habit name reaches the events table.
      properties: { category: habit.category, kind: habit.type, weight: habit.weight,
        frequency: habit.frequency.mode, hasGoal: !!habit.goalId, status: habit.status },
    });
  });
}

export async function DELETE(request: Request) {
  return withUser(async (userId) => {
    const id = requireId(request);
    await deleteHabit(userId, id);
    markMemberStale(userId);
    await trackEvent({ userId, event: "habit_deleted", entityType: "habit", entityId: id, page: "/more/habits" });
  });
}
