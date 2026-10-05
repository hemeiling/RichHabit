import { deletedTasks } from "@/lib/together/work";
import { togetherRoute } from "@/lib/together/route";

/** Recently deleted: what any member can restore. */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  return togetherRoute((userId) => deletedTasks(userId, params.id));
}
