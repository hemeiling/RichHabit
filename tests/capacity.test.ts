import { describe, expect, it, vi } from "vitest";
import { en } from "../src/lib/i18n/en";
import { zh } from "../src/lib/i18n/zh";

/**
 * The predicate lives in SQL, so what is testable here is the vocabulary and
 * the shape of the rule. The counting and the race are proved against a real
 * Postgres in the browser suite.
 */
describe("who occupies a place", () => {
  it("is expressed once, and excludes admins", async () => {
    const { OCCUPIES_A_SLOT } = await import("../src/lib/db/capacity");
    expect(OCCUPIES_A_SLOT).toContain("disabled_at is null");
    expect(OCCUPIES_A_SLOT).toContain("role <> 'admin'");
  });

  /**
   * The invariant that makes grandfathering hold. The predicate reads a column
   * on the account, never the environment variable — so it is the same string
   * whatever REQUIRE_EMAIL_VERIFICATION is set to, and an account that predates
   * verification (verification_required false) is counted either way.
   *
   * The earlier design interpolated the flag into this string, which meant
   * turning verification on would have stopped counting every existing user at
   * once: nine accounts with an address and no verified date would have dropped
   * out of the total and freed nine places that were not free.
   */
  it("is the same predicate whether or not verification is required", async () => {
    vi.resetModules();
    process.env.REQUIRE_EMAIL_VERIFICATION = "false";
    const off = (await import("../src/lib/db/capacity")).OCCUPIES_A_SLOT;

    vi.resetModules();
    process.env.REQUIRE_EMAIL_VERIFICATION = "true";
    const on = (await import("../src/lib/db/capacity")).OCCUPIES_A_SLOT;

    // Both env.ts and capacity.ts were loaded with the flag on; drop them so
    // the next test does not inherit it.
    delete process.env.REQUIRE_EMAIL_VERIFICATION;
    vi.resetModules();

    expect(on).toBe(off);
    expect(on).toContain("not verification_required or email_verified_at is not null");
  });

  it("counts a grandfathered account and not a pending one", async () => {
    const { OCCUPIES_A_SLOT, AWAITING_VERIFICATION } =
      await import("../src/lib/db/capacity");

    /** A tiny evaluator for the two predicates, over one account's columns. */
    const holds = (sql: string, u: Record<string, unknown>) => {
      const expr = sql
        .replace(/disabled_at is null/g, String(u.disabled_at === null))
        .replace(/role <> 'admin'/g, String(u.role !== "admin"))
        .replace(/not verification_required/g, String(!u.verification_required))
        .replace(/verification_required/g, String(Boolean(u.verification_required)))
        .replace(/email_verified_at is not null/g, String(u.email_verified_at !== null))
        .replace(/email_verified_at is null/g, String(u.email_verified_at === null))
        .replace(/\band\b/g, "&&").replace(/\bor\b/g, "||");
      return Boolean(new Function(`return (${expr})`)());
    };

    const grandfathered = {
      disabled_at: null, role: "user",
      verification_required: false, email_verified_at: null,
    };
    const pending = {
      disabled_at: null, role: "user",
      verification_required: true, email_verified_at: null,
    };
    const verified = {
      disabled_at: null, role: "user",
      verification_required: true, email_verified_at: "2026-08-16",
    };
    const admin = { ...pending, role: "admin" };

    // The whole grandfathering rule in one assertion: an account from before
    // verification existed keeps its place and is never counted as pending.
    expect(holds(OCCUPIES_A_SLOT, grandfathered)).toBe(true);
    expect(holds(AWAITING_VERIFICATION, grandfathered)).toBe(false);

    expect(holds(OCCUPIES_A_SLOT, pending)).toBe(false);
    expect(holds(AWAITING_VERIFICATION, pending)).toBe(true);

    expect(holds(OCCUPIES_A_SLOT, verified)).toBe(true);
    expect(holds(AWAITING_VERIFICATION, verified)).toBe(false);

    // Admins are exempt from the cap and from the pending list alike.
    expect(holds(OCCUPIES_A_SLOT, admin)).toBe(false);
    expect(holds(AWAITING_VERIFICATION, admin)).toBe(false);
  });
});

/**
 * The limit is configuration, and 0 is a real setting.
 *
 * It used to be read through the shared `num` helper, which rejects anything
 * `<= 0` and falls back — so `EARLY_ACCESS_USER_LIMIT=0` quietly meant *fifty*
 * and the cap could not be switched off at all. It now has its own parser;
 * `num` is unchanged, because for every other value it reads (pool sizes, TTLs,
 * password bounds, AI allowances) 0 is nonsense and the fallback is the safety
 * net.
 */
describe("the limit is configuration, and 0 means unlimited", () => {
  const withEnv = async (value: string | undefined) => {
    const before = process.env.EARLY_ACCESS_USER_LIMIT;
    if (value === undefined) delete process.env.EARLY_ACCESS_USER_LIMIT;
    else process.env.EARLY_ACCESS_USER_LIMIT = value;
    const { capacity } = await import("../src/lib/env");
    const limit = capacity.limit;   // a getter: read now, not frozen at import
    if (before === undefined) delete process.env.EARLY_ACCESS_USER_LIMIT;
    else process.env.EARLY_ACCESS_USER_LIMIT = before;
    return limit;
  };

  it("is unlimited when the variable is not set — the shipped default", async () => {
    expect(await withEnv(undefined)).toBe(0);
  });

  it("is unlimited for an empty value", async () => {
    expect(await withEnv("")).toBe(0);
  });

  it("treats 0 as unlimited rather than falling back to a number", async () => {
    expect(await withEnv("0")).toBe(0);
  });

  it("enforces a positive whole number", async () => {
    expect(await withEnv("50")).toBe(50);
    expect(await withEnv("1")).toBe(1);
    expect(await withEnv("250")).toBe(250);
  });

  it("falls open to unlimited for a negative value", async () => {
    // A cap is a restriction; a typo must not close the door on everyone.
    expect(await withEnv("-5")).toBe(0);
  });

  it("falls open to unlimited for anything that is not a whole number", async () => {
    for (const bad of ["abc", "12.5", "1e3.5", "fifty", " ", "NaN", "Infinity"]) {
      expect(await withEnv(bad), bad).toBe(0);
    }
  });

  it("does not weaken the shared parser, which still refuses 0", async () => {
    const src = await import("node:fs")
      .then((fs) => fs.readFileSync("src/lib/env.ts", "utf8"));
    const num = src.slice(src.indexOf("function num("), src.indexOf("\n}", src.indexOf("function num(")));
    expect(num).toContain("parsed <= 0");
    // And capacity no longer goes through it.
    expect(src).not.toMatch(/num\("EARLY_ACCESS_USER_LIMIT"/);
  });

  it("does not require email verification unless it is switched on", async () => {
    const { capacity } = await import("../src/lib/env");
    expect(capacity.requireEmailVerification).toBe(false);
  });
});

/**
 * Disabling the limit must not have deleted the machinery that enforces one.
 * Everything here is what a future cap depends on.
 */
describe("the capacity capability survives the limit being off", () => {
  const read = async () => (await import("node:fs"))
    .readFileSync("src/lib/db/capacity.ts", "utf8");

  it("keeps every helper the enforcement paths use", async () => {
    const src = await read();
    for (const fn of ["withCapacityLock", "withReservedSlot", "withCapacityFor",
      "withRoleLock", "currentCapacity", "OCCUPIES_A_SLOT", "AWAITING_VERIFICATION"]) {
      expect(src, fn).toContain(`export ${fn.startsWith("with") || fn === "currentCapacity" ? "async function" : "const"} ${fn}`);
    }
  });

  it("keeps the advisory lock, so a positive limit is still race-safe", async () => {
    const src = await read();
    expect(src).toContain("pg_advisory_xact_lock");
    expect(src.match(/^const \w*LOCK = /gm)?.length ?? 0).toBe(1);
  });

  it("still short-circuits when there is no limit, rather than counting", async () => {
    const src = await read();
    // Two roomFor implementations, each returning true before touching the
    // database when the limit is off.
    expect(src.match(/if \(capacity\.limit <= 0 \|\| n <= 0\) return true;/g)).toHaveLength(2);
  });

  it("keeps the refusal path a sign-up depends on", async () => {
    const signup = await import("node:fs")
      .then((fs) => fs.readFileSync("src/app/api/auth/signup/route.ts", "utf8"));
    expect(signup).toContain("withReservedSlot");
    expect(signup).toContain("status: 409");
    expect(signup).toContain("full: true");
  });

  it("keeps the verification redemption's full outcome", async () => {
    const verify = await import("node:fs")
      .then((fs) => fs.readFileSync("src/lib/email/verify.ts", "utf8"));
    expect(verify).toContain("withCapacityLock");
    expect(verify).toMatch(/status: "full"/);
  });

  it("keeps the admin refusals and the last-admin protection", async () => {
    const admin = await import("node:fs")
      .then((fs) => fs.readFileSync("src/lib/admin/users.ts", "utf8"));
    expect(admin).toContain("withCapacityFor");
    expect(admin).toContain("withRoleLock");
    expect(admin).toMatch(/Early access is full/);
    expect(admin).toMatch(/last active admin/);
  });
});

/**
 * The full message is dormant while no limit is set, and it must name no
 * number: the number is configuration, so copy that quotes one goes stale the
 * moment it changes.
 */
describe("the full message", () => {
  it("explains a pause without naming a number, in English", () => {
    expect(en.earlyAccess.fullTitle).toBe("RichHabit Early Access Is Full");
    expect(en.earlyAccess.fullBody).toContain("Sign-ups are paused");
    expect(en.earlyAccess.fullBody).toContain("Please check back later");
    expect(en.earlyAccess.fullBody).not.toMatch(/\b50\b|first 50/);
  });

  it("explains a pause without naming a number, in Chinese", () => {
    expect(zh.earlyAccess.fullTitle).toBe("「养成富有的习惯」早期体验名额已满");
    expect(zh.earlyAccess.fullBody).toContain("注册暂时关闭");
    expect(zh.earlyAccess.fullBody).toContain("欢迎之后再次关注");
    expect(zh.earlyAccess.fullBody).not.toMatch(/前 ?50|50 位/);
  });

  it("promises no particular number of free places, in either language", () => {
    for (const d of [en, zh]) {
      const all = [d.earlyAccess.body, d.earlyAccess.fullBody, ...d.earlyAccess.facts].join(" ");
      expect(all).not.toMatch(/first 50|50 users|50 accounts|前 ?50|50 位/);
    }
  });
});

describe("the sign-up form's new fields are named in both languages", () => {
  it("has every label", () => {
    for (const k of ["firstName", "lastName", "username", "usernameHint",
      "confirmPassword", "passwordMismatch"] as const) {
      expect(en.login[k], `en.${k}`).toBeTruthy();
      expect(zh.login[k], `zh.${k}`).toBeTruthy();
      expect(zh.login[k]).toMatch(/[一-鿿0-9–\s-]/);
    }
  });

  it("explains a refusal in both", () => {
    expect(en.errors.nameRequired).toBeTruthy();
    expect(zh.errors.nameRequired).toMatch(/[一-鿿]/);
    expect(en.errors.usernameTaken).toBeTruthy();
    expect(zh.errors.usernameTaken).toMatch(/[一-鿿]/);
  });
});

/**
 * Role changes and the account cap.
 *
 * A promotion frees a place and a demotion takes one, because `OCCUPIES_A_SLOT`
 * exempts admins. That coupling is why `setRole` has to consult capacity at
 * all, and why its last-admin check has to be atomic: counting admins and
 * writing the new role as two steps lets two simultaneous demotions each see
 * one admin remaining and leave none.
 */
describe("changing a role is a capacity event", () => {
  it("holds the lock before counting, rather than lazily", async () => {
    const src = await import("node:fs")
      .then((fs) => fs.readFileSync("src/lib/db/capacity.ts", "utf8"));
    const fn = src.slice(src.indexOf("export async function withRoleLock"));
    const lock = fn.indexOf("pg_advisory_xact_lock");
    const count = fn.indexOf("count(*)");
    expect(lock).toBeGreaterThan(-1);
    // The lock must be taken unconditionally, before any counting — the
    // capacity helper takes it lazily, which is correct there and not here.
    expect(lock).toBeLessThan(count);
  });

  it("reuses the capacity lock rather than introducing a second one", async () => {
    const src = await import("node:fs")
      .then((fs) => fs.readFileSync("src/lib/db/capacity.ts", "utf8"));
    // Two locks taken in different orders by different callers is how
    // deadlocks are made; one key means that cannot happen.
    expect(src.match(/pg_advisory_xact_lock\(\$1\)/g)?.length).toBeGreaterThan(0);
    expect(src.match(/^const \w*LOCK = /gm)?.length ?? 0).toBe(1);
  });
});

describe("setRole's refusals", () => {
  const read = async () => (await import("node:fs"))
    .readFileSync("src/lib/admin/users.ts", "utf8");
  const body = async () => {
    const src = await read();
    const i = src.indexOf("export async function setRole");
    return src.slice(i, src.indexOf("\n}", i));
  };

  it("refuses to remove your own admin role", async () => {
    expect(await body()).toMatch(/cannot remove your own admin role/);
  });

  it("re-counts admins inside the lock, not before it", async () => {
    const fn = await body();
    expect(fn).toContain("withRoleLock");
    const lock = fn.indexOf("withRoleLock");
    const count = fn.indexOf("role = 'admin' and disabled_at is null");
    expect(count).toBeGreaterThan(lock);
  });

  it("checks capacity when demoting, since that takes a place", async () => {
    const fn = await body();
    expect(fn).toContain("roomFor(1)");
    expect(fn).toMatch(/Early access is full/);
  });

  it("writes one column and nothing else", async () => {
    const fn = await body();
    const writes = fn.match(/update \w+ set [^"]*/g) ?? [];
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("update users set role");
    // No deletion of anything the person owns.
    expect(fn).not.toMatch(/delete from (habits|habit_completions|goals|day_notes|spending)/);
  });
});
