import { pendingFor } from "@/lib/together/invitations";
import { requireAccess } from "@/lib/together/access";
import { togetherRoute } from "@/lib/together/route";

/**
 * The invitations waiting for the signed-in account — what the header's
 * notification bell lists. The same rows the Together home shows, without the
 * boards and People around them, so the bell stays cheap to open.
 */
export async function GET() {
  return togetherRoute(async (userId) => {
    await requireAccess(userId);
    return { invitations: await pendingFor(userId) };
  });
}
