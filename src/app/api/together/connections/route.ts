import { body } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { getLocale } from "@/lib/i18n/server";
import {
  inviteCollaboratorByEmail, inviteCollaboratorByUsername, removeCollaborator,
} from "@/lib/together/connections";
import { togetherRoute } from "@/lib/together/route";

/**
 * Collaborator connections. POST `{ username }` or `{ email }` asks to
 * connect; DELETE `?userId=` removes an accepted collaborator. Open to every
 * account Together admits — one's own connections are not an administrative
 * power — and nobody is connected without accepting. Analytics hear a channel
 * name and nothing else.
 */
export async function POST(request: Request) {
  return togetherRoute(async (userId) => {
    const b = await body<{ username?: unknown; email?: unknown }>(request);
    if (b.username !== undefined) {
      const outcome = await inviteCollaboratorByUsername(userId, b.username);
      if (outcome.invited || outcome.connected) {
        await trackEvent({ userId, event: "together_connection_requested", page: "/together",
          properties: { channel: "username", mutual: outcome.connected } });
      }
      return outcome;
    }
    const created = await inviteCollaboratorByEmail(userId, b.email, getLocale());
    await trackEvent({ userId, event: "together_connection_requested", page: "/together",
      properties: { channel: "email" } });
    // Never which address, never whether it has an account: only that it went out.
    return { invited: 1, connected: false, id: created.id };
  });
}

export async function DELETE(request: Request) {
  return togetherRoute(async (userId) => {
    const otherId = new URL(request.url).searchParams.get("userId");
    await removeCollaborator(userId, otherId);
    await trackEvent({ userId, event: "together_connection_removed", page: "/together" });
  });
}

export const dynamic = "force-dynamic";
