import { body } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { acceptConnection } from "@/lib/together/connections";
import { togetherRoute } from "@/lib/together/route";

/** Accept an emailed collaborator request as the signed-in account. */
export async function POST(request: Request) {
  return togetherRoute(async (userId) => {
    const outcome = await acceptConnection(userId, (await body<{ token?: unknown }>(request)).token);
    await trackEvent({ userId, event: "together_connection_accepted", page: "/together",
      properties: { channel: "email" } });
    return outcome;
  });
}

export const dynamic = "force-dynamic";
