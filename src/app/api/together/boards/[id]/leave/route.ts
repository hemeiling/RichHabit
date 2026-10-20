import { trackEvent } from "@/lib/analytics/track";
import { togetherAccess } from "@/lib/together/access";
import { leaveBoard } from "@/lib/together/boards";
import { togetherRoute } from "@/lib/together/route";

/**
 * A member leaves the board. `together` says whether Together still exists for
 * them afterwards: someone outside the preview who leaves their last space has
 * no Overview to return to, and is sent elsewhere rather than to a "not found".
 */
export async function POST(_: Request, { params }: { params: { id: string } }) {
  return togetherRoute(async (userId) => {
    await leaveBoard(userId, params.id);
    await trackEvent({ userId, event: "together_board_left", page: "/together" });
    return { ok: true, together: (await togetherAccess(userId)) !== null };
  });
}
