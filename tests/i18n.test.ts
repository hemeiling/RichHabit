import { describe, expect, it } from "vitest";
import { LOCALES, dict, intlTag, isLocale, resolveLocale } from "../src/lib/i18n";
import { en } from "../src/lib/i18n/en";
import { zh } from "../src/lib/i18n/zh";
import { both, joinPair } from "../src/lib/i18n/both";
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
  it("honours an explicit cookie", () => {
    expect(resolveLocale("zh")).toBe("zh");
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("both")).toBe("both");
  });

  it("defaults to bilingual, not to one language", () => {
    // The browser language says what the device owner reads, not what everyone
    // sharing the screen reads.
    expect(resolveLocale(null)).toBe("both");
    expect(resolveLocale(undefined)).toBe("both");
    expect(resolveLocale("klingon")).toBe("both");
  });

  it("knows its own locales", () => {
    expect(isLocale("both")).toBe(true);
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

describe("bilingual dictionary", () => {
  it("carries both languages in every label", () => {
    expect(both.nav.today).toBe("Today · 今天");
    expect(both.login.signIn).toBe("Sign in · 登录");
    expect(both.common.save).toBe("Save · 保存");
  });

  it("keeps interpolated values once, not twice over", () => {
    expect(both.today.daysRunning(7)).toContain("7");
    expect(both.suggestions.worst("Exercise", 41)).toContain("Exercise");
    expect(both.suggestions.worst("Exercise", 41)).toContain("41");
  });

  it("joins day initials tightly enough for a 34px column", () => {
    expect(both.days.initial[1]).toBe("M/一");
    expect(both.days.initial[1].length).toBeLessThanOrEqual(3);
  });

  it("separates sentences with a space, not a middot", () => {
    // A middot mid-paragraph reads as punctuation rather than as a divider.
    expect(both.encouragement.allDone).not.toContain("·");
    expect(both.encouragement.allDone).toContain("全部完成");
  });

  it("shows a value once when both languages agree", () => {
    expect(both.common.none).toBe("—");
    // A ratio of numerals is the same in both languages; printing it twice
    // ("0 of 5 · 0 / 5") is noise.
    expect(both.common.of(0, 5)).toBe("0 / 5");
    expect(both.today.streakDays(3)).toBe("3d");
  });

  it("does not double a separator that is already in the string", () => {
    expect(both.today.avoid).toBe("Avoid · 戒除");
    expect(both.today.avoid).not.toContain("· ·");
  });

  it("never falls behind en/zh, because it is derived", () => {
    const keys = (o: object): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        v && typeof v === "object" && !Array.isArray(v) ? keys(v).map((s) => `${k}.${s}`) : [k]);
    expect(keys(both)).toEqual(keys(en));
  });
});

describe("joinPair", () => {
  it("collapses identical values", () => expect(joinPair("—", "—")).toBe("—"));
  it("uses a slash for very short pairs", () => expect(joinPair("S", "日")).toBe("S/日"));
  it("uses a space after a sentence", () => expect(joinPair("Done.", "完成。")).toBe("Done. 完成。"));
  it("uses a middot for labels", () => expect(joinPair("Save", "保存")).toBe("Save · 保存"));
});

describe("bilingual seed", () => {
  it("names starter habits in both languages", () => {
    const first = seedSet("both").habits[0];
    expect(first.name).toBe("Read for learning · 阅读学习");
    expect(first.unit).toBe("min · 分钟");
  });

  it("still produces 16 habits and 3 goals", () => {
    expect(seedSet("both").habits).toHaveLength(16);
    expect(seedSet("both").goals).toHaveLength(3);
  });
});

describe("no value is rendered twice in bilingual mode", () => {
  /**
   * The hazard of a derived bilingual dictionary: pass an already-bilingual
   * string into a bilingual function and it comes back doubled —
   * "High · 高 priority · High · 高优先级". Functions that mention a category or
   * a unit therefore take a key and resolve their own language's word.
   */
  const countOccurrences = (haystack: string, needle: string) =>
    haystack.split(needle).length - 1;

  it("names a category once per language", () => {
    const s = both.week.phaseResult("morning");
    expect(countOccurrences(s, "Morning")).toBe(1);
    expect(countOccurrences(s, "早晨")).toBe(1);
    expect(s).toBe("Morning · seven-day result · 早晨 · 七天结果");
  });

  it("does the same inside a sentence", () => {
    const s = both.week.holdingAt("daytime", 82);
    expect(countOccurrences(s, "Daytime")).toBe(1);
    expect(countOccurrences(s, "白天")).toBe(1);
    expect(countOccurrences(s, "82")).toBe(2); // once per language, as intended

    const w = both.suggestions.weakestWindow("nighttime", 41);
    expect(countOccurrences(w, "Nighttime")).toBe(1);
    expect(countOccurrences(w, "夜晚")).toBe(1);
  });

  it("names a unit once per language", () => {
    const s = both.metrics.avg("6.1", "hours");
    expect(countOccurrences(s, "hrs")).toBe(1);
    expect(countOccurrences(s, "小时")).toBe(1);
  });

  it("uses whole labels for priority rather than interpolating a word", () => {
    expect(both.habits.priorityFull.high).toBe("High priority · 高优先级");
    expect(countOccurrences(both.habits.priorityFull.high, "High")).toBe(1);
  });
});
