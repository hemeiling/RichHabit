import { trackEvent } from "@/lib/analytics/track";
import { leaveBoard } from "@/lib/together/boards";
import { togetherRoute } from "@/lib/together/route";

/** A member leaves the board. */
export async function POST(_: Request, { params }: { params: { id: string } }) {
  return togetherRoute(async (userId) => {
    await leaveBoard(userId, params.id);
    await trackEvent({ userId, event: "together_board_left", page: "/together" });
    return { ok: true };
  });
}
