import { withUser } from "@/lib/api";
import { loadState } from "@/lib/db/queries";

/** The whole account in one read — what the store loads on mount. */
export async function GET() {
  return withUser((userId) => loadState(userId));
}
