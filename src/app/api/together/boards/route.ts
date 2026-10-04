import { body } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { createBoard } from "@/lib/together/boards";
import { togetherRoute } from "@/lib/together/route";

/** A new board, owned by the caller; optionally with some of their People on it. */
export async function POST(request: Request) {
  return togetherRoute(async (userId) => {
    const b = await body<{ name?: unknown; people?: unknown }>(request);
    const { id, people } = await createBoard(userId, b.name, b.people);
    // A count, never a name: board names are the members' own words.
    await trackEvent({ userId, event: "together_board_created", page: "/together", properties: { people } });
    return { id };
  });
}
