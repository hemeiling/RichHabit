import { describe, expect, it } from "vitest";
import { COLLECTIONS, LIBRARY, habitFromLibrary, libraryByKey } from "../src/lib/library";
import { canonical, canonicalDescription, habitDescription, habitSource } from "../src/lib/templates";
import { parseHabit } from "../src/lib/validate";
import { dict } from "../src/lib/i18n";
import { en } from "../src/lib/i18n/en";
import { zh } from "../src/lib/i18n/zh";

/**
 * The template collections (HT-1), and the one definition of adopting a
 * template. What must hold: every collection item is fully bilingual and
 * cites its source; historical items carry only frequencies their sources
 * stated (all daily — nothing invented); adopting copies the template's own
 * suggestions, including the frequency both callers used to drop; nothing
 * a collection adds is active unless asked; and no description promises
 * wealth or success.
 */

const collectionItems = LIBRARY.filter((i) => i.collection);

describe("the collections", () => {
  it("exist, with Franklin's thirteen virtues complete plus his two questions", () => {
    expect(COLLECTIONS).toEqual(["franklin", "history"]);
    const franklin = LIBRARY.filter((i) => i.collection === "franklin").map((i) => i.key);
    expect(franklin).toHaveLength(15);
    for (const v of ["temperance", "silence", "order", "resolution", "frugality", "industry",
      "sincerity", "justice", "moderation", "cleanliness", "tranquility", "chastity", "humility"]) {
      expect(franklin).toContain(`franklin_${v}`);
    }
    expect(franklin).toContain("franklin_morning_question");
    expect(franklin).toContain("franklin_evening_question");
    expect(LIBRARY.filter((i) => i.collection === "history").length).toBeGreaterThanOrEqual(8);
  });

  it("every collection item is named, described and cited in both languages", () => {
    for (const item of collectionItems) {
      for (const d of [en, zh]) {
        expect(d.templates.habits[item.key], `${item.key} name`).toBeTruthy();
        expect(d.templates.descriptions[item.key], `${item.key} description`).toBeTruthy();
        expect(d.templates.sources[item.key], `${item.key} source`).toBeTruthy();
      }
      expect(zh.templates.habits[item.key]).not.toBe(en.templates.habits[item.key]);
    }
  });

  it("historical items carry only the frequency their sources stated: daily, with no invented numbers", () => {
    for (const item of collectionItems) {
      expect(item.frequency, item.key).toBe("daily");
      expect(item.days, item.key).toBeUndefined();
      expect(item.timesPerWeek, item.key).toBeUndefined();
    }
    // The one stated amount: Gates's "an hour almost every night".
    expect(libraryByKey.get("gates_reading_before_sleep")!.target).toBe(60);
    // Where the source stated no amount, none is suggested.
    for (const k of ["darwin_daily_walk", "buffett_reading_block"]) {
      expect(libraryByKey.get(k)!.target, k).toBeNull();
    }
  });

  it("a principle is labelled as one, and no description promises wealth or success", () => {
    expect(en.templates.sources.marcus_morning_prep).toMatch(/principle, not a recorded habit/);
    expect(zh.templates.sources.marcus_morning_prep).toMatch(/原则/);
    for (const [key, text] of Object.entries(en.templates.descriptions)) {
      expect(text, key).not.toMatch(/guarantee|will make you (rich|successful)|wealth follows/i);
    }
    for (const [key, text] of Object.entries(zh.templates.descriptions)) {
      expect(text, key).not.toMatch(/保证|必将|让你变得富有|致富/);
    }
  });
});

describe("adopting a template", () => {
  it("copies the template's own suggestions — including the frequency both callers used to lose", () => {
    const review = habitFromLibrary(libraryByKey.get("review_spending")!);
    expect(review.frequency).toEqual({ mode: "times", days: [0, 1, 2, 3, 4, 5, 6], timesPerWeek: 1 });
    const reach = habitFromLibrary(libraryByKey.get("reach_out_to_someone")!);
    expect(reach.frequency.timesPerWeek).toBe(3);
    const gates = habitFromLibrary(libraryByKey.get("gates_reading_before_sleep")!);
    expect(gates).toMatchObject({
      tracking: "duration", minimum: 10, target: 60, unit: "min",
      name: canonical("habits", "gates_reading_before_sleep"),
      description: canonicalDescription("gates_reading_before_sleep"),
      templateKey: "gates_reading_before_sleep",
      status: "active", active: true,
    });
  });

  it("lands as Planned when asked — chosen, not yet tracked — and keeps its own time of day", () => {
    const h = habitFromLibrary(libraryByKey.get("seneca_evening_review")!, { status: "planned" });
    expect(h.status).toBe("planned");
    expect(h.active).toBe(false);
    expect(h.category).toBe("nighttime");
    const moved = habitFromLibrary(libraryByKey.get("exercise")!, { category: "daytime", sortOrder: 7 });
    expect(moved.category).toBe("daytime");
    expect(moved.sortOrder).toBe(7);
  });

  it("the validator keeps the key for a custom unit, so a unit edit no longer breaks name translation", () => {
    const h = habitFromLibrary(libraryByKey.get("gates_reading_before_sleep")!);
    const parsed = parseHabit({ ...h, unit: "pages" });
    expect(parsed.templateKey).toBe("gates_reading_before_sleep");
    // Renaming is still the line: the words become theirs and the key goes.
    expect(parseHabit({ ...h, name: "My own reading ritual" }).templateKey).toBeNull();
  });
});

describe("what the reader sees", () => {
  it("descriptions follow the language while untouched, and stay the user's once edited", () => {
    const h = habitFromLibrary(libraryByKey.get("seneca_evening_review")!);
    expect(habitDescription(h, dict("zh"))).toBe(zh.templates.descriptions.seneca_evening_review);
    expect(habitDescription(h, dict("en"))).toBe(en.templates.descriptions.seneca_evening_review);
    const edited = { ...h, description: "Three lines in my own notebook." };
    expect(habitDescription(edited, dict("zh"))).toBe("Three lines in my own notebook.");
  });

  it("sources resolve per language, and only for templates that have one", () => {
    expect(habitSource("seneca_evening_review", dict("zh"))).toContain("塞内加");
    expect(habitSource("seneca_evening_review", dict("en"))).toContain("Seneca");
    expect(habitSource("exercise", dict("en"))).toBe("");
    expect(habitSource(null, dict("en"))).toBe("");
  });
});
