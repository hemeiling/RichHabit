import { revokeInvitation } from "@/lib/together/invitations";
import { togetherRoute } from "@/lib/together/route";

/** Withdraw an open invitation: the owner, or whoever sent it. */
export async function DELETE(_: Request, { params }: { params: { id: string; inviteId: string } }) {
  return togetherRoute(async (userId) => {
    await revokeInvitation(userId, params.id, params.inviteId);
    return { ok: true };
  });
}
