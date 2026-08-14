import { body, requireId, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { deleteHabit, saveHabit } from "@/lib/db/queries";
import { parseHabit } from "@/lib/validate";

export async function POST(request: Request) {
  return withUser(async (userId) => {
    const habit = parseHabit(await body(request));
    const created = await saveHabit(userId, habit);
    await trackEvent({
      userId,
      event: created ? "habit_created" : habit.active ? "habit_edited" : "habit_archived",
      entityType: "habit", entityId: habit.id, page: "/habits",
      // Shape, never content: no habit name reaches the events table.
      properties: { category: habit.category, kind: habit.type, weight: habit.weight,
        frequency: habit.frequency.mode, hasGoal: !!habit.goalId },
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
