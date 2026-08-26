import { ApiError, body, requireId, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { isSchemaBehind, violatedConstraint } from "@/lib/db/diagnose";
import { deleteImportantDate, saveImportantDate } from "@/lib/db/queries";
import { getDict } from "@/lib/i18n/server";
import { eventLength } from "@/lib/importantDates";
import { parseImportantDate } from "@/lib/validate";

/**
 * §26. Important Dates.
 *
 * Private user content, like the journal and the post-it: these rows are never
 * read by Community Progress, by another account or by an admin screen. The
 * user id comes from the session and nowhere else, so a request cannot name
 * whose calendar it means.
 *
 * Reads come with the rest of the account through /api/state; there is no GET
 * here, because a second read path would be a second answer to "what is in my
 * calendar".
 */

/**
 * A write against a table that has not been created yet, said plainly.
 *
 * 503 rather than 500, and a sentence rather than "something went wrong
 * saving that": the code can legitimately be ahead of the schema for as long
 * as it takes someone to run the migration, and during that window the honest
 * message is that the feature is not switched on — not that the save failed
 * for unknowable reasons.
 */
function orNotDeployed(e: unknown): unknown {
  if (isSchemaBehind(e)) {
    console.error("[api] important_dates is behind this build — run npm run db:migrate");
    return new ApiError(getDict().importantDates.unavailable, 503);
  }
  /*
   * The same problem one release later, and the only CHECK on this table a
   * validated request can still trip: the note limit was raised in the code
   * before the migration that raises it in the database. Every other constraint
   * here — the date order, the title length, the colour format — is enforced by
   * `parseImportantDate` first, so it cannot reach Postgres.
   *
   * The note the person wrote is not lost; it is still in the field in front of
   * them. This only has to tell them why it would not save.
   */
  if (violatedConstraint(e) === "important_dates_note_check") {
    console.error("[api] important_dates.note is still capped in the database — run npm run db:migrate");
    return new ApiError(getDict().importantDates.noteNotWidened, 503);
  }
  return e;
}

export async function POST(request: Request) {
  return withUser(async (userId) => {
    const event = parseImportantDate(await body(request));
    try {
      await saveImportantDate(userId, event);
    } catch (e) {
      throw orNotDeployed(e);
    }
    /*
     * §21 privacy. That a date was recorded, how long it runs and whether it
     * carries a note — never the title, the note or the colour. What somebody
     * has in their calendar is theirs.
     */
    await trackEvent({
      userId,
      event: "important_date_saved",
      entityType: "important_date",
      entityId: event.id,
      page: "/today",
      properties: {
        days: eventLength(event),
        multiDay: event.startDate !== event.endDate,
        hasNote: event.note.trim().length > 0,
        kind: event.kind,
      },
    });
  });
}

export async function DELETE(request: Request) {
  return withUser(async (userId) => {
    const id = requireId(request);
    try {
      await deleteImportantDate(userId, id);
    } catch (e) {
      throw orNotDeployed(e);
    }
    await trackEvent({
      userId, event: "important_date_deleted", entityType: "important_date",
      entityId: id, page: "/today",
    });
  });
}
