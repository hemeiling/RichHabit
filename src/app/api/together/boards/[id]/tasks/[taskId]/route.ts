import { body } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { deleteTask, loadTask, updateTask, type TaskPatch } from "@/lib/together/work";
import { togetherRoute } from "@/lib/together/route";

type Params = { params: { id: string; taskId: string } };

/** One task, with its description and who added it. */
export async function GET(_: Request, { params }: Params) {
  return togetherRoute((userId) => loadTask(userId, params.id, params.taskId));
}

/** Any subset of a task's fields; moving is `stage`. */
export async function PATCH(request: Request, { params }: Params) {
  return togetherRoute(async (userId) => {
    const patch = await body<TaskPatch>(request);
    const { task, moved, assigneesChanged } = await updateTask(userId, params.id, params.taskId, patch);
    // Stage keys and a count — never a title, a description, a group or who.
    if (moved) {
      await trackEvent({ userId, event: "together_task_moved", page: "/together", properties: { from: moved.from, to: moved.to } });
    }
    if (assigneesChanged) {
      await trackEvent({ userId, event: "together_task_assignees_set", page: "/together",
        properties: { count: task.assignees.length } });
    }
    return { task };
  });
}

/** Soft delete; restorable from Recently deleted. */
export async function DELETE(_: Request, { params }: Params) {
  return togetherRoute(async (userId) => {
    // Counted once: repeating a delete changes nothing and records nothing.
    if (await deleteTask(userId, params.id, params.taskId)) {
      await trackEvent({ userId, event: "together_task_deleted", page: "/together" });
    }
    return { ok: true };
  });
}
