import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * HT-2c against a real Postgres (PGlite), on both sides of migration step 22.
 *
 * After it: the rotation is stored when the habit is created and read back;
 * no later save — a rename, a schedule change, a client sending another
 * start — can move it, so every past week keeps its virtue; and it is one
 * active habit.
 *
 * Before it: an ordinary habit saves exactly as today, and a rotating one is
 * refused as "not available yet" with nothing written.
 */

const PARSERS = {
  1082: (v: string) => v,
  1182: (v: string) => (v === "{}" ? [] : v.slice(1, -1).split(",")),
};
vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    ((globalThis as any).__vrDb as PGlite).query(sql, params as any[], { parsers: PARSERS }).then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__vrDb as PGlite).transaction(async (tx: any) =>
      fn(async (sql: string, params: unknown[] = []) => (await tx.query(sql, params, { parsers: PARSERS })).rows)),
}));

const { loadState, saveHabit } = await import("../src/lib/db/queries");
const { blankHabit } = await import("../src/lib/habits");
const { habitFromLibrary, libraryByKey } = await import("../src/lib/library");
const { isSchemaBehind } = await import("../src/lib/db/diagnose");

const FULL = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const START = "-- ---- Flexible repetition and weekly rotation (step 22) ----";
const END = "-- ---- end flexible repetition and weekly rotation ----";
const BEFORE_STEP_22 = FULL.slice(0, FULL.indexOf(START)) + FULL.slice(FULL.indexOf("\n", FULL.indexOf(END)));

let after: PGlite, before: PGlite;
const use = (db: PGlite) => { (globalThis as any).__vrDb = db; };
const sql = async (db: PGlite, text: string, params: unknown[] = []) =>
  (await db.query<any>(text, params as any[], { parsers: PARSERS })).rows;
async function account(db: PGlite) {
  const [row] = await sql(db, `insert into users (email, password_hash) values ($1, 'x') returning id`,
    [`${randomUUID()}@example.com`]);
  return row.id as string;
}
const virtueWeek = () => ({ ...habitFromLibrary(libraryByKey.get("franklin_virtue_week")!),
  startDate: "2026-10-18", rotationStart: "2026-10-18" });

beforeAll(async () => {
  after = await PGlite.create(); await after.exec(FULL);
  before = await PGlite.create(); await before.exec(BEFORE_STEP_22);
});
afterAll(async () => { await after.close(); await before.close(); });

describe("after step 22", () => {
  it("stores the rotation on create and reads it back", async () => {
    use(after);
    const me = await account(after);
    const h = virtueWeek();
    await saveHabit(me, h, "2026-10-18");
    expect(await sql(after, "select rotation, rotation_start from habits where id = $1", [h.id]))
      .toEqual([{ rotation: "franklin_virtues", rotation_start: "2026-10-18" }]);
    const loaded = (await loadState(me)).habits.find((x) => x.id === h.id)!;
    expect(loaded).toMatchObject({ rotation: "franklin_virtues", rotationStart: "2026-10-18", templateKey: "franklin_virtue_week" });
  });

  it("never moves it afterwards: a rename, a schedule change or another start leaves the weeks as they were", async () => {
    use(after);
    const me = await account(after);
    const h = virtueWeek();
    await saveHabit(me, h, "2026-10-18");
    await saveHabit(me, { ...h, name: "My virtues", templateKey: null, rotationStart: "2026-11-01",
      frequency: { ...h.frequency, mode: "days" as const, days: [1, 2, 3, 4, 5] } }, "2026-10-25");
    const [row] = await sql(after, "select name, rotation, rotation_start from habits where id = $1", [h.id]);
    expect(row).toEqual({ name: "My virtues", rotation: "franklin_virtues", rotation_start: "2026-10-18" });
  });

  it("is one active habit", async () => {
    use(after);
    const me = await account(after);
    await saveHabit(me, virtueWeek(), "2026-10-18");
    expect((await sql(after, "select count(*)::int n from habits where user_id = $1 and status = 'active'", [me]))[0].n).toBe(1);
  });

  it("an ordinary habit stores no rotation", async () => {
    use(after);
    const me = await account(after);
    const h = { ...blankHabit(), name: "Read", startDate: "2026-10-18" };
    await saveHabit(me, h, "2026-10-18");
    expect(await sql(after, "select rotation, rotation_start from habits where id = $1", [h.id]))
      .toEqual([{ rotation: null, rotation_start: null }]);
  });
});

describe("before step 22", () => {
  it("saves an ordinary habit as today, and refuses a rotating one with nothing written", async () => {
    use(before);
    const me = await account(before);
    const plain = { ...blankHabit(), name: "Read", startDate: "2026-10-18" };
    await saveHabit(me, plain, "2026-10-18");
    expect((await loadState(me)).habits.find((x) => x.id === plain.id)).toMatchObject({ rotation: null, rotationStart: null });

    const h = virtueWeek();
    const failure = await saveHabit(me, h, "2026-10-18").then(() => null, (e) => e);
    expect(isSchemaBehind(failure)).toBe(true);
    expect(await sql(before, "select id from habits where id = $1", [h.id])).toEqual([]);
  });
});
