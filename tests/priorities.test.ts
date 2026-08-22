import { describe, expect, it } from "vitest";
import { parseNewPriority, parsePriorityDone } from "../src/lib/validate";
import { canAdd, carriedFrom, doneOn, prioritiesOn } from "../src/lib/priorities";
import { MAX_PRIORITIES, emptyState } from "../src/lib/types";
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

describe("the cap", () => {
  /** The cap is the feature: it stops being a post-it at about six. */
  it("stops a sixth being added to a day", () => {
    const five = Array.from({ length: MAX_PRIORITIES }, () => p("2026-08-15"));
    expect(canAdd(five, "2026-08-15")).toBe(false);
    expect(canAdd(five.slice(1), "2026-08-15")).toBe(true);
  });

  it("counts what rolled in, not just what was written today", () => {
    const rolled = Array.from({ length: MAX_PRIORITIES }, () => p("2026-08-01"));
    expect(canAdd(rolled, "2026-08-20")).toBe(false);
  });

  it("does not count lines already finished", () => {
    const done = Array.from({ length: MAX_PRIORITIES }, () => p("2026-08-01", "2026-08-02"));
    expect(canAdd(done, "2026-08-20")).toBe(true);
  });

  /*
   * History can push a day past the cap without anyone adding anything: three
   * left unfinished on Monday and three more written Tuesday is six by
   * Wednesday. Every one is still shown — dropping the sixth would lose
   * something the user wrote, which is worse than an over-full note.
   */
  it("still shows every line when history has pushed a day over the cap", () => {
    const all = [
      ...Array.from({ length: 3 }, () => p("2026-08-17")),
      ...Array.from({ length: 3 }, () => p("2026-08-18")),
    ];
    expect(prioritiesOn(all, "2026-08-19")).toHaveLength(6);
    expect(canAdd(all, "2026-08-19")).toBe(false);
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

  it("says the limit in both, in the same friendly terms", () => {
    expect(en.priorities.full).toMatch(/post-it/i);
    expect(zh.priorities.full).toMatch(/便利贴/);
  });

  /* A line that arrives on its own has to say why, in either language. */
  it("explains a carried-over line in both", () => {
    expect(en.priorities.carriedFrom("Aug 12")).toContain("Aug 12");
    expect(zh.priorities.carriedFrom("8月12日")).toContain("8月12日");
    expect(en.priorities.overflowing).toMatch(/carried over/i);
    expect(zh.priorities.overflowing).toMatch(/延续/);
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
