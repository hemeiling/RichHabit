import { describe, expect, it } from "vitest";
import { addInOrder } from "../src/lib/addHabits";
import { habitFromLibrary, libraryByKey } from "../src/lib/library";
import type { Habit } from "../src/lib/types";

/**
 * Adding several templates at once. What must hold: habits are saved in order;
 * at the plan's active-habit limit the rest are held back (not attempted) and
 * can go to the backlog; other failures can be retried; and a retry — even of
 * a save whose reply was lost — never creates a second row.
 */

const LIMITED = Object.assign(new Error("Plan limit reached"), { code: "plan_limit_reached", limit: 15 });
const planLimitOf = (e: unknown) => ((e as { code?: string }).code === "plan_limit_reached" ? 15 : null);

/** A server that upserts by id and holds an active-habit allowance, like POST /api/habits. */
function server({ room = Infinity, dropReplyFor = new Set<string>(), offline = false } = {}) {
  const rows = new Map<string, Habit>();
  const calls: string[] = [];
  const save = async (h: Habit) => {
    calls.push(h.id);
    if (offline) throw new TypeError("Failed to fetch");
    const existed = rows.get(h.id);
    const active = [...rows.values()].filter((r) => r.status === "active").length;
    if (h.status === "active" && existed?.status !== "active" && active >= room) throw LIMITED;
    rows.set(h.id, h);                                  // upsert on id
    if (dropReplyFor.has(h.id)) {
      dropReplyFor.delete(h.id);
      throw new TypeError("Failed to fetch");          // saved, but the reply never arrived
    }
  };
  return { rows, calls, save };
}

const picks = (keys: string[], status: "active" | "planned" = "active") =>
  keys.map((k) => ({ ...habitFromLibrary(libraryByKey.get(k)!), status, active: status === "active" }));

describe("adding several habits", () => {
  it("saves them all, in order", async () => {
    const s = server();
    const list = picks(["bezos_door_check", "gates_learning_note", "musk_delete_step"]);
    const out = await addInOrder(list, s.save, planLimitOf);
    expect(out.added.map((h) => h.id)).toEqual(list.map((h) => h.id));
    expect(s.calls).toEqual(list.map((h) => h.id));
    expect(out.limited).toEqual([]);
    expect(out.failed).toEqual([]);
  });

  it("stops adding to Today at the plan limit and holds the rest back without trying them", async () => {
    const s = server({ room: 2 });
    const list = picks(["bezos_door_check", "gates_learning_note", "musk_delete_step", "corley_say_no"]);
    const out = await addInOrder(list, s.save, planLimitOf);
    expect(out.added).toHaveLength(2);
    expect(out.limited.map((h) => h.id)).toEqual(list.slice(2).map((h) => h.id));
    expect(out.limit).toBe(15);
    expect(s.calls).toHaveLength(3);                    // the fourth was never sent
    // …and those held back can go to the backlog, which the limit does not cover.
    const rest = out.limited.map((h) => ({ ...h, status: "planned" as const, active: false }));
    const again = await addInOrder(rest, s.save, planLimitOf);
    expect(again.added).toHaveLength(2);
    expect(s.rows.size).toBe(4);
  });

  it("never applies the limit to habits saved for later", async () => {
    const s = server({ room: 0 });
    const out = await addInOrder(picks(["bezos_door_check", "gates_new_field"], "planned"), s.save, planLimitOf);
    expect(out.added).toHaveLength(2);
    expect(out.limited).toEqual([]);
  });

  it("keeps going past an ordinary failure, and reports it to retry", async () => {
    const s = server({ offline: true });
    const out = await addInOrder(picks(["bezos_door_check", "gates_new_field"]), s.save, planLimitOf);
    expect(out.failed).toHaveLength(2);
    expect(out.added).toEqual([]);
    expect(out.limit).toBeNull();
  });

  it("does not duplicate anything when a save whose reply was lost is retried", async () => {
    const list = picks(["bezos_door_check", "gates_learning_note"]);
    const s = server({ dropReplyFor: new Set([list[0].id]) });
    const first = await addInOrder(list, s.save, planLimitOf);
    expect(first.failed.map((h) => h.id)).toEqual([list[0].id]);
    expect(s.rows.size).toBe(2);                         // it was saved after all
    const retry = await addInOrder(first.failed, s.save, planLimitOf);
    expect(retry.added).toHaveLength(1);
    expect(s.rows.size).toBe(2);                         // same id: updated, not added
  });
});
