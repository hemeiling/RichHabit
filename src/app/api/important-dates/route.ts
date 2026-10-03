import { ApiError, body, requireId, withUser } from "@/lib/api";
import { trackEvent } from "@/lib/analytics/track";
import { isSchemaBehind, violatedConstraint } from "@/lib/db/diagnose";
import {
  deleteImportantDate, deleteImportantDateOccurrence, saveImportantDate,
} from "@/lib/db/queries";
import { check } from "@/lib/http";
import { getDict } from "@/lib/i18n/server";
import { eventLength } from "@/lib/importantDates";
import { isExtendedWrite, parseImportantDate } from "@/lib/validate";

/**
 * §26. Important Dates.
 *
 * Private user content, like the journal and the post-it: these rows are never
 * read by Community Progress, by another account, by an admin screen or by an
 * AI provider. The user id comes from the session and nowhere else, so a
 * request cannot name whose calendar it means.
 *
 * Reads come with the rest of the account through /api/state; there is no GET
 * here, because a second read path would be a second answer to "what is in my
 * calendar".
 */

/**
 * A write against a table — or columns — that have not been created yet, said
 * plainly.
 *
 * 503 rather than 500, and a sentence rather than "something went wrong
 * saving that": the code can legitimately be ahead of the schema for as long
 * as it takes someone to run the migration, and during that window the honest
 * message is that the feature is not switched on — not that the save failed
 * for unknowable reasons.
 */
function orNotDeployed(e: unknown): unknown {
  if (isSchemaBehind(e)) {
    // 42703 is a missing column: the table is there, times and repeats are not.
    const columnsOnly = (e as { code?: string }).code === "42703";
    console.error("[api] important_dates is behind this build — run npm run db:migrate");
    return new ApiError(
      columnsOnly ? getDict().importantDates.timesUnavailable : getDict().importantDates.unavailable,
      503);
  }
  /*
   * The same problem one release later: the note limit was raised in the code
   * before the migration that raises it in the database.
   *
   * The note the person wrote is not lost; it is still in the field in front of
   * them. This only has to tell them why it would not save.
   */
  const constraint = violatedConstraint(e);
  if (constraint === "important_dates_note_check") {
    console.error("[api] important_dates.note is still capped in the database — run npm run db:migrate");
    return new ApiError(getDict().importantDates.noteNotWidened, 503);
  }
  /*
   * The two CHECKs a *previous* build can still trip, because it does not know
   * the event has a time or a repeat: moving the dates of an overnight event so
   * its end time lands before its start, or moving a series' first date past
   * the date it was set to end. Nothing was written; reloading gets a build
   * that can show and edit both.
   */
  if (constraint === "important_dates_time_order_check"
    || constraint === "important_dates_repeat_until_check") {
    return new ApiError(getDict().importantDates.reloadToEdit, 409);
  }
  if (constraint === "important_dates_excluded_on_check") {
    return new ApiError(getDict().importantDates.tooManyDeleted, 409);
  }
  return e;
}

export async function POST(request: Request) {
  return withUser(async (userId) => {
    const raw = await body(request);
    const event = parseImportantDate(raw);
    try {
      await saveImportantDate(userId, event, { extended: isExtendedWrite(raw) });
    } catch (e) {
      throw orNotDeployed(e);
    }
    /*
     * §21 privacy. The shape of the event and nothing it says — never the
     * title, the note, the colour, the time of day or the zone. What somebody
     * has in their calendar, and where they are, is theirs.
     */
    await trackEvent({
      userId,
      event: "important_date_saved",
      entityType: "important_date",
      entityId: event.id,
      page: "/priorities",
      properties: {
        days: eventLength(event),
        multiDay: event.startDate !== event.endDate,
        hasNote: event.note.trim().length > 0,
        kind: event.kind,
        timed: event.startTime != null,
        repeat: event.repeat?.unit ?? "none",
        interval: event.repeat?.interval ?? 0,
        hasEnd: event.repeat?.until != null,
      },
    });
  });
}

/**
 * Deletes an event — or, with `on=YYYY-MM-DD`, only that occurrence of a
 * repeating one. The two are the only deletes there are: there is no "this and
 * following", and no occurrence is ever edited on its own.
 */
export async function DELETE(request: Request) {
  return withUser(async (userId) => {
    const id = requireId(request);
    const on = new URL(request.url).searchParams.get("on");
    const occurrence = on == null ? null : check.date(on, "on");
    try {
      if (occurrence) await deleteImportantDateOccurrence(userId, id, occurrence);
      else await deleteImportantDate(userId, id);
    } catch (e) {
      throw orNotDeployed(e);
    }
    await trackEvent({
      userId, event: "important_date_deleted", entityType: "important_date",
      entityId: id, page: "/priorities",
      properties: { scope: occurrence ? "occurrence" : "all" },
    });
  });
}
