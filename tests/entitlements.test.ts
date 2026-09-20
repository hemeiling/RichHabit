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

describe("Phase 4 establishes the policy and enforces nothing", () => {
  it("no route calls limitFor or entitlements yet", () => {
    const callers = walk(path.join("src", "app"))
      .filter((f) => /\blimitFor\(|\bentitlements\(|getActor\(/.test(read(f)));
    expect(callers).toEqual([]);
  });

  it("nothing refuses a request on a plan", () => {
    const offenders = walk(path.join("src", "app", "api"))
      .filter((f) => /limitFor|FREE_LIMITS|activeHabits >|newPrioritiesPerDay/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("the priority write path is untouched by plans", () => {
    const route = read(path.join("src", "app", "api", "priorities", "route.ts"));
    expect(route).not.toMatch(/entitlement|limitFor|getActor|quota|user_plans/i);

    const queries = read(path.join("src", "lib", "db", "queries.ts"));
    const addPriority = queries.slice(queries.indexOf("export async function addPriority"));
    const body = addPriority.slice(0, addPriority.indexOf("\n}"));
    /* Identifiers, not substrings: `planned_on` is a legitimate column in this
       function and contains "plan". What must be absent is quota accounting and
       any entitlement lookup. */
    expect(body).not.toMatch(/priority_quota_usage|\bquota\b|limitFor|getActor|entitlements\(|user_plans/i);
    // And it must still be a single statement, not a transaction — Phase 5's job.
    expect(body).not.toContain("transaction(");
  });

  it("priority_quota_usage does not exist yet — that is Phase 5", () => {
    expect(fs.existsSync(path.join(ROOT, "scripts", "migrations", "priority-quota-usage.mjs"))).toBe(false);
    expect(read(path.join("db", "schema.sql"))).not.toContain("priority_quota_usage");
  });
});
