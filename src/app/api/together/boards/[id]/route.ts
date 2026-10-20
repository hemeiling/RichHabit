import { body } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { togetherAccess } from "@/lib/together/access";
import { deleteBoard, loadBoard, renameBoard, setArchived } from "@/lib/together/boards";
import { togetherRoute } from "@/lib/together/route";

/** One board, as this member may see it. */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  return togetherRoute((userId) => loadBoard(userId, params.id));
}

/** Rename, archive or restore — the owner's administration of a board. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return togetherRoute(async (userId) => {
    const b = await body<{ name?: unknown; archived?: unknown }>(request);
    // One change per request: archiving and renaming together would rename an
    // archived board, which is read-only.
    if (typeof b.archived === "boolean") {
      await setArchived(userId, params.id, b.archived);
      await trackEvent({ userId, event: "together_board_archived", page: "/together",
        properties: { archived: b.archived } });
    } else {
      await renameBoard(userId, params.id, b.name);
    }
    return { ok: true };
  });
}

/**
 * Delete the space for good — the owner only, confirming with its name. The
 * audit record is the analytics event: who, which space id and when, with what
 * it held as counts — never its name, a task or a member's name.
 */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  return togetherRoute(async (userId) => {
    // Read leniently: access is decided before anything about the request is
    // refused, so a malformed body tells a non-member nothing (deleteBoard
    // checks membership and ownership first, the name only for the owner).
    const b = (await request.json().catch(() => null)) as { confirmName?: unknown } | null;
    const held = await deleteBoard(userId, params.id, b?.confirmName);
    await trackEvent({ userId, event: "together_board_deleted", page: "/together",
      entityType: "together_board", entityId: params.id, properties: { ...held } });
    // Whether Together still exists for them (an owner who inherited the space
    // may have had no other): where the screen should go next.
    return { ok: true, together: (await togetherAccess(userId)) !== null };
  });
}
