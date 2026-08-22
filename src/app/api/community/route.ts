import { withUser } from "@/lib/api";
import { communitySnapshot } from "@/lib/community";

/**
 * Community Progress. Read-only and derived: nothing about a ranking is
 * stored, so it cannot fall out of step with the habit records it comes from.
 *
 * What crosses to the browser is a display name, a percentage and a rank.
 * Never an email, a user id, or anything about another member's habits.
 */
export async function GET() {
  return withUser(async (userId) => communitySnapshot(userId));
}
