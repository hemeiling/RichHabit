import { withUser } from "@/lib/api";
import { communitySnapshot, viewerToday } from "@/lib/community";

/**
 * Community Progress. Read-only and derived: nothing about a ranking is
 * stored, so it cannot fall out of step with the habit records it comes from.
 *
 * What crosses to the browser is a display name, a percentage, an
 * accomplishment count and a rank. Never an email, a user id, a priority's
 * text or date, or anything else about another member's habits.
 *
 * The month is the reader's calendar month, from the time zone their browser
 * sends, so the board agrees with their own progress. See `viewerToday`.
 */
export async function GET(req: Request) {
  return withUser(async (userId) =>
    communitySnapshot(userId, viewerToday(req.headers.get("x-rh-timezone"))));
}
