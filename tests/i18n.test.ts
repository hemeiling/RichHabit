import { describe, expect, it } from "vitest";
import { LOCALES, dict, intlTag, isLocale, resolveLocale } from "../src/lib/i18n";
import { en } from "../src/lib/i18n/en";
import { zh } from "../src/lib/i18n/zh";
import { seedSet } from "../src/lib/seed";

/**
 * TypeScript already forces `zh` to have the same keys as `en`. What it cannot
 * check is that a value was actually translated rather than pasted, or that a
 * function returns something with the interpolated value in it.
 */

type Node = Record<string, unknown>;

function walk(a: Node, b: Node, path = ""): { path: string; en: unknown; zh: unknown }[] {
  const out: { path: string; en: unknown; zh: unknown }[] = [];
  for (const key of Object.keys(a)) {
    const here = path ? `${path}.${key}` : key;
    const av = a[key], bv = b[key];
    if (typeof av === "object" && av !== null && !Array.isArray(av)) {
      out.push(...walk(av as Node, (bv ?? {}) as Node, here));
    } else {
      out.push({ path: here, en: av, zh: bv });
    }
  }
  return out;
}

// Ideographs, CJK punctuation (。、「」) and fullwidth forms (（）) — a string
// like "。" is fully translated but contains no ideograph.
const HAS_CJK = /[\u3000-\u303F\u4E00-\u9FFF\uFF00-\uFFEF]/;

/** Keys whose value is legitimately identical in both languages. */
const SHARED = new Set([
  "common.none",
  "login.emailPlaceholder",
  "goalAreas.Health", "goalAreas.Fitness", "goalAreas.Career", "goalAreas.Learning",
  "goalAreas.Relationships", "goalAreas.Financial", "goalAreas.Personal project", "goalAreas.Sleep",
]);

describe("dictionary parity", () => {
  const entries = walk(en as unknown as Node, zh as unknown as Node);

  it("covers every key", () => {
    const missing = entries.filter((e) => e.zh === undefined).map((e) => e.path);
    expect(missing).toEqual([]);
  });

  it("matches types key for key", () => {
    const mismatched = entries
      .filter((e) => typeof e.en !== typeof e.zh)
      .map((e) => `${e.path}: ${typeof e.en} vs ${typeof e.zh}`);
    expect(mismatched).toEqual([]);
  });

  it("has arrays of the same length", () => {
    const bad = entries
      .filter((e) => Array.isArray(e.en) && (e.zh as unknown[]).length !== (e.en as unknown[]).length)
      .map((e) => e.path);
    expect(bad).toEqual([]);
  });

  it("leaves no English string untranslated", () => {
    const untranslated = entries
      .filter((e) => typeof e.en === "string" && !SHARED.has(e.path))
      .filter((e) => !HAS_CJK.test(e.zh as string))
      .map((e) => `${e.path} = ${e.zh}`);
    expect(untranslated).toEqual([]);
  });

  it("translates the suggestion chips, not just the labels", () => {
    zh.coach.suggestions.forEach((s) => expect(s).toMatch(HAS_CJK));
    expect(zh.coach.suggestions).toHaveLength(en.coach.suggestions.length);
  });
});

describe("interpolating functions keep their values", () => {
  it("puts the number in both languages", () => {
    for (const locale of LOCALES) {
      const t = dict(locale);
      expect(t.today.daysRunning(7)).toContain("7");
      expect(t.insights.streakCount(3)).toContain("3");
      expect(t.week.scheduledOf(4, 9)).toContain("4");
      expect(t.week.scheduledOf(4, 9)).toContain("9");
    }
  });

  it("puts the habit name in both languages", () => {
    for (const locale of LOCALES) {
      const t = dict(locale);
      expect(t.week.keepSteady("Exercise")).toContain("Exercise");
      expect(t.suggestions.worst("Exercise", 41)).toContain("Exercise");
      expect(t.suggestions.worst("Exercise", 41)).toContain("41");
    }
  });
});

describe("resolveLocale", () => {
  it("prefers an explicit cookie", () => {
    expect(resolveLocale("zh", "en-US,en;q=0.9")).toBe("zh");
    expect(resolveLocale("en", "zh-CN")).toBe("en");
  });

  it("falls back to Accept-Language", () => {
    expect(resolveLocale(null, "zh-CN,zh;q=0.9,en;q=0.8")).toBe("zh");
    expect(resolveLocale(null, "zh-Hant")).toBe("zh");
    expect(resolveLocale(null, "en-GB,en;q=0.9")).toBe("en");
  });

  it("defaults to English when it recognises nothing", () => {
    expect(resolveLocale(null, "fr-FR,de;q=0.8")).toBe("en");
    expect(resolveLocale(null, null)).toBe("en");
    expect(resolveLocale("klingon", null)).toBe("en");
  });

  it("knows its own locales", () => {
    expect(isLocale("zh")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(intlTag("zh")).toBe("zh-CN");
  });
});

describe("seeded starter set", () => {
  it("gives every language the same 16 habits and 3 goals", () => {
    for (const locale of LOCALES) {
      expect(seedSet(locale).habits).toHaveLength(16);
      expect(seedSet(locale).goals).toHaveLength(3);
    }
  });

  it("names them in Chinese for zh", () => {
    seedSet("zh").habits.forEach((h) => expect(h.name).toMatch(HAS_CJK));
    seedSet("zh").goals.forEach((g) => expect(g.name).toMatch(HAS_CJK));
  });

  it("keeps goal areas as the English keys the dictionary looks up", () => {
    // `area` is a stored value the UI translates on render; translating it at
    // write time would leave old rows unmatchable.
    seedSet("zh").goals.forEach((g) => expect(en.goalAreas[g.area]).toBeDefined());
  });

  it("marks the avoid habits explicitly rather than by name prefix", () => {
    const avoid = seedSet("zh").habits.filter((h) => h.kind === "avoid");
    expect(avoid.length).toBe(seedSet("en").habits.filter((h) => h.kind === "avoid").length);
    expect(avoid.length).toBeGreaterThan(0);
  });
});
