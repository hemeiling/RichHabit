import { body } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { ensureGroup } from "@/lib/together/work";
import { togetherRoute } from "@/lib/together/route";

/** A group by name: the space's existing one (ignoring case), or a new one. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return togetherRoute(async (userId) => {
    const b = await body<{ name?: unknown }>(request);
    const { created, ...group } = await ensureGroup(userId, params.id, b.name);
    if (created) await trackEvent({ userId, event: "together_group_created", page: "/together" });
    return { group };
  });
}
