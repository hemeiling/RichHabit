import { body } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { moveTask, type MoveIntent } from "@/lib/together/work";
import { togetherRoute } from "@/lib/together/route";

/**
 * Moves a task to a place in a list — drag-and-drop, Move to…, Position and
 * Reopen. The body states intent (`stage`, and `place` or a `before`/`after`
 * neighbour); the server decides the rank.
 */
export async function POST(request: Request, { params }: { params: { id: string; taskId: string } }) {
  return togetherRoute(async (userId) => {
    const b = await body<MoveIntent & { via?: unknown }>(request);
    const r = await moveTask(userId, params.id, params.taskId, b);
    const via = b.via === "drag" ? "drag" : "menu";
    // Stage keys and how — never a title, a task, a neighbour or who.
    if (!r.unchanged) {
      if (r.reopened) await trackEvent({ userId, event: "together_task_reopened", page: "/together", properties: { to: r.to, via } });
      else if (r.reordered) await trackEvent({ userId, event: "together_task_reordered", page: "/together", properties: { stage: r.to, via } });
      else await trackEvent({ userId, event: "together_task_moved", page: "/together", properties: { from: r.from, to: r.to, via } });
    }
    return { task: r.task, unchanged: r.unchanged };
  });
}
