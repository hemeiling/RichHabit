import { describe, expect, it } from "vitest";
import { LOCALES, dict, intlTag, isLocale, resolveLocale } from "../src/lib/i18n";
import { en } from "../src/lib/i18n/en";
import { zh } from "../src/lib/i18n/zh";
import { both, joinPair } from "../src/lib/i18n/both";
import { SEED_GOALS, SEED_HABITS } from "../src/lib/seed";
import { canonical, habitName, isTemplateWording } from "../src/lib/templates";

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

  it("falls back to the browser's language for a new visitor", () => {
    expect(resolveLocale(null, "zh-CN,zh;q=0.9,en;q=0.8")).toBe("zh");
    expect(resolveLocale(null, "zh-Hant")).toBe("zh");
    expect(resolveLocale(null, "en-GB,en;q=0.9")).toBe("en");
  });

  it("defaults to English when it recognises neither", () => {
    expect(resolveLocale(null, "fr-FR,de;q=0.8")).toBe("en");
    expect(resolveLocale(null, null)).toBe("en");
    expect(resolveLocale("klingon", null)).toBe("en");
  });

  it("lets an explicit choice beat the browser", () => {
    expect(resolveLocale("en", "zh-CN")).toBe("en");
    expect(resolveLocale("zh", "en-US")).toBe("zh");
    expect(resolveLocale("both", "en-US")).toBe("both");
  });

  it("knows its own locales", () => {
    expect(isLocale("both")).toBe(true);
    expect(isLocale("zh")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(intlTag("zh")).toBe("zh-CN");
  });
});

describe("seeded starter set", () => {
  it("is structure plus a key, with no display text in it", () => {
    expect(SEED_HABITS).toHaveLength(16);
    expect(SEED_GOALS).toHaveLength(3);
    for (const h of SEED_HABITS) {
      expect(h.key).toMatch(/^[a-z0-9_]+$/);
      // A seed entry must not carry a name: that is what froze starter habits
      // into one language before.
      expect(h).not.toHaveProperty("name");
    }
  });

  it("has a translation for every key in every language", () => {
    for (const locale of LOCALES) {
      const t = dict(locale);
      for (const h of SEED_HABITS) {
        expect(t.templates.habits[h.key], `${locale}/${h.key}`).toBeTruthy();
      }
      for (const g of SEED_GOALS) {
        expect(t.templates.goals[g.key], `${locale}/${g.key}`).toBeTruthy();
      }
      for (const unit of new Set(SEED_HABITS.map((h) => h.unit).filter(Boolean))) {
        expect(t.templates.units[unit!], `${locale}/unit/${unit}`).toBeTruthy();
      }
    }
  });

  it("translates the eight names the report called out", () => {
    const t = dict("zh");
    const expected: Record<string, string> = {
      read_for_learning: "阅读学习",
      exercise: "锻炼",
      plan_priorities: "规划今日优先事项",
      personal_goal: "推进个人目标",
      skip_early_email: "避免一早查看邮件",
      goal_related_work: "完成重要的目标相关工作",
      drink_water: "喝足够的水",
      avoid_junk_food: "避免垃圾食品",
    };
    for (const [key, zhName] of Object.entries(expected)) {
      expect(t.templates.habits[key]).toBe(zhName);
    }
  });

  it("marks the avoid habits explicitly rather than by name prefix", () => {
    expect(SEED_HABITS.filter((h) => h.kind === "avoid").length).toBeGreaterThan(0);
  });
});

describe("template resolution", () => {
  const seeded = { templateKey: "exercise", name: canonical("habits", "exercise"), unit: "min" };
  const mine = { templateKey: null, name: "Practice violin", unit: "minutes" };

  it("renders a seeded habit in the reader's language", () => {
    expect(habitName(seeded, dict("en"))).toBe("Exercise");
    expect(habitName(seeded, dict("zh"))).toBe("锻炼");
    expect(habitName(seeded, dict("both"))).toBe("Exercise · 锻炼");
  });

  it("never translates a habit the user wrote", () => {
    for (const locale of LOCALES) {
      expect(habitName(mine, dict(locale))).toBe("Practice violin");
    }
  });

  it("falls back to the stored name if a key is somehow unknown", () => {
    expect(habitName({ templateKey: "no_such_key", name: "Fallback" }, dict("zh"))).toBe("Fallback");
  });

  it("recognises template wording in any language, so renaming can be detected", () => {
    expect(isTemplateWording("habits", "exercise", "Exercise")).toBe(true);
    expect(isTemplateWording("habits", "exercise", "锻炼")).toBe(true);
    expect(isTemplateWording("habits", "exercise", "Morning run")).toBe(false);
  });
});


describe("bilingual dictionary", () => {
  it("carries both languages in every label", () => {
    expect(both.nav.today).toBe("Today · 今日");
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
    expect(both.encouragement.allDone).not.toContain("·");
    expect(both.encouragement.allDone).toContain("全部完成");
  });

  it("shows a value once when both languages agree", () => {
    expect(both.common.none).toBe("—");
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
    expect(countOccurrences(s, "日间")).toBe(1);
    expect(countOccurrences(s, "82")).toBe(2); // once per language, as intended

    const w = both.suggestions.weakestWindow("nighttime", 41);
    expect(countOccurrences(w, "Nighttime")).toBe(1);
    expect(countOccurrences(w, "晚间")).toBe(1);
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
