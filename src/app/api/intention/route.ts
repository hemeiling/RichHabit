import { ApiError, body, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { isSchemaBehind, uniqueViolation } from "@/lib/db/diagnose";
import { saveIntention } from "@/lib/db/queries";
import { getDict } from "@/lib/i18n/server";
import { parseIntention } from "@/lib/validate";

/**
 * Clarify Your Intention.
 *
 * The most private route in the app. What somebody wants, why it matters and
 * whether they suspect the wanting is not really theirs belongs to them alone:
 * it is never read by another account, never read by an admin screen, and never
 * placed in an analytics property or a log line. The user id comes from the
 * session and nowhere else, so a request cannot name whose reflection it means.
 *
 * Reads arrive with the rest of the account through /api/state. There is no GET
 * here, for the same reason the other private modules have none — a second read
 * path would be a second answer to "what did I write".
 *
 * One route, called on autosave. The whole record is sent rather than a field
 * at a time because the reflection is one thing the person is working on, and a
 * per-field API would invite the client to decide which parts of it exist.
 */

/**
 * A write against a table that is not there yet, said plainly.
 *
 * 503 and a sentence, as with important dates: on the free plan the schema is
 * applied by hand, so code can legitimately reach production before its
 * migration, and during that window the honest message is that the feature is
 * not switched on. The screen also refuses to offer a writing surface while the
 * module reports itself unavailable, so this is the second line of defence
 * rather than the first — nobody should reach it having written anything.
 */
function orNotDeployed(e: unknown): unknown {
  if (isSchemaBehind(e)) {
    console.error("[api] intentions is behind this build — run npm run db:migrate");
    return new ApiError(getDict().intention.unavailableBody, 503);
  }
  /*
   * Two sessions starting an intention at the same moment — two tabs left open
   * on the page, most likely. `intentions_one_active` is the rule that keeps an
   * account to one, and it did its job; what must not happen is that the second
   * tab reports "something went wrong saving that" over a reflection somebody
   * is in the middle of writing. 409 and a sentence that says what to do.
   *
   * Nothing is lost either way: the intention the first tab created is intact,
   * and reloading the second shows it.
   */
  if (uniqueViolation(e) === "intentions_one_active") {
    return new ApiError(getDict().intention.alreadyStarted, 409);
  }
  /*
   * Any other refusal by the database: a data exception (class 22) or an
   * integrity violation (class 23), such as the bounds on the reflection arrays.
   *
   * These are answered here, and never left to `withUser`, for one reason:
   * `withUser` logs an unexpected error in full, and a Postgres constraint error
   * carries "Failing row contains (...)" in its detail — which for this table is
   * the person's whole reflection. So what is logged is the error's code and the
   * constraint's name, and nothing that was written.
   *
   * The validator enforces the same limits first with its own message, so in
   * practice this is unreachable. It is here so that if the two ever drift, the
   * failure is a refused save rather than a private reflection in a log file.
   */
  const pg = e as { code?: unknown; constraint?: unknown } | null;
  if (typeof pg?.code === "string" && /^2[23]/.test(pg.code)) {
    const constraint = typeof pg.constraint === "string" ? pg.constraint : "";
    console.error(`[api] intentions refused a write (${pg.code} ${constraint})`);
    return new ApiError(getDict().errors.saveFailed, 400);
  }
  return e;
}

export async function POST(request: Request) {
  return withUser(async (userId) => {
    const intention = parseIntention(await body(request));
    let outcome = { started: false, finished: false };
    try {
      outcome = await saveIntention(userId, intention);
    } catch (e) {
      throw orNotDeployed(e);
    }

    /*
     * §21 privacy, and the strictest application of it in the app.
     *
     * How far through the session somebody is, and whether they have finished
     * it. Never the intention, never a reason, never the ownership answer,
     * never a word of the vision, never the note, never a length, never a
     * count of anything they wrote. Those would all be facts about the content
     * of a private reflection, and the adoption table does not need any of
     * them to say the module is being used.
     *
     * Both are recorded on the transition and nowhere else — the call that
     * created the intention, and the call that finished it. A debounced write
     * fires while somebody is thinking and a revisit writes again over a
     * reflection that was finished weeks ago, so anything keyed off the state
     * rather than the change would count the same session over and over. That
     * is the heartbeat §21 says not to write, and it would make the completion
     * figure a count of saves.
     */
    if (outcome.started) {
      await trackEvent({
        userId, event: "intention_started", entityType: "intention",
        entityId: intention.id, page: "/intention",
      });
    }
    if (outcome.finished) {
      await trackEvent({
        userId, event: "intention_completed", entityType: "intention",
        entityId: intention.id, page: "/intention",
      });
    }
  });
}
