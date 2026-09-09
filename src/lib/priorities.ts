import { normalizePriorityCategory, type Priority, type PriorityCategory } from "@/lib/types";

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
  const categoryOrder: Record<string, number> = {
    urgent_important: 0,
    important_not_urgent: 1,
    urgent_not_important: 2,
    not_important_not_urgent: 3,
    unsorted: 1,
  };

  const visible = all.filter(
    (p) => p.createdOn <= date && (p.completedOn === null || p.completedOn >= date),
  );

  return visible
    .map((p, index) => ({ p, index, category: normalizePriorityCategory(p.category) }))
    .sort((a, b) => {
      const diff = (categoryOrder[a.category] ?? categoryOrder.important_not_urgent) - (categoryOrder[b.category] ?? categoryOrder.important_not_urgent);
      if (diff !== 0) return diff;
      const orderDiff = (a.p.sortOrder ?? 0) - (b.p.sortOrder ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return a.index - b.index;
    })
    .map(({ p }) => p);
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


/**
 * The four quadrants, in reading order. `unsorted` is deliberately absent: it
 * is a storage value from before the matrix existed, not a place on screen.
 * `normalizePriorityCategory` resolves it to important & not urgent.
 */
export const QUADRANTS: PriorityCategory[] = [
  "urgent_important",        // top left     — do
  "important_not_urgent",    // top right    — plan and protect
  "urgent_not_important",    // bottom left  — delegate or reduce
  "not_important_not_urgent",// bottom right — limit or eliminate
];

/** One row of an arrangement: which box, and where in it. Never the text. */
export interface PriorityLayoutEntry {
  id: string;
  category: PriorityCategory;
  sortOrder: number;
}

/**
 * The whole arrangement after moving one priority.
 *
 * One function for every way a priority can move — dragged to another quadrant,
 * dropped above a sibling, or re-filed from the category control — because
 * those are the same operation with a different destination, and three
 * implementations of "where does everything sit now" is three chances to
 * disagree.
 *
 * `beforeId` is the priority the moved one should land above, or null to put it
 * at the end of the destination. Passing the moved priority's own id is a
 * no-op rather than a move to the end, which is what a drag onto itself means.
 *
 * Returns every visible priority, each numbered densely from zero within its
 * own quadrant. Only `category` and `sortOrder` are ever named here: the id is
 * carried through untouched, and text, created_on and completed_on are not this
 * function's business and are never written by the query it feeds.
 *
 * A legacy `unsorted` row is normalised on the way through, so the first time
 * an account rearranges anything its rows quietly acquire the category they
 * were already being displayed under. Nothing moves on screen when that
 * happens, which is the point.
 */
export function layoutAfterMove(
  visible: Priority[],
  id: string,
  toCategory: PriorityCategory,
  beforeId: string | null = null,
): PriorityLayoutEntry[] {
  if (beforeId === id) return [];
  if (!QUADRANTS.includes(toCategory)) return [];
  if (!visible.some((p) => p.id === id)) return [];

  const columns = new Map<PriorityCategory, string[]>(QUADRANTS.map((q) => [q, []]));

  // The order already on screen: sort_order first, insertion order to break
  // ties, which is the same rule `prioritiesOn` reads them back with.
  [...visible]
    .map((p, index) => ({ p, index, category: normalizePriorityCategory(p.category) }))
    .sort((a, b) => (a.p.sortOrder ?? 0) - (b.p.sortOrder ?? 0) || a.index - b.index)
    .forEach(({ p, category }) => { columns.get(category)!.push(p.id); });

  for (const ids of columns.values()) {
    const at = ids.indexOf(id);
    if (at >= 0) ids.splice(at, 1);
  }

  const destination = columns.get(toCategory)!;
  const at = beforeId === null ? -1 : destination.indexOf(beforeId);
  if (at >= 0) destination.splice(at, 0, id);
  else destination.push(id);

  return QUADRANTS.flatMap((category) =>
    columns.get(category)!.map((entryId, sortOrder) => ({ id: entryId, category, sortOrder })));
}

/**
 * The quadrant two answers imply.
 *
 * The whole of the classification rule, and the reason there is no default: the
 * app never has an opinion about whether something matters to you, it only
 * arranges the answer you gave. Importance is contextual to a person's goals in
 * a way nothing here can infer, and urgency without a stated deadline is a
 * guess — so both arrive as answers, or the priority is not created.
 */
export function quadrantFor(important: boolean, urgent: boolean): PriorityCategory {
  if (important) return urgent ? "urgent_important" : "important_not_urgent";
  return urgent ? "urgent_not_important" : "not_important_not_urgent";
}

/**
 * Whether a planned day has passed while the line is still open.
 *
 * Completed lines are never overdue: finishing late is still finishing, and
 * marking it in amber afterwards would be a reprimand for work already done.
 */
export function isPlanOverdue(p: Priority, date: string): boolean {
  return p.plannedOn !== null && p.plannedOn < date && !doneOn(p, date);
}

/**
 * The one line under the heading, or nothing at all.
 *
 * At most one thing is ever on screen, and a nudge outranks an insight because
 * it is tied to something that just happened rather than to a standing count.
 * `nudgeAllowed` is the once-a-day rule, decided by the caller — this stays a
 * pure function of the day's priorities so it can be reasoned about and tested.
 *
 * Every branch is a count of what is on screen right now. Nothing here looks
 * backwards, because `category` is mutable and unversioned: a claim about what
 * used to be in which quadrant would be invention, not evidence.
 */
export type PriorityCue =
  | { kind: "nudge"; quadrant: PriorityCategory }
  | { kind: "insight"; key: "mostly_urgent" | "protect"; count: number };

export function cueFor(
  visible: Priority[], date: string, nudgeAllowed: boolean,
): PriorityCue | null {
  const open = visible.filter((p) => !doneOn(p, date));
  const count = (c: PriorityCategory) =>
    open.filter((p) => normalizePriorityCategory(p.category) === c).length;

  if (nudgeAllowed) {
    // The reflective moment worth catching: a crisis just got handled, and the
    // question of whether it had to be a crisis is briefly a live one.
    const finishedUrgentImportant = visible.some((p) =>
      doneOn(p, date) && normalizePriorityCategory(p.category) === "urgent_important");
    if (finishedUrgentImportant) return { kind: "nudge", quadrant: "urgent_important" };
    if (count("urgent_not_important") >= 2) {
      return { kind: "nudge", quadrant: "urgent_not_important" };
    }
    if (count("not_important_not_urgent") >= 2) {
      return { kind: "nudge", quadrant: "not_important_not_urgent" };
    }
  }

  /*
   * Thresholds, not thresholds of virtue. Four is the point below which "most
   * of these are urgent" describes a coincidence rather than a day, and three
   * is the point below which "protect time for these" is advice about one
   * errand. Both are deliberately quiet about small days.
   */
  const urgent = count("urgent_important") + count("urgent_not_important");
  if (open.length >= 4 && urgent * 5 > open.length * 3) {
    return { kind: "insight", key: "mostly_urgent", count: urgent };
  }

  const protect = count("important_not_urgent");
  if (protect >= 3) return { kind: "insight", key: "protect", count: protect };

  return null;
}
