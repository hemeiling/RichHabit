import { loadHome } from "@/lib/together/boards";
import { togetherRoute } from "@/lib/together/route";

/** Together home: this account's boards, and the People derived from them. */
export async function GET() {
  return togetherRoute((userId) => loadHome(userId));
}
