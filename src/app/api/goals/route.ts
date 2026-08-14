import { body, requireId, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { deleteGoal, saveGoal } from "@/lib/db/queries";
import { parseGoal } from "@/lib/validate";

export async function POST(request: Request) {
  return withUser(async (userId) => {
    const goal = parseGoal(await body(request));
    const created = await saveGoal(userId, goal);
    await trackEvent({
      userId, event: created ? "goal_created" : "goal_updated",
      entityType: "goal", entityId: goal.id, page: "/more/goals",
      properties: { area: goal.area },
    });
  });
}

export async function DELETE(request: Request) {
  return withUser(async (userId) => {
    const id = requireId(request);
    await deleteGoal(userId, id);
    await trackEvent({ userId, event: "goal_deleted", entityType: "goal", entityId: id, page: "/more/goals" });
  });
}
