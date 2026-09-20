import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * The entitlement boundary.
 *
 * Three properties matter more than the numbers: **no row means Free**, so
 * introducing plans changed nobody; **expiry is applied once**, in the shared
 * rule, so an expired grant cannot read as Pro on one screen and Free to a
 * feature; and **admin bypass lives centrally**, so no feature ever branches on
 * a role.
 *
 * Phase 4 establishes the policy and enforces nothing. The last describe block
 * is what keeps that true.
 */

const state = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock("@/lib/db/pool", () => ({
  query: async () => state.rows,
  transaction: async () => { throw new Error("getActor must not open a transaction"); },
}));

const {
  FREE_LIMITS, effectivePlan, entitlements, limitFor,
} = await import("../src/lib/entitlements");
const { getActor } = await import("../src/lib/entitlements/actor");

const USER = "11111111-1111-4111-8111-111111111111";
const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

describe("effectivePlan — the one rule for “is this Pro today”", () => {
  it("treats a missing row as free", () => {
    expect(effectivePlan(null)).toBe("free");
    expect(effectivePlan(undefined)).toBe("free");
  });

  it("treats a stored free row as free", () => {
    expect(effectivePlan({ plan: "free", expires_at: null })).toBe("free");
  });

  it("treats pro with no expiry as pro — what Grandfathered Pro holds", () => {
    expect(effectivePlan({ plan: "pro", expires_at: null })).toBe("pro");
  });

  it("treats pro with a future expiry as pro, and a past one as free", () => {
    expect(effectivePlan({ plan: "pro", expires_at: future })).toBe("pro");
    expect(effectivePlan({ plan: "pro", expires_at: past })).toBe("free");
  });

  it("decides on an instant that can be supplied, so expiry is testable", () => {
    const boundary = "2026-09-20T00:00:00Z";
    expect(effectivePlan({ plan: "pro", expires_at: boundary }, new Date("2026-09-19T23:59:59Z"))).toBe("pro");
    expect(effectivePlan({ plan: "pro", expires_at: boundary }, new Date("2026-09-20T00:00:01Z"))).toBe("free");
  });
});

describe("getActor — resolved from the database, never from a request", () => {
  const actorWith = async (row: Record<string, unknown> | null) => {
    state.rows = row ? [row] : [];
    return getActor(USER);
  };

  it("is Free when the account has no plan row", async () => {
    const actor = await actorWith({ role: "user", plan: null, source: null, expires_at: null });
    expect(actor).toEqual({ userId: USER, plan: "free", source: null, isAdmin: false });
  });

  it("is Pro for a permanent grandfathered grant", async () => {
    const actor = await actorWith({ role: "user", plan: "pro", source: "grandfathered", expires_at: null });
    expect(actor.plan).toBe("pro");
    expect(actor.source).toBe("grandfathered");
  });

  it("is Free for an expired grant, but keeps the source so a screen can explain why", async () => {
    const actor = await actorWith({ role: "user", plan: "pro", source: "trial", expires_at: past });
    expect(actor.plan).toBe("free");
    expect(actor.source).toBe("trial");
  });

  it("reads admin from the role column", async () => {
    const actor = await actorWith({ role: "admin", plan: null, source: null, expires_at: null });
    expect(actor.isAdmin).toBe(true);
    expect(actor.plan).toBe("free");   // an admin needs no plan row to be unlimited
  });

  it("falls back to the least privileged answer for an account it cannot read", async () => {
    const actor = await actorWith(null);
    expect(actor).toEqual({ userId: USER, plan: "free", source: null, isAdmin: false });
  });
});

describe("the policy", () => {
  const actor = (over: Partial<Awaited<ReturnType<typeof getActor>>> = {}) =>
    ({ userId: USER, plan: "free" as const, source: null, isAdmin: false, ...over });

  it("gives Free 15 active habits and 5 new priorities a day", () => {
    expect(entitlements(actor())).toEqual({ activeHabits: 15, newPrioritiesPerDay: 5 });
    expect(limitFor(actor(), "activeHabits")).toBe(15);
    expect(limitFor(actor(), "newPrioritiesPerDay")).toBe(5);
    expect(FREE_LIMITS).toEqual({ activeHabits: 15, newPrioritiesPerDay: 5 });
  });

  it("gives Pro no limits", () => {
    const pro = actor({ plan: "pro", source: "grandfathered" });
    expect(entitlements(pro)).toEqual({ activeHabits: null, newPrioritiesPerDay: null });
    expect(limitFor(pro, "activeHabits")).toBeNull();
  });

  it("gives an admin no limits, whatever their plan row says", () => {
    for (const plan of ["free", "pro"] as const) {
      const admin = actor({ isAdmin: true, plan });
      expect(limitFor(admin, "activeHabits"), plan).toBeNull();
      expect(limitFor(admin, "newPrioritiesPerDay"), plan).toBeNull();
    }
  });

  it("says unlimited with null — never 0, never Infinity", () => {
    const pro = actor({ plan: "pro", source: "gifted" });
    for (const v of Object.values(entitlements(pro))) {
      expect(v).toBeNull();
      expect(v).not.toBe(0);
      expect(Number.isFinite(v as unknown as number)).toBe(false);
    }
    // 0 meaning two things is the bug Phase 2 fixed; it must not return here.
    expect(JSON.stringify(entitlements(pro))).toBe('{"activeHabits":null,"newPrioritiesPerDay":null}');
  });

  it("is pure: the same actor always answers the same", () => {
    const a = actor({ plan: "pro", source: "support" });
    expect(entitlements(a)).toEqual(entitlements(a));
  });
});

/* ───────────────── the boundary, and the absence of enforcement ───────────── */

const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
/**
 * Source with comments removed, so these guards measure code rather than
 * commentary. Several of the files below *explain* that they read no plan table
 * and hold no billing field; a promise of absence must not read as the thing
 * itself — the same trap the Phase 3 privacy detector fell into.
 */
const stripComments = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
  .replace(/^\s*--[^\n]*$/gm, " ");
const code = (f: string) => stripComments(read(f));
const walk = (dir: string): string[] => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]))
  .filter((f) => /\.(ts|tsx)$/.test(f));

describe("the entitlement boundary is the only way in", () => {
  it("only the entitlement module and the admin listing read user_plans", () => {
    // Code only: index.ts names the table in a comment forbidding exactly this.
    const readers = walk("src").filter((f) => /user_plans/.test(code(f)));
    expect(readers.sort()).toEqual([
      path.join("src", "lib", "analytics", "queries.ts"),
      path.join("src", "lib", "entitlements", "actor.ts"),
    ]);
    // The stripper must not be hiding a real read behind a comment.
    expect(stripComments("/* user_plans */ select 1")).not.toMatch(/user_plans/);
    expect(stripComments("select * from user_plans -- x")).toMatch(/user_plans/);
  });

  it("no feature route resolves a plan for itself", () => {
    const offenders = walk(path.join("src", "app", "api"))
      .filter((f) => /user_plans|effectivePlan|\bplan === |source === /.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("the admin plan badge decides nothing — no database, no environment", () => {
    const src = read(path.join("src", "lib", "admin", "plan.ts"));
    expect(src).not.toMatch(/@\/lib\/db|process\.env|user_plans/);
    // It words the answer the entitlement module already gave.
    expect(src).toMatch(/from "@\/lib\/entitlements"/);
  });

  it("carries no billing, payment or provider field anywhere", () => {
    const BILLING = /stripe|customer_id|subscription|invoice|checkout|price_/i;

    for (const f of [...walk(path.join("src", "lib", "entitlements")),
      path.join("src", "lib", "admin", "plan.ts"),
      path.join("scripts", "migrations", "user-plans.mjs")]) {
      expect(code(f), f).not.toMatch(BILLING);
    }
    // The detector still catches a real reference in code, not just in prose.
    expect(stripComments("const c = stripe.customers.create()")).toMatch(BILLING);
    expect(stripComments("/* no stripe here */ const x = 1;")).not.toMatch(BILLING);
  });
});

/**
 * Phase 5 turned enforcement on, so the four assertions that used to stand here
 * — no caller of `limitFor`, no entitlement reference in the priority path, no
 * `priority_quota_usage` — are now false by design. They are **inverted rather
 * than deleted**: what mattered about them was never "nothing enforces", it was
 * "enforcement cannot leak out of the entitlement boundary", and that is still
 * the property worth failing a build over.
 */
describe("Phase 5 enforces the policy in exactly two write paths", () => {
  const queries = () => read(path.join("src", "lib", "db", "queries.ts"));
  const QUERIES = path.join("src", "lib", "db", "queries.ts");

  /** One function's body, by name. Comments kept unless a test strips them. */
  const fnBody = (src: string, name: string) => {
    const from = src.slice(src.indexOf(`function ${name}`));
    return from.slice(0, from.indexOf("\n}"));
  };

  it("saveHabit gates only a transition INTO active", () => {
    const body = stripComments(fnBody(queries(), "saveHabit"));
    expect(body).toContain("guardActiveHabitLimit");
    // The `!wasActive` half is the whole of "editing an active habit is free".
    expect(body).toMatch(/h\.status === "active" && !wasActive/);
  });

  it("the active-habit gate reads the entitlement, then locks, then counts", () => {
    const body = stripComments(fnBody(queries(), "guardActiveHabitLimit"));
    expect(body).toContain('limitFor(await getActor(userId, q), "activeHabits")');
    expect(body).toContain("pg_advisory_xact_lock");
    expect(body).toMatch(/status = 'active'/);
    expect(body).toContain("PlanLimitError");
    // Unlimited leaves before the lock is taken and before anything is counted.
    expect(body).toMatch(/if \(limit == null\) return;[\s\S]*pg_advisory_xact_lock/);
  });

  it("addPriority charges the day in the same transaction as the insert", () => {
    const body = stripComments(fnBody(queries(), "addPriority"));
    expect(body).toContain("transaction(");
    expect(body).toContain("priority_quota_usage");
    expect(body).toContain('limitFor(await getActor(userId, q), "newPrioritiesPerDay")');
    // Insert first, charge second: that ordering is what makes a retry free.
    expect(body.indexOf("insert into priorities"))
      .toBeLessThan(body.indexOf("priority_quota_usage"));
    // The retry check comes before either, and reuses the shared 404.
    expect(body).toContain('assertOwns(q, "priorities", id, userId)');
    // The allowance is never decremented, and the day is never derived here.
    expect(body).not.toMatch(/created = .*- 1|viewerToday|new Date\(/);
  });

  it("the quota day is the server's, never the client's created_on", () => {
    const route = stripComments(read(path.join("src", "app", "api", "priorities", "route.ts")));
    expect(route).toContain('viewerToday(request.headers.get("x-rh-timezone"))');
    // `date` still sets created_on; the local day is a separate argument.
    expect(route).toMatch(/addPriority\(userId, id, text, date, category,/);
  });

  it("only the two write paths can raise a plan limit", () => {
    const allowed = [QUERIES, path.join("src", "lib", "http.ts"), path.join("src", "lib", "api.ts")];
    const others = walk("src")
      .filter((f) => !allowed.includes(f))
      .filter((f) => /PlanLimitError/.test(code(f)));
    expect(others).toEqual([]);
  });

  it("entitlement logic stays centralized — nothing else resolves an actor", () => {
    const callers = walk("src")
      .filter((f) => !f.startsWith(path.join("src", "lib", "entitlements")))
      .filter((f) => f !== QUERIES)
      .filter((f) => /\blimitFor\(|\bentitlements\(|getActor\(/.test(code(f)));
    expect(callers).toEqual([]);
  });

  it("no route or component decides entitlement for itself", () => {
    /*
     * Identifiers that belong to entitlement *state*, not the English words
     * "plan" and "source". An earlier version of this guard matched `\bsource ===`
     * and flagged `p.source === "upload"` in the AI Workspace composer — a file's
     * origin, which has nothing to do with a plan. Matching a bare word here is
     * how a guard stops meaning anything: it either gets weakened until it passes
     * or it trains people to ignore it.
     */
    const ENTITLEMENT_STATE = new RegExp([
      "user_plans", "effectivePlan", "planSource",
      '\\bplan === "(pro|free)"',
      '\\bsource === "(grandfathered|purchased|gifted|promotional|trial|support)"',
      "stripe", "checkout_session", "subscription_id",
    ].join("|"), "i");

    /*
     * Admin → Users is allowed to *show* a plan. It is handed `plan` and
     * `planSource` by the listing query and turns them into a word through
     * `lib/admin/plan.ts`; it reads no database, calls no entitlement function and
     * decides nothing. Display is not a decision — and the two tests either side
     * of this one are what keep that true.
     */
    const PRESENTATION_ONLY = [
      path.join("src", "app", "admin", "users", "UsersTable.tsx"),
      path.join("src", "app", "admin", "users", "[id]", "page.tsx"),
    ];

    const offenders = [...walk(path.join("src", "app")), ...walk(path.join("src", "components"))]
      .filter((f) => !PRESENTATION_ONLY.includes(f))
      .filter((f) => ENTITLEMENT_STATE.test(code(f)));
    expect(offenders).toEqual([]);

    // The allowlisted screens present; they must not resolve or enforce.
    for (const f of PRESENTATION_ONLY) {
      expect(code(f), f).not.toMatch(/\blimitFor\(|\bentitlements\(|getActor\(|PlanLimitError/);
    }

    // The detector still catches every real leak…
    for (const leak of [
      'if (actor.plan === "pro") allow()',
      'if (row.source === "grandfathered") skip()',
      "select plan from user_plans",
      "const p = effectivePlan(row)",
      "stripe.checkout.sessions.create()",
    ]) expect(leak, leak).toMatch(ENTITLEMENT_STATE);

    // …and no longer flags words that merely look like one.
    for (const innocent of [
      'if (p.source === "upload" && p.status === "ready") attach()',
      "if (plan === current) return",
      "const source = await readFile(name)",
    ]) expect(innocent, innocent).not.toMatch(ENTITLEMENT_STATE);
  });

  it("gates nothing but active habits and new priorities", () => {
    const src = queries();
    for (const name of ["setCompletion", "saveGoal", "saveDayNote", "saveJournal", "saveSpending",
      "saveMetrics", "saveReview", "saveStack", "saveAwareness", "saveImportantDate",
      "saveIntention", "setPriorityText", "setPriorityDone", "setPriorityPlannedOn",
      "deletePriority", "reorderPriorities", "savePriorityLayout", "deleteHabit", "savePrefs"]) {
      const body = stripComments(fnBody(src, name));
      expect(body, name).not.toMatch(/PlanLimitError|limitFor|getActor|priority_quota_usage/);
    }
  });

  it("the quota migration is additive: no update, insert, delete, drop or alter", () => {
    const file = path.join("scripts", "migrations", "priority-quota-usage.mjs");
    expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
    expect(read(path.join("db", "schema.sql"))).toContain("priority_quota_usage");
    const m = stripComments(read(file));
    expect(m).not.toMatch(/\bupdate \w+ set|\binsert into|\bdelete from|\bdrop \b|\balter table/i);
    expect(m).toContain("create table if not exists priority_quota_usage");
    // The detector is real: it would catch a backfill if one were added.
    expect(stripComments("-- ok\ninsert into x (a) values (1)")).toMatch(/\binsert into/i);
  });
});
