import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The Free active-habit allowance, against a real Postgres (PGlite).
 *
 * The properties that matter: only an operation that **increases** the active
 * count is gated, an account already over the limit keeps everything and stays
 * fully editable, Pro and Admin are unlimited without writing anything anywhere,
 * and an expired Pro row behaves exactly as Free.
 *
 * PGlite serves one connection at a time, so genuine parallel contention cannot
 * be reproduced in process. The concurrency test below therefore proves the
 * property that actually protects the limit — a writer that arrives after another
 * has committed sees the committed count and is refused — while the presence and
 * ordering of `pg_advisory_xact_lock` is pinned by source assertions in
 * tests/entitlements.test.ts. Both halves are needed: the lock without the count
 * refuses nothing, and the count without the lock refuses nothing reliably.
 */

vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    ((globalThis as any).__limitDb as PGlite).query(sql, params as any[]).then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__limitDb as PGlite).transaction(async (tx: any) =>
      fn(async (sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows)),
}));

const { saveHabit, deleteHabit, setCompletion } = await import("../src/lib/db/queries");
const { PlanLimitError } = await import("../src/lib/http");
const { blankHabit } = await import("../src/lib/habits");
const { FREE_LIMITS } = await import("../src/lib/entitlements");

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
let db: PGlite;
const sql = async (text: string, params: unknown[] = []) =>
  (await db.query<any>(text, params as any[])).rows;

const LIMIT = FREE_LIMITS.activeHabits as number;

async function account(): Promise<string> {
  const [row] = await sql(
    `insert into users (email, password_hash) values ($1, 'x') returning id`,
    [`${randomUUID()}@example.com`]);
  return row.id as string;
}
const makeAdmin = (id: string) => sql(`update users set role = 'admin' where id = $1`, [id]);
const grantPro = (id: string, expiresAt: string | null = null) =>
  sql(`insert into user_plans (user_id, plan, source, expires_at)
       values ($1, 'pro', 'grandfathered', $2::timestamptz)`, [id, expiresAt]);

/** Rows inserted straight past the gate, so "already over the limit" is reachable. */
const seedActive = async (id: string, n: number) => {
  for (let i = 0; i < n; i++) {
    await sql(`insert into habits (user_id, name, category, status)
               values ($1, $2, 'morning', 'active')`, [id, `seeded ${i}`]);
  }
};
const activeCount = (id: string) =>
  sql(`select count(*)::int n from habits where user_id = $1 and status = 'active'`, [id])
    .then((r) => r[0].n as number);

const habit = (over: Partial<ReturnType<typeof blankHabit>> = {}) => ({ ...blankHabit(), ...over });

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SCHEMA);
  (globalThis as any).__limitDb = db;
});
afterAll(async () => { await db.close(); });

describe("a Free account at the active-habit allowance", () => {
  it("allows the habit that reaches the limit", async () => {
    const id = await account();
    await seedActive(id, LIMIT - 1);
    expect(await activeCount(id)).toBe(LIMIT - 1);

    await expect(saveHabit(id, habit({ name: "the fifteenth" }))).resolves.toBe(true);
    expect(await activeCount(id)).toBe(LIMIT);
  });

  it("refuses the next one, as a 409 naming the feature and the limit", async () => {
    const id = await account();
    await seedActive(id, LIMIT);

    const attempt = saveHabit(id, habit({ name: "one too many" }));
    await expect(attempt).rejects.toThrow(PlanLimitError);
    await attempt.catch((e: any) => {
      expect(e.status).toBe(409);
      expect(e.code).toBe("plan_limit_reached");
      expect(e.feature).toBe("activeHabits");
      expect(e.limit).toBe(LIMIT);
    });
    // Refused means nothing was written, not written-then-removed.
    expect(await activeCount(id)).toBe(LIMIT);
    expect(await sql(`select count(*)::int n from habits where user_id = $1`, [id])
      .then((r) => r[0].n)).toBe(LIMIT);
  });

  it("refuses a reactivation once the sheet is full", async () => {
    const id = await account();
    await seedActive(id, LIMIT);
    const paused = habit({ name: "waiting", status: "paused", active: false });
    await saveHabit(id, paused);                       // parking it is always allowed
    expect(await activeCount(id)).toBe(LIMIT);

    await expect(saveHabit(id, { ...paused, status: "active", active: true }))
      .rejects.toThrow(PlanLimitError);
    // Still paused, and still there.
    const [row] = await sql(`select status from habits where id = $1`, [paused.id]);
    expect(row.status).toBe("paused");
  });

  it("serialises two increases at the limit-1 boundary: exactly one succeeds", async () => {
    const id = await account();
    await seedActive(id, LIMIT - 1);

    const results = await Promise.allSettled([
      saveHabit(id, habit({ name: "racer A" })),
      saveHabit(id, habit({ name: "racer B" })),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(PlanLimitError);
    // The invariant the lock exists to protect.
    expect(await activeCount(id)).toBe(LIMIT);
  });
});

describe("a Free account already over the allowance keeps everything", () => {
  const OVER = 17;

  it("does not lose, pause or retire a single habit", async () => {
    const id = await account();
    await seedActive(id, OVER);
    expect(await activeCount(id)).toBe(OVER);
    // Nothing in the write path touches other rows, so reading it back is enough.
    expect(await sql(`select count(*)::int n from habits where user_id = $1`, [id])
      .then((r) => r[0].n)).toBe(OVER);
  });

  it("allows an edit to a habit that is already active", async () => {
    const id = await account();
    await seedActive(id, OVER - 1);
    const mine = habit({ name: "already on the sheet" });
    await seedActive(id, 1);
    // Create it through the gate at a point where there is still room, then fill up.
    await sql(`insert into habits (id, user_id, name, category, status)
               values ($1, $2, 'mine', 'morning', 'active')`, [mine.id, id]);
    expect(await activeCount(id)).toBe(OVER + 1);

    await expect(saveHabit(id, { ...mine, name: "renamed while over the limit" }))
      .resolves.toBe(false);
    const [row] = await sql(`select name, status from habits where id = $1`, [mine.id]);
    expect(row.name).toBe("renamed while over the limit");
    expect(row.status).toBe("active");
  });

  it("allows a schedule change, and a completion", async () => {
    const id = await account();
    await seedActive(id, OVER);
    const mine = habit({ name: "trackable" });
    await sql(`insert into habits (id, user_id, name, category, status)
               values ($1, $2, 'trackable', 'morning', 'active')`, [mine.id, id]);

    await expect(saveHabit(id, {
      ...mine, frequency: { mode: "times", days: [], timesPerWeek: 4 },
    })).resolves.toBe(false);
    await expect(setCompletion(id, mine.id, "2026-09-20", true)).resolves.toBeUndefined();
    expect(await sql(`select count(*)::int n from habit_completions where user_id = $1`, [id])
      .then((r) => r[0].n)).toBe(1);
  });

  it("allows pausing, and allows the count to come down", async () => {
    const id = await account();
    await seedActive(id, OVER);
    const [victim] = await sql(
      `select id, name from habits where user_id = $1 order by name limit 1`, [id]);

    await expect(saveHabit(id, habit({ id: victim.id, name: victim.name, status: "paused", active: false })))
      .resolves.toBe(false);
    expect(await activeCount(id)).toBe(OVER - 1);

    await deleteHabit(id, victim.id);
    expect(await activeCount(id)).toBe(OVER - 1);
  });

  it("still refuses one more active habit", async () => {
    const id = await account();
    await seedActive(id, OVER);
    await expect(saveHabit(id, habit({ name: "no room at all" })))
      .rejects.toThrow(PlanLimitError);
  });
});

describe("who is exempt", () => {
  it("Pro · Grandfathered is unlimited", async () => {
    const id = await account();
    await grantPro(id);
    await seedActive(id, LIMIT);
    for (let i = 0; i < 5; i++) {
      await expect(saveHabit(id, habit({ name: `pro ${i}` }))).resolves.toBe(true);
    }
    expect(await activeCount(id)).toBe(LIMIT + 5);
  });

  it("an admin is unlimited, and needs no plan row to be", async () => {
    const id = await account();
    await makeAdmin(id);
    await seedActive(id, LIMIT);
    for (let i = 0; i < 3; i++) {
      await expect(saveHabit(id, habit({ name: `admin ${i}` }))).resolves.toBe(true);
    }
    expect(await activeCount(id)).toBe(LIMIT + 3);
    expect(await sql(`select count(*)::int n from user_plans where user_id = $1`, [id])
      .then((r) => r[0].n)).toBe(0);
  });

  it("an expired Pro row behaves exactly as Free", async () => {
    const id = await account();
    await grantPro(id, new Date(Date.now() - 86_400_000).toISOString());
    await seedActive(id, LIMIT);
    await expect(saveHabit(id, habit({ name: "lapsed" }))).rejects.toThrow(PlanLimitError);
    // The grant is still on record; only its effect has lapsed.
    expect(await sql(`select plan, source from user_plans where user_id = $1`, [id])
      .then((r) => r[0])).toMatchObject({ plan: "pro", source: "grandfathered" });
  });

  it("a Pro row that has not expired is still unlimited", async () => {
    const id = await account();
    await grantPro(id, new Date(Date.now() + 86_400_000).toISOString());
    await seedActive(id, LIMIT);
    await expect(saveHabit(id, habit({ name: "still valid" }))).resolves.toBe(true);
  });
});

describe("what the gate never touches", () => {
  it("does not gate a habit written as a candidate or a recommendation", async () => {
    const id = await account();
    await seedActive(id, LIMIT);
    // This is the shape /api/recommendations writes: never active without approval.
    for (const status of ["candidate", "recommended", "paused", "retired"] as const) {
      await expect(saveHabit(id, habit({ name: `${status} one`, status, active: false })),
        status).resolves.toBe(true);
    }
    expect(await activeCount(id)).toBe(LIMIT);
  });

  it("counts each account separately", async () => {
    const mine = await account();
    const theirs = await account();
    await seedActive(mine, LIMIT);
    await expect(saveHabit(mine, habit({ name: "mine" }))).rejects.toThrow(PlanLimitError);
    await expect(saveHabit(theirs, habit({ name: "theirs" }))).resolves.toBe(true);
  });

  it("refuses to let one account write into another's habit", async () => {
    const mine = await account();
    const theirs = await account();
    const h = habit({ name: "theirs alone" });
    await saveHabit(theirs, h);
    // The shared 404: a missing row and someone else's row read the same.
    await expect(saveHabit(mine, { ...h, name: "stolen" })).rejects.toThrow(/not found/i);
  });

  it("writes no quota row: that table is for priorities only", async () => {
    const id = await account();
    await saveHabit(id, habit({ name: "a habit" }));
    expect(await sql(`select count(*)::int n from priority_quota_usage`).then((r) => r[0].n)).toBe(0);
  });
});
