import { body } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { respondToInvitation } from "@/lib/together/invitations";
import { togetherRoute } from "@/lib/together/route";

/** Accept or decline an in-platform invitation addressed to the signed-in account. */
export async function POST(request: Request) {
  return togetherRoute(async (userId) => {
    const b = await body<{ id?: unknown; accept?: unknown }>(request);
    const answered = await respondToInvitation(userId, b.id, b.accept);
    const accept = b.accept === true;
    await trackEvent({ userId, page: "/together",
      ...(accept
        ? { event: "together_invitation_accepted", properties: { channel: "people" } }
        : { event: "together_invitation_declined" }) });
    return accept ? answered : { ok: true };
  });
}
