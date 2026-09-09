import { describe, expect, it } from "vitest";
import { parseNewPriority, parsePriorityDone, parsePriorityPlan } from "../src/lib/validate";
import {
  NO_QUADRANT_ADD, QUADRANTS, carriedFrom, cueFor, doneOn, hasDraft, isPlanOverdue,
  layoutAfterMove, prioritiesOn, quadrantAdd, quadrantFor,
} from "../src/lib/priorities";
import { DEFAULT_PRIORITY_CATEGORY, emptyState, normalizePriorityCategory } from "../src/lib/types";
import type { Priority } from "../src/lib/types";
import { en } from "../src/lib/i18n/en";
import { zh } from "../src/lib/i18n/zh";

const ID = "11111111-1111-4111-8111-111111111111";

let n = 0;
const p = (createdOn: string, completedOn: string | null = null, text = `item ${++n}`): Priority =>
  ({ id: `${n}`, text, createdOn, completedOn, category: "unsorted", plannedOn: null, sortOrder: 0 });

describe("what is on a given day", () => {
  it("shows a line on the day it was written", () => {
    expect(prioritiesOn([p("2026-08-15")], "2026-08-15")).toHaveLength(1);
  });

  /* The feature, stated once: unfinished means still here tomorrow. */
  it("carries an unfinished line forward, day after day", () => {
    const all = [p("2026-08-10")];
    for (const d of ["2026-08-10", "2026-08-11", "2026-08-12", "2026-09-01", "2027-01-01"]) {
      expect(prioritiesOn(all, d)).toHaveLength(1);
    }
  });

  it("does not show it before it was written", () => {
    expect(prioritiesOn([p("2026-08-15")], "2026-08-14")).toEqual([]);
  });

  /*
   * The historical half of the feature. A note left unfinished long before any
   * of this existed is open now, still dated then. Nothing had to run in
   * between — no nightly job, no login, no visit on the intervening days —
   * because the rule is a comparison rather than an event.
   */
  it("carries forward a line written long before the feature existed", () => {
    const old = p("2025-03-04");
    expect(prioritiesOn([old], "2026-08-21")).toHaveLength(1);
    expect(prioritiesOn([old], "2026-08-21")[0].createdOn).toBe("2025-03-04");
  });

  it("stops carrying it forward once it is finished", () => {
    const all = [p("2026-08-10", "2026-08-12")];
    expect(prioritiesOn(all, "2026-08-12")).toHaveLength(1);
    expect(prioritiesOn(all, "2026-08-13")).toEqual([]);
    expect(prioritiesOn(all, "2026-09-01")).toEqual([]);
  });

  /* Ticking something must not make it vanish from under the cursor. */
  it("still shows it on the day it was finished", () => {
    expect(prioritiesOn([p("2026-08-10", "2026-08-15")], "2026-08-15")).toHaveLength(1);
  });

  it("keeps it on the days it was genuinely outstanding", () => {
    const all = [p("2026-08-10", "2026-08-13")];
    for (const d of ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13"]) {
      expect(prioritiesOn(all, d)).toHaveLength(1);
    }
  });

  it("keeps the user's order", () => {
    const all = [p("2026-08-10", null, "a"), p("2026-08-11", null, "b"), p("2026-08-09", null, "c")];
    expect(prioritiesOn(all, "2026-08-12").map((x) => x.text)).toEqual(["a", "b", "c"]);
  });

  it("returns the same record, not a copy of it", () => {
    const one = p("2026-08-10");
    expect(prioritiesOn([one], "2026-08-20")[0]).toBe(one);
  });

  /* One row per record means duplication is unreachable, not merely avoided. */
  it("never lists one priority twice on a day", () => {
    const one = p("2026-08-01");
    const ids = prioritiesOn([one], "2026-08-30").map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("whether it was done, as at a day", () => {
  it("is not done on a day before it was finished", () => {
    const one = p("2026-08-10", "2026-08-15");
    expect(doneOn(one, "2026-08-11")).toBe(false);
    expect(doneOn(one, "2026-08-15")).toBe(true);
  });

  it("is never done while it is still open", () => {
    expect(doneOn(p("2026-08-10"), "2027-01-01")).toBe(false);
  });
});

describe("saying where a line came from", () => {
  it("names the day it was written when it has rolled", () => {
    expect(carriedFrom(p("2026-08-10"), "2026-08-14")).toBe("2026-08-10");
  });

  it("says nothing on the day it was written", () => {
    expect(carriedFrom(p("2026-08-14"), "2026-08-14")).toBe(null);
  });
});

describe("no cap", () => {
  /*
   * There used to be a five-item limit. Rolling priorities forward made it
   * incoherent — a day can hold six before anybody types anything — so it is
   * gone, and what replaces it is nothing: every line the person has is on the
   * day it belongs on, in the order they put it in.
   */
  it("puts every line on the day, however many there are", () => {
    const twelve = Array.from({ length: 12 }, () => p("2026-08-15"));
    expect(prioritiesOn(twelve, "2026-08-15")).toHaveLength(12);
  });

  it("rolls all of them forward, not the first five", () => {
    const nine = Array.from({ length: 9 }, () => p("2026-08-01"));
    expect(prioritiesOn(nine, "2026-08-20")).toHaveLength(9);
    expect(prioritiesOn(nine, "2027-01-01")).toHaveLength(9);
  });

  it("lets what rolled in and what was written today sit together", () => {
    const all = [
      ...Array.from({ length: 4 }, () => p("2026-08-17")),
      ...Array.from({ length: 4 }, () => p("2026-08-18")),
      ...Array.from({ length: 3 }, () => p("2026-08-19")),
    ];
    const day = prioritiesOn(all, "2026-08-19");
    expect(day).toHaveLength(11);
    // Carried lines still say where they came from; today's do not.
    expect(day.filter((x) => carriedFrom(x, "2026-08-19") !== null)).toHaveLength(8);
  });

  it("keeps the user's order rather than sorting a long list", () => {
    const all = ["c", "a", "b", "e", "d", "f", "g"].map((t) => p("2026-08-15", null, t));
    expect(prioritiesOn(all, "2026-08-15").map((x) => x.text))
      .toEqual(["c", "a", "b", "e", "d", "f", "g"]);
  });

  it("still drops a line from the day it was finished on", () => {
    const all = Array.from({ length: 8 }, (_, i) =>
      p("2026-08-01", i < 3 ? "2026-08-02" : null));
    expect(prioritiesOn(all, "2026-08-02")).toHaveLength(8);   // finished today still shows
    expect(prioritiesOn(all, "2026-08-03")).toHaveLength(5);   // and is gone tomorrow
  });

  it("has no cap left to import", async () => {
    const types = await import("../src/lib/types");
    const lib = await import("../src/lib/priorities");
    expect("MAX_PRIORITIES" in types).toBe(false);
    expect("canAdd" in lib).toBe(false);
  });
});

describe("what the server accepts", () => {
  const fresh = { id: ID, date: "2026-08-15", category: "urgent_important" };

  it("takes a line and trims it", () => {
    expect(parseNewPriority({ ...fresh, text: "  padded  " }).text).toBe("padded");
  });

  it("refuses a blank line rather than storing one", () => {
    expect(() => parseNewPriority({ ...fresh, text: "   " })).toThrow();
    expect(() => parseNewPriority({ ...fresh, text: "" })).toThrow();
  });

  it("bounds the length of one line", () => {
    expect(() => parseNewPriority({ ...fresh, text: "x".repeat(300) })).toThrow();
  });

  it("insists on a real date and a real id", () => {
    expect(() => parseNewPriority({ ...fresh, id: ID, text: "x", date: undefined })).toThrow();
    expect(() => parseNewPriority({ ...fresh, text: "x", date: "yesterday" })).toThrow();
    expect(() => parseNewPriority({ ...fresh, id: "nope", text: "x" })).toThrow();
  });

  it("records a completion against the day being looked at", () => {
    expect(parsePriorityDone({ id: ID, done: true, date: "2026-08-12" }))
      .toEqual({ id: ID, done: true, date: "2026-08-12" });
  });

  it("only ever reads a boolean for done", () => {
    expect(parsePriorityDone({ id: ID, done: "yes", date: "2026-08-12" }).done).toBe(false);
  });
});

describe("the state shape", () => {
  it("starts empty rather than undefined", () => {
    expect(emptyState().priorities).toEqual([]);
  });

  it("defaults a legacy priority to the important & not urgent quadrant", () => {
    const legacy = { ...p("2026-08-10"), category: undefined } as any;
    expect(normalizePriorityCategory(legacy.category)).toBe("important_not_urgent");
    expect(normalizePriorityCategory("unsorted")).toBe("important_not_urgent");
    expect(DEFAULT_PRIORITY_CATEGORY).toBe("important_not_urgent");
  });

  it("keeps category order stable inside a quadrant", () => {
    const all = [
      { ...p("2026-08-10", null, "a"), category: "urgent_important", sortOrder: 1 },
      { ...p("2026-08-10", null, "b"), category: "urgent_important", sortOrder: 0 },
      { ...p("2026-08-10", null, "c"), category: "important_not_urgent", sortOrder: 0 },
    ];
    const urgent = all.filter((x) => x.category === "urgent_important").sort((a, b) => a.sortOrder - b.sortOrder);
    expect(urgent.map((x) => x.text)).toEqual(["b", "a"]);
  });
});

describe("bilingual", () => {
  it("names it in both languages", () => {
    expect(en.priorities.title).toBe("Today's priorities");
    expect(zh.priorities.title).toBe("今日优先事项");
    expect(zh.priorities.add).toBe("添加");
  });

  /*
   * The counter says what the day holds. It must never read as progress
   * towards a limit, which is what "1 / 5" said and what the cap's removal is
   * meant to stop saying.
   */
  it("counts what is there, in both languages", () => {
    expect(en.priorities.count(1, 8)).toBe("1 completed · 8 priorities");
    expect(en.priorities.count(0, 1)).toBe("0 completed · 1 priority");
    expect(zh.priorities.count(1, 8)).toBe("已完成 1 · 共 8 项");
    for (const dict of [en, zh]) {
      expect(dict.priorities.count(2, 11)).toContain("11");
      expect(dict.priorities.count(2, 11)).not.toMatch(/\/\s*5\b/);
    }
  });

  /* Guidance about focus, never a refusal. */
  it("encourages focus without forbidding anything, in both", () => {
    for (const [dict, forbidding] of [[en, /limit|maximum|cannot|can't|only five/i],
      [zh, /上限|最多|不能|不可/]] as const) {
      expect(dict.priorities.focusHint).toBeTruthy();
      expect(dict.priorities.focusHint).not.toMatch(forbidding);
    }
  });

  /* A line that arrives on its own has to say why, in either language. */
  it("explains a carried-over line in both", () => {
    expect(en.priorities.carriedFrom("Aug 12")).toContain("Aug 12");
    expect(zh.priorities.carriedFrom("8月12日")).toContain("8月12日");
  });

  it("labels every control for a screen reader, in both", () => {
    for (const dict of [en, zh]) {
      expect(dict.priorities.check("x")).toContain("x");
      expect(dict.priorities.uncheck("x")).toContain("x");
      expect(dict.priorities.remove("x")).toContain("x");
      expect(dict.priorities.moveUp(2)).toContain("2");
      expect(dict.priorities.moveDown(2)).toContain("2");
    }
  });
});

/*
 * Rearranging the matrix.
 *
 * The rule these pin down is the one the product depends on: a priority that
 * moves is the same priority. `layoutAfterMove` is the only place that decides
 * where everything sits, whether the move came from a drag or from the category
 * control, so testing it covers both interactions.
 */
describe("moving a priority between quadrants", () => {
  const at = (id: string, category: string, sortOrder: number): Priority =>
    ({ id, text: `t-${id}`, createdOn: "2026-09-01", completedOn: null,
       category: category as Priority["category"], plannedOn: null, sortOrder });

  const day = [
    at("a", "urgent_important", 0),
    at("b", "urgent_important", 1),
    at("c", "important_not_urgent", 0),
  ];

  const where = (layout: { id: string; category: string; sortOrder: number }[], id: string) =>
    layout.find((e) => e.id === id);

  it("files a priority into the quadrant it was dropped on", () => {
    const layout = layoutAfterMove(day, "c", "urgent_important", null);
    expect(where(layout, "c")?.category).toBe("urgent_important");
  });

  it("keeps the same record: only category and order are ever named", () => {
    const layout = layoutAfterMove(day, "c", "urgent_important", null);
    for (const entry of layout) {
      expect(Object.keys(entry).sort()).toEqual(["category", "id", "sortOrder"]);
    }
    // Every line that was on the day is still on it, under its own id.
    expect(layout.map((e) => e.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("puts it at the end of the destination when nothing is named", () => {
    const layout = layoutAfterMove(day, "c", "urgent_important", null);
    expect(where(layout, "c")?.sortOrder).toBe(2);
  });

  it("puts it above the sibling it was dropped on", () => {
    const layout = layoutAfterMove(day, "c", "urgent_important", "b");
    expect(where(layout, "c")?.sortOrder).toBe(1);
    expect(where(layout, "b")?.sortOrder).toBe(2);
  });

  it("reorders within one quadrant without changing its category", () => {
    const layout = layoutAfterMove(day, "b", "urgent_important", "a");
    expect(where(layout, "b")).toEqual({ id: "b", category: "urgent_important", sortOrder: 0 });
    expect(where(layout, "a")?.sortOrder).toBe(1);
  });

  it("closes the gap in the quadrant it left", () => {
    const layout = layoutAfterMove(day, "a", "important_not_urgent", null);
    expect(where(layout, "b")?.sortOrder).toBe(0);
  });

  it("numbers each quadrant densely from zero", () => {
    const layout = layoutAfterMove(day, "c", "urgent_important", null);
    const byCategory = new Map<string, number[]>();
    for (const e of layout) byCategory.set(e.category, [...(byCategory.get(e.category) ?? []), e.sortOrder]);
    for (const orders of byCategory.values()) {
      expect([...orders].sort((x, y) => x - y)).toEqual(orders.map((_, i) => i));
    }
  });

  /* Dropping something on itself is not a move to the end of the list. */
  it("does nothing when a line is dropped on itself", () => {
    expect(layoutAfterMove(day, "a", "urgent_important", "a")).toEqual([]);
  });

  it("does nothing for a line that is not on the day", () => {
    expect(layoutAfterMove(day, "zzz", "urgent_important", null)).toEqual([]);
  });

  it("does nothing for a category that is not one of the four", () => {
    expect(layoutAfterMove(day, "a", "unsorted" as any, null)).toEqual([]);
  });

  /*
   * The legacy rows this feature shipped on top of. They are stored `unsorted`
   * and displayed under Important & Not Urgent; the first rearrangement writes
   * down what was already on screen, and nothing appears to move.
   */
  it("resolves a legacy line into the quadrant it was already shown in", () => {
    const legacy = [at("x", "unsorted", 0), at("y", "unsorted", 1)];
    const layout = layoutAfterMove(legacy, "y", "urgent_important", null);
    expect(where(layout, "x")?.category).toBe("important_not_urgent");
  });

  it("never writes a fifth category", () => {
    const legacy = [at("x", "unsorted", 0), at("y", "unsorted", 1)];
    const layout = layoutAfterMove(legacy, "y", "urgent_important", null);
    expect(layout.every((e) => QUADRANTS.includes(e.category))).toBe(true);
    expect(layout.some((e) => e.category === "unsorted")).toBe(false);
  });

  it("offers exactly four quadrants, and no unsorted box", () => {
    expect(QUADRANTS).toHaveLength(4);
    expect(QUADRANTS).not.toContain("unsorted");
  });

  it("names all four in both languages, with a short form for the card", () => {
    for (const dict of [en, zh]) {
      for (const q of QUADRANTS) {
        expect(dict.priorities.quadrants[q].title).toBeTruthy();
        expect(dict.priorities.quadrants[q].subtitle).toBeTruthy();
        // Short enough to sit under the line without competing with it.
        expect(dict.priorities.quadrants[q].short.length).toBeLessThanOrEqual(10);
      }
    }
  });
});

/*
 * Classification is a decision, not a default.
 *
 * The bug these pin down is the one that made Q2 meaningless: every new line
 * was filed as important-and-not-urgent whatever it was, so the quadrant the
 * method says to protect became the quadrant everything fell into.
 */
describe("classifying a new priority", () => {
  it("derives each quadrant from the two answers", () => {
    expect(quadrantFor(true, true)).toBe("urgent_important");
    expect(quadrantFor(true, false)).toBe("important_not_urgent");
    expect(quadrantFor(false, true)).toBe("urgent_not_important");
    expect(quadrantFor(false, false)).toBe("not_important_not_urgent");
  });

  it("refuses to create one without a quadrant", () => {
    const b = { id: ID, text: "x", date: "2026-08-15" };
    expect(() => parseNewPriority(b)).toThrow();
    expect(() => parseNewPriority({ ...b, category: "" })).toThrow();
    expect(() => parseNewPriority({ ...b, category: "somewhere_else" })).toThrow();
  });

  /* The old default must not survive as a fallback anywhere. */
  it("never quietly files a new line under important & not urgent", () => {
    const b = { id: ID, text: "x", date: "2026-08-15" };
    expect(() => parseNewPriority(b)).toThrow();
    expect(() => parseNewPriority({ ...b, category: "unsorted" })).toThrow();
  });

  it("carries the chosen quadrant through", () => {
    for (const q of QUADRANTS) {
      expect(parseNewPriority({ id: ID, text: "x", date: "2026-08-15", category: q }).category)
        .toBe(q);
    }
  });
});

describe("the four boxes, in the order the method reads them", () => {
  it("puts do, protect, delegate and limit in that order", () => {
    expect(QUADRANTS).toEqual([
      "urgent_important",         // top left
      "important_not_urgent",     // top right
      "urgent_not_important",     // bottom left
      "not_important_not_urgent", // bottom right
    ]);
  });

  it("names the intent of each box in both languages", () => {
    for (const dict of [en, zh]) {
      expect(dict.priorities.quadrants.urgent_important.subtitle).toBeTruthy();
      expect(dict.priorities.quadrants.important_not_urgent.short).toBeTruthy();
      // The card label and the planning verb must not be the same word.
      expect(dict.priorities.quadrants.important_not_urgent.short)
        .not.toBe(dict.priorities.plan);
    }
  });
});

describe("planning a Q2 line", () => {
  const q2 = (plannedOn: string | null, completedOn: string | null = null): Priority =>
    ({ id: "p", text: "read", createdOn: "2026-09-01", completedOn,
       category: "important_not_urgent", plannedOn, sortOrder: 0 });

  it("takes a real date, or nothing", () => {
    expect(parsePriorityPlan({ id: ID, plannedOn: "2026-09-12" }).plannedOn).toBe("2026-09-12");
    expect(parsePriorityPlan({ id: ID, plannedOn: null }).plannedOn).toBeNull();
    expect(parsePriorityPlan({ id: ID, plannedOn: "" }).plannedOn).toBeNull();
    expect(() => parsePriorityPlan({ id: ID, plannedOn: "next tuesday" })).toThrow();
  });

  it("is not overdue before the day arrives, nor on it", () => {
    expect(isPlanOverdue(q2("2026-09-12"), "2026-09-10")).toBe(false);
    expect(isPlanOverdue(q2("2026-09-12"), "2026-09-12")).toBe(false);
  });

  it("is overdue once the day has passed and it is still open", () => {
    expect(isPlanOverdue(q2("2026-09-12"), "2026-09-13")).toBe(true);
  });

  /* Finishing late is still finishing. */
  it("is never overdue once it is done", () => {
    expect(isPlanOverdue(q2("2026-09-12", "2026-09-14"), "2026-09-15")).toBe(false);
  });

  it("says nothing about a line with no planned day", () => {
    expect(isPlanOverdue(q2(null), "2030-01-01")).toBe(false);
  });
});

describe("the one line under the heading", () => {
  const at = (id: string, category: string, completedOn: string | null = null): Priority =>
    ({ id, text: `t-${id}`, createdOn: "2026-09-01", completedOn,
       category: category as Priority["category"], plannedOn: null, sortOrder: 0 });
  const TODAY = "2026-09-09";

  it("says nothing on a quiet day", () => {
    expect(cueFor([at("a", "urgent_important")], TODAY, true)).toBeNull();
  });

  it("counts the important work that is not urgent yet", () => {
    const items = ["a", "b", "c"].map((id) => at(id, "important_not_urgent"));
    expect(cueFor(items, TODAY, false)).toEqual({ kind: "insight", key: "protect", count: 3 });
  });

  it("notices a day that is mostly urgent", () => {
    const items = [at("a", "urgent_important"), at("b", "urgent_important"),
      at("c", "urgent_not_important"), at("d", "important_not_urgent")];
    expect(cueFor(items, TODAY, false)?.kind).toBe("insight");
    expect((cueFor(items, TODAY, false) as any).key).toBe("mostly_urgent");
  });

  /* Legacy rows read as important & not urgent, and must count as such. */
  it("counts a legacy line under the quadrant it is displayed in", () => {
    const items = ["a", "b", "c"].map((id) => at(id, "unsorted"));
    expect((cueFor(items, TODAY, false) as any).key).toBe("protect");
  });

  it("offers a nudge after an urgent, important thing is finished", () => {
    const items = [at("a", "urgent_important", TODAY)];
    expect(cueFor(items, TODAY, true))
      .toEqual({ kind: "nudge", quadrant: "urgent_important" });
  });

  it("holds that nudge back once the day's one has been dismissed", () => {
    const items = [at("a", "urgent_important", TODAY)];
    expect(cueFor(items, TODAY, false)).toBeNull();
  });

  it("never returns a nudge and an insight together", () => {
    const items = [at("a", "urgent_important", TODAY),
      ...["b", "c", "d"].map((id) => at(id, "important_not_urgent"))];
    const cue = cueFor(items, TODAY, true);
    expect(cue?.kind).toBe("nudge");
  });

  /* Completed lines are not still on the to-do list. */
  it("does not count finished work as outstanding", () => {
    const items = ["a", "b", "c"].map((id) => at(id, "important_not_urgent", TODAY));
    expect(cueFor(items, TODAY, false)).toBeNull();
  });

  it("asks each question supportively, in both languages", () => {
    for (const dict of [en, zh]) {
      for (const q of ["urgent_important", "urgent_not_important", "not_important_not_urgent"]) {
        expect(dict.priorities.nudge[q]).toBeTruthy();
        // A question, never a verdict.
        expect(dict.priorities.nudge[q]).toMatch(/[?？]$/);
      }
      expect(dict.priorities.insight.protect(6)).toContain("6");
      expect(dict.priorities.insight.mostlyUrgent()).toBeTruthy();
    }
  });
});

/*
 * Adding straight into a box.
 *
 * The risky part is not the create — that reuses the path the global row
 * already uses — it is the four-way table for dismissing a half-typed line.
 * Getting it wrong means silently throwing away someone's words, so it is
 * pinned here case by case rather than left to the component.
 */
describe("adding inside one quadrant", () => {
  const open = (category: any = "urgent_important") =>
    quadrantAdd(NO_QUADRANT_ADD, { type: "open", category });
  const typed = (text: string, category: any = "urgent_important") =>
    quadrantAdd(open(category), { type: "type", category, text });

  it("opens the box that was asked for", () => {
    expect(open("urgent_not_important").open).toBe("urgent_not_important");
  });

  it("keeps what is typed, per quadrant", () => {
    const s = quadrantAdd(typed("write it down"), {
      type: "type", category: "not_important_not_urgent", text: "other box" });
    expect(s.drafts.urgent_important).toBe("write it down");
    expect(s.drafts.not_important_not_urgent).toBe("other box");
  });

  // ---- the table ----------------------------------------------------------
  it("closes an empty field when clicked away from", () => {
    expect(quadrantAdd(open(), { type: "away" }).open).toBeNull();
  });

  it("closes an empty field on Escape", () => {
    expect(quadrantAdd(open(), { type: "escape" }).open).toBeNull();
  });

  /* A stray click elsewhere is not a decision to abandon a sentence. */
  it("leaves a field with words in it open when clicked away from", () => {
    const s = quadrantAdd(typed("half a thought"), { type: "away" });
    expect(s.open).toBe("urgent_important");
    expect(s.drafts.urgent_important).toBe("half a thought");
  });

  it("closes on Escape but never destroys the words", () => {
    const s = quadrantAdd(typed("half a thought"), { type: "escape" });
    expect(s.open).toBeNull();
    expect(s.drafts.urgent_important).toBe("half a thought");
  });

  it("gives the draft back when that quadrant is reopened", () => {
    const closed = quadrantAdd(typed("half a thought"), { type: "escape" });
    const again = quadrantAdd(closed, { type: "open", category: "urgent_important" });
    expect(again.drafts.urgent_important).toBe("half a thought");
  });

  /* Working in another box must not disturb the first one's draft. */
  it("keeps drafts apart across quadrants", () => {
    let s = typed("q1 words", "urgent_important");
    s = quadrantAdd(s, { type: "escape" });
    s = quadrantAdd(s, { type: "open", category: "important_not_urgent" });
    s = quadrantAdd(s, { type: "type", category: "important_not_urgent", text: "q2 words" });
    s = quadrantAdd(s, { type: "escape" });
    s = quadrantAdd(s, { type: "open", category: "urgent_important" });
    expect(s.drafts.urgent_important).toBe("q1 words");
    expect(s.drafts.important_not_urgent).toBe("q2 words");
  });

  it("clears only that quadrant's draft once the line is created", () => {
    let s = typed("q1 words", "urgent_important");
    s = quadrantAdd(s, { type: "type", category: "important_not_urgent", text: "q2 words" });
    s = quadrantAdd(s, { type: "added" });
    expect(s.open).toBeNull();
    expect(s.drafts.urgent_important).toBeUndefined();
    expect(s.drafts.important_not_urgent).toBe("q2 words");
  });

  it("treats whitespace as nothing waiting", () => {
    const s = quadrantAdd(typed("   "), { type: "escape" });
    expect(hasDraft(s, "urgent_important")).toBe(false);
    expect(s.open).toBeNull();
  });

  it("ignores dismissal when nothing is open", () => {
    expect(quadrantAdd(NO_QUADRANT_ADD, { type: "escape" })).toEqual(NO_QUADRANT_ADD);
    expect(quadrantAdd(NO_QUADRANT_ADD, { type: "away" })).toEqual(NO_QUADRANT_ADD);
  });

  /* Choosing the box is the classification; there is nothing else to ask. */
  it("creates in the quadrant it was opened from, in either language", () => {
    for (const q of QUADRANTS) {
      expect(parseNewPriority({ id: ID, text: "x", date: "2026-09-09", category: q }).category)
        .toBe(q);
    }
  });

  it("has three wordings for a collapsed box, in both languages", () => {
    for (const dict of [en, zh]) {
      expect(dict.priorities.addHere).toBeTruthy();
      expect(dict.priorities.addFirstHere).toBeTruthy();
      expect(dict.priorities.continueAdding).toBeTruthy();
      // The waiting-draft wording must not be the same line as the ordinary one.
      expect(dict.priorities.continueAdding).not.toBe(dict.priorities.addHere);
      expect(dict.priorities.continueAdding).not.toBe(dict.priorities.addFirstHere);
      // An empty box still has its own drop wording for the drag case.
      expect(dict.priorities.dropHere).toBeTruthy();
    }
  });
});
