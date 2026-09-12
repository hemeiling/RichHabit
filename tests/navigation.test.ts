import { describe, expect, it } from "vitest";
import { LOCALES, dict } from "../src/lib/i18n";
import { en } from "../src/lib/i18n/en";
import { zh } from "../src/lib/i18n/zh";

/**
 * The navigation, as a contract.
 *
 * A route whose title is missing does not fail to build — the header quietly
 * falls back to the product name, which reads as "you are nowhere in
 * particular" and is the kind of thing nobody notices until a user asks about
 * it. So the routes are listed here, and a new one without a title in both
 * languages fails a test instead.
 */

/** The destinations the sidebar offers, in the order it offers them. */
const SIDEBAR = [
  { href: "/intention", key: "intention" },
  { href: "/habits", key: "habits" },
  { href: "/priorities", key: "priorities" },
  { href: "/week", key: "week" },
  { href: "/insights", key: "insights" },
  { href: "/community", key: "community" },
  { href: "/more", key: "more" },
] as const;

/** Everything reachable from More. */
const MORE = ["habits", "refine", "awareness", "goals", "metrics", "spending",
  "stacks", "review"] as const;

describe("the sidebar", () => {
  it("names every destination in both languages", () => {
    for (const { key } of SIDEBAR) {
      expect(en.nav[key], `en.nav.${key}`).toBeTruthy();
      expect(zh.nav[key], `zh.nav.${key}`).toMatch(/[一-鿿]/);
    }
  });

  it("gives every destination a page title in both languages", () => {
    for (const { href } of SIDEBAR) {
      expect(en.titles[href], `en.titles["${href}"]`).toBeTruthy();
      expect(zh.titles[href], `zh.titles["${href}"]`).toBeTruthy();
    }
  });

  /*
   * My Journey is a group, so it has a label and deliberately no title and no
   * route: there is no journey page for a title to head.
   */
  it("names the group the three experiences sit under", () => {
    expect(en.nav.journey).toBe("My Journey");
    expect(zh.nav.journey).toBe("我的旅程");
    expect(en.titles["/journey"]).toBeUndefined();
  });

  it("has no Today destination left to compete with them", () => {
    expect("today" in en.nav).toBe(false);
    // /today redirects to /habits, so its title would never be rendered.
    expect(en.titles["/today"]).toBeUndefined();
    expect(zh.titles["/today"]).toBeUndefined();
  });

  /*
   * The labels are indented under a parent and sit in a 244px column, so their
   * length is a real constraint rather than a matter of taste. Bilingual mode
   * sets the two languages on separate lines for exactly this reason, so each
   * language is measured on its own.
   */
  it("keeps the three experience labels short enough to nest", () => {
    for (const key of ["intention", "habits", "priorities"] as const) {
      expect(en.nav[key].length, `en.nav.${key}`).toBeLessThanOrEqual(17);
      expect(zh.nav[key].length, `zh.nav.${key}`).toBeLessThanOrEqual(6);
    }
  });
});

describe("the habit sheet, now under More", () => {
  it("is listed with a label and a note in both languages", () => {
    expect(en.more.links.habits.label).toBe("My Habit Sheet");
    expect(en.more.links.habits.note).toBeTruthy();
    expect(zh.more.links.habits.label).toBe("我的习惯表");
    expect(zh.more.links.habits.note).toMatch(/[一-鿿]/);
  });

  it("has its own page title, distinct from Rich Habits", () => {
    expect(en.titles["/more/habits"]).toBe("My Habit Sheet");
    expect(zh.titles["/more/habits"]).toBe("我的习惯表");
    expect(en.titles["/more/habits"]).not.toBe(en.titles["/habits"]);
    expect(zh.titles["/more/habits"]).not.toBe(zh.titles["/habits"]);
  });

  it("and every other More link still has both halves", () => {
    for (const key of MORE) {
      expect(en.more.links[key].label, `en ${key}`).toBeTruthy();
      expect(en.more.links[key].note, `en ${key} note`).toBeTruthy();
      expect(zh.more.links[key].label, `zh ${key}`).toMatch(/[一-鿿]/);
    }
  });

  it("has a title for every More route", () => {
    for (const key of MORE) {
      const href = `/more/${key}`;
      expect(en.titles[href], `en.titles["${href}"]`).toBeTruthy();
      expect(zh.titles[href], `zh.titles["${href}"]`).toBeTruthy();
    }
  });
});

describe("bilingual navigation", () => {
  /*
   * The sidebar renders the two languages on separate lines rather than using
   * the merged label, so what matters here is that both halves exist to be
   * rendered. The merged form is still what every other surface uses.
   */
  it("has a label in each language for every destination", () => {
    for (const { key } of SIDEBAR) {
      expect(dict("en").nav[key]).toBeTruthy();
      expect(dict("zh").nav[key]).toBeTruthy();
      expect(dict("both").nav[key]).toContain(dict("en").nav[key]);
      expect(dict("both").nav[key]).toContain(dict("zh").nav[key]);
    }
  });

  it("resolves a title for every destination in every locale", () => {
    for (const locale of LOCALES) {
      for (const { href } of SIDEBAR) {
        expect(dict(locale).titles[href], `${locale} ${href}`).toBeTruthy();
      }
    }
  });
});
