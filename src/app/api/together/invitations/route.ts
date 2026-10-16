import { requireAccess } from "@/lib/together/access";
import { pendingConnectionsFor } from "@/lib/together/connections";
import { pendingFor } from "@/lib/together/invitations";
import { togetherRoute } from "@/lib/together/route";

/**
 * Everything waiting for the signed-in account — collaborator requests first,
 * then space invitations — which is what the header's notification bell
 * lists. The same rows the Together home shows, without the boards and
 * People around them, so the bell stays cheap to open.
 */
export async function GET() {
  return togetherRoute(async (userId) => {
    await requireAccess(userId);
    const [connections, spaces] = await Promise.all([
      pendingConnectionsFor(userId), pendingFor(userId),
    ]);
    return {
      invitations: [
        ...connections.map((c) => ({ kind: "connection" as const, ...c })),
        ...spaces.map((i) => ({ kind: "space" as const, ...i })),
      ],
    };
  });
}

export const dynamic = "force-dynamic";
