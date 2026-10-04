import { body } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { addMembers } from "@/lib/together/boards";
import { togetherRoute } from "@/lib/together/route";

/** The owner adds some of their People to the board. Anyone else is invited by email. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return togetherRoute(async (userId) => {
    const b = await body<{ people?: unknown }>(request);
    const added = await addMembers(userId, params.id, b.people);
    if (added) await trackEvent({ userId, event: "together_members_added", page: "/together", properties: { added } });
    return { added };
  });
}
