import { describe, expect, it } from "vitest";
import { parseNewPriority, parsePriorityDone } from "../src/lib/validate";
import { carriedFrom, doneOn, prioritiesOn } from "../src/lib/priorities";
import { emptyState } from "../src/lib/types";
import type { Priority } from "../src/lib/types";
import { en } from "../src/lib/i18n/en";
import { zh } from "../src/lib/i18n/zh";

const ID = "11111111-1111-4111-8111-111111111111";

let n = 0;
const p = (createdOn: string, completedOn: string | null = null, text = `item ${++n}`): Priority =>
  ({ id: `${n}`, text, createdOn, completedOn });

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
  const fresh = { id: ID, date: "2026-08-15" };

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
    expect(() => parseNewPriority({ id: ID, text: "x" })).toThrow();
    expect(() => parseNewPriority({ id: ID, text: "x", date: "yesterday" })).toThrow();
    expect(() => parseNewPriority({ id: "nope", text: "x", date: "2026-08-15" })).toThrow();
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
