import { ApiError, body, withUser } from "@/lib/api";
import { markMemberStale } from "@/lib/community";
import { isSchemaBehind } from "@/lib/db/diagnose";
import { savePrefs } from "@/lib/db/queries";
import { getDict } from "@/lib/i18n/server";
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
    try {
      await savePrefs(userId, parsePrefs(await body(request)));
    } catch (e) {
      /*
       * Reading preferences survives a database older than the code — they are
       * read with `select *`, so an absent column reads as its default. Writing
       * cannot: the insert names every column. This is the one moment in the
       * window between a deploy and the migration that follows it where someone
       * would otherwise be told "something went wrong saving that" about a
       * setting that is not broken, only not deployed yet.
       */
      if (!isSchemaBehind(e)) throw e;
      console.error("[api] user_preferences is behind this build — run npm run db:migrate");
      throw new ApiError(getDict().more.prefsNotDeployed, 503);
    }
    markMemberStale(userId);
  });
}
