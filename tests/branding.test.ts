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

  /**
   * One space in "Rich Habits" was the old product name; the product is
   * RichHabit, one word.
   *
   * The phrase itself is not banned, because it is now the name of a
   * destination as well as a phrase in the tagline: the habit experience is
   * called Rich Habits in the sidebar and in its page title, and step five of
   * Clarify Your Intention offers to add a habit to it by name. What must never
   * come back is the phrase used where the *product* is meant — so the
   * sanctioned uses are listed and everything else still fails.
   */
  it("uses 'Rich Habits' only as the tagline phrase and the destination's name", () => {
    const sanctioned = [
      en.tagline,                       // the phrase the promise is built on
      en.nav.habits,                    // the sidebar destination
      en.titles["/habits"],             // the same screen's page title
      en.intention.action.addHabit,     // "Add to Rich Habits"
    ];
    let text = JSON.stringify(en);
    for (const value of sanctioned) {
      expect(value, "a sanctioned use must still say it").toContain("Rich Habits");
      text = text.split(JSON.stringify(value)).join('""');
    }
    expect(text).not.toContain("Rich Habits");
  });

  it("names the three destinations, in both languages", () => {
    expect(en.nav.intention).toBe("Clarify Intention");
    expect(en.nav.habits).toBe("Rich Habits");
    expect(en.nav.priorities).toBe("Priority Compass");
    expect(zh.nav.intention).toBe("明确意图");
    expect(zh.nav.habits).toBe("富有习惯");
    expect(zh.nav.priorities).toBe("优先罗盘");
    // The page title carries the full name; the sidebar label is the short one.
    expect(en.titles["/intention"]).toBe("Clarify Your Intention");
    expect(zh.titles["/intention"]).toBe("明确意图");
  });

  /**
   * The attribution, word for word as the Product Owner approved it.
   *
   * Pinned in a test because the second sentence is what keeps an
   * acknowledgement from reading as a claim of endorsement, and because the
   * first must not drift into a quotation. Dr. Doty's work is credited; none of
   * it is reproduced.
   */
  it("credits Dr. James R. Doty without implying endorsement", () => {
    expect(en.intention.attribution).toBe(
      "Inspired by the work of Dr. James R. Doty on intention, attention, and "
      + "clarifying what truly matters. Created independently by RichHabit.");
    expect(zh.intention.attribution).toContain("James R. Doty");
    expect(zh.intention.attribution).toContain("独立开发");
    // No quotation marks anywhere: nothing here is quoted, so nothing may look
    // as though it is.
    for (const text of [en.intention.attribution, zh.intention.attribution]) {
      expect(text).not.toMatch(/["'“”「」]/);
    }
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
