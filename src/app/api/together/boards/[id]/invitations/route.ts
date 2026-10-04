import { body } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { getLocale } from "@/lib/i18n/server";
import { createInvitation, invitePeople } from "@/lib/together/invitations";
import { togetherRoute } from "@/lib/together/route";

/**
 * Invite to this board: `{ people }` — some of your People, in-platform — or
 * `{ email }` — an address, by email. Either way nobody joins until they
 * accept. An email answer comes only once the invitation is usable, a failure
 * leaves nothing usable behind, and the answer is the same whether or not the
 * address has an account (see lib/together/invitations).
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return togetherRoute(async (userId) => {
    const b = await body<{ email?: unknown; people?: unknown }>(request);
    if (b.people !== undefined) {
      const invited = await invitePeople(userId, params.id, b.people);
      if (invited) {
        await trackEvent({ userId, event: "together_invitation_sent", page: "/together",
          properties: { channel: "people", count: invited } });
      }
      return { invited };
    }
    const created = await createInvitation(userId, params.id, b.email, getLocale());
    // No address, no board name: only that an invitation went out.
    await trackEvent({ userId, event: "together_invitation_sent", page: "/together",
      properties: { channel: "email", count: 1 } });
    return created;
  });
}
