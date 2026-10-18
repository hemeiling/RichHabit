import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * HT-2a against a real Postgres (PGlite): schedule versions as they are written
 * and read.
 *
 *  - a save dates a schedule change by the person's calendar, not the server's;
 *  - an unchanged schedule writes no version;
 *  - a same-day change replaces that day's version, and earlier ones are never
 *    touched;
 *  - a version dated ahead of the person's today (the old UTC rule) is amended,
 *    not left to overrule the newer choice;
 *  - `loadState` hands the engine every version, oldest first, so a day is
 *    scored by the schedule in force on it.
 *
 * The parsers are the ones lib/db/pool registers, so a date is the string
 * Postgres sent, exactly as in production.
 */

const PARSERS = {
  1082: (v: string) => v,
  1182: (v: string) => (v === "{}" ? [] : v.slice(1, -1).split(",")),
};

vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    ((globalThis as any).__schedDb as PGlite).query(sql, params as any[], { parsers: PARSERS })
      .then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__schedDb as PGlite).transaction(async (tx: any) =>
      fn(async (sql: string, params: unknown[] = []) =>
        (await tx.query(sql, params, { parsers: PARSERS })).rows)),
}));

const { loadState, saveHabit, setCompletion } = await import("../src/lib/db/queries");
const { blankHabit, dayScore, isScheduled } = await import("../src/lib/habits");

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
let db: PGlite;
const sql = async (text: string, params: unknown[] = []) =>
  (await db.query<any>(text, params as any[], { parsers: PARSERS })).rows;

const DAILY = { mode: "daily" as const, days: [0, 1, 2, 3, 4, 5, 6], timesPerWeek: 3 };
const MWF = { mode: "days" as const, days: [1, 3, 5], timesPerWeek: 3 };
const TWICE = { mode: "times" as const, days: [0, 1, 2, 3, 4, 5, 6], timesPerWeek: 2 };

async function account(): Promise<string> {
  const [row] = await sql(
    `insert into users (email, password_hash) values ($1, 'x') returning id`,
    [`${randomUUID()}@example.com`]);
  return row.id as string;
}
const versions = (habitId: string) => sql(
  `select effective_from, mode, days_of_week, times_per_week
     from habit_schedules where habit_id = $1 order by effective_from`, [habitId]);

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SCHEMA);
  (globalThis as any).__schedDb = db;
});
afterAll(async () => { await db.close(); });

describe("writing schedule versions", () => {
  it("dates the first version by the person's calendar", async () => {
    const me = await account();
    const h = { ...blankHabit(), name: "Stretch", startDate: "2026-10-01", frequency: DAILY };
    await saveHabit(me, h, "2026-10-01");
    expect(await versions(h.id)).toEqual([
      { effective_from: "2026-10-01", mode: "daily", days_of_week: [0, 1, 2, 3, 4, 5, 6], times_per_week: null },
    ]);
  });

  it("writes nothing when only the name or section changed", async () => {
    const me = await account();
    const h = { ...blankHabit(), name: "Stretch", startDate: "2026-10-01", frequency: MWF };
    await saveHabit(me, h, "2026-10-01");
    await saveHabit(me, { ...h, name: "Stretch well", category: "nighttime" as const,
      frequency: { ...MWF, days: [5, 3, 1] } }, "2026-10-09");
    expect((await versions(h.id)).map((v) => v.effective_from)).toEqual(["2026-10-01"]);
  });

  it("opens a version for a change, replaces one made the same day, and keeps the earlier ones", async () => {
    const me = await account();
    const h = { ...blankHabit(), name: "Stretch", startDate: "2026-10-01", frequency: DAILY };
    await saveHabit(me, h, "2026-10-01");
    await saveHabit(me, { ...h, frequency: MWF }, "2026-10-12");
    await saveHabit(me, { ...h, frequency: TWICE }, "2026-10-12");
    expect(await versions(h.id)).toEqual([
      { effective_from: "2026-10-01", mode: "daily", days_of_week: [0, 1, 2, 3, 4, 5, 6], times_per_week: null },
      { effective_from: "2026-10-12", mode: "times", days_of_week: [0, 1, 2, 3, 4, 5, 6], times_per_week: 2 },
    ]);
  });

  it("amends a version dated ahead of the person's today instead of being overruled by it", async () => {
    const me = await account();
    const h = { ...blankHabit(), name: "Stretch", startDate: "2026-10-01", frequency: DAILY };
    await saveHabit(me, h, "2026-10-01");
    // What the old rule wrote for an evening edit west of UTC: tomorrow's date.
    await sql(`insert into habit_schedules (habit_id, user_id, mode, days_of_week, effective_from)
               values ($1, $2, 'days', '{1,3,5}', '2026-10-19')`, [h.id, me]);
    await saveHabit(me, { ...h, frequency: TWICE }, "2026-10-18");
    expect((await versions(h.id)).map((v) => [v.effective_from, v.mode])).toEqual([
      ["2026-10-01", "daily"], ["2026-10-19", "times"],
    ]);
  });

  it("falls back to the server's date when no calendar date is given", async () => {
    const me = await account();
    const h = { ...blankHabit(), name: "Stretch", startDate: "2026-10-01", frequency: DAILY };
    await saveHabit(me, h);
    const [{ today }] = await sql("select current_date::text as today");
    expect((await versions(h.id)).map((v) => v.effective_from)).toEqual([today]);
  });

  it("cannot add a version to another account's habit", async () => {
    const owner = await account();
    const intruder = await account();
    const h = { ...blankHabit(), name: "Mine", startDate: "2026-10-01", frequency: DAILY };
    await saveHabit(owner, h, "2026-10-01");
    await expect(saveHabit(intruder, { ...h, frequency: MWF }, "2026-10-12")).rejects.toThrow(/not found/i);
    expect((await versions(h.id)).map((v) => v.mode)).toEqual(["daily"]);
  });
});

describe("reading them back", () => {
  it("gives the engine every version, oldest first, and the newest as the current schedule", async () => {
    const me = await account();
    const h = { ...blankHabit(), name: "Stretch", startDate: "2026-10-01", frequency: DAILY };
    await saveHabit(me, h, "2026-10-01");
    await saveHabit(me, { ...h, frequency: MWF }, "2026-10-12");

    const state = await loadState(me);
    const loaded = state.habits.find((x) => x.id === h.id)!;
    expect(loaded.frequency).toEqual(MWF);
    expect(loaded.frequencyHistory).toEqual([
      { from: "2026-10-01", frequency: DAILY },
      { from: "2026-10-12", frequency: MWF },
    ]);
  });

  it("scores a past Tuesday by the daily rule it was lived under", async () => {
    const me = await account();
    const h = { ...blankHabit(), name: "Stretch", startDate: "2026-10-01", frequency: DAILY };
    await saveHabit(me, h, "2026-10-01");
    await setCompletion(me, h.id, "2026-10-06", true);           // a Tuesday
    await saveHabit(me, { ...h, frequency: MWF }, "2026-10-12"); // Mondays, Wednesdays, Fridays from here

    const state = await loadState(me);
    const loaded = state.habits.find((x) => x.id === h.id)!;
    expect(isScheduled(state, loaded, "2026-10-06")).toBe(true);
    expect(dayScore(state, "2026-10-06")).toMatchObject({ pct: 100, done: 1, total: 1 });
    expect(isScheduled(state, loaded, "2026-10-13")).toBe(false); // a Tuesday under the new rule
    // The completion itself is untouched by any of this.
    expect(await sql("select done_on from habit_completions where habit_id = $1", [h.id]))
      .toEqual([{ done_on: "2026-10-06" }]);
  });
});
