import { withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { loadState } from "@/lib/db/queries";

/**
 * The whole account in one read — what the store loads on mount, and therefore
 * the app being opened. Session boundaries are derived from this plus whatever
 * the person does next.
 */
export async function GET() {
  return withUser(async (userId) => {
    const state = await loadState(userId);
    await trackEvent({ userId, event: "app_opened", page: "/" });
    return state;
  }, (t) => t.errors.loadFailedReason);
}
