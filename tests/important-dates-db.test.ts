import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Important Dates V2 through the real data layer (lib/db/queries), against a
 * real Postgres (PGlite).
 *
 * The properties that matter most here are about data that already exists:
 *   - a client from before times and repeats can still save, and saving from
 *     it never erases a time, a repeat or a deleted occurrence;
 *   - an account loads correctly before the migration has run, and after it;
 *   - deleting one occurrence touches one row's exclusions and nothing else,
 *     and only for the account that owns the row.
 *
 * The parsers below are the ones lib/db/pool registers for `pg`, so a date
 * comes back as the string Postgres sent, exactly as in production.
 */

const PARSERS = {
  1082: (v: string) => v,
  1182: (v: string) => (v === "{}" ? [] : v.slice(1, -1).split(",")),
};
/** Run once, just before the next statement — to interleave a concurrent edit. */
let beforeNext: (() => Promise<void>) | null = null;

vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) => {
    const hook = beforeNext;
    if (hook && /^\s*update important_dates/.test(sql)) { beforeNext = null; await hook(); }
    return ((globalThis as any).__idDb as PGlite).query(sql, params as any[], { parsers: PARSERS })
      .then((r) => r.rows);
  },
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__idDb as PGlite).transaction(async (tx: any) =>
      fn(async (sql: string, params: unknown[] = []) => (await tx.query(sql, params, { parsers: PARSERS })).rows)),
}));

const { loadState, saveImportantDate, deleteImportantDate, deleteImportantDateOccurrence } =
  await import("../src/lib/db/queries");
const { parseImportantDate } = await import("../src/lib/validate");
const { isSchemaBehind, violatedConstraint } = await import("../src/lib/db/diagnose");
const { seriesAfterEdit } = await import("../src/lib/importantDates");
const { migrateImportantDatesV2 } = await import("../scripts/migrations/important-dates-v2.mjs");

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const START = "-- ---- important dates: optional times, and repeating events ----";
const END = "-- ---- end important dates: optional times, and repeating events ----";
const EXISTING_SCHEMA = SCHEMA.slice(0, SCHEMA.indexOf(START))
  + SCHEMA.slice(SCHEMA.indexOf(END) + END.length);

let db: PGlite;
const open: PGlite[] = [];
const use = async (schema: string) => {
  db = await PGlite.create();
  open.push(db);
  await db.exec(schema);
  (globalThis as any).__idDb = db;
};
afterAll(async () => { for (const d of open) await d.close(); });

const sql = async (text: string, params: unknown[] = []) =>
  (await db.query<any>(text, params as any[], { parsers: PARSERS })).rows;
async function account(): Promise<string> {
  const [row] = await sql(`insert into users (email, password_hash) values ($1, 'x') returning id`,
    [`${randomUUID()}@example.com`]);
  return row.id;
}

/** What the browser sends: the V2 client always says `v: 2`. */
const v2 = (over: Record<string, unknown> = {}) => parseImportantDate({
  v: 2, id: randomUUID(), title: "Mom's Birthday", startDate: "2026-10-12", endDate: "2026-10-12",
  note: "", color: "rose", kind: "birthday",
  startTime: null, endTime: null, timeZone: null,
  repeat: { unit: "year", interval: 1, until: null }, ...over,
});
/** What a tab still running the previous build sends: no marker, no new fields. */
const v1 = (e: { id: string; title: string; startDate: string; endDate: string; kind?: string }) =>
  parseImportantDate({ ...e, note: "", color: "blue", kind: e.kind ?? "none" });

const datesOf = async (userId: string) => (await loadState(userId)).importantDates;

describe("before the migration has run", () => {
  beforeEach(async () => { await use(EXISTING_SCHEMA); });

  it("loads existing events as all day and once, and the module as available", async () => {
    const me = await account();
    await sql(`insert into important_dates (user_id, title, starts_on, ends_on, note, color, kind)
               values ($1, 'Trip', '2026-09-09', '2026-09-11', 'Booth 412', 'teal', 'travel')`, [me]);
    const state = await loadState(me);
    expect(state.unavailable).not.toContain("importantDates");
    expect(state.importantDates).toEqual([expect.objectContaining({
      title: "Trip", startDate: "2026-09-09", endDate: "2026-09-11", note: "Booth 412",
      startTime: null, endTime: null, timeZone: null, repeat: null, excludedOn: [],
    })]);
  });

  it("still saves from a client that does not know about times", async () => {
    const me = await account();
    const id = randomUUID();
    await saveImportantDate(me, v1({ id, title: "Old client", startDate: "2026-11-01", endDate: "2026-11-01" }),
      { extended: false });
    expect((await datesOf(me))[0]).toMatchObject({ id, title: "Old client" });
  });

  it("reports a V2 save as the schema being behind — never as data loss", async () => {
    const me = await account();
    const err = await saveImportantDate(me, v2(), { extended: true }).catch((e) => e);
    expect(isSchemaBehind(err)).toBe(true);
    expect(err.code).toBe("42703");
    expect(await datesOf(me)).toEqual([]);
  });
});

describe("after the migration", () => {
  beforeEach(async () => { await use(SCHEMA); });

  it("reads exactly what it read before the migration, plus the defaults", async () => {
    // The same rows, loaded on the old schema and then on the migrated one.
    await use(EXISTING_SCHEMA);
    const me = await account();
    await sql(`insert into important_dates (user_id, title, starts_on, ends_on, note, color, kind) values
      ($1, 'Battery Show', '2026-09-09', '2026-09-11', 'Booth', 'teal', 'travel'),
      ($1, '妈妈的生日', '2026-10-12', '2026-10-12', null, '#C4577F', 'none')`, [me]);
    const before = await datesOf(me);
    await migrateImportantDatesV2({ query: async (q: string, p?: unknown[]) =>
      ({ rows: (await db.query(q, p as any[])).rows as any[] }) });
    const after = await datesOf(me);
    expect(after).toEqual(before);
    expect(after.every((e) => e.startTime === null && e.repeat === null && e.excludedOn.length === 0)).toBe(true);
  });

  it("stores a timed, repeating event and reads it back as written", async () => {
    const me = await account();
    const e = v2({ title: "Zoom", kind: "none", startTime: "19:00", endTime: "20:30",
      timeZone: "America/Chicago", repeat: { unit: "week", interval: 2, until: "2027-06-30" } });
    await saveImportantDate(me, e, { extended: true });
    expect((await datesOf(me))[0]).toEqual({ ...e, note: "" });
  });

  it("never lets a previous-build save erase a time, a repeat or a deleted occurrence", async () => {
    const me = await account();
    const e = v2({ startTime: "18:30", endTime: "20:00", timeZone: "America/Chicago" });
    await saveImportantDate(me, e, { extended: true });
    await deleteImportantDateOccurrence(me, e.id, "2027-10-12");

    // A stale tab fixes a typo in the title. It knows nothing about the rest.
    await saveImportantDate(me, v1({ id: e.id, title: "Mom's birthday", startDate: e.startDate,
      endDate: e.endDate, kind: "birthday" }), { extended: false });

    expect((await datesOf(me))[0]).toMatchObject({
      title: "Mom's birthday", startTime: "18:30", endTime: "20:00", timeZone: "America/Chicago",
      repeat: { unit: "year", interval: 1, until: null }, excludedOn: ["2027-10-12"],
    });
  });

  it("gives a new event from a previous build the defaults: all day, once", async () => {
    const me = await account();
    const id = randomUUID();
    await saveImportantDate(me, v1({ id, title: "Old", startDate: "2026-11-01", endDate: "2026-11-01" }),
      { extended: false });
    expect((await datesOf(me))[0]).toMatchObject({ startTime: null, repeat: null, excludedOn: [] });
  });

  it("refuses a previous-build save that would break a time it cannot see — and changes nothing", async () => {
    const me = await account();
    const e = v2({ repeat: null, startDate: "2026-10-12", endDate: "2026-10-13", startTime: "22:00", endTime: "01:00",
      timeZone: "America/Chicago" });
    await saveImportantDate(me, e, { extended: true });
    const err = await saveImportantDate(me, v1({ id: e.id, title: e.title, startDate: "2026-10-12",
      endDate: "2026-10-12" }), { extended: false }).catch((x) => x);
    expect(violatedConstraint(err)).toBe("important_dates_time_order_check");
    expect((await datesOf(me))[0]).toMatchObject({ endDate: "2026-10-13", endTime: "01:00" });
  });

  it("keeps deleted occurrences on a rename and clears them when the series moves — as the screen does", async () => {
    const me = await account();
    const e = v2({ startDate: "2026-10-01", endDate: "2026-10-01", kind: "none",
      repeat: { unit: "week", interval: 1, until: null } });
    await saveImportantDate(me, e, { extended: true });
    await deleteImportantDateOccurrence(me, e.id, "2026-10-08");
    const stored = async () => (await datesOf(me))[0];

    for (const edit of [
      { ...e, title: "Renamed" },                                             // keeps
      { ...e, title: "Renamed", repeat: { unit: "week" as const, interval: 1, until: "2027-01-01" } }, // keeps
      { ...e, title: "Renamed", startDate: "2026-10-02", endDate: "2026-10-02" },          // clears
    ]) {
      const before = await stored();
      const expected = seriesAfterEdit(before, edit).excludedOn;
      await saveImportantDate(me, edit, { extended: true });
      expect((await stored()).excludedOn, JSON.stringify(edit)).toEqual(expected);
      if (expected.length === 0) break;
    }
    expect((await stored()).excludedOn).toEqual([]);
  });

  it("deletes one occurrence: once, idempotently, and nothing else", async () => {
    const me = await account();
    const e = v2();
    await saveImportantDate(me, e, { extended: true });
    const other = v2({ title: "Other" });
    await saveImportantDate(me, other, { extended: true });

    await deleteImportantDateOccurrence(me, e.id, "2027-10-12");
    await deleteImportantDateOccurrence(me, e.id, "2027-10-12");
    const [mine, untouched] = (await datesOf(me)).sort((a, b) => a.title.localeCompare(b.title));
    expect(mine.excludedOn).toEqual(["2027-10-12"]);
    expect(untouched.excludedOn).toEqual([]);
    expect(mine.title).toBe("Mom's Birthday");
  });

  it("refuses a date that is not an occurrence, and an event that does not repeat", async () => {
    const me = await account();
    const e = v2();
    await saveImportantDate(me, e, { extended: true });
    await expect(deleteImportantDateOccurrence(me, e.id, "2027-10-13")).rejects.toThrow(/not part/);
    await expect(deleteImportantDateOccurrence(me, e.id, "2025-10-12")).rejects.toThrow(/not part/);
    const once = v2({ repeat: null });
    await saveImportantDate(me, once, { extended: true });
    await expect(deleteImportantDateOccurrence(me, once.id, "2026-10-12")).rejects.toThrow(/does not repeat/);
    expect((await datesOf(me)).every((x) => x.excludedOn.length === 0)).toBe(true);
  });

  it("refuses another account's event, exactly as if it did not exist", async () => {
    const me = await account();
    const them = await account();
    const theirs = v2();
    await saveImportantDate(them, theirs, { extended: true });

    await expect(deleteImportantDateOccurrence(me, theirs.id, "2027-10-12")).rejects.toMatchObject({ status: 404 });
    await expect(saveImportantDate(me, { ...theirs, title: "Mine now" }, { extended: true }))
      .rejects.toMatchObject({ status: 404 });
    await deleteImportantDate(me, theirs.id);   // scoped: silently touches nothing
    expect(await datesOf(them)).toEqual([{ ...theirs, note: "" }]);
  });

  it("does not exclude a date from a series that moved while it was being deleted", async () => {
    const me = await account();
    const e = v2({ startDate: "2026-10-01", endDate: "2026-10-01", kind: "none",
      repeat: { unit: "week", interval: 1, until: null } });
    await saveImportantDate(me, e, { extended: true });
    beforeNext = async () => {
      await db.query(`update important_dates set starts_on = '2026-10-02', ends_on = '2026-10-02' where id = $1`, [e.id]);
    };
    await expect(deleteImportantDateOccurrence(me, e.id, "2026-10-08")).rejects.toMatchObject({ status: 409 });
    expect((await datesOf(me))[0].excludedOn).toEqual([]);
  });

  it("deletes a whole series as one row", async () => {
    const me = await account();
    const e = v2();
    await saveImportantDate(me, e, { extended: true });
    await deleteImportantDate(me, e.id);
    expect(await datesOf(me)).toEqual([]);
  });

  it("loads repeating events ahead of the limit's ordering", async () => {
    const me = await account();
    const old = v2({ title: "Grandma", startDate: "1958-10-12", endDate: "1958-10-12" });
    await saveImportantDate(me, old, { extended: true });
    await saveImportantDate(me, v2({ title: "Later", repeat: null, startDate: "2030-01-01", endDate: "2030-01-01" }),
      { extended: true });
    expect((await datesOf(me))[0].title).toBe("Grandma");
  });
});
