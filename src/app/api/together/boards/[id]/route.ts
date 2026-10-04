import { body } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { loadBoard, renameBoard, setArchived } from "@/lib/together/boards";
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
