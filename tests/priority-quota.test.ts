import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The Free allowance of new priorities per local calendar day, against a real
 * Postgres (PGlite).
 *
 * What the allowance counts is **creation of an identity**, and nothing else.
 * Rollover, editing, reordering, requadranting, completing and reopening are all
 * operations on a line that already exists, so none of them may cost anything —
 * and deleting does not hand the day back, because the day was spent writing it.
 *
 * The day is the server's, derived from the reader's time zone. PGlite serves one
 * connection at a time, so the concurrency test proves the property that protects
 * the count — a second writer sees the first's committed row and is refused —
 * while the `on conflict … where` ordering is pinned by source assertions in
 * tests/entitlements.test.ts.
 */

vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params: unknown[] = []) =>
    ((globalThis as any).__quotaDb as PGlite).query(sql, params as any[]).then((r) => r.rows),
  transaction: async (fn: (q: any) => Promise<unknown>) =>
    ((globalThis as any).__quotaDb as PGlite).transaction(async (tx: any) =>
      fn(async (sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows)),
}));

const {
  addPriority, deletePriority, reorderPriorities, savePriorityLayout,
  setPriorityDone, setPriorityPlannedOn, setPriorityText,
} = await import("../src/lib/db/queries");
const { PlanLimitError } = await import("../src/lib/http");
const { FREE_LIMITS } = await import("../src/lib/entitlements");
const { viewerToday } = await import("../src/lib/community");
const { prioritiesOn } = await import("../src/lib/priorities");

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
let db: PGlite;
const sql = async (text: string, params: unknown[] = []) =>
  (await db.query<any>(text, params as any[])).rows;

const LIMIT = FREE_LIMITS.newPrioritiesPerDay as number;
const DAY = "2026-09-20";
const Q = "important_not_urgent" as const;

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

const used = (id: string, day = DAY) =>
  sql(`select created from priority_quota_usage where user_id = $1 and local_day = $2::date`, [id, day])
    .then((r) => (r.length ? (r[0].created as number) : 0));
const countFor = (id: string) =>
  sql(`select count(*)::int n from priorities where user_id = $1`, [id]).then((r) => r[0].n as number);
/** One creation, with a fresh client-generated id — the real call shape. */
const create = (id: string, text = "a line", day = DAY, on = DAY) =>
  addPriority(id, randomUUID(), text, on, Q, day);

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SCHEMA);
  (globalThis as any).__quotaDb = db;
});
afterAll(async () => { await db.close(); });

describe("the day's allowance", () => {
  it("allows five, then refuses the sixth as a 409", async () => {
    const id = await account();
    for (let i = 1; i <= LIMIT; i++) {
      await expect(create(id, `line ${i}`), `creation ${i}`).resolves.toBeUndefined();
    }
    expect(await used(id)).toBe(LIMIT);

    const attempt = create(id, "one too many");
    await expect(attempt).rejects.toThrow(PlanLimitError);
    await attempt.catch((e: any) => {
      expect(e.status).toBe(409);
      expect(e.code).toBe("plan_limit_reached");
      expect(e.feature).toBe("newPrioritiesPerDay");
      expect(e.limit).toBe(LIMIT);
    });
    // The refusal wrote nothing: not the priority, and not a sixth increment.
    expect(await countFor(id)).toBe(LIMIT);
    expect(await used(id)).toBe(LIMIT);
  });

  it("serialises two creations at the boundary: exactly one succeeds", async () => {
    const id = await account();
    for (let i = 0; i < LIMIT - 1; i++) await create(id, `filler ${i}`);
    expect(await used(id)).toBe(LIMIT - 1);

    const results = await Promise.allSettled([
      create(id, "racer A"), create(id, "racer B"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(PlanLimitError);

    expect(await used(id)).toBe(LIMIT);
    expect(await countFor(id)).toBe(LIMIT);
  });

  it("gives each local day its own allowance, with no reset job", async () => {
    const id = await account();
    for (let i = 0; i < LIMIT; i++) await create(id, `today ${i}`);
    await expect(create(id, "blocked today")).rejects.toThrow(PlanLimitError);

    // Tomorrow is simply a different key.
    await expect(create(id, "tomorrow", "2026-09-21", "2026-09-21")).resolves.toBeUndefined();
    expect(await used(id, "2026-09-21")).toBe(1);
    expect(await used(id, DAY)).toBe(LIMIT);
  });

  it("counts each account separately", async () => {
    const mine = await account();
    const theirs = await account();
    for (let i = 0; i < LIMIT; i++) await create(mine, `mine ${i}`);
    await expect(create(mine, "mine again")).rejects.toThrow(PlanLimitError);
    await expect(create(theirs, "theirs")).resolves.toBeUndefined();
  });
});

describe("a failed write costs nothing", () => {
  it("does not consume the allowance when the insert itself fails", async () => {
    const id = await account();
    await create(id, "one good line");
    expect(await used(id)).toBe(1);

    // 201 characters: the body CHECK refuses it, inside the same transaction.
    await expect(addPriority(id, randomUUID(), "x".repeat(201), DAY, Q, DAY)).rejects.toThrow();
    expect(await used(id)).toBe(1);
    expect(await countFor(id)).toBe(1);
  });

  it("rolls the priority back when the charge is refused", async () => {
    const id = await account();
    for (let i = 0; i < LIMIT; i++) await create(id, `full ${i}`);
    const doomed = randomUUID();
    await expect(addPriority(id, doomed, "never lands", DAY, Q, DAY))
      .rejects.toThrow(PlanLimitError);
    expect(await sql(`select 1 from priorities where id = $1`, [doomed])).toEqual([]);
  });
});

describe("retrying the same request", () => {
  it("is a no-op that consumes nothing", async () => {
    const id = await account();
    const same = randomUUID();
    await addPriority(id, same, "written once", DAY, Q, DAY);
    expect(await used(id)).toBe(1);

    // The client resent it: same id, same everything.
    await expect(addPriority(id, same, "written once", DAY, Q, DAY)).resolves.toBeUndefined();
    expect(await used(id)).toBe(1);
    expect(await countFor(id)).toBe(1);
  });

  it("does not let a retry rewrite the line it already created", async () => {
    const id = await account();
    const same = randomUUID();
    await addPriority(id, same, "the original words", DAY, Q, DAY);
    await addPriority(id, same, "different words", DAY, Q, DAY);
    const [row] = await sql(`select body from priorities where id = $1`, [same]);
    expect(row.body).toBe("the original words");
  });

  it("answers another account's id with the shared 404, and charges nothing", async () => {
    const mine = await account();
    const theirs = await account();
    const id = randomUUID();
    await addPriority(theirs, id, "theirs", DAY, Q, DAY);

    await expect(addPriority(mine, id, "mine now", DAY, Q, DAY)).rejects.toThrow(/not found/i);
    expect(await used(mine)).toBe(0);
    expect(await countFor(mine)).toBe(0);
  });
});

describe("what never consumes the allowance", () => {
  it("deleting does not hand the day back", async () => {
    const id = await account();
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const [i, pid] of ids.entries()) await addPriority(id, pid, `line ${i}`, DAY, Q, DAY);
    expect(await used(id)).toBe(LIMIT);

    await deletePriority(id, ids[0]);
    await deletePriority(id, ids[1]);
    expect(await countFor(id)).toBe(LIMIT - 2);
    // Create 5, delete 2, and the day is still spent.
    expect(await used(id)).toBe(LIMIT);
    await expect(create(id, "not with the freed slots")).rejects.toThrow(PlanLimitError);
  });

  it("editing, planning, reordering, requadranting, completing and reopening are free", async () => {
    const id = await account();
    const pid = randomUUID();
    await addPriority(id, pid, "the one line", DAY, Q, DAY);
    expect(await used(id)).toBe(1);

    await setPriorityText(id, pid, "reworded");
    await setPriorityPlannedOn(id, pid, "2026-09-22");
    await setPriorityPlannedOn(id, pid, null);
    await reorderPriorities(id, [pid]);
    await savePriorityLayout(id, [{ id: pid, category: "urgent_important", sortOrder: 0 }]);
    await setPriorityDone(id, pid, true, DAY);
    await setPriorityDone(id, pid, false, DAY);

    expect(await used(id)).toBe(1);
    expect(await countFor(id)).toBe(1);
  });

  it("rollover is a read: an unfinished line appears on later days for free", async () => {
    const id = await account();
    const pid = randomUUID();
    await addPriority(id, pid, "still open", DAY, Q, DAY);
    expect(await used(id)).toBe(1);

    const rows = await sql(
      `select id, body as text, to_char(created_on,'YYYY-MM-DD') as "createdOn",
              completed_on as "completedOn", category, sort_order as "sortOrder"
         from priorities where user_id = $1`, [id]);
    // The whole of the rollover, from lib/priorities: two date comparisons.
    expect(prioritiesOn(rows as any, "2026-09-25").map((p) => p.id)).toEqual([pid]);
    expect(prioritiesOn(rows as any, "2026-09-19")).toEqual([]);
    // Nothing was written to look at another day.
    expect(await used(id)).toBe(1);
    expect(await used(id, "2026-09-25")).toBe(0);
  });
});

describe("who is exempt", () => {
  it("Pro · Grandfathered is unlimited and writes no quota row at all", async () => {
    const id = await account();
    await grantPro(id);
    for (let i = 0; i < LIMIT + 4; i++) {
      await expect(create(id, `pro ${i}`), `creation ${i}`).resolves.toBeUndefined();
    }
    expect(await countFor(id)).toBe(LIMIT + 4);
    expect(await sql(`select count(*)::int n from priority_quota_usage where user_id = $1`, [id])
      .then((r) => r[0].n)).toBe(0);
  });

  it("an admin is unlimited and writes no quota row", async () => {
    const id = await account();
    await makeAdmin(id);
    for (let i = 0; i < LIMIT + 2; i++) await create(id, `admin ${i}`);
    expect(await countFor(id)).toBe(LIMIT + 2);
    expect(await sql(`select count(*)::int n from priority_quota_usage where user_id = $1`, [id])
      .then((r) => r[0].n)).toBe(0);
  });

  it("an expired Pro row behaves exactly as Free", async () => {
    const id = await account();
    await grantPro(id, new Date(Date.now() - 86_400_000).toISOString());
    for (let i = 0; i < LIMIT; i++) await create(id, `lapsed ${i}`);
    await expect(create(id, "one too many")).rejects.toThrow(PlanLimitError);
    expect(await used(id)).toBe(LIMIT);
  });
});

describe("the day is the server's answer", () => {
  const noon = new Date("2026-09-20T12:00:00Z");

  it("uses the reader's own calendar day when the zone is valid", () => {
    expect(viewerToday("Asia/Shanghai", noon)).toBe("2026-09-20");
    expect(viewerToday("America/Los_Angeles", noon)).toBe("2026-09-20");
    // Late evening in California is already tomorrow in Shanghai.
    const evening = new Date("2026-09-20T23:30:00Z");
    expect(viewerToday("Asia/Shanghai", evening)).toBe("2026-09-21");
    expect(viewerToday("America/Los_Angeles", evening)).toBe("2026-09-20");
  });

  it("falls back to the server's date for a missing, empty or unknown zone", () => {
    for (const bad of [null, undefined, "", "Mars/Olympus_Mons", "not a zone", "x".repeat(100)]) {
      expect(viewerToday(bad as any, noon), String(bad)).toBe("2026-09-20");
    }
  });

  it("can be moved by at most one calendar day, whatever zone is claimed", () => {
    // The residual risk, documented as a bound rather than left implicit: a forged
    // header selects among the dates in effect somewhere on Earth, never an
    // arbitrary one.
    const zones = ["Pacific/Kiritimati", "Etc/GMT+12", "Asia/Shanghai",
      "America/Los_Angeles", "UTC", "Pacific/Apia", "Etc/GMT-14"];
    const days = new Set(zones.map((z) => viewerToday(z, noon)));
    for (const day of days) {
      const drift = Math.abs(
        (Date.parse(`${day}T00:00:00Z`) - Date.parse("2026-09-20T00:00:00Z")) / 86_400_000);
      expect(drift, day).toBeLessThanOrEqual(1);
    }
    expect(days.size).toBeLessThanOrEqual(3);   // yesterday, today, tomorrow
  });

  it("charges the server's day even when the line is dated differently", async () => {
    const id = await account();
    // A line belonging to an earlier day still spends today's allowance.
    await addPriority(id, randomUUID(), "backdated", "2026-09-18", Q, DAY);
    expect(await used(id, DAY)).toBe(1);
    expect(await used(id, "2026-09-18")).toBe(0);
    const [row] = await sql(
      `select to_char(created_on,'YYYY-MM-DD') as d from priorities where user_id = $1`, [id]);
    expect(row.d).toBe("2026-09-18");
  });
});
