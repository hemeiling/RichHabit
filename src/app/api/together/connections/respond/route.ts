import { body } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { respondToConnection } from "@/lib/together/connections";
import { togetherRoute } from "@/lib/together/route";

/** Accept or decline a collaborator request addressed to the signed-in account. */
export async function POST(request: Request) {
  return togetherRoute(async (userId) => {
    const b = await body<{ id?: unknown; accept?: unknown }>(request);
    const outcome = await respondToConnection(userId, b.id, b.accept);
    await trackEvent({ userId, page: "/together",
      event: b.accept === true ? "together_connection_accepted" : "together_connection_declined" });
    return outcome;
  });
}

export const dynamic = "force-dynamic";
