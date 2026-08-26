import type { Priority } from "@/lib/types";

/**
 * Which priorities belong on a given day, and whether each was finished by
 * then. One rule, in one place, because it is the whole of the rollover.
 *
 * A priority is on the note for day `d` when it existed by then and had not
 * already been finished before then:
 *
 *     createdOn <= d  and  (completedOn is null or completedOn >= d)
 *
 * Read forwards, that puts an unfinished item on every day from the one it was
 * written on up to today — which is the rollover, and it needs no nightly job,
 * no copying, and no "carried over" column, because nothing is ever moved.
 * Nothing has to run for it to work; a note written months ago and never
 * finished satisfies this the first time anyone asks, including notes written
 * long before the feature existed.
 *
 * Read backwards, the same rule reconstructs a past day honestly. A priority
 * finished on the 5th still appears on the 3rd and the 4th, where it really
 * was outstanding, and is gone from the 6th. The old day-keyed store could
 * only ever show what had been copied into that day's row.
 */
export function prioritiesOn(all: Priority[], date: string): Priority[] {
  // Filter only — the array arrives in the user's own order and stays in it.
  return all.filter(
    (p) => p.createdOn <= date && (p.completedOn === null || p.completedOn >= date),
  );
}

/**
 * Whether a priority was already finished as at `date`.
 *
 * Date-relative on purpose. Looking back at the 3rd, something you did not
 * finish until the 5th has to show as unfinished, or the past day is a lie.
 */
export function doneOn(p: Priority, date: string): boolean {
  return p.completedOn !== null && p.completedOn <= date;
}

/**
 * The day this line came forward from, or null if it was written on `date`.
 *
 * Shown next to the text. Somebody opening Today and finding last Tuesday's
 * task on it is owed the reason, and the creation date is both the reason and
 * the thing the record exists to preserve.
 */
export function carriedFrom(p: Priority, date: string): string | null {
  return p.createdOn < date ? p.createdOn : null;
}

