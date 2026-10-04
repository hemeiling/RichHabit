import { trackEvent } from "@/lib/analytics/track";
import { removeMember } from "@/lib/together/boards";
import { togetherRoute } from "@/lib/together/route";

/** The owner removes a member. */
export async function DELETE(_: Request, { params }: { params: { id: string; userId: string } }) {
  return togetherRoute(async (userId) => {
    await removeMember(userId, params.id, params.userId);
    await trackEvent({ userId, event: "together_member_removed", page: "/together" });
    return { ok: true };
  });
}
