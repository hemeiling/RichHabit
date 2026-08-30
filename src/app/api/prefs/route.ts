import { body, withUser } from "@/lib/api";
import { markMemberStale } from "@/lib/community";
import { savePrefs } from "@/lib/db/queries";
import { parsePrefs } from "@/lib/validate";

/**
 * Preferences, including whether this account appears on the Community board.
 *
 * The board is cached for a minute, so turning that setting off would otherwise
 * leave somebody visible for up to a minute after they asked not to be — which
 * is exactly the wrong direction for a privacy control to fail in. Marking the
 * member stale makes the next read re-score them; `refreshStale` drops a member
 * whose score comes back null, which is what opting out now produces, and
 * re-ranks everyone else so the board stays coherent.
 */
export async function POST(request: Request) {
  return withUser(async (userId) => {
    await savePrefs(userId, parsePrefs(await body(request)));
    markMemberStale(userId);
  });
}
