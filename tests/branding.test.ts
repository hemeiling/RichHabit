import { describe, expect, it } from "vitest";
import { en } from "../src/lib/i18n/en";
import { zh } from "../src/lib/i18n/zh";
import { both } from "../src/lib/i18n/both";

describe("the product name and tagline", () => {
  it("is RichHabit in English and 养成富有的习惯 in Chinese", () => {
    expect(en.appName).toBe("RichHabit");
    expect(zh.appName).toBe("养成富有的习惯");
  });

  it("carries the tagline in both", () => {
    expect(en.tagline).toBe("Build Rich Habits. Build a Richer Life.");
    expect(zh.tagline).toBe("好习惯，成就更富足的人生。");
  });

  it("shows both at once in bilingual mode", () => {
    expect(both.appName).toContain("RichHabit");
    expect(both.appName).toContain("养成富有的习惯");
  });

  /** One space in "Rich Habits" was the old name; the product is RichHabit. */
  it("has no stray 'Rich Habits' left in user-facing English", () => {
    const text = JSON.stringify(en);
    // The tagline says "Rich Habits" on purpose — it is the phrase, not the name.
    const withoutTagline = text.replace(JSON.stringify(en.tagline), '""');
    expect(withoutTagline).not.toContain("Rich Habits");
  });

  it("has no stray 富习惯 left as a product name in Chinese", () => {
    // 富习惯得分 stays: that is the score's name, not the product's.
    expect(zh.appName).not.toBe("富习惯");
    expect(zh.feedback.thanks).toContain("RichHabit");
  });
});

describe("the free early access notice", () => {
  it("says exactly what the product asked for, in English", () => {
    expect(en.earlyAccess.title).toBe("Free Early Access");
    expect(en.earlyAccess.body).toContain("free for our first 50 users");
    expect(en.earlyAccess.body).toContain("limit, suspend, or delete accounts");
    expect(en.earlyAccess.body).toContain("Free access may also change as RichHabit evolves");
  });

  it("says exactly what the product asked for, in Chinese", () => {
    expect(zh.earlyAccess.title).toBe("免费早期体验");
    expect(zh.earlyAccess.body).toContain("前 50 位用户");
    expect(zh.earlyAccess.body).toContain("限制、暂停或删除相关账户的权利");
    expect(zh.earlyAccess.body).toContain("免费使用政策也可能进行调整");
  });

  it("uses the requested wording for the checkbox", () => {
    expect(en.earlyAccess.agree).toBe("I agree to the Free Early Access terms.");
    expect(zh.earlyAccess.agree).toBe("我同意免费早期体验条款。");
  });

  it("labels the longer policy link in both", () => {
    expect(en.earlyAccess.learnMore).toBe("Learn more");
    expect(zh.earlyAccess.learnMore).toBe("了解详情");
  });

  it("has a refusal message in both, for when the box is not ticked", () => {
    expect(en.earlyAccess.mustAgree).toBeTruthy();
    expect(zh.earlyAccess.mustAgree).toMatch(/[一-鿿]/);
  });

  it("states the same facts in both languages, and the same number of them", () => {
    expect(en.earlyAccess.facts.length).toBe(zh.earlyAccess.facts.length);
    expect(en.earlyAccess.facts.length).toBeGreaterThanOrEqual(4);
    for (const f of zh.earlyAccess.facts) expect(f).toMatch(/[一-鿿]/);
  });
});
