import { historyPage } from "@/lib/together/work";
import { togetherRoute } from "@/lib/together/route";

/** History — Done for more than 24 hours — a page at a time after `cursor` (the last one on screen). */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return togetherRoute((userId) => historyPage(userId, params.id, new URL(request.url).searchParams.get("cursor")));
}
