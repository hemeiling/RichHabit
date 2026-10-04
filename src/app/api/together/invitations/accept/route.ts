import { body } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { acceptInvitation } from "@/lib/together/invitations";
import { togetherRoute } from "@/lib/together/route";

/** Accept an invitation as the signed-in account. */
export async function POST(request: Request) {
  return togetherRoute(async (userId) => {
    const b = await body<{ token?: unknown }>(request);
    const accepted = await acceptInvitation(userId, b.token);
    await trackEvent({ userId, event: "together_invitation_accepted", page: "/together" });
    return accepted;
  });
}
