import { ApiError, body, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { isSchemaBehind } from "@/lib/db/diagnose";
import { canSeeRelease, markWhatsNewSeen } from "@/lib/db/queries";
import { getDict } from "@/lib/i18n/server";

/**
 * What's New: the panel was shown, or one of its links was followed.
 *
 *   { action: "opened", release: <id> }  the panel displayed releases up to and
 *                                        including <id>, the newest on screen.
 *                                        Advances this account's seen mark.
 *   { action: "cta", release: <id> }     the release's link was followed.
 *
 * The browser sends a release id and nothing else; what that id means — its
 * publication time, its audience — comes from the code. Analytics record the id
 * and whether the mark moved. There is no user content in this feature to leak.
 */
export async function POST(request: Request) {
  return withUser(async (userId) => {
    const b = await body<{ action?: unknown; release?: unknown }>(request);
    const release = typeof b.release === "string" ? b.release : "";

    if (b.action === "opened") {
      let result;
      try {
        result = await markWhatsNewSeen(userId, release);
      } catch (e) {
        // The column not added yet: the panel still works, it just cannot remember.
        if (isSchemaBehind(e)) {
          console.error("[api] user_preferences.whats_new_seen_at is missing — run npm run db:migrate");
          throw new ApiError(getDict().whatsNew.notDeployed, 503);
        }
        throw e;
      }
      await trackEvent({
        userId, event: "whats_new_opened", page: "/whats-new",
        properties: { release, cleared: result.advanced && result.hadUnread },
      });
      return { seenAt: result.seenAt };
    }

    if (b.action === "cta") {
      if (!(await canSeeRelease(userId, release))) throw new ApiError("Not found", 404);
      await trackEvent({
        userId, event: "whats_new_cta_clicked", page: "/whats-new",
        properties: { release },
      });
      return { ok: true };
    }

    throw new ApiError("action must be opened or cta");
  });
}
