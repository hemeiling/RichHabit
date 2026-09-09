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
    urgent_not_important: 1,
    important_not_urgent: 2,
    not_important_not_urgent: 3,
    unsorted: 2,
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
  "urgent_important",
  "urgent_not_important",
  "important_not_urgent",
  "not_important_not_urgent",
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
