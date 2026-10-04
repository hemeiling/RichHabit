import { body } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { acceptInvitation } from "@/lib/together/invitations";
import { togetherRoute } from "@/lib/together/route";

/**
 * Accept an emailed invitation as the signed-in account. Needs no preview
 * access: the token, the matching address and the invitation decide, and only
 * that board opens (lib/together/access).
 */
export async function POST(request: Request) {
  return togetherRoute(async (userId) => {
    const b = await body<{ token?: unknown }>(request);
    const accepted = await acceptInvitation(userId, b.token);
    await trackEvent({ userId, event: "together_invitation_accepted", page: "/together",
      properties: { channel: "email" } });
    return accepted;
  });
}
