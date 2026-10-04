import { body } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { getLocale } from "@/lib/i18n/server";
import { createInvitation } from "@/lib/together/invitations";
import { togetherRoute } from "@/lib/together/route";

/**
 * Invite an address to this board. Answers only once the invitation is usable;
 * a failure leaves nothing usable behind (see lib/together/invitations). The
 * answer is the same whether or not the address has an account.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return togetherRoute(async (userId) => {
    const b = await body<{ email?: unknown }>(request);
    const created = await createInvitation(userId, params.id, b.email, getLocale());
    // No address, no board name: only that an invitation went out.
    await trackEvent({ userId, event: "together_invitation_sent", page: "/together" });
    return created;
  });
}
