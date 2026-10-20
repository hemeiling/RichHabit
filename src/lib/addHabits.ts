import type { Habit } from "@/lib/types";

/**
 * Adding several habits at once (the Template Library's review screen).
 *
 * They are saved one after another, in the order shown, through the ordinary
 * single-habit save — the same validation, ownership check and plan limit as
 * adding one. Three outcomes are kept apart, because each needs a different
 * next step:
 *
 *   added    saved.
 *   limited  refused because the plan's active-habit limit was reached. Once
 *            that happens the rest of the active ones are not attempted —
 *            they would be refused too — and the person can save them to the
 *            backlog instead (planned habits do not count against the limit).
 *   failed   anything else (a dropped connection, say). Safe to retry.
 *
 * Retrying never duplicates anything: each habit's id is chosen once, when it
 * is picked, and the server's save is an upsert on that id. A save whose reply
 * was lost and is sent again updates the same row instead of creating another.
 */
export interface AddOutcome {
  added: Habit[];
  limited: Habit[];
  failed: Habit[];
  /** The limit the server named, when one was reached. */
  limit: number | null;
}

export async function addInOrder(
  list: Habit[],
  save: (h: Habit) => Promise<unknown>,
  /** The limit, when this rejection was the plan's active-habit limit; null otherwise. */
  planLimitOf: (e: unknown) => number | null,
): Promise<AddOutcome> {
  const out: AddOutcome = { added: [], limited: [], failed: [], limit: null };
  for (const h of list) {
    if (out.limit != null && h.status === "active") {
      out.limited.push(h);
      continue;
    }
    try {
      await save(h);
      out.added.push(h);
    } catch (e) {
      const limit = planLimitOf(e);
      if (limit != null && h.status === "active") {
        out.limit = limit;
        out.limited.push(h);
      } else {
        out.failed.push(h);
      }
    }
  }
  return out;
}
