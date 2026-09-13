import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  HABIT_IDS_COMMENT, PRIORITY_IDS_COMMENT, PRIORITY_ID_COMMENT, migrateIntentionLinks,
} from "../scripts/migrations/intention-links.mjs";
import { reconcilePriorityIds } from "../src/lib/intention";
import type { Intention } from "../src/lib/types";

/**
 * The multi-link migration, run for real against Postgres (PGlite, in process).
 *
 * The starting table is built with the exact definition production has today —
 * the 4d DDL from scripts/migrate.mjs at release 5245c87 — and filled with
 * representative rows. The migration step is the same code the migration script
 * runs. These tests prove that every existing intention, habit link and priority
 * link survives exactly, that the step is idempotent, that links have no limit,
 * and that the previous release's save statement still works afterwards.
 */

/* The production definition, verbatim from step 4d at 5245c87. */
const PRODUCTION_DDL = `
  create table users (id uuid primary key);
  create table habits (id uuid primary key, user_id uuid not null, name text not null, template_key text);
  create table priorities (id uuid primary key, user_id uuid not null, body text not null);

  create function text_array_within(items text[], max_items int, max_chars int)
  returns boolean language sql immutable parallel safe as $$
    select coalesce(cardinality(items), 0) <= max_items
       and not exists (select 1 from unnest(items) as item where length(item) > max_chars)
  $$;

  create table intentions (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references users on delete cascade,
    want          text not null default '' check (length(want) <= 2000),
    why_chain     text[] not null default '{}'
                  constraint intentions_why_chain_check
                  check (text_array_within(why_chain, 3, 2000)),
    ownership     text check (ownership in ('mine','outside','unsure')),
    ownership_note text not null default '' check (length(ownership_note) <= 2000),
    vision        text[] not null default '{}'
                  constraint intentions_vision_check
                  check (text_array_within(vision, 4, 2000)),
    habit_ids     uuid[] not null default '{}'
                  constraint intentions_habit_ids_check
                  check (cardinality(habit_ids) <= 3),
    priority_id   uuid,
    step          smallint not null default 1 check (step between 1 and 5),
    completed_at  timestamptz,
    archived_at   timestamptz,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
  );
  create unique index intentions_one_active on intentions (user_id)
    where archived_at is null;
`;

/* The previous release's save, verbatim from src/lib/db/queries.ts at 5245c87. */
const PREVIOUS_RELEASE_SAVE = `with prior as (
       select completed_at from intentions where id = $1 and user_id = $2
     ), saved as (
       insert into intentions
         (id, user_id, want, why_chain, ownership, ownership_note, vision,
          habit_ids, priority_id, step, completed_at)
       values ($1,$2,$3,$4::text[],$5,$6,$7::text[],$8::uuid[],$9,$10,
               case when $11 then now() else null end)
       on conflict (id) do update set
         want = excluded.want,
         why_chain = excluded.why_chain,
         ownership = excluded.ownership,
         ownership_note = excluded.ownership_note,
         vision = excluded.vision,
         habit_ids = excluded.habit_ids,
         priority_id = excluded.priority_id,
         step = excluded.step,
         completed_at = coalesce(intentions.completed_at, excluded.completed_at),
         updated_at = now()
       where intentions.user_id = $2
       returning (xmax = 0) as inserted, completed_at
     )
     select saved.inserted as started,
            (saved.completed_at is not null
              and (select completed_at from prior) is null) as finished
       from saved`;

const ORIGINAL_COLUMNS = `id, user_id, want, why_chain, ownership, ownership_note, vision,
  habit_ids, priority_id, step, completed_at, archived_at, created_at, updated_at`;

const uuid = () => crypto.randomUUID();
const U1 = uuid(), U2 = uuid(), U3 = uuid();
const H = [uuid(), uuid(), uuid()];
const P = [uuid(), uuid()];
const rows = { A: uuid(), B: uuid(), C: uuid(), D: uuid(), E: uuid() };
const LONG_ZH = "我想每天早上用英语清楚地表达一个想法 😀".repeat(80).slice(0, 2000);

let db: PGlite;
const client = {
  async query(sql: string, params?: unknown[]) {
    const result = await db.query(sql, params as any[]);
    return { rows: result.rows as any[], rowCount: result.affectedRows ?? 0 };
  },
};
const snapshot = async (columns: string, table = "intentions") =>
  JSON.stringify((await client.query(`select ${columns} from ${table} order by id`)).rows);

let before: string;
let unrelatedBefore: string;
let firstRun: number;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(PRODUCTION_DDL);
  for (const u of [U1, U2, U3]) await client.query("insert into users (id) values ($1)", [u]);
  for (const h of H) await client.query("insert into habits values ($1, $2, $3, null)", [h, U1, `habit ${h.slice(0, 4)}`]);
  for (const p of P) await client.query("insert into priorities values ($1, $2, $3)", [p, U1, `priority ${p.slice(0, 4)}`]);

  const insert = `insert into intentions (id, user_id, want, why_chain, ownership, ownership_note, vision,
    habit_ids, priority_id, step, completed_at, archived_at, created_at, updated_at)
    values ($1,$2,$3,$4::text[],$5,$6,$7::text[],$8::uuid[],$9,$10,$11,$12,$13,$14)`;
  // A: in progress, nothing linked.
  await client.query(insert, [rows.A, U2, "Read more", ["It calms me"], null, "", [""], [], null, 2, null, null,
    "2026-09-01T08:00:00Z", "2026-09-01T08:05:00Z"]);
  // B: completed, three habits and a priority.
  await client.query(insert, [rows.B, U1, "Speak confidently at work", ["To be heard", "To lead"], "mine",
    "It came from me", ["Leading meetings", "Calm"], H, P[0], 5, "2026-09-05T10:00:00Z", null,
    "2026-09-02T09:00:00Z", "2026-09-05T10:00:00Z"]);
  // C: archived, one habit and a priority.
  await client.query(insert, [rows.C, U1, "An older intention", ["Old reason"], "outside", "", [""], [H[1]], P[1],
    5, "2026-08-01T10:00:00Z", "2026-09-02T08:59:00Z", "2026-07-30T09:00:00Z", "2026-09-02T08:59:00Z"]);
  // D: two habits, no priority, the longest Chinese and emoji text the columns allow.
  await client.query(insert, [rows.D, U3, LONG_ZH, [LONG_ZH, LONG_ZH, LONG_ZH], "unsure", LONG_ZH,
    [LONG_ZH, LONG_ZH, LONG_ZH, LONG_ZH], [H[0], H[2]], null, 4, null, null,
    "2026-09-03T09:00:00Z", "2026-09-10T11:00:00Z"]);

  before = await snapshot(ORIGINAL_COLUMNS);
  unrelatedBefore = (await snapshot("*", "habits")) + (await snapshot("*", "priorities"));
  firstRun = await migrateIntentionLinks(client);
});

afterAll(async () => { await db.close(); });

describe("the first run", () => {
  it("makes changes", () => {
    // Constraint removed, column added, two rows backfilled, three comments.
    expect(firstRun).toBe(1 + 1 + 2 + 3);
  });

  it("leaves every original column of every row exactly as it was", async () => {
    expect(await snapshot(ORIGINAL_COLUMNS)).toBe(before);
  });

  it("carries each single priority link into priority_ids, and nothing else", async () => {
    const { rows: out } = await client.query("select id, priority_id, priority_ids from intentions");
    const by = Object.fromEntries(out.map((r) => [r.id, r]));
    expect(by[rows.B].priority_ids).toEqual([P[0]]);
    expect(by[rows.C].priority_ids).toEqual([P[1]]);
    expect(by[rows.A].priority_ids).toEqual([]);
    expect(by[rows.D].priority_ids).toEqual([]);
    expect(by[rows.B].priority_id).toBe(P[0]);
    expect(by[rows.C].priority_id).toBe(P[1]);
  });

  it("keeps the row count and every unrelated table unchanged", async () => {
    expect((await client.query("select count(*)::int as n from intentions")).rows[0].n).toBe(4);
    expect((await snapshot("*", "habits")) + (await snapshot("*", "priorities"))).toBe(unrelatedBefore);
  });

  it("removes the habit limit and keeps the reflection limits", async () => {
    const { rows: constraints } = await client.query(
      `select conname, contype, pg_get_constraintdef(oid) as def
         from pg_constraint where conrelid = 'intentions'::regclass order by conname`);
    const list = constraints.map((r) => r.conname);
    expect(list).not.toContain("intentions_habit_ids_check");
    expect(list).toContain("intentions_why_chain_check");
    expect(list).toContain("intentions_vision_check");
    // No CHECK of any name bounds either link list. (Newer Postgres also lists
    // NOT NULL as a named constraint; those are not limits and are ignored.)
    const checks = constraints.filter((r) => r.contype === "c").map((r) => String(r.def));
    expect(checks.some((def) => /habit_ids|priority_ids/.test(def))).toBe(false);
  });

  it("documents the canonical and legacy columns", async () => {
    const comment = async (column: string) => (await client.query(
      `select col_description('intentions'::regclass, attnum) as c from pg_attribute
        where attrelid = 'intentions'::regclass and attname = $1`, [column])).rows[0].c;
    expect(await comment("priority_ids")).toBe(PRIORITY_IDS_COMMENT);
    expect(await comment("priority_id")).toBe(PRIORITY_ID_COMMENT);
    expect(await comment("habit_ids")).toBe(HABIT_IDS_COMMENT);
  });

  it("still allows only one active intention per account", async () => {
    await expect(client.query(
      "insert into intentions (id, user_id, want) values ($1, $2, 'second')", [uuid(), U1],
    )).rejects.toThrow();
  });
});

describe("a second run", () => {
  it("changes nothing at all", async () => {
    const full = await snapshot("*");
    expect(await migrateIntentionLinks(client)).toBe(0);
    expect(await snapshot("*")).toBe(full);
  });
});

describe("after the migration", () => {
  it("accepts any number of linked habits and priorities", async () => {
    for (const count of [4, 25, 1000]) {
      const ids = Array.from({ length: count }, () => uuid());
      await client.query("update intentions set habit_ids = $1::uuid[], priority_ids = $1::uuid[] where id = $2",
        [ids, rows.A]);
      const { rows: out } = await client.query(
        "select cardinality(habit_ids) as h, cardinality(priority_ids) as p from intentions where id = $1", [rows.A]);
      expect(out[0]).toEqual({ h: count, p: count });
    }
  });

  it("still accepts the previous release's save, insert and update alike", async () => {
    const fresh = uuid();
    await client.query("insert into users (id) values ($1)", [fresh]);
    const id = uuid();
    const args = (want: string, habits: string[], priority: string | null) =>
      [id, fresh, want, ["why"], "mine", "", [""], habits, priority, 5, true];
    await client.query(PREVIOUS_RELEASE_SAVE, args("Old app insert", [H[0]], P[0]));
    await client.query(PREVIOUS_RELEASE_SAVE, args("Old app update", [H[0], H[1]], P[1]));
    const { rows: out } = await client.query(
      "select want, habit_ids, priority_id, priority_ids from intentions where id = $1", [id]);
    expect(out[0].want).toBe("Old app update");
    expect(out[0].priority_id).toBe(P[1]);
    // Old code never writes the list; the loader still reads its single link.
    expect(out[0].priority_ids).toEqual([]);
    expect(reconcilePriorityIds(out[0].priority_ids, out[0].priority_id)).toEqual([P[1]]);
  });
});

/*
 * The new application's own save and suggestion read, run through queries.ts
 * against this database. `query` is routed to PGlite.
 */
vi.mock("@/lib/db/pool", () => ({
  query: async (sql: string, params?: unknown[]) =>
    ((globalThis as any).__intentionDb as PGlite).query(sql, params as any[]).then((r) => r.rows),
  transaction: async () => { throw new Error("not used"); },
}));

describe("the new application against the migrated table", () => {
  beforeAll(() => { (globalThis as any).__intentionDb = db; });

  const intention = (over: Partial<Intention>): Intention => ({
    id: rows.B, want: "Speak confidently at work", whyChain: ["To be heard", "To lead"],
    ownership: "mine", ownershipNote: "PRIVATE-OWNERSHIP-NOTE", vision: ["Leading meetings"],
    habitIds: H, priorityIds: [P[0], P[1]], step: 5, complete: true, ...over,
  });

  it("writes priority_ids as canonical and priority_id as its first entry", async () => {
    const { saveIntention } = await import("../src/lib/db/queries");
    await saveIntention(U1, intention({}));
    let row = (await client.query("select priority_id, priority_ids, completed_at from intentions where id = $1",
      [rows.B])).rows[0];
    expect(row.priority_ids).toEqual([P[0], P[1]]);
    expect(row.priority_id).toBe(P[0]);
    // Finishing again must not re-date the original completion.
    expect(new Date(row.completed_at).toISOString()).toBe("2026-09-05T10:00:00.000Z");

    await saveIntention(U1, intention({ priorityIds: [] }));
    row = (await client.query("select priority_id, priority_ids from intentions where id = $1", [rows.B])).rows[0];
    expect(row.priority_ids).toEqual([]);
    expect(row.priority_id).toBeNull();
  });

  it("reads only what suggestions may see: never the ownership answer or note", async () => {
    const pool = await import("@/lib/db/pool");
    const seen: string[] = [];
    const spy = vi.spyOn(pool, "query").mockImplementation(async (sql: string, params?: unknown[]) => {
      seen.push(sql);
      return db.query(sql, params as any[]).then((r) => r.rows as any);
    });
    const { saveIntention, intentionSuggestionSource } = await import("../src/lib/db/queries");
    await saveIntention(U1, intention({}));
    seen.length = 0;
    const source = await intentionSuggestionSource(U1);
    spy.mockRestore();

    expect(JSON.stringify(source)).not.toContain("PRIVATE-OWNERSHIP-NOTE");
    expect(Object.keys(source!).sort()).toEqual(["habits", "priorities", "vision", "want", "whyChain"]);
    expect(seen.join(" ")).not.toMatch(/ownership|select \*/);
    expect(source!.habits).toHaveLength(3);
    expect(source!.priorities).toHaveLength(2);
  });
});
