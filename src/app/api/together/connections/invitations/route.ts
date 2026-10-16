import { revokeConnectionInvitation } from "@/lib/together/connections";
import { togetherRoute } from "@/lib/together/route";

/** Withdraw one of the signed-in account's own open collaborator requests. */
export async function DELETE(request: Request) {
  return togetherRoute(async (userId) => {
    await revokeConnectionInvitation(userId, new URL(request.url).searchParams.get("id"));
  });
}

export const dynamic = "force-dynamic";
