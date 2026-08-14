import { body, requireId, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { deleteHabit, saveHabit } from "@/lib/db/queries";
import { parseHabit } from "@/lib/validate";

export async function POST(request: Request) {
  return withUser(async (userId) => {
    const habit = parseHabit(await body(request));
    const created = await saveHabit(userId, habit);
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
    await trackEvent({ userId, event: "habit_deleted", entityType: "habit", entityId: id, page: "/habits" });
  });
}
