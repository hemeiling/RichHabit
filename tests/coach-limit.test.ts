/**
 * The AI coach's durable safety limit, against a real Postgres (PGlite).
 *
 * The properties that matter: it survives a restart because it is counted in
 * the database, it charges a request before the model runs, it is per account,
 * and it applies to everybody — this is a cost guard, not an entitlement.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    ((globalThis as any).__coachDb as PGlite).query(sql, params as any[]).then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__coachDb as PGlite).transaction(async (tx: any) =>
      fn(async (sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows)),
}));

const { coachUsage, takeCoachRequest } = await import("../src/lib/ai/coachLimit");

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
let db: PGlite;
const sql = async (text: string, params: unknown[] = []) => (await db.query<any>(text, params as any[])).rows;
const LIMITS = { hourly: 3, daily: 5 };

async function account() {
  const [row] = await sql(
    `insert into users (email, password_hash) values ($1, 'x') returning id`,
    [`${randomUUID()}@example.com`]);
  return row.id as string;
}
const rowsFor = (userId: string) =>
  sql(`select count(*)::int n from coach_requests where user_id = $1`, [userId]).then((r) => r[0].n);
/** Moves this account's recorded requests back in time, to test the windows. */
const age = (userId: string, interval: string) =>
  sql(`update coach_requests set occurred_at = occurred_at - $2::interval where user_id = $1`,
    [userId, interval]);

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SCHEMA);
  (globalThis as any).__coachDb = db;
});
afterAll(async () => { await db.close(); });

describe("the hourly allowance", () => {
  it("allows requests up to the limit, then refuses", async () => {
    const id = await account();
    for (let i = 1; i <= LIMITS.hourly; i++) {
      const taken = await takeCoachRequest(id, LIMITS);
      expect(taken.ok, `request ${i}`).toBe(true);
    }
    const refused = await takeCoachRequest(id, LIMITS);
    expect(refused).toMatchObject({ ok: false, reason: "hour" });
  });

  it("refuses without recording anything, so a refusal costs no allowance", async () => {
    const id = await account();
    for (let i = 0; i < LIMITS.hourly; i++) await takeCoachRequest(id, LIMITS);
    const before = await rowsFor(id);
    await takeCoachRequest(id, LIMITS);
    await takeCoachRequest(id, LIMITS);
    expect(await rowsFor(id)).toBe(before);
  });

  it("forgives once the hour has passed, while the day still counts", async () => {
    const id = await account();
    for (let i = 0; i < LIMITS.hourly; i++) await takeCoachRequest(id, LIMITS);
    expect((await takeCoachRequest(id, LIMITS)).ok).toBe(false);

    await age(id, "2 hours");
    const usage = await coachUsage(id);
    expect(usage.hour).toBe(0);
    expect(usage.day).toBe(LIMITS.hourly);
    expect((await takeCoachRequest(id, LIMITS)).ok).toBe(true);
  });
});

describe("the daily allowance", () => {
  it("refuses once the day's limit is reached, even in a fresh hour", async () => {
    const id = await account();
    for (let i = 0; i < LIMITS.daily; i++) {
      await takeCoachRequest(id, LIMITS);
      // Spread across hours so the hourly limit is never the one refusing.
      await age(id, "70 minutes");
    }
    const refused = await takeCoachRequest(id, LIMITS);
    expect(refused).toMatchObject({ ok: false, reason: "day" });
  });

  it("forgives once a day has passed", async () => {
    const id = await account();
    for (let i = 0; i < LIMITS.daily; i++) {
      await takeCoachRequest(id, LIMITS);
      await age(id, "70 minutes");
    }
    expect((await takeCoachRequest(id, LIMITS)).ok).toBe(false);
    await age(id, "25 hours");
    expect(await coachUsage(id)).toEqual({ hour: 0, day: 0 });
    expect((await takeCoachRequest(id, LIMITS)).ok).toBe(true);
  });
});

describe("what it charges, and whom", () => {
  it("charges the request before the model runs, so a failed call still counts", async () => {
    const id = await account();
    // takeCoachRequest is called *before* the provider; the row exists whether
    // or not the caller then succeeds.
    await takeCoachRequest(id, LIMITS);
    expect(await rowsFor(id)).toBe(1);
    expect((await coachUsage(id)).hour).toBe(1);
  });

  it("counts each account separately", async () => {
    const mine = await account();
    const theirs = await account();
    for (let i = 0; i < LIMITS.hourly; i++) await takeCoachRequest(mine, LIMITS);
    expect((await takeCoachRequest(mine, LIMITS)).ok).toBe(false);
    expect((await takeCoachRequest(theirs, LIMITS)).ok).toBe(true);
  });

  it("is durable: the count comes from the table, not from memory", async () => {
    const id = await account();
    await takeCoachRequest(id, LIMITS);
    await takeCoachRequest(id, LIMITS);
    // Nothing in this module holds state — a restart reads the same rows back.
    const [row] = await sql(`select count(*)::int n from coach_requests where user_id = $1`, [id]);
    expect(row.n).toBe(2);
    expect((await coachUsage(id)).hour).toBe(2);
  });

  it("treats 0 as no limit, for a future configuration that lifts it", async () => {
    const id = await account();
    for (let i = 0; i < 8; i++) {
      expect((await takeCoachRequest(id, { hourly: 0, daily: 0 })).ok).toBe(true);
    }
  });
});

describe("housekeeping", () => {
  it("sweeps this account's rows older than the retention window", async () => {
    const id = await account();
    await takeCoachRequest(id, LIMITS);
    await age(id, "40 days");
    expect(await rowsFor(id)).toBe(1);
    // The next request sweeps the stale row and records the new one.
    await takeCoachRequest(id, LIMITS);
    expect(await rowsFor(id)).toBe(1);
  });

  it("removes an account's requests when the account is deleted", async () => {
    const id = await account();
    await takeCoachRequest(id, LIMITS);
    await sql(`delete from users where id = $1`, [id]);
    expect(await rowsFor(id)).toBe(0);
  });
});
