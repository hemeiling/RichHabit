import { trackEvent } from "@/lib/analytics/track";
import { restoreTask } from "@/lib/together/work";
import { togetherRoute } from "@/lib/together/route";

/** Undo a delete: the task returns to its stage, in its place. */
export async function POST(_: Request, { params }: { params: { id: string; taskId: string } }) {
  return togetherRoute(async (userId) => {
    const task = await restoreTask(userId, params.id, params.taskId);
    await trackEvent({ userId, event: "together_task_restored", page: "/together" });
    return { task };
  });
}
