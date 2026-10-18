import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * HT-2b against a real Postgres (PGlite), on both sides of migration step 22.
 *
 * After it: each new mode is stored in its own columns and read back; a
 * same-day switch back to an original mode clears the new settings; an
 * unchanged schedule writes nothing.
 *
 * Before it — a deploy that lands ahead of its migration: the original three
 * modes save exactly as they do today, the state still loads, and a new mode
 * fails as "not available yet" (`isRepeatUnavailable`) with nothing written,
 * not even the habit row.
 */

const PARSERS = {
  1082: (v: string) => v,
  1182: (v: string) => (v === "{}" ? [] : v.slice(1, -1).split(",")),
};
vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    ((globalThis as any).__frDb as PGlite).query(sql, params as any[], { parsers: PARSERS }).then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__frDb as PGlite).transaction(async (tx: any) =>
      fn(async (sql: string, params: unknown[] = []) => (await tx.query(sql, params, { parsers: PARSERS })).rows)),
}));

const { loadState, saveHabit } = await import("../src/lib/db/queries");
const { blankHabit } = await import("../src/lib/habits");
const { isRepeatUnavailable } = await import("../src/lib/db/diagnose");

const FULL = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const START = "-- ---- Flexible repetition and weekly rotation (step 22) ----";
const END = "-- ---- end flexible repetition and weekly rotation ----";
const BEFORE_STEP_22 = FULL.slice(0, FULL.indexOf(START)) + FULL.slice(FULL.indexOf("\n", FULL.indexOf(END)));

const DAILY = { mode: "daily" as const, days: [0, 1, 2, 3, 4, 5, 6], timesPerWeek: 3 };
let after: PGlite, before: PGlite;
const use = (db: PGlite) => { (globalThis as any).__frDb = db; };
const sql = async (db: PGlite, text: string, params: unknown[] = []) =>
  (await db.query<any>(text, params as any[], { parsers: PARSERS })).rows;
async function account(db: PGlite) {
  const [row] = await sql(db, `insert into users (email, password_hash) values ($1, 'x') returning id`,
    [`${randomUUID()}@example.com`]);
  return row.id as string;
}
const rows = (db: PGlite, habitId: string) => sql(db,
  `select * from habit_schedules where habit_id = $1 order by effective_from`, [habitId]);

beforeAll(async () => {
  after = await PGlite.create(); await after.exec(FULL);
  before = await PGlite.create(); await before.exec(BEFORE_STEP_22);
});
afterAll(async () => { await after.close(); await before.close(); });

describe("after step 22", () => {
  it("stores every N days in its own columns and reads it back", async () => {
    use(after);
    const me = await account(after);
    const h = { ...blankHabit(), name: "Water", startDate: "2026-10-01",
      frequency: { ...DAILY, mode: "every_n_days" as const, intervalDays: 3, anchorDate: "2026-10-02" } };
    await saveHabit(me, h, "2026-10-01");
    expect(await rows(after, h.id)).toEqual([expect.objectContaining({
      mode: "every_n_days", interval_days: 3, anchor_date: "2026-10-02",
      times_per_week: null, times_per_month: null, days_of_month: null, effective_from: "2026-10-01",
    })]);
    const loaded = (await loadState(me)).habits.find((x) => x.id === h.id)!;
    expect(loaded.frequency).toEqual({ ...DAILY, mode: "every_n_days", intervalDays: 3, anchorDate: "2026-10-02" });
  });

  it("stores times a month and days of the month, and an unchanged save writes nothing", async () => {
    use(after);
    const me = await account(after);
    const monthly = { ...blankHabit(), name: "Call home", startDate: "2026-10-01",
      frequency: { ...DAILY, mode: "month_times" as const, timesPerMonth: 4 } };
    const bills = { ...blankHabit(), name: "Pay bills", startDate: "2026-10-01",
      frequency: { ...DAILY, mode: "month_days" as const, daysOfMonth: [1, 15] } };
    await saveHabit(me, monthly, "2026-10-01");
    await saveHabit(me, bills, "2026-10-01");
    await saveHabit(me, { ...bills, name: "Pay the bills", frequency: { ...bills.frequency, daysOfMonth: [15, 1] } }, "2026-10-09");
    expect((await rows(after, monthly.id))[0]).toMatchObject({ mode: "month_times", times_per_month: 4 });
    expect((await rows(after, bills.id)).map((r) => [r.effective_from, r.days_of_month])).toEqual([["2026-10-01", [1, 15]]]);
    const loaded = (await loadState(me)).habits;
    expect(loaded.find((x) => x.id === monthly.id)!.frequency.timesPerMonth).toBe(4);
    expect(loaded.find((x) => x.id === bills.id)!.frequency.daysOfMonth).toEqual([1, 15]);
  });

  it("clears the new settings when the same day's version goes back to an original mode", async () => {
    use(after);
    const me = await account(after);
    const h = { ...blankHabit(), name: "Water", startDate: "2026-10-01",
      frequency: { ...DAILY, mode: "month_days" as const, daysOfMonth: [5] } };
    await saveHabit(me, h, "2026-10-18");
    await saveHabit(me, { ...h, frequency: DAILY }, "2026-10-18");
    expect(await rows(after, h.id)).toEqual([expect.objectContaining({
      mode: "daily", days_of_month: null, interval_days: null, anchor_date: null, times_per_month: null,
    })]);
  });
});

describe("before step 22 (a deploy ahead of its migration)", () => {
  it("saves the original three modes exactly as today, and the state loads", async () => {
    use(before);
    const me = await account(before);
    const h = { ...blankHabit(), name: "Read", startDate: "2026-10-01", frequency: DAILY };
    await saveHabit(me, h, "2026-10-01");
    await saveHabit(me, { ...h, frequency: { ...DAILY, mode: "days" as const, days: [1, 3, 5] } }, "2026-10-05");
    await saveHabit(me, { ...h, frequency: { ...DAILY, mode: "times" as const, timesPerWeek: 2 } }, "2026-10-09");
    expect((await rows(before, h.id)).map((r) => r.mode)).toEqual(["daily", "days", "times"]);
    const loaded = (await loadState(me)).habits.find((x) => x.id === h.id)!;
    expect(loaded.frequency).toEqual({ ...DAILY, mode: "times", timesPerWeek: 2 });
  });

  it("refuses a new mode as 'not available yet' and writes nothing, not even the habit", async () => {
    use(before);
    const me = await account(before);
    const h = { ...blankHabit(), name: "Water", startDate: "2026-10-01",
      frequency: { ...DAILY, mode: "every_n_days" as const, intervalDays: 3, anchorDate: "2026-10-02" } };
    const failure = await saveHabit(me, h, "2026-10-01").then(() => null, (e) => e);
    expect(failure).not.toBeNull();
    expect(isRepeatUnavailable(failure)).toBe(true);
    expect(await sql(before, "select id from habits where id = $1", [h.id])).toEqual([]);
    expect(await rows(before, h.id)).toEqual([]);
  });
});
