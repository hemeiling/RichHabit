import { describe, expect, it } from "vitest";
import {
  COLLECTIONS, COLLECTION_INFO, EVERYDAY, GOAL_FILTERS, LIBRARY, allEntries, collectionEntries,
  entryMatches, entrySource, entryWhy, goalOf, habitFromLibrary, libraryByKey, suggestedFrequency,
} from "../src/lib/library";
import type { CollectionKey } from "../src/lib/library";
import { scheduleProblem } from "../src/lib/habits";
import { FRANKLIN_VIRTUES, ROTATIONS } from "../src/lib/rotation";
import {
  canonical, canonicalDescription, habitDescription, habitSource, isTemplateWording,
} from "../src/lib/templates";
import { parseHabit } from "../src/lib/validate";
import { dict } from "../src/lib/i18n";
import { en, type CollectionText } from "../src/lib/i18n/en";
import { zh } from "../src/lib/i18n/zh";

/**
 * The Template Library: five featured collections, the everyday shelf and
 * From history, and the one definition of adopting a template. What must hold:
 * every collection habit is complete in both languages, says how directly it
 * comes from its person, and cites a checked source; nothing promises wealth or
 * success and no statistic is quoted; every suggested schedule is one HT-2b can
 * keep; and adopting copies — a library change never reaches anyone's habit.
 */

const FEATURED: CollectionKey[] = ["franklin", "corley", "gates", "musk", "bezos"];
const featured = FEATURED.flatMap(collectionEntries);
const collectionItems = LIBRARY.filter((i) => i.collection);
const text = (d: typeof en, c: CollectionKey) => (d.templates.collections as Record<string, CollectionText>)[c];

describe("the collections", () => {
  it("are the five featured ones in order, then From history", () => {
    expect(COLLECTIONS).toEqual(["franklin", "corley", "gates", "musk", "bezos", "history"]);
    expect(COLLECTIONS.filter((c) => COLLECTION_INFO[c].featured)).toEqual(FEATURED);
  });

  it("Franklin: all thirteen virtues, each on its own with a practical habit, after his own method", () => {
    const keys = collectionEntries("franklin").map((e) => e.item.key);
    expect(keys.slice(0, 3)).toEqual(["franklin_virtue_week", "franklin_morning_question", "franklin_evening_question"]);
    for (const v of FRANKLIN_VIRTUES) {
      const group = collectionEntries("franklin").filter((e) => e.group === v).map((e) => e.item.key);
      expect(group, v).toEqual([`franklin_${v}`, `franklin_${v}_practice`]);
    }
    expect(keys).toHaveLength(3 + 13 * 2);
  });

  it("the Virtue of the week complements the virtues: one rotation, over those same thirteen templates", () => {
    expect(LIBRARY.filter((i) => i.rotation).map((i) => i.key)).toEqual(["franklin_virtue_week"]);
    expect([...ROTATIONS.franklin_virtues]).toEqual(FRANKLIN_VIRTUES.map((v) => `franklin_${v}`));
    for (const k of ROTATIONS.franklin_virtues) {
      expect(libraryByKey.get(k)?.collection, k).toBe("franklin");
    }
  });

  it("uses the approved Chinese virtue names, and keeps Franklin's own meaning of Chastity", () => {
    expect(FRANKLIN_VIRTUES.map((v) => zh.templates.habits[`franklin_${v}`])).toEqual(
      ["节制", "缄默", "秩序", "决心", "节俭", "勤奋", "真诚", "正义", "中庸", "整洁", "平静", "贞洁", "谦逊"]);
    expect(en.templates.descriptions.franklin_chastity).toContain("Rarely use venery but for health or offspring");
    expect(en.templates.descriptions.franklin_chastity).toContain("venery: sexual indulgence");
    expect(zh.templates.descriptions.franklin_chastity).toContain("健康或生育");
    // The modern reading is offered as an adaptation, not passed off as his words.
    expect(en.templates.why.franklin_chastity_practice).toMatch(/sexual restraint.*RichHabit adaptation/s);
    expect(libraryByKey.get("franklin_chastity_practice")?.attribution).toBe("adaptation");
  });

  it("Corley: five themes, with four everyday habits shown inside rather than copied", () => {
    const entries = collectionEntries("corley");
    expect([...new Set(entries.map((e) => e.group))]).toEqual(
      ["corley_morning", "corley_attention", "corley_learning", "corley_money", "corley_consistency"]);
    const borrowed = entries.filter((e) => e.ref.startsWith("corley:"));
    expect(borrowed.map((e) => e.item.key).sort()).toEqual(
      ["exercise", "read_for_learning", "review_spending", "top_three_priorities"]);
    for (const e of borrowed) expect(e.item.collection, e.item.key).toBeUndefined();
    // Placed in the morning routine, whatever its everyday shelf says.
    expect(entries.find((e) => e.item.key === "top_three_priorities")?.category).toBe("morning");
  });

  it("labels Gates's 30-minute reading suggestion a RichHabit adaptation", () => {
    const reading = libraryByKey.get("gates_reading_before_sleep")!;
    expect(reading).toMatchObject({ collection: "gates", attribution: "adaptation", minimum: 10, target: 30, unit: "min" });
    expect(en.templates.why.gates_reading_before_sleep).toMatch(/I read an hour almost every night/);
    expect(en.templates.why.gates_reading_before_sleep).toMatch(/RichHabit's adaptation/);
  });

  it("keeps each habit in a group its collection lists, and leaves no listed group empty", () => {
    for (const c of COLLECTIONS) {
      const { groups } = COLLECTION_INFO[c];
      const entries = collectionEntries(c);
      expect(entries.length, c).toBeGreaterThan(0);
      if (!groups.length) continue;
      for (const e of entries) expect(groups, `${c}/${e.item.key}`).toContain(e.group);
      for (const g of groups) expect(entries.some((e) => e.group === g), `${c}/${g}`).toBe(true);
    }
  });
});

describe("what each template says", () => {
  it("has, in both languages, a name, a why and a source — and a description for every collection's own habit", () => {
    for (const e of featured) {
      for (const d of [en, zh]) {
        expect(d.templates.habits[e.item.key], `${e.ref} name`).toBeTruthy();
        expect(entryWhy(e, d), `${e.ref} why`).toBeTruthy();
        expect(entrySource(e, d), `${e.ref} source`).toBeTruthy();
        if (e.item.collection) expect(d.templates.descriptions[e.item.key], `${e.ref} description`).toBeTruthy();
      }
      expect(zh.templates.habits[e.item.key], e.ref).not.toBe(en.templates.habits[e.item.key]);
    }
    for (const item of collectionItems) {
      for (const d of [en, zh]) expect(d.templates.sources[item.key], `${item.key} source`).toBeTruthy();
    }
  });

  it("links every featured habit to its source over https, and labels every collection link", () => {
    for (const e of featured) expect(e.url, e.ref).toMatch(/^https:\/\/[^\s]+$/);
    for (const c of FEATURED) {
      const { links } = COLLECTION_INFO[c];
      expect(links.length, c).toBeGreaterThan(0);
      for (const url of links) expect(url, c).toMatch(/^https:\/\//);
      for (const d of [en, zh]) expect(text(d, c).links, `${c} link labels`).toHaveLength(links.length);
    }
  });

  it("says, for every collection habit, how directly it comes from its person", () => {
    for (const e of COLLECTIONS.flatMap(collectionEntries)) {
      expect(["documented", "principle", "adaptation"], e.ref).toContain(e.attribution);
    }
    for (const d of [en, zh]) {
      for (const a of ["documented", "principle", "adaptation"] as const) {
        expect(d.templates.attribution[a]).toBeTruthy();
        expect(d.templates.attributionHint[a]).toBeTruthy();
      }
    }
    // The history shelf's principle is still labelled as one.
    expect(en.templates.sources.marcus_morning_prep).toMatch(/principle, not a recorded habit/);
    expect(zh.templates.sources.marcus_morning_prep).toMatch(/原则/);
  });

  it("promises no wealth or success, and quotes no statistics", () => {
    const words = (d: typeof en) => [
      ...Object.values(d.templates.descriptions),
      ...Object.values(d.templates.why),
      ...COLLECTIONS.flatMap((c) => Object.values(text(d, c)).flat()),
    ];
    for (const s of words(en)) {
      expect(s).not.toMatch(/guarantee|will make you (rich|successful|wealthy)|wealth follows|get rich/i);
      // A percentage is a statistic unless it is the saving example people adjust.
      for (const pct of s.match(/\d+(\.\d+)?\s?(%|percent)/g) ?? []) {
        expect(s, pct).toMatch(/save|saving|savings/i);
      }
    }
    for (const s of words(zh)) {
      expect(s).not.toMatch(/保证|必将|让你变得富有|致富/);
      for (const pct of s.match(/\d+(\.\d+)?\s?%/g) ?? []) expect(s, pct).toMatch(/存|储蓄/);
    }
  });

  it("gives every collection its words in both languages, and the featured ones an About section", () => {
    for (const c of COLLECTIONS) {
      for (const d of [en, zh]) {
        const x = text(d, c);
        expect(x.title && x.person && x.idea, `${c}`).toBeTruthy();
        if (COLLECTION_INFO[c].featured) expect(x.bio && x.philosophy && x.useful, `${c} about`).toBeTruthy();
      }
    }
    for (const g of [...new Set(COLLECTIONS.flatMap((c) => COLLECTION_INFO[c].groups))]) {
      const named = (d: typeof en) => d.templates.groups[g] ?? d.templates.habits[`franklin_${g}`];
      expect(named(en), g).toBeTruthy();
      expect(named(zh), g).toBeTruthy();
    }
  });
});

describe("schedules", () => {
  it("suggests, for every template, a schedule HT-2b can keep", () => {
    for (const item of LIBRARY) {
      expect(scheduleProblem(suggestedFrequency(item)), item.key).toBeNull();
      expect(scheduleProblem(habitFromLibrary(item).frequency), item.key).toBeNull();
    }
  });

  it("covers daily, weekly and monthly habits", () => {
    const modes = new Set(featured.map((e) => e.item.frequency));
    expect([...modes].sort()).toEqual(["daily", "month_times", "times"]);
    const monthly = habitFromLibrary(libraryByKey.get("bezos_long_term_review")!);
    expect(monthly.frequency).toMatchObject({ mode: "month_times", timesPerMonth: 1 });
    const weekly = habitFromLibrary(libraryByKey.get("bezos_door_check")!);
    expect(weekly.frequency).toMatchObject({ mode: "times", timesPerWeek: 1 });
  });

  it("keeps documented practices on their sources' own rhythm: daily, nothing invented", () => {
    for (const e of COLLECTIONS.flatMap(collectionEntries).filter((x) => x.attribution === "documented")) {
      expect(e.item.frequency, e.ref).toBe("daily");
    }
    for (const k of ["darwin_daily_walk", "buffett_reading_block"]) {
      expect(libraryByKey.get(k)!.target, k).toBeNull();     // no amount stated, none suggested
    }
  });
});

describe("browsing", () => {
  it("files every template under exactly one of five goals, with several in each", () => {
    expect([...GOAL_FILTERS]).toEqual(["learning", "finance", "health", "productivity", "growth"]);
    for (const g of GOAL_FILTERS) {
      expect(LIBRARY.filter((i) => goalOf(i) === g).length, g).toBeGreaterThanOrEqual(3);
    }
    for (const d of [en, zh]) for (const g of GOAL_FILTERS) expect(d.customise.goals[g]).toBeTruthy();
  });

  it("finds templates by habit, person and collection, in either language", () => {
    const find = (needle: string, locale: "en" | "zh") =>
      allEntries().filter((e) => entryMatches(e, needle.toLowerCase(), dict(locale))).map((e) => e.item.key);
    expect(find("two-way door", "en")).toContain("bezos_door_check");
    expect(find("双向门", "zh")).toContain("bezos_door_check");
    expect(find("Gates", "en")).toEqual(expect.arrayContaining(["gates_think_time", "gates_new_field"]));
    expect(find("富兰克林", "zh").length).toBeGreaterThanOrEqual(29);
    expect(find("lifelong learning", "en")).toContain("gates_learning_note");
  });

  it("lists every template once overall, with a collection's version over the everyday one", () => {
    const all = allEntries();
    expect(new Set(all.map((e) => e.item.key)).size).toBe(all.length);
    expect(all.length).toBe(LIBRARY.length);
    expect(all.find((e) => e.item.key === "exercise")?.collection).toBe("corley");
  });

  it("keeps the everyday shelf to everyday templates", () => {
    expect(EVERYDAY.every((e) => !e.item.collection && e.collection === null)).toBe(true);
    expect(EVERYDAY.map((e) => e.item.key)).toContain("plan_priorities");
  });
});

describe("adopting a template", () => {
  it("copies the template's own suggestions — including its frequency", () => {
    const review = habitFromLibrary(libraryByKey.get("review_spending")!);
    expect(review.frequency).toEqual({ mode: "times", days: [0, 1, 2, 3, 4, 5, 6], timesPerWeek: 1 });
    const reach = habitFromLibrary(libraryByKey.get("reach_out_to_someone")!);
    expect(reach.frequency.timesPerWeek).toBe(3);
    const gates = habitFromLibrary(libraryByKey.get("gates_reading_before_sleep")!);
    expect(gates).toMatchObject({
      tracking: "duration", minimum: 10, target: 30, unit: "min",
      name: canonical("habits", "gates_reading_before_sleep"),
      description: canonicalDescription("gates_reading_before_sleep"),
      templateKey: "gates_reading_before_sleep",
      status: "active", active: true,
    });
  });

  it("makes a copy that shares nothing with the library, so editing it can never change a template", () => {
    const item = libraryByKey.get("reach_out_to_someone")!;
    const before = JSON.stringify(item);
    const copy = habitFromLibrary(item);
    copy.frequency.days.push(9);
    copy.name = "Mine now";
    expect(JSON.stringify(item)).toBe(before);
    expect(habitFromLibrary(item).frequency.days).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(habitFromLibrary(item).id).not.toBe(copy.id);
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

  it("keeps the key and the schedule of a new template through the server's validator", () => {
    for (const key of ["corley_pay_yourself_first", "musk_focus_session", "franklin_order_practice"]) {
      const h = habitFromLibrary(libraryByKey.get(key)!);
      const parsed = parseHabit(h);
      expect(parsed.templateKey, key).toBe(key);
      expect(parsed.frequency.mode, key).toBe(h.frequency.mode);
    }
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
    expect(habitSource("gates_reading_before_sleep", dict("en"))).toBe("Bill Gates, quoted in The Seattle Times (1990)");
  });

  it("still treats corrected wording as the template's own, so copies made before keep translating", () => {
    const old = {
      templateKey: "franklin_morning_question",
      description: "Franklin opened each day with this question at five in the morning, then planned the day's business.",
    };
    expect(habitDescription(old, dict("zh"))).toBe(zh.templates.descriptions.franklin_morning_question);
    const sleep = { templateKey: "bezos_sleep_eight", description: "“For me, I need eight hours of sleep” — planned for, not left to chance." };
    expect(habitDescription(sleep, dict("en"))).toBe(en.templates.descriptions.bezos_sleep_eight);
    // A name stored under the earlier Chinese wording keeps its key through the validator.
    expect(isTemplateWording("habits", "franklin_silence", "慎言")).toBe(true);
    expect(isTemplateWording("habits", "franklin_silence", "缄默")).toBe(true);
  });
});
