import { body } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { deleteGroup, renameGroup } from "@/lib/together/work";
import { togetherRoute } from "@/lib/together/route";

type Params = { params: { id: string; groupId: string } };

export async function PATCH(request: Request, { params }: Params) {
  return togetherRoute(async (userId) => {
    const b = await body<{ name?: unknown }>(request);
    return { group: await renameGroup(userId, params.id, params.groupId, b.name) };
  });
}

/** Deletes the label only: its tasks stay, without a group. */
export async function DELETE(_: Request, { params }: Params) {
  return togetherRoute(async (userId) => {
    await deleteGroup(userId, params.id, params.groupId);
    await trackEvent({ userId, event: "together_group_deleted", page: "/together" });
    return { ok: true };
  });
}
