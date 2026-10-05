import { body } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { createTask, olderDone } from "@/lib/together/work";
import { togetherRoute } from "@/lib/together/route";

/** Older Done, a page at a time after `cursor` (the last one on screen). */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return togetherRoute((userId) => olderDone(userId, params.id, new URL(request.url).searchParams.get("cursor")));
}

/** Quick capture: a title, into Backlog or a board stage. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return togetherRoute(async (userId) => {
    const b = await body<{ title?: unknown; stage?: unknown }>(request);
    const task = await createTask(userId, params.id, b);
    // The stage only — never the title. What a space works on is its members' own.
    await trackEvent({ userId, event: "together_task_created", page: "/together", properties: { stage: task.stage } });
    return { task };
  });
}
