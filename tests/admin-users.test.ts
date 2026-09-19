import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Admin → Users against a real Postgres (PGlite) built from db/schema.sql.
 *
 * `@/lib/db/pool` is routed to that database and **every statement is recorded**,
 * so the privacy checks below read the exact SQL the admin screens run rather
 * than a description of it. That recorder is the part of this suite that matters
 * most: it fails if a future column, join or convenience `select *` ever puts a
 * person's own words in front of an administrator.
 */

vi.mock("@/lib/db/pool", () => ({
  query: async (text: string, params: unknown[] = []) => {
    ((globalThis as any).__adminSql as string[]).push(text);
    return ((globalThis as any).__adminDb as PGlite).query(text, params as any[]).then((r) => r.rows);
  },
}));

import { adminUserById, adminUserIds, adminUsers, userProfile } from "../src/lib/analytics/queries";
import { planBadge, planText } from "../src/lib/admin/plan";
import { accomplishedBetween } from "../src/lib/accomplishments";

const SCHEMA = fs.readFileSync(path.resolve(__dirname, "..", "db", "schema.sql"), "utf8");
const RUN = randomUUID().slice(0, 8);
const issued: string[] = [];

let db: PGlite;
const sql = async (text: string, params: unknown[] = []) => (await db.query<any>(text, params as any[])).rows;

/** Private text planted everywhere; none of it may ever come back. */
const SECRET = (what: string) => `SECRET-${what}-${RUN}`;

async function account(
  label: string,
  opts: { role?: "user" | "admin"; via?: string | null; createdAt?: string } = {},
) {
  const [row] = await sql(
    `insert into users (email, password_hash, role, created_via, created_at)
     values ($1, 'x', $2, $3, coalesce($4::timestamptz, now())) returning id`,
    [`${label}-${RUN}@example.com`, opts.role ?? "user", opts.via ?? "self_signup", opts.createdAt ?? null]);
  return row.id as string;
}
const habit = async (userId: string, status: string) =>
  (await sql(`insert into habits (user_id, name, description, anchor, category, status)
              values ($1, $2, $3, $4, 'morning', $5) returning id`,
  [userId, SECRET("habit-name"), SECRET("habit-description"), SECRET("anchor"), status]))[0].id as string;
const complete = (userId: string, habitId: string, day: string) =>
  sql(`insert into habit_completions (habit_id, user_id, done_on, note) values ($1, $2, $3, $4)`,
    [habitId, userId, day, SECRET("completion-note")]);
const priority = async (userId: string, completedOn: string | null) =>
  (await sql(`insert into priorities (user_id, body, created_on, completed_on)
              values ($1, $2, '2026-09-01', $3) returning id`,
  [userId, SECRET("priority-body"), completedOn]))[0].id as string;
const importantDate = (userId: string) =>
  sql(`insert into important_dates (user_id, title, starts_on, ends_on, note)
       values ($1, $2, '2026-10-01', '2026-10-03', $3)`,
  [userId, SECRET("date-title"), SECRET("date-note")]);
const event = (userId: string | null, name: string) =>
  sql(`insert into analytics_events (user_id, event_name) values ($1, $2)`, [userId, name]);

const find = async (userId: string) => {
  const page = await adminUsers({ search: RUN, pageSize: 200 });
  const row = page.rows.find((r) => r.id === userId);
  expect(row, "the account is listed").toBeDefined();
  return row!;
};

let busy: string, idle: string, starter: string, admin: string;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SCHEMA);
  (globalThis as any).__adminDb = db;
  (globalThis as any).__adminSql = issued;

  busy = await account("busy", { createdAt: "2026-08-01T00:00:00Z" });
  idle = await account("idle", { via: "test", createdAt: "2026-08-02T00:00:00Z" });
  starter = await account("starter", { createdAt: "2026-08-03T00:00:00Z" });
  admin = await account("admin", { role: "admin", via: "admin", createdAt: "2026-08-04T00:00:00Z" });

  // busy: 3 habits on the sheet and 4 that are not.
  const active = [await habit(busy, "active"), await habit(busy, "active"), await habit(busy, "active")];
  const retired = await habit(busy, "retired");
  for (const s of ["paused", "candidate", "recommended"]) await habit(busy, s);
  await complete(busy, active[0], "2026-09-10");
  await complete(busy, active[0], "2026-09-11");
  await complete(busy, active[1], "2026-09-11");
  await complete(busy, active[2], "2026-09-12");
  await complete(busy, retired, "2026-08-20");   // history on a since-retired habit still counts
  for (const done of ["2026-09-05", "2026-09-06", null, null, null]) await priority(busy, done);
  await importantDate(busy);
  await importantDate(busy);
  await event(busy, "intention_started");
  await event(busy, "intention_completed");
  await event(busy, "app_opened");
  // A second active day, so "Most active" has a clear leader rather than a tie.
  await sql(`insert into analytics_events (user_id, event_name, occurred_at)
             values ($1, 'app_opened', now() - interval '2 days')`, [busy]);
  await sql(`insert into user_sessions (user_id) values ($1), ($1)`, [busy]);

  /* Private content in tables the admin screens must never read, including an
     analytics event whose properties carry text. */
  await sql(`insert into intentions (user_id, want, why_chain, ownership, ownership_note, vision, step, completed_at)
             values ($1, $2, array[$3], 'mine', $4, array[$5], 5, now())`,
  [busy, SECRET("want"), SECRET("why"), SECRET("ownership-note"), SECRET("vision")]);
  await sql(`insert into goals (user_id, name, why) values ($1, $2, $3)`, [busy, SECRET("goal"), SECRET("goal-why")]);
  await sql(`insert into weekly_reviews (user_id, week_start, went_well) values ($1, '2026-09-07', $2)`,
    [busy, SECRET("review")]);
  await sql(`insert into monthly_reflections (user_id, month, body) values ($1, '2026-08', $2)`,
    [busy, SECRET("reflection")]);
  await sql(`insert into day_notes (user_id, note_date, body, gratitude)
             values ($1, '2026-09-10', $2, array[$3])`,
  [busy, SECRET("journal-body"), SECRET("gratitude")]);
  await sql(`insert into analytics_events (user_id, event_name, properties)
             values ($1, 'habit_created', $2::jsonb)`,
  [busy, JSON.stringify({ secret: SECRET("event-properties") })]);

  // starter: a started intention, one open priority, only a proposed habit.
  await habit(starter, "recommended");
  await priority(starter, null);
  await event(starter, "intention_started");

  // An event detached from a deleted account belongs to nobody.
  await event(null, "intention_completed");
});

afterAll(async () => { await db.close(); });

describe("Admin → Users product metrics", () => {
  it("counts active habits only, and every completion row", async () => {
    const row = await find(busy);
    expect(row.activeHabits).toBe(3);
    expect(row.completions).toBe(5);
    expect((await find(starter)).activeHabits).toBe(0);
  });

  it("counts priorities, the open ones, and accomplishments by the completed_on rule", async () => {
    const row = await find(busy);
    expect(row.priorities).toBe(5);
    expect(row.openPriorities).toBe(3);
    expect(row.accomplishments).toBe(2);
    // Total is the sum of the two halves, always.
    expect(row.openPriorities + row.accomplishments).toBe(row.priorities);

    // The same number the shared Insights / Community rule gives for all time.
    const rows = await sql(`select completed_on::text as "completedOn" from priorities where user_id = $1`, [busy]);
    expect(accomplishedBetween(rows as any, "0000-01-01", "9999-12-31").length).toBe(row.accomplishments);

    const starterRow = await find(starter);
    expect([starterRow.priorities, starterRow.openPriorities, starterRow.accomplishments]).toEqual([1, 1, 0]);
  });

  it("follows reopening and deleting a completed priority", async () => {
    const reopened = await priority(busy, "2026-09-07");
    expect((await find(busy)).accomplishments).toBe(3);
    await sql(`update priorities set completed_on = null where id = $1`, [reopened]);
    const open = await find(busy);
    expect([open.accomplishments, open.openPriorities]).toEqual([2, 4]);
    await sql(`delete from priorities where id = $1`, [reopened]);
    const row = await find(busy);
    expect([row.priorities, row.openPriorities, row.accomplishments]).toEqual([5, 3, 2]);
  });

  it("derives intention status from the intention events, never the intentions table", async () => {
    expect((await find(busy)).intention).toBe("completed");
    expect((await find(starter)).intention).toBe("started");
    expect((await find(idle)).intention).toBe("none");
  });

  it("counts important dates and sessions", async () => {
    const row = await find(busy);
    expect(row.importantDates).toBe(2);
    expect(row.sessions).toBe(2);
    expect((await find(idle)).importantDates).toBe(0);
  });

  it("counts active days as distinct UTC days with a tracked event", async () => {
    expect((await find(busy)).activeDays).toBe(2);
    expect((await find(idle)).activeDays).toBe(0);
  });

  it("shows zeros, not gaps, for an account that has done nothing", async () => {
    const row = await find(idle);
    expect([row.activeDays, row.sessions, row.activeHabits, row.completions,
      row.priorities, row.openPriorities, row.accomplishments, row.importantDates])
      .toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(row.lastActive).toBeNull();
    expect(row.intention).toBe("none");
  });

  it("has no trace of the legacy Goals and Reviews columns", async () => {
    const row = await find(busy) as unknown as Record<string, unknown>;
    expect("goals" in row).toBe(false);
    expect("reviews" in row).toBe(false);
    expect("habits" in row).toBe(false);   // renamed to activeHabits, and redefined
  });
});

describe("the Plan column", () => {
  it("is Admin for an administrator and Free for everyone else", async () => {
    expect(planText(planBadge(await find(admin)))).toBe("Admin");
    expect(planText(planBadge(await find(busy)))).toBe("Free");
    expect(planText(planBadge(await find(idle)))).toBe("Free");
  });

  it("carries a tooltip, and renders a future source without a layout change", () => {
    expect(planBadge({ role: "user" }).title).toBeTruthy();
    expect(planText({ label: "Pro", source: "Grandfathered", title: "x" })).toBe("Pro · Grandfathered");
  });

  it("resolves nothing: it reads the role and consults no entitlement store", async () => {
    const src = fs.readFileSync(path.resolve(__dirname, "..", "src", "lib", "admin", "plan.ts"), "utf8");
    expect(src).not.toMatch(/user_plans|priority_quota|ai_usage|stripe|subscription/i);
    // No database, no environment: a pure function of the role.
    expect(src).not.toMatch(/from "@\/lib\/db|process\.env/);
  });
});

describe("Admin → Users listing behaviour is unchanged", () => {
  it("filters by role, source and status, and sorts", async () => {
    const admins = await adminUsers({ search: RUN, role: "admin" });
    expect(admins.rows.map((r) => r.id)).toEqual([admin]);
    const tests = await adminUsers({ search: RUN, source: "test" });
    expect(tests.rows.map((r) => r.id)).toEqual([idle]);

    const newest = await adminUsers({ search: RUN, sort: "newest" });
    expect(newest.rows.map((r) => r.id)).toEqual([admin, starter, idle, busy]);
    const oldest = await adminUsers({ search: RUN, sort: "oldest" });
    expect(oldest.rows.map((r) => r.id)).toEqual([busy, idle, starter, admin]);
    expect((await adminUsers({ search: RUN, sort: "active" })).rows[0].id).toBe(busy);

    await sql(`update users set disabled_at = now() where id = $1`, [idle]);
    expect((await adminUsers({ search: RUN, status: "disabled" })).rows.map((r) => r.id)).toEqual([idle]);
    expect((await adminUsers({ search: RUN, status: "active" })).total).toBe(3);
    await sql(`update users set disabled_at = null where id = $1`, [idle]);
  });

  it("sorts by the adoption columns, most first", async () => {
    for (const sort of ["habits", "completions", "priorities", "accomplishments", "sessions"] as const) {
      const page = await adminUsers({ search: RUN, sort });
      expect(page.rows[0].id, sort).toBe(busy);
      expect(page.rows.map((r) => r.id).sort()).toEqual([busy, idle, starter, admin].sort());
    }
  });

  it("pages, and finds one account by id", async () => {
    const page = await adminUsers({ search: RUN, pageSize: 10 });
    expect(page.total).toBe(4);
    const one = await adminUserById(busy);
    expect(one?.priorities).toBe(5);
    const profile = await userProfile(busy);
    expect(profile?.intention).toBe("completed");
    expect(profile?.features).toBeDefined();
  });
});

/**
 * The id-only query is a different statement from the listing, so the one thing
 * that can go wrong is the two disagreeing about which accounts a filter matches
 * — "select all matching" ticking something the list never showed, or missing
 * something it did.
 */
describe("adminUserIds matches the listing, filter for filter", () => {
  const listed = async (q: Parameters<typeof adminUsers>[0]) =>
    (await adminUsers({ ...q, pageSize: 200 })).rows.map((r) => r.id).sort();

  it("returns exactly the ids the listing returns, for every filter combination", async () => {
    const combinations: Parameters<typeof adminUsers>[0][] = [
      { search: RUN },
      { search: RUN, role: "admin" },
      { search: RUN, role: "user" },
      { search: RUN, status: "active" },
      { search: RUN, status: "pending" },
      { search: RUN, status: "disabled" },
      { search: RUN, source: "test" },
      { search: RUN, source: "real" },
      { search: RUN, source: "unclassified" },
      { search: RUN, kind: "email" },
      { search: RUN, kind: "username" },
      { search: RUN, role: "user", status: "active", source: "real", kind: "email" },
    ];
    for (const q of combinations) {
      expect((await adminUserIds(q)).sort(), JSON.stringify(q)).toEqual(await listed(q));
    }
  });

  it("agrees with the listing's own total", async () => {
    const page = await adminUsers({ search: RUN, pageSize: 10 });
    expect((await adminUserIds({ search: RUN })).length).toBe(page.total);
  });

  it("still matches once an account is disabled", async () => {
    await sql(`update users set disabled_at = now() where id = $1`, [starter]);
    for (const q of [{ search: RUN, status: "active" as const }, { search: RUN, status: "disabled" as const }]) {
      expect((await adminUserIds(q)).sort()).toEqual(await listed(q));
    }
    await sql(`update users set disabled_at = null where id = $1`, [starter]);
  });

  it("does not compute the adoption aggregates merely to list ids", async () => {
    issued.length = 0;
    await adminUserIds({ search: RUN });
    // One statement, and it joins nothing it does not need.
    expect(issued).toHaveLength(1);
    const text = issued[0].toLowerCase();
    for (const table of ["habit_completions", "priorities", "important_dates", "user_sessions", "analytics_events"]) {
      expect(text, table).not.toContain(table);
    }
    expect(text).toContain("select u.id");
  });
});

/* ───────────────────────── privacy boundary ───────────────────────── */

/** Columns that hold what a person wrote, or AI Workspace content. */
const PROHIBITED_COLUMNS = new Set([
  "name", "description", "anchor", "environment", "friction", "rationale", "note",
  "body", "title",
  "want", "why_chain", "ownership", "ownership_note", "vision",
  "went_well", "got_in_way", "focus_next", "modify", "add_or_drop", "stats",
  "content", "original_filename", "instructions", "properties",
  "gratitude", "reflection",
]);
/** Tables that are private content in their entirety. */
const PROHIBITED_TABLES = new Set([
  "intentions", "goals", "weekly_reviews", "monthly_reflections", "day_notes",
  "habit_awareness_entries", "daily_metrics", "spending_records", "feedback",
]);

/**
 * Every prohibited identifier a statement mentions, plus any star select.
 *
 * String literals and SQL comments are removed first. Both are prose rather than
 * schema: `where event_name = 'note'` selects no note, and a `-- the intentions
 * table is not read` comment is a promise about the query, not a breach of it.
 * Stripping them is what keeps this detector strict about code while allowing the
 * SQL to explain itself — and the negative controls below prove a real leak
 * hidden in either position is still caught.
 */
function prohibitedIn(statement: string): string[] {
  const text = statement.toLowerCase()
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  const found = new Set<string>();
  for (const token of text.match(/[a-z_][a-z0-9_]*/g) ?? []) {
    if (PROHIBITED_COLUMNS.has(token) || PROHIBITED_TABLES.has(token) || token.startsWith("ai_")) found.add(token);
  }
  if (/select\s+\*|\.\*|,\s*\*/.test(text)) found.add("*");
  return [...found];
}

describe("Admin → Users privacy boundary", () => {
  it("the detector itself catches content being selected", () => {
    expect(prohibitedIn("select h.name from habits h")).toContain("name");
    expect(prohibitedIn("select body from priorities")).toContain("body");
    expect(prohibitedIn("select i.want, i.vision from intentions i")).toEqual(
      expect.arrayContaining(["want", "vision", "intentions"]));
    expect(prohibitedIn("select title, note from important_dates")).toEqual(
      expect.arrayContaining(["title", "note"]));
    expect(prohibitedIn("select d.* from important_dates d")).toContain("*");
    expect(prohibitedIn("select content from ai_messages")).toEqual(
      expect.arrayContaining(["content", "ai_messages"]));
    expect(prohibitedIn("select properties from analytics_events")).toContain("properties");
    expect(prohibitedIn("select gratitude from day_notes")).toEqual(
      expect.arrayContaining(["gratitude", "day_notes"]));
    // The permitted shapes must not trip it.
    expect(prohibitedIn("select count(*) from priorities where completed_on is not null")).toEqual([]);
    expect(prohibitedIn("select 1 where event_name = 'note'")).toEqual([]);
    expect(prohibitedIn("select count(*) filter (where status = 'active') from habits")).toEqual([]);
    // A comment may name a table to explain that it is NOT read.
    expect(prohibitedIn("select 1 -- the intentions table is not read")).toEqual([]);
    expect(prohibitedIn("select 1 /* not from day_notes either */")).toEqual([]);

    /* …but stripping comments must not become a way to smuggle a leak past the
       detector. A real selection on the same line as a comment is still caught,
       and so is one after a comment ends. */
    expect(prohibitedIn("select i.want from intentions i -- harmless")).toEqual(
      expect.arrayContaining(["want", "intentions"]));
    expect(prohibitedIn("select 1 -- a note\nunion all select body from priorities")).toContain("body");
    expect(prohibitedIn("select /* x */ title from important_dates")).toContain("title");
  });

  it("no statement the users list, ids, detail page or profile runs names private content", async () => {
    issued.length = 0;
    await adminUsers({ search: RUN });
    await adminUsers({ search: RUN, sort: "least_active", role: "user", status: "pending", kind: "email", source: "real" });
    for (const sort of ["habits", "completions", "priorities", "accomplishments", "sessions", "newest", "oldest", "last_active", "active"] as const) {
      await adminUsers({ search: RUN, sort });
    }
    await adminUserIds({ search: RUN });
    await adminUserIds({ search: RUN, status: "disabled", source: "test" });
    await adminUserById(busy);
    await userProfile(busy);
    expect(issued.length).toBeGreaterThan(0);
    for (const statement of issued) {
      expect(prohibitedIn(statement), statement).toEqual([]);
    }
  });

  it("returns only approved fields, and no private text", async () => {
    const page = await adminUsers({ search: RUN, pageSize: 200 });
    const profile = await userProfile(busy);
    expect(Object.keys(page.rows[0]).sort()).toEqual([
      "accomplishments", "activeDays", "activeHabits", "address", "completions", "createdAt",
      "createdVia", "disabledAt", "displayName", "email", "emailVerifiedAt", "firstActive",
      "firstName", "id", "importantDates", "intention", "lastActive", "lastName",
      "openPriorities", "priorities", "role", "sessions", "status", "username",
      "verificationRequired",
    ]);
    // Everything planted in the fixtures, in one assertion.
    expect(JSON.stringify({ page, profile })).not.toContain("SECRET");
  });
});
