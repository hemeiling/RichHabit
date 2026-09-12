import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  accomplishedBetween, accomplishedInMonth, accomplishedInYear, accomplishedOn, carriedSince,
  countsByDay, countsByMonth, groupByDay, needsDeleteConfirmation,
} from "../src/lib/accomplishments";
import { prioritiesOn } from "../src/lib/priorities";
import { en } from "../src/lib/i18n/en";
import { zh } from "../src/lib/i18n/zh";
import { both } from "../src/lib/i18n/both";
import type { Priority, PriorityCategory } from "../src/lib/types";

/**
 * An accomplishment is a priority with a completion date. These tests pin the
 * rule every surface shares — Insights, My Progress and Community — and the
 * lifecycle that follows from it: complete, reopen, complete again, delete.
 */

let n = 0;
const priority = (over: Partial<Priority> = {}): Priority => ({
  id: `p${String(++n).padStart(3, "0")}`, text: "Line", createdOn: "2026-09-01", completedOn: null,
  category: "urgent_important", plannedOn: null, sortOrder: 0, ...over,
});

/* The client's own actions, reduced to what they do to the row. */
const complete = (p: Priority, date: string): Priority => ({ ...p, completedOn: date });
const reopen = (p: Priority): Priority => ({ ...p, completedOn: null });

const TODAY = "2026-09-12";

describe("the lifecycle", () => {
  it("completing adds exactly one accomplishment, on the day it was ticked", () => {
    const open = priority({ text: "Send the proposal", createdOn: "2026-09-10" });
    expect(accomplishedInMonth([open], "2026-09", TODAY)).toHaveLength(0);

    const done = complete(open, TODAY);
    expect(accomplishedInMonth([done], "2026-09", TODAY)).toHaveLength(1);
    expect(accomplishedOn([done], TODAY)).toEqual([done]);
    expect(accomplishedOn([done], "2026-09-11")).toHaveLength(0);
  });

  it("the next day's compass no longer shows it, and its own day still does", () => {
    const done = complete(priority({ createdOn: "2026-09-10" }), TODAY);
    expect(prioritiesOn([done], "2026-09-13")).toHaveLength(0);
    // The historical rule is untouched: on the day it was finished it was there.
    expect(prioritiesOn([done], TODAY)).toHaveLength(1);
    expect(prioritiesOn([done], "2026-09-10")).toHaveLength(1);
  });

  it("an unfinished priority still rolls forward", () => {
    const open = priority({ createdOn: "2026-09-10" });
    expect(prioritiesOn([open], "2026-09-13")).toHaveLength(1);
  });

  it("reopening removes it; completing again counts it once, on the new day", () => {
    const first = complete(priority(), "2026-09-05");
    const reopened = reopen(first);
    expect(accomplishedInMonth([reopened], "2026-09", TODAY)).toHaveLength(0);

    const again = complete(reopened, "2026-09-12");
    expect(accomplishedInMonth([again], "2026-09", TODAY)).toHaveLength(1);
    expect(accomplishedOn([again], "2026-09-05")).toHaveLength(0);
    expect(accomplishedOn([again], "2026-09-12")).toHaveLength(1);
  });

  it("re-completing in another month moves it between months", () => {
    const again = complete(reopen(complete(priority({ createdOn: "2026-08-20" }), "2026-08-30")), "2026-09-02");
    expect(countsByMonth([again], "2026", TODAY)[7]).toBe(0);
    expect(countsByMonth([again], "2026", TODAY)[8]).toBe(1);
  });

  it("deleting the row removes the accomplishment", () => {
    const keep = complete(priority(), "2026-09-03");
    const gone = complete(priority(), "2026-09-03");
    const after = [keep, gone].filter((p) => p.id !== gone.id);
    expect(accomplishedInMonth(after, "2026-09", TODAY)).toEqual([keep]);
  });
});

describe("totals", () => {
  const all = [
    complete(priority(), "2026-01-15"),
    complete(priority(), "2026-03-01"),
    complete(priority(), "2026-03-31"),
    complete(priority(), "2026-09-01"),
    complete(priority(), "2026-09-12"),
    complete(priority(), "2026-09-12"),
    // A wrong device clock must not invent later accomplishments.
    complete(priority({ createdOn: "2026-09-12" }), "2026-09-20"),
    complete(priority({ createdOn: "2025-12-01" }), "2025-12-31"),
    priority({ createdOn: "2026-09-12" }),
  ];

  it("a month counts its own days, never past today", () => {
    expect(accomplishedInMonth(all, "2026-09", TODAY)).toHaveLength(3);
    expect(accomplishedInMonth(all, "2026-03", TODAY)).toHaveLength(2);
    expect(accomplishedInMonth(all, "2026-10", TODAY)).toHaveLength(0);
  });

  it("the daily bars add up to the month and leave future days empty", () => {
    const days = countsByDay(all, "2026-09", TODAY);
    expect(days).toHaveLength(30);
    expect(days[0]).toBe(1);
    expect(days[11]).toBe(2);
    expect(days.slice(12).every((c) => c === 0)).toBe(true);
    expect(days.reduce((a, b) => a + b, 0)).toBe(accomplishedInMonth(all, "2026-09", TODAY).length);
  });

  it("the year total is the sum of its months", () => {
    const months = countsByMonth(all, "2026", TODAY);
    const sum = months.reduce((a, b) => a + b, 0);
    expect(months).toEqual([1, 0, 2, 0, 0, 0, 0, 0, 3, 0, 0, 0]);
    expect(sum).toBe(accomplishedInYear(all, "2026", TODAY).length);
    for (let m = 0; m < 12; m++) {
      const month = `2026-${String(m + 1).padStart(2, "0")}`;
      expect(months[m]).toBe(accomplishedInMonth(all, month, TODAY).length);
    }
    expect(countsByMonth(all, "2025", TODAY)[11]).toBe(1);
  });

  it("a range is inclusive, and a backwards range is empty", () => {
    expect(accomplishedBetween(all, "2026-03-01", "2026-03-31")).toHaveLength(2);
    expect(accomplishedBetween(all, "2026-03-31", "2026-03-01")).toHaveLength(0);
  });

  it("February and leap years have the right number of days", () => {
    expect(countsByDay([], "2026-02", TODAY)).toHaveLength(28);
    expect(countsByDay([], "2028-02", "2028-12-31")).toHaveLength(29);
  });
});

describe("the month list", () => {
  it("groups by completion day, newest first, in the compass's quadrant order", () => {
    const at = (category: PriorityCategory, sortOrder: number, text: string, day = "2026-09-12") =>
      complete(priority({ category, sortOrder, text }), day);
    const items = [
      at("not_important_not_urgent", 0, "Q4"),
      at("important_not_urgent", 1, "Q2 second"),
      at("urgent_important", 0, "Q1"),
      at("important_not_urgent", 0, "Q2 first"),
      at("urgent_important", 0, "Earlier", "2026-09-03"),
    ];
    const days = groupByDay(items);
    expect(days.map((d) => d.date)).toEqual(["2026-09-12", "2026-09-03"]);
    expect(days[0].items.map((p) => p.text)).toEqual(["Q1", "Q2 first", "Q2 second", "Q4"]);
  });

  it("keeps the user's title exactly as written", () => {
    const text = "  回复 Anna 的邮件 — re: Q3 😀  ";
    expect(groupByDay([complete(priority({ text }), TODAY)])[0].items[0].text).toBe(text);
  });

  it("says where a carried item came from, and nothing for a same-day one", () => {
    expect(carriedSince(complete(priority({ createdOn: "2026-09-05" }), TODAY))).toBe("2026-09-05");
    expect(carriedSince(complete(priority({ createdOn: TODAY }), TODAY))).toBeNull();
    expect(carriedSince(priority({ createdOn: "2026-09-05" }))).toBeNull();
  });
});

describe("deleting", () => {
  it("asks first only for a completed priority", () => {
    expect(needsDeleteConfirmation(complete(priority(), TODAY), TODAY)).toBe(true);
    expect(needsDeleteConfirmation(priority(), TODAY)).toBe(false);
  });

  it("the card's remove button routes a completed line through the confirmation", () => {
    const src = fs.readFileSync("src/components/Priorities.tsx", "utf8");
    expect(src).toMatch(/needsDeleteConfirmation\(item, date\)\s*\?\s*setConfirmDelete\(item\)\s*:\s*actions\.deletePriority\(item\.id\)/);
    expect(src).toMatch(/t\.priorities\.deleteDoneTitle/);
    expect(src).toMatch(/t\.common\.cancel/);
  });
});

describe("Priority Compass looks forward", () => {
  const compass = fs.readFileSync("src/components/screens/PriorityCompass.tsx", "utf8");

  it("has no previous-day navigation and always shows today", () => {
    expect(compass).not.toMatch(/previousDay|nextDay|addDays|‹|›/);
    expect(compass).toMatch(/const today = useToday\(\)/);
    expect(compass).toMatch(/<Priorities date=\{today\} \/>/);
  });

  it("keeps the historical rule in lib/priorities", () => {
    expect(fs.readFileSync("src/lib/priorities.ts", "utf8")).toMatch(/export function prioritiesOn\(all: Priority\[\], date: string\)/);
  });

  it("marks the Community figure stale when a priority is completed, reopened or deleted", () => {
    const route = fs.readFileSync("src/app/api/priorities/route.ts", "utf8");
    expect((route.match(/markMemberStale\(userId\)/g) ?? []).length).toBe(2);
  });
});

describe("wording", () => {
  it("uses the approved names in each language", () => {
    expect(en.insights.accomplishments.title).toBe("Accomplishments");
    expect(en.insights.accomplishments.thisMonth).toBe("accomplished this month");
    expect(en.insights.accomplishments.thisYear).toBe("accomplished this year");
    expect(zh.insights.accomplishments.title).toBe("成果");
    expect(zh.insights.accomplishments.thisMonth).toBe("本月成果");
    expect(zh.insights.accomplishments.thisYear).toBe("今年成果");
    expect(zh.insights.accomplishments.today(2)).toBe("今天 2 项");
  });

  it("gives Chinese every key English has, and bilingual carries both", () => {
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(zh.insights.accomplishments)).toEqual(keys(en.insights.accomplishments));
    for (const k of ["deleteDoneTitle", "deleteDoneBody", "deleteDoneConfirm"] as const) {
      expect(zh.priorities[k]).toBeTruthy();
      expect(both.priorities[k]).toContain(en.priorities[k]);
      expect(both.priorities[k]).toContain(zh.priorities[k]);
    }
    expect(both.insights.accomplishments.title).toContain("Accomplishments");
    expect(both.insights.accomplishments.title).toContain("成果");
    expect(both.community.accomplishedCount(14)).toContain("14");
  });
});
