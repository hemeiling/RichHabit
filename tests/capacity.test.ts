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

describe("the limit is configuration", () => {
  it("defaults to 50", async () => {
    const { capacity } = await import("../src/lib/env");
    expect(capacity.limit).toBe(50);
  });

  it("does not require email verification unless it is switched on", async () => {
    const { capacity } = await import("../src/lib/env");
    expect(capacity.requireEmailVerification).toBe(false);
  });
});

describe("the full message", () => {
  it("says exactly what the product asked for, in English", () => {
    expect(en.earlyAccess.fullTitle).toBe("RichHabit Early Access Is Full");
    expect(en.earlyAccess.fullBody).toContain("limited to the first 50 users");
    expect(en.earlyAccess.fullBody).toContain("all available spots have been filled");
    expect(en.earlyAccess.fullBody).toContain("Please check back later");
  });

  it("says exactly what the product asked for, in Chinese", () => {
    expect(zh.earlyAccess.fullTitle).toBe("「养成富有的习惯」早期体验名额已满");
    expect(zh.earlyAccess.fullBody).toContain("前 50 位用户");
    expect(zh.earlyAccess.fullBody).toContain("现有名额已经全部使用完毕");
    expect(zh.earlyAccess.fullBody).toContain("欢迎之后再次关注");
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
 * Role changes and the fifty places.
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
