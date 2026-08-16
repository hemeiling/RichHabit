import { describe, expect, it } from "vitest";
import { parsePriorities } from "../src/lib/validate";
import { MAX_PRIORITIES, emptyState } from "../src/lib/types";
import { en } from "../src/lib/i18n/en";
import { zh } from "../src/lib/i18n/zh";

const day = { date: "2026-08-15" };

describe("the day's post-it", () => {
  it("keeps what was written, in order, with its done state", () => {
    const out = parsePriorities({ ...day, items: [
      { text: "Finish the project review", done: true },
      { text: "Exercise", done: false },
      { text: "Call family", done: false },
    ] });
    expect(out.items.map((i: { text: string }) => i.text))
      .toEqual(["Finish the project review", "Exercise", "Call family"]);
    expect(out.items[0].done).toBe(true);
  });

  /** The cap is the feature: it stops being a post-it at about six. */
  it("refuses more than five", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ text: `item ${i}`, done: false }));
    expect(() => parsePriorities({ ...day, items: six })).toThrow(/at most/i);
    const five = six.slice(0, MAX_PRIORITIES);
    expect(parsePriorities({ ...day, items: five }).items).toHaveLength(5);
  });

  it("does not require any particular number", () => {
    expect(parsePriorities({ ...day, items: [] }).items).toEqual([]);
    expect(parsePriorities({ ...day, items: [{ text: "one thing" }] }).items).toHaveLength(1);
  });

  it("drops blank lines rather than storing them", () => {
    const out = parsePriorities({ ...day, items: [
      { text: "a real one" }, { text: "" }, { text: "   " },
    ] });
    expect(out.items).toHaveLength(1);
  });

  it("trims, and treats a missing done as not done", () => {
    const out = parsePriorities({ ...day, items: [{ text: "  padded  " }] });
    expect(out.items[0]).toEqual({ text: "padded", done: false });
  });

  it("only ever stores a boolean for done", () => {
    const out = parsePriorities({ ...day, items: [{ text: "x", done: "yes" }] });
    expect(out.items[0].done).toBe(false);
  });

  it("bounds the length of one line", () => {
    expect(() => parsePriorities({ ...day, items: [{ text: "x".repeat(300) }] })).toThrow();
  });

  it("insists on a real date", () => {
    expect(() => parsePriorities({ items: [{ text: "x" }] })).toThrow();
    expect(() => parsePriorities({ date: "yesterday", items: [] })).toThrow();
  });
});

describe("the state shape", () => {
  it("starts empty rather than undefined", () => {
    expect(emptyState().priorities).toEqual({});
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
