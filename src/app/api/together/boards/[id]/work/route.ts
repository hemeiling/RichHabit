import { loadWork } from "@/lib/together/work";
import { togetherRoute } from "@/lib/together/route";

/** A space's shared work in one read: its tasks (Done limited to the recent ones), groups and members. */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  return togetherRoute((userId) => loadWork(userId, params.id));
}
