import { describe, expect, it } from "vitest";
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

  it("ignores verification while there is no provider", async () => {
    const { OCCUPIES_A_SLOT } = await import("../src/lib/db/capacity");
    // REQUIRE_EMAIL_VERIFICATION defaults off, so a fresh account counts at once.
    expect(OCCUPIES_A_SLOT).not.toContain("email_verified_at");
  });
});

describe("the limit is configuration", () => {
  it("defaults to 50", async () => {
    const { capacity } = await import("../src/lib/env");
    expect(capacity.limit).toBe(50);
  });

  it("does not require email verification yet", async () => {
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
