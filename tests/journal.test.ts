import { describe, expect, it } from "vitest";
import { parseJournal, parseMonthlyReflection, MAX_GRATITUDE_ITEMS } from "../src/lib/validate";
import { emptyState } from "../src/lib/types";
import { en } from "../src/lib/i18n/en";
import { zh } from "../src/lib/i18n/zh";

describe("a day's journal", () => {
  const day = { date: "2026-08-15" };

  it("keeps what was written, in order", () => {
    const out = parseJournal({ ...day, gratitude: ["my family", "the weather"] });
    expect(out.gratitude).toEqual(["my family", "the weather"]);
  });

  /** Three boxes and one thing to say is the normal case, not an error. */
  it("drops blank lines instead of refusing them", () => {
    const out = parseJournal({ ...day, gratitude: ["one thing", "", "   "] });
    expect(out.gratitude).toEqual(["one thing"]);
  });

  it("does not require three, or any particular number", () => {
    expect(parseJournal({ ...day, gratitude: [] }).gratitude).toEqual([]);
    expect(parseJournal({ ...day, gratitude: ["a"] }).gratitude).toHaveLength(1);
    expect(parseJournal({ ...day, gratitude: ["a", "b", "c", "d", "e"] }).gratitude)
      .toHaveLength(5);
  });

  it("trims each entry", () => {
    expect(parseJournal({ ...day, gratitude: ["  a walk  "] }).gratitude).toEqual(["a walk"]);
  });

  it("bounds how much one day can hold", () => {
    const many = Array(MAX_GRATITUDE_ITEMS + 1).fill("x");
    expect(() => parseJournal({ ...day, gratitude: many })).toThrow(/at most/i);
  });

  it("refuses an entry longer than the column allows", () => {
    expect(() => parseJournal({ ...day, gratitude: ["x".repeat(400)] })).toThrow();
  });

  it("keeps the optional reflection, and accepts the old field name", () => {
    expect(parseJournal({ ...day, reflection: "a good day" }).reflection).toBe("a good day");
    // `body` is what the day note used to be called; existing clients still work.
    expect(parseJournal({ ...day, body: "an older note" }).reflection).toBe("an older note");
  });

  it("insists on a real date", () => {
    expect(() => parseJournal({ gratitude: ["a"] })).toThrow();
    expect(() => parseJournal({ date: "not-a-date", gratitude: ["a"] })).toThrow();
  });
});

describe("a month's reflection", () => {
  it("accepts a YYYY-MM month", () => {
    expect(parseMonthlyReflection({ month: "2026-08", body: "a full month" }).month)
      .toBe("2026-08");
  });

  it("refuses anything else", () => {
    for (const bad of ["2026", "2026-8", "august", "2026-08-15"]) {
      expect(() => parseMonthlyReflection({ month: bad, body: "" }), bad).toThrow();
    }
  });
});

describe("the state shape", () => {
  it("starts with an empty journal rather than undefined", () => {
    const s = emptyState();
    expect(s.journal).toEqual({});
    expect(s.monthlyReflections).toEqual({});
  });
});

describe("bilingual", () => {
  it("names the feature in both languages", () => {
    expect(en.journal.title).toBe("Gratitude journal");
    expect(zh.journal.title).toBe("感恩日记");
    expect(zh.journal.prompt).toBe("今天有什么值得感恩的？");
    expect(zh.journal.addItem).toBe("添加一条");
    expect(zh.journal.monthlyTitle).toBe("本月感恩回顾");
    expect(zh.journal.reflectTitle).toBe("我的月度反思");
  });

  it("offers the monthly prompts in both, and the same number of them", () => {
    expect(en.journal.prompts.length).toBe(zh.journal.prompts.length);
    expect(en.journal.prompts.length).toBeGreaterThanOrEqual(5);
    for (const p of zh.journal.prompts) expect(p).toMatch(/[一-鿿]/);
  });

  it("has no leftover 'today's notes' wording", () => {
    expect(JSON.stringify(zh.journal)).not.toContain("今日记录");
    expect(en.journal.title).not.toMatch(/notes/i);
  });
});
