import { body, requireId, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { deleteStack, saveStack } from "@/lib/db/queries";
import { parseStack } from "@/lib/validate";

export async function POST(request: Request) {
  return withUser(async (userId) => {
    const stack = parseStack(await body(request));
    const created = await saveStack(userId, stack);
    await trackEvent({
      userId, event: created ? "habit_stack_created" : "habit_stack_updated",
      entityType: "stack", entityId: stack.id, page: "/more/stacks",
    });
  });
}

export async function DELETE(request: Request) {
  return withUser(async (userId) => {
    const id = requireId(request);
    await deleteStack(userId, id);
  });
}
