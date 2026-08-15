import { describe, expect, it } from "vitest";
import { monthOf, previousMonth, summarise } from "@/lib/spending";
import type { SpendingRecord } from "@/lib/types";

let n = 0;
const rec = (r: Partial<SpendingRecord> & { date: string; amount: number }): SpendingRecord => ({
  id: `s${n++}`,
  description: "",
  category: "other",
  needWant: "need",
  planned: true,
  notes: "",
  ...r,
});

describe("month arithmetic", () => {
  it("takes the month off an ISO date", () => {
    expect(monthOf("2026-03-31")).toBe("2026-03");
  });

  it("steps back a month without landing in the wrong one", () => {
    expect(previousMonth("2026-03")).toBe("2026-02");
    expect(previousMonth("2026-12")).toBe("2026-11");
  });

  it("crosses the January boundary", () => {
    expect(previousMonth("2026-01")).toBe("2025-12");
  });

  /**
   * The bug this replaced: `new Date("2026-03-31").setMonth(1)` is February 31,
   * which rolls forward to March 3 — so "last month" came back as March and the
   * screen compared the month against itself, always reporting no change.
   */
  it("is unaffected by the length of the month", () => {
    expect(previousMonth(monthOf("2026-03-31"))).toBe("2026-02");
    expect(previousMonth(monthOf("2026-05-31"))).toBe("2026-04");
  });
});

describe("summarise", () => {
  it("is empty and offers no percentages when nothing is recorded", () => {
    const s = summarise([], "2026-03");
    expect(s.total).toBe(0);
    expect(s.unplannedPct).toBeNull();
    expect(s.wantPct).toBeNull();
    expect(s.changePct).toBeNull();
    expect(s.byCategory).toEqual([]);
  });

  it("only counts the month asked for", () => {
    const s = summarise([
      rec({ date: "2026-03-01", amount: 10 }),
      rec({ date: "2026-02-28", amount: 99 }),
      rec({ date: "2026-04-01", amount: 99 }),
    ], "2026-03");
    expect(s.total).toBe(10);
  });

  /** §27. Category % = category spending / total tracked spending × 100. */
  it("gives each category its share of the month", () => {
    const s = summarise([
      rec({ date: "2026-03-01", amount: 60, category: "food" }),
      rec({ date: "2026-03-02", amount: 30, category: "food" }),
      rec({ date: "2026-03-03", amount: 10, category: "transport" }),
    ], "2026-03");

    expect(s.total).toBe(100);
    expect(s.byCategory).toEqual([
      { key: "food", spent: 90, pct: 90 },
      { key: "transport", spent: 10, pct: 10 },
    ]);
  });

  it("leaves out categories with no spending", () => {
    const s = summarise([rec({ date: "2026-03-01", amount: 5, category: "food" })], "2026-03");
    expect(s.byCategory.map((c) => c.key)).toEqual(["food"]);
  });

  it("orders categories largest first", () => {
    const s = summarise([
      rec({ date: "2026-03-01", amount: 5, category: "food" }),
      rec({ date: "2026-03-01", amount: 50, category: "housing" }),
      rec({ date: "2026-03-01", amount: 20, category: "travel" }),
    ], "2026-03");
    expect(s.byCategory.map((c) => c.key)).toEqual(["housing", "travel", "food"]);
  });

  it("splits planned from unplanned", () => {
    const s = summarise([
      rec({ date: "2026-03-01", amount: 75, planned: true }),
      rec({ date: "2026-03-02", amount: 25, planned: false }),
    ], "2026-03");
    expect(s.unplanned).toBe(25);
    expect(s.unplannedPct).toBe(25);
  });

  it("splits needs from wants", () => {
    const s = summarise([
      rec({ date: "2026-03-01", amount: 80, needWant: "need" }),
      rec({ date: "2026-03-02", amount: 20, needWant: "want" }),
    ], "2026-03");
    expect(s.wants).toBe(20);
    expect(s.wantPct).toBe(20);
  });

  it("compares against the previous month", () => {
    const records = [
      rec({ date: "2026-02-10", amount: 200 }),
      rec({ date: "2026-03-10", amount: 250 }),
    ];
    expect(summarise(records, "2026-03").changePct).toBeCloseTo(25);
    expect(summarise(records, "2026-02").changePct).toBeNull();
  });

  it("reports a fall as a negative change", () => {
    const s = summarise([
      rec({ date: "2026-02-10", amount: 200 }),
      rec({ date: "2026-03-10", amount: 150 }),
    ], "2026-03");
    expect(s.changePct).toBeCloseTo(-25);
  });

  it("does not divide by an empty previous month", () => {
    const s = summarise([rec({ date: "2026-03-10", amount: 150 })], "2026-03");
    expect(s.changePct).toBeNull();
  });

  it("keeps sums to cents rather than surfacing float noise", () => {
    const s = summarise([
      rec({ date: "2026-03-01", amount: 0.1 }),
      rec({ date: "2026-03-02", amount: 0.2 }),
    ], "2026-03");
    expect(s.total).toBe(0.3);
  });
});
